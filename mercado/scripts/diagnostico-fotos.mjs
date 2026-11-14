// Diagnóstico de fotos por fuente (solo lectura: no escribe nada).
//   node scripts/diagnostico-fotos.mjs exotic-avenue,prestige-dlc
// 1. En la base (si hay SUPABASE_DB_URL): cuántos anuncios activos no tienen fotos y si las ligas guardadas abren.
// 2. En el sitio: abre 3 fichas con el adaptador y muestra qué fotos encuentra (y qué hay en el HTML).
import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { PoliteFetcher } from '../core/http.mjs';
import { adapters } from '../adapters/index.mjs';

const ids = (process.argv[2] ?? '').split(',').map(s => s.trim()).filter(Boolean);
const cfg = parseYaml(readFileSync(new URL('../sources.yaml', import.meta.url), 'utf8'));
const UA = 'Mozilla/5.0 (compatible; MercadoMX-diagnostico)';

async function probe(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', headers: { 'user-agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
    return `${r.status} ${r.headers.get('content-type') ?? '?'} ${r.headers.get('content-length') ?? '?'}B`;
  } catch (e) { return `ERROR ${e.message}`; }
}

if (process.env.SUPABASE_DB_URL) {
  const postgres = (await import('postgres')).default;
  const { dbOptions } = await import('../core/dburl.mjs');
  const sql = postgres({ ...dbOptions(process.env.SUPABASE_DB_URL), max: 1, prepare: false, idle_timeout: 5 });
  try {
    for (const id of ids) {
      const [c] = await sql`select count(*)::int anuncios,
          count(*) filter (where not exists (select 1 from mx_photos p where p.listing_id = l.id))::int sin_fotos,
          count(*) filter (where l.status = 'activo')::int activos
        from mx_listings l where l.source_id = ${id}`;
      console.log(`\n══ ${id} · base: ${JSON.stringify(c)}`);
      const rows = await sql`select l.url ficha, p.url foto, p.phash is not null con_huella from mx_photos p join mx_listings l on l.id = p.listing_id
        where l.source_id = ${id} order by p.id desc limit 4`;
      for (const r of rows) console.log(`  foto guardada: ${r.foto}\n    → ${await probe(r.foto)} · huella: ${r.con_huella} · ficha ${r.ficha}`);
      // todas las fotos guardadas: cuántas ya no abren y cuántos anuncios se quedaron sin ninguna que abra
      const all = await sql`select l.id, l.url ficha, l.status, p.url foto from mx_photos p join mx_listings l on l.id = p.listing_id where l.source_id = ${id} order by l.id, p.position limit 600`;
      const byL = new Map(); let rotas = 0;
      for (const r of all) {
        const st = await probe(r.foto), ok = /^200 image\//.test(st);
        if (!ok) rotas++;
        if (!byL.has(r.id)) byL.set(r.id, { ficha: r.ficha, status: r.status, ok: 0, mal: 0, ej: null });
        const x = byL.get(r.id); if (ok) x.ok++; else { x.mal++; x.ej = x.ej ?? `${r.foto} → ${st}`; }
      }
      const todasRotas = [...byL.values()].filter(x => x.ok === 0);
      console.log(`  fotos revisadas ${all.length} · no abren ${rotas} · anuncios con TODAS rotas ${todasRotas.length} de ${byL.size}`);
      for (const x of todasRotas.slice(0, 5)) console.log(`    ${x.status} ${x.ficha}\n      ej. ${x.ej}`);
      const sin = await sql`select url from mx_listings l where source_id = ${id} and not exists (select 1 from mx_photos p where p.listing_id = l.id) limit 3`;
      for (const r of sin) console.log(`  sin fotos: ${r.url}`);
    }
  } finally { await sql.end({ timeout: 5 }); }
}

for (const id of process.env.DIAG_SOLO_BASE ? [] : ids) {
  const s = cfg.sources.find(x => x.id === id);
  if (!s) { console.log(`no existe ${id}`); continue; }
  const source = { ...cfg.defaults, ...s };
  const fetcher = new PoliteFetcher({ userAgent: source.user_agent, minDelayMs: 2000, retries: 1 });
  const ad = adapters[source.adapter ?? source.id](source);
  console.log(`\n══ ${id} · sitio (${source.base_url})`);
  let n = 0;
  for await (const raw of ad.listings({ fetcher, source, log: console.log, isKnown: () => false, wanted: () => true })) {
    if (!raw.photos) continue;
    console.log(`  ficha: ${raw.url}\n  título: ${raw.title} · fotos que lee el adaptador: ${raw.photos.length}`);
    for (const u of raw.photos.slice(0, 3)) console.log(`    ${u}\n      → ${await probe(u)}`);
    // lo que hay en el HTML, por si el adaptador no lo está viendo
    const html = (await fetcher.get(raw.url)).text;
    const imgs = [...html.matchAll(/<img[^>]+>/gi)].map(m => m[0].slice(0, process.env.DIAG_TAG_LARGO ? 1500 : 220)).slice(0, 8);
    const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*>/i)?.[0];
    const ld = [...html.matchAll(/"image"\s*:\s*(\[[^\]]{0,600}|"[^"]{0,300}")/g)].map(m => m[1].slice(0, 300)).slice(0, 2);
    console.log(`    og:image: ${og ?? '—'}\n    JSON-LD image: ${ld.join(' | ') || '—'}\n    <img> (primeras):\n      ${imgs.join('\n      ')}`);
    const urls = [...new Set([...html.matchAll(/["'(](\/?[^"'()\s]+\.(?:jpe?g|png|webp|avif))/gi)].map(m => m[1]))].slice(0, 15);
    console.log(`    rutas de imagen en el HTML: \n      ${urls.join('\n      ')}`);
    if (++n >= 3) break;
  }
}
