// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Comando de ingesta
//
//   node scripts/ingest.mjs --seco --fuente seminuevos-com --limite 15
//       Corre de verdad contra el sitio, pero guarda en una base temporal en
//       memoria (PGlite). No necesita secrets y no toca Supabase. Sirve para
//       ver qué entraría.
//
//   node scripts/ingest.mjs                 (lo que corre GitHub Actions)
//       Todas las fuentes con enabled: true en sources.yaml, contra Supabase.
//       Requiere SUPABASE_DB_URL (secret de GitHub, nunca en el código).
//
// Opciones: --fuente a,b · --limite N · --sin-fotos · --hoy AAAA-MM-DD · --reporte archivo.json
//           --semilla .capturas/semilla-prod.json (solo con --seco): arranca la base temporal con
//           lo que ya hay en Supabase (scripts/semilla-prod.mjs), para que el anti-duplicados
//           compare contra producción; --exportar deja fuera esas filas.
// ════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { PoliteFetcher } from '../core/http.mjs';
import { Store, fromPglite, fromPostgres } from '../core/store.mjs';
import { runAll } from '../core/pipeline.mjs';
import { adapters } from '../adapters/index.mjs';

const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

const dry = flag('seco');
const only = opt('fuente')?.split(',').map(s => s.trim());
const limit = opt('limite') ? Number(opt('limite')) : Infinity;
const today = opt('hoy') ?? new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

const cfg = parseYaml(readFileSync(new URL('../sources.yaml', import.meta.url), 'utf8'));
const all = cfg.sources.map(s => ({ ...cfg.defaults, ...s }));
let sources = all.filter(s => !['manual', 'script_local'].includes(s.capture_mode));
if (only) sources = sources.filter(s => only.includes(s.id));
else sources = sources.filter(s => s.enabled);
// --archivo ruta.json: carga una captura local (API de Mercado Libre, Marketplace…) como la fuente indicada.
if (opt('archivo')) {
  if (!only || only.length !== 1) { console.error('Con --archivo indica una sola --fuente.'); process.exit(2); }
  const s = all.find(x => x.id === only[0]);
  if (!s) { console.error(`No existe la fuente ${only[0]} en sources.yaml`); process.exit(2); }
  sources = [{ ...s, adapter: 'archivo-json', config: { ...(s.config ?? {}), file: opt('archivo') } }];
}
if (!dry && only && sources.some(s => !s.enabled)) {
  console.error('Solo se corren contra Supabase fuentes con enabled: true. Usa --seco para probar una desactivada.');
  process.exit(2);
}
if (!sources.length) { console.log('No hay fuentes para correr.'); process.exit(0); }

let db;
if (dry) {
  const { freshLocalDb } = await import('../core/local-db.mjs');
  db = fromPglite(await freshLocalDb());
  console.log('Modo seco: base temporal en memoria (no se toca Supabase).');
} else {
  if (!process.env.SUPABASE_DB_URL) { console.error('Falta SUPABASE_DB_URL (secret de GitHub).'); process.exit(2); }
  const postgres = (await import('postgres')).default;
  db = fromPostgres(postgres(process.env.SUPABASE_DB_URL, { max: 1, prepare: false, idle_timeout: 20 }));
}
const store = new Store(db);
await store.syncSources(all);

const colsOf = async t => (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1
  and is_generated = 'NEVER' order by ordinal_position`, [t])).rows.map(r => r.column_name);
const json = v => JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? x.toString() : x));   // hashes de 64 bits
const seeded = new Map();   // tabla → filas (JSON) que venían de producción: no se re-exportan
if (opt('semilla')) {
  if (!dry) { console.error('--semilla solo tiene sentido con --seco.'); process.exit(2); }
  const { tablas } = JSON.parse(readFileSync(opt('semilla'), 'utf8'));
  for (const [t, rows] of Object.entries(tablas)) {
    if (!rows.length) continue;
    const cols = await colsOf(t);
    await db.query(`insert into public.${t} (${cols.join(', ')}) overriding system value
      select ${cols.join(', ')} from json_populate_recordset(null::public.${t}, $1::json)`, [JSON.stringify(rows)]);
  }
  for (const t of Object.keys(tablas)) {
    // ids de identidad: que los nuevos sigan después de los de producción
    const idn = (await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'id' and is_identity = 'YES'`, [t])).rows.length;
    if (idn && tablas[t].length) await db.query(`select setval(pg_get_serial_sequence('public.${t}', 'id'), (select max(id) from public.${t}))`);
    const cols = await colsOf(t);
    seeded.set(t, new Set((await db.query(`select ${cols.join(', ')} from ${t}`)).rows.map(json)));
  }
  console.log('Semilla de producción cargada:', Object.fromEntries(Object.entries(tablas).map(([t, r]) => [t, r.length])));
}

const makeFetcher = s => new PoliteFetcher({ userAgent: s.user_agent, minDelayMs: (s.min_delay_seconds ?? 3) * 1000, retries: s.retries ?? 3,
  log: e => { if (e.error || e.status >= 400) console.log(`    ${e.status ?? 'ERR'} ${e.url}${e.error ? ' · ' + e.error : ''}`); } });

const reports = await runAll({ sources, adapters, store, makeFetcher, today, trigger: dry ? 'manual' : 'cron', limit, hashPhotos: !flag('sin-fotos') });

console.log(`\n══ Reporte ${today} ${dry ? '(seco)' : ''} ══`);
for (const r of reports) {
  console.log(`\n${r.ok ? '✓' : '✗'} ${r.fuente}${r.fatal ? ' · ' + r.fatal : ''}`);
  console.log(`  nuevos ${r.nuevos} (unidos a un auto ya conocido: ${r.unidos_a_auto_existente}) · actualizados ${r.actualizados} · sin cambio ${r.sin_cambio}`);
  console.log(`  fuera de la taxonomía ${r.fuera_de_taxonomia} · marcados vendidos ${r.marcados_vendidos ?? 0} · a revisión: duplicado ${r.a_revision_duplicado}, normalización ${r.a_revision_normalizacion}`);
  console.log(`  activos no vistos hoy ${r.completa ? r.no_vistos : '(corrida parcial: no se cuenta)'} · errores ${r.errores.length} · peticiones ${r.resumen.peticiones}`);
  if (r.muestras.length) console.table(r.muestras);
}
if (opt('reporte')) writeFileSync(opt('reporte'), JSON.stringify({ fecha: today, seco: dry, fuentes: reports }, null, 2));
if (dry) {
  const q = async s => (await db.query(s)).rows;
  console.log('\nEn la base temporal:', (await q(`select (select count(*) from mx_vehicles)::int vehiculos, (select count(*) from mx_listings)::int listings,
    (select count(*) from mx_price_snapshots)::int precios, (select count(*) from mx_photos where phash is not null)::int fotos_con_hash,
    (select count(*) from mx_review_queue where status = 'pendiente')::int en_revision`))[0]);
}
// --exportar archivo.sql (solo con --seco): todo lo que entró a la base temporal
// como un SQL idempotente, para aplicarlo a Supabase con el CLI ya conectado
// (npx supabase db query --remote --file archivo.sql). Pensado para la carga
// inicial; el día a día lo hace GitHub Actions directo contra la base.
if (dry && opt('exportar')) {
  const TABLES = ['mx_vehicles', 'mx_listings', 'mx_listing_private', 'mx_specs', 'mx_spec_options', 'mx_price_snapshots', 'mx_photos', 'mx_review_queue', 'mx_runs'];
  const NATURAL_KEY = { mx_photos: ['listing_id', 'url'], mx_review_queue: ['kind', 'vehicle_a', 'vehicle_b', 'listing_id'],
    mx_runs: ['source_id', 'started_at'], mx_price_snapshots: ['listing_id', 'observed_from'] };
  const ran = reports.map(r => r.fuente);
  const out = ['-- Carga generada por scripts/ingest.mjs --seco --exportar', `-- ${today} · fuentes: ${ran.join(', ')}`, 'begin;'];
  const lit = v => `$mx$${json(v)}$mx$`;
  const src = (await db.query(`select * from mx_sources where id = any($1)`, [ran])).rows;
  out.push(`insert into public.mx_sources select * from json_populate_recordset(null::public.mx_sources, ${lit(src)}::json)
  on conflict (id) do update set status = excluded.status, last_run_at = excluded.last_run_at, last_success_at = excluded.last_success_at, enabled = excluded.enabled;`);
  for (const t of TABLES) {
    const cols = (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1
      and not (column_name = 'id' and is_identity = 'YES') and is_generated = 'NEVER' order by ordinal_position`, [t])).rows.map(r => r.column_name);
    const seen = seeded.get(t);
    const rows = (await db.query(`select ${(await colsOf(t)).join(', ')} from ${t}`)).rows
      .filter(r => !seen?.has(json(r)))
      .map(r => Object.fromEntries(cols.map(c => [c, r[c]])));
    if (!rows.length) continue;
    if (json(rows).includes('$mx$')) throw new Error(`datos de ${t} contienen el delimitador $mx$`);
    // Tablas con id autonumérico no chocan por id: se evita el duplicado por su llave natural,
    // para que aplicar el mismo archivo dos veces no repita fotos ni revisiones.
    const key = NATURAL_KEY[t];
    const guard = key ? `\n  where not exists (select 1 from public.${t} x where ${key.map(c => `x.${c} is not distinct from r.${c}`).join(' and ')})` : '';
    out.push(`insert into public.${t} (${cols.join(', ')})\n  select ${cols.map(c => `r.${c}`).join(', ')} from json_populate_recordset(null::public.${t}, ${lit(rows)}::json) r${guard}\n  on conflict do nothing;`);
  }
  out.push('commit;');
  writeFileSync(opt('exportar'), out.join('\n\n') + '\n');
  console.log(`\nSQL de carga escrito en ${opt('exportar')}`);
}
await db.close?.();
// Una fuente rota no tumba la corrida: el código de salida solo marca error si TODAS fallaron.
process.exit(reports.length && reports.every(r => !r.ok) ? 1 : 0);
