// 009 · Versión a mano: del catálogo del mismo modelo o "Otro" (texto); solo admin; con historial.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, vehicleWithListing } from './helpers/db.mjs';

const fails = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail('debió fallar'); };
const row = async (db, id) => (await db.query(`select version_id, generation_id, version_custom, version_manual_at is not null manual from mx_vehicles where id = $1`, [id])).rows[0];

describe('versión a mano', () => {
  let db, car;
  before(async () => {
    db = await freshDb(); car = await vehicleWithListing(db);
    await db.query(`update mx_vehicles set version_id = null where id = $1`, [car.vehicle]);   // "Versión por confirmar"
  });

  test('admin elige una versión del catálogo del mismo modelo; la generación se ajusta sola', async () => {
    await as(db, 'admin', tx => tx.query(`select mx_set_vehicle_version($1, 'porsche-911-992-1-gt3')`, [car.vehicle]), { commit: true });
    assert.deepEqual(await row(db, car.vehicle), { version_id: 'porsche-911-992-1-gt3', generation_id: 'porsche-911-992-1', version_custom: null, manual: true });
  });

  test('"Otro": texto libre (y quita la del catálogo); se puede volver a "por confirmar"', async () => {
    await as(db, 'admin', tx => tx.query(`select mx_set_vehicle_version($1, null, '  GT3 Touring Weissach  ')`, [car.vehicle]), { commit: true });
    let r = await row(db, car.vehicle);
    assert.equal(r.version_id, null); assert.equal(r.version_custom, 'GT3 Touring Weissach'); assert.equal(r.manual, true);
    await as(db, 'admin', tx => tx.query(`select mx_set_vehicle_version($1)`, [car.vehicle]), { commit: true });
    r = await row(db, car.vehicle);
    assert.equal(r.version_custom, null); assert.equal(r.manual, false);
    const log = (await db.query(`select after_version, after_custom from mx_version_edits where vehicle_id = $1 order by id`, [car.vehicle])).rows;
    assert.deepEqual(log, [{ after_version: 'porsche-911-992-1-gt3', after_custom: null }, { after_version: null, after_custom: 'GT3 Touring Weissach' }, { after_version: null, after_custom: null }]);
  });

  test('no: versión de otro modelo, las dos a la vez, usuario normal ni anónimo', async () => {
    await fails(as(db, 'admin', tx => tx.query(`select mx_set_vehicle_version($1, 'lamborghini-urus-urus-urus-s')`, [car.vehicle])), /otro modelo/);
    await fails(as(db, 'admin', tx => tx.query(`select mx_set_vehicle_version($1, 'porsche-911-992-1-gt3', 'GT3')`, [car.vehicle])), /no las dos/);
    await fails(as(db, 'user', tx => tx.query(`select mx_set_vehicle_version($1, 'porsche-911-992-1-gt3')`, [car.vehicle])), /Solo un admin/);
    await fails(as(db, 'anon', tx => tx.query(`select mx_set_vehicle_version($1, 'porsche-911-992-1-gt3')`, [car.vehicle])), /permission denied/);
    // el historial no lo ve un usuario normal
    assert.equal((await as(db, 'user', tx => tx.query(`select count(*)::int n from mx_version_edits`))).rows[0].n, 0);
  });
});

describe('fecha de publicación aproximada ("hace 3 meses")', () => {
  test('se guarda marcada como aproximada; una fecha exacta posterior la reemplaza; una vacía no la borra', async () => {
    const { Store, fromPglite } = await import('../core/store.mjs');
    const { runSource } = await import('../core/pipeline.mjs');
    const db = await freshDb(), store = new Store(fromPglite(db));
    await store.syncSources([{ id: 'ml', name: 'ML', kind: 'portal', capture_mode: 'scraper', enabled: true }]);
    const fake = items => ({ partial: false, async *listings() { yield* items; } });
    const base = { make: 'Porsche', model: '911', title: 'Porsche 911 GT3 2022', year: 2022, price: 4500000, currency: 'MXN', external_id: 'MLM1', url: 'https://auto.mercadolibre.com.mx/MLM-1' };
    const run = (it, day) => runSource({ adapter: fake([it]), source: { id: 'ml' }, store, fetcher: null, today: day, hashPhotos: false, log: () => {} });
    const get = async () => (await db.query(`select published_on::text d, published_approx a from mx_listings where external_id = 'MLM1'`)).rows[0];
    await run({ ...base, published_on: '2026-08-14', extra: { publicado_texto: 'hace 3 meses' } }, '2026-11-12');
    assert.deepEqual(await get(), { d: '2026-08-14', a: true });
    await run({ ...base }, '2026-11-13');                                   // desde la lista: sin fecha → no se borra
    assert.deepEqual(await get(), { d: '2026-08-14', a: true });
    await run({ ...base, published_on: '2026-08-20' }, '2026-11-14');       // la fuente da la fecha exacta
    assert.deepEqual(await get(), { d: '2026-08-20', a: false });
  });
});
