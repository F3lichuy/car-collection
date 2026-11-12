// Migración 007: borrar autos (solo el dueño, reversible) y precio anterior anunciado por la fuente.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, ADMIN, vehicleWithListing } from './helpers/db.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { normalizeListing } from '../core/normalize.mjs';

const fails = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail('debió fallar'); };
const visible = async (db, who, vehicle) => (await as(db, who, tx => tx.query(
  `select (select count(*) from mx_vehicles where id = $1)::int v, (select count(*) from mx_listings where vehicle_id = $1)::int l`, [vehicle]))).rows[0];

describe('borrar autos', () => {
  let db, car;
  before(async () => { db = await freshDb(); car = await vehicleWithListing(db); });

  test('un admin que no es el dueño no puede borrar; nadie borra filas directo', async () => {
    await fails(as(db, 'admin', tx => tx.query(`select mx_delete_vehicle($1, 'prueba')`, [car.vehicle])), /Solo el dueño/);
    await fails(as(db, 'user', tx => tx.query(`select mx_delete_vehicle($1, 'prueba')`, [car.vehicle])), /Solo el dueño/);
    await fails(as(db, 'anon', tx => tx.query(`select mx_delete_vehicle($1, 'prueba')`, [car.vehicle])), /permission denied/);
    for (const t of ['mx_vehicles', 'mx_listings', 'mx_price_snapshots', 'mx_photos']) {
      await fails(as(db, 'admin', tx => tx.query(`delete from ${t}`)), /permission denied/);
    }
  });

  test('el dueño borra: desaparece para todos menos para él, y lo puede restaurar', async () => {
    await db.query(`insert into mx_owners (user_id, note) values ($1, 'prueba') on conflict do nothing`, [ADMIN]);
    await as(db, 'admin', tx => tx.query(`select mx_delete_vehicle($1, 'Era una réplica')`, [car.vehicle]), { commit: true });
    assert.deepEqual(await visible(db, 'anon', car.vehicle), { v: 0, l: 0 });
    assert.deepEqual(await visible(db, 'user', car.vehicle), { v: 0, l: 0 });
    assert.deepEqual(await visible(db, 'admin', car.vehicle), { v: 1, l: 1 });   // el dueño lo ve para restaurarlo
    const { rows: [v] } = await db.query(`select delete_reason, deleted_by from mx_vehicles where id = $1`, [car.vehicle]);
    assert.deepEqual(v, { delete_reason: 'Era una réplica', deleted_by: ADMIN });
    await fails(as(db, 'admin', tx => tx.query(`select mx_delete_vehicle($1)`, [car.vehicle])), /ya estaba borrado/);

    await as(db, 'admin', tx => tx.query(`select mx_restore_vehicle($1)`, [car.vehicle]), { commit: true });
    assert.deepEqual(await visible(db, 'anon', car.vehicle), { v: 1, l: 1 });
    const log = (await db.query(`select action from mx_vehicle_deletions where vehicle_id = $1 order by id`, [car.vehicle])).rows.map(r => r.action);
    assert.deepEqual(log, ['borrado', 'restaurado']);
    // la bitácora no la ve nadie más
    assert.equal((await as(db, 'user', tx => tx.query(`select count(*)::int n from mx_vehicle_deletions`).catch(() => ({ rows: [{ n: 0 }] })))).rows[0].n, 0);
  });
});

describe('precio anterior anunciado', () => {
  test('se guarda junto al precio del día; nunca menor que el precio', async () => {
    const db = await freshDb(), store = new Store(fromPglite(db));
    const car = await vehicleWithListing(db);
    const n = normalizeListing({ source_id: 'x', observed_on: '2026-11-12', title: 'Porsche 911 GT3 Touring 2023', year: 2023, price: 5189000, list_price: '$5,559,000.00', currency: 'MXN' });
    assert.equal(n.price.list_price, 5559000);
    await store.recordPrice(db, car.listing, n.price, '2026-11-12');
    const { rows: [s] } = await db.query(`select price::int p, list_price::int lp from mx_price_snapshots where listing_id = $1`, [car.listing]);
    assert.deepEqual(s, { p: 5189000, lp: 5559000 });
    // un "precio anterior" menor o en otra moneda no se toma
    assert.equal(normalizeListing({ source_id: 'x', observed_on: '2026-11-12', title: 'Porsche 911 GT3 2023', price: 5189000, list_price: 4000000, currency: 'MXN' }).price.list_price, undefined);
    await fails(db.query(`update mx_price_snapshots set list_price = 100 where listing_id = $1`, [car.listing]), /list_price_ok/);
  });
});
