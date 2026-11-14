// Fotos que el sitio ya no publica: se quitan solo cuando el adaptador leyó la ficha completa.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/db.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { runSource } from '../core/pipeline.mjs';

const car = (photos, extra = {}) => ({ external_id: '157', url: 'https://prestige.test/vehiculo/157', title: 'Porsche 911 Carrera S 2021', year: 2021,
  price: 2950000, currency: 'MXN', photos, ...extra });
const adapterOf = rows => () => ({ partial: false, async *listings() { yield* rows; } });

test('la siguiente corrida quita las fotos que el sitio ya no publica; nunca las que subiste ni con una lista incompleta', async () => {
  const db = await freshDb(), store = new Store(fromPglite(db));
  await db.query(`insert into mx_sources (id, name, kind, capture_mode) values ('prestige-dlc', 'Prestige', 'broker', 'scraper')`);
  const source = { id: 'prestige-dlc' }, run = (rows, today) => runSource({ adapter: adapterOf(rows)(), source, store, fetcher: null, today, hashPhotos: false, log: () => {} });
  const B = 'https://blob.test/vehicles/157/';
  await run([car([B + 'vieja-1.jpg', B + 'vieja-2.jpg'], { fotos_completas: true })], '2026-11-01');
  const { rows: [l] } = await db.query(`select id from mx_listings where external_id = '157'`);
  const mia = 'https://x.supabase.co/storage/v1/object/public/images/u1/mia.jpg';
  await db.query(`insert into mx_photos (listing_id, url, position) values ($1, $2, -1)`, [l.id, mia]);
  const urls = async () => (await db.query(`select url from mx_photos where listing_id = $1 order by position, id`, [l.id])).rows.map(r => r.url);

  // lista de resultados (sin "fotos_completas"): no se borra nada
  await run([car([B + 'nueva-1.jpg'])], '2026-11-05');
  assert.deepEqual(await urls(), [mia, B + 'vieja-1.jpg', B + 'vieja-2.jpg', B + 'nueva-1.jpg']);

  // ficha completa con fotos nuevas: se van las viejas, se queda la tuya
  const r = await run([car([B + 'nueva-1.jpg', B + 'nueva-2.jpg'], { fotos_completas: true })], '2026-11-10');
  assert.equal(r.fotos_quitadas, 2);
  assert.deepEqual(await urls(), [mia, B + 'nueva-1.jpg', B + 'nueva-2.jpg']);
});
