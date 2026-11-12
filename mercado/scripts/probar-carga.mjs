// Ensayo de una carga: base local con las migraciones + la semilla de producción,
// y encima el SQL exportado. Si falla aquí, fallaría en Supabase.
//   node scripts/probar-carga.mjs .capturas/semilla-prod.json .capturas/carga.sql
import { readFileSync } from 'node:fs';
import { freshLocalDb } from '../core/local-db.mjs';

const [seedFile, sqlFile] = process.argv.slice(2);
const db = await freshLocalDb();
const cols = async t => (await db.query(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 and is_generated = 'NEVER' order by ordinal_position`, [t])).rows.map(r => r.column_name);
const { tablas } = JSON.parse(readFileSync(seedFile, 'utf8'));
// fuentes de la semilla (las filas de anuncios las necesitan)
const srcIds = [...new Set((tablas.mx_listings ?? []).map(l => l.source_id))];
for (const id of srcIds) await db.query(`insert into mx_sources (id, name, kind, capture_mode) values ($1, $1, 'broker', 'scraper') on conflict do nothing`, [id]);
for (const [t, rows] of Object.entries(tablas)) {
  if (!rows.length) continue;
  const c = await cols(t);
  await db.query(`insert into public.${t} (${c.join(', ')}) overriding system value select ${c.join(', ')} from json_populate_recordset(null::public.${t}, $1::json)`, [JSON.stringify(rows)]);
}
// como en producción: los autonuméricos siguen después de las filas existentes
for (const t of Object.keys(tablas)) {
  const idn = (await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = 'id' and is_identity = 'YES'`, [t])).rows.length;
  if (idn && tablas[t].length) await db.query(`select setval(pg_get_serial_sequence('public.${t}', 'id'), (select max(id) from public.${t}))`);
}
const count = async () => (await db.query(`select (select count(*) from mx_vehicles)::int vehiculos, (select count(*) from mx_listings)::int anuncios, (select count(*) from mx_photos)::int fotos, (select count(*) from mx_review_queue where status = 'pendiente')::int revision`)).rows[0];
console.log('antes  ', await count());
await db.exec(readFileSync(sqlFile, 'utf8'));
console.log('después', await count());
await db.exec(readFileSync(sqlFile, 'utf8'));
console.log('2ª vez ', await count(), '(debe ser igual: la carga es idempotente)');
const pub = (await db.query(`select id, name from mx_sources_public order by id`)).rows.map(r => r.id);
console.log('fuentes públicas:', pub.join(', '));
await db.close();
