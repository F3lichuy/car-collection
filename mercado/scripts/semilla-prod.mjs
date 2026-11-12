// Copia de SOLO LECTURA de los autos que ya están en Supabase, para que una
// corrida en seco (ingest.mjs --seco --semilla …) los conozca y el anti-duplicados
// compare contra producción, no contra una base vacía.
//
//   node scripts/semilla-prod.mjs [.capturas/semilla-prod.json]
//
// Usa el CLI de Supabase ya conectado (npx supabase db query --remote --read-only).
// El archivo queda en .capturas/ (ignorado por git): incluye datos privados de anuncios.
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dirname, resolve } from 'node:path';

export const SEED_TABLES = ['mx_vehicles', 'mx_listings', 'mx_listing_private', 'mx_specs', 'mx_spec_options', 'mx_price_snapshots', 'mx_photos', 'mx_merges', 'mx_review_queue'];

const out = resolve(process.argv[2] ?? new URL('../.capturas/semilla-prod.json', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const repo = new URL('../../', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const seed = {};
for (const t of SEED_TABLES) {
  const sql = `select coalesce(json_agg(t), '[]'::json) as rows from public.${t} t`;
  // la consulta va en archivo: en Windows el shell partiría el SQL en argumentos
  const f = join(tmpdir(), `mx-semilla-${t}.sql`);
  writeFileSync(f, sql);
  const res = execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['supabase', 'db', 'query', '--remote', '--read-only', '--output-format', 'json', '--file', `"${f}"`],
    { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, shell: process.platform === 'win32' });
  rmSync(f, { force: true });
  const j = JSON.parse(res.slice(res.indexOf('{')));
  seed[t] = j.rows?.[0]?.rows ?? [];
  console.log(`${t}: ${seed[t].length}`);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ tomada: new Date().toISOString(), tablas: seed }));
console.log(`Semilla escrita en ${out}`);
