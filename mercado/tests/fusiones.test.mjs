// Fase 2 · Fusiones, deshacer y cola de revisión en la base (PGlite).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, vehicleWithListing } from './helpers/db.mjs';

const rejects = (p, re) => assert.rejects(p, e => re.test(e.message), `esperaba error ${re}`);
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
let db;
before(async () => { db = await freshDb(); });

// Un auto con listing, spec canónica, foto y precio.
async function car(opts = {}) {
  const c = await vehicleWithListing(db, opts);
  if (opts.vin) await db.query(`update mx_vehicles set vin = $1 where id = $2`, [opts.vin, c.vehicle]);
  if (opts.created) await db.query(`update mx_vehicles set created_at = $1 where id = $2`, [opts.created, c.vehicle]);
  c.spec = (await one(db, `insert into mx_specs (vehicle_id, listing_id, is_canonical, year, km, is_demo) values ($1, $2, true, 2023, 1200, $3) returning id`, [c.vehicle, c.listing, !!opts.demo])).id;
  await db.query(`insert into mx_photos (listing_id, url, phash) values ($1, $2, 123)`, [c.listing, `https://f/${c.listing}.jpg`]);
  await db.query(`select mx_record_price($1, 9800000, 'MXN', false, '2026-11-01')`, [c.listing]);
  return c;
}
const merge = (keep, drop, reason = 'manual') => one(db, `select mx_merge_vehicles($1, $2, $3) id`, [keep, drop, reason]);

describe('cola de revisión', () => {
  test('encolar: ordena el par, no repite, sube el score y respeta "distinto" y VIN distintos', async () => {
    const a = await car(), b = await car();
    const id1 = (await one(db, `select mx_enqueue_duplicate($1, $2, 0.6) id`, [b.vehicle, a.vehicle])).id;
    const id2 = (await one(db, `select mx_enqueue_duplicate($1, $2, 0.8, '["fingerprint"]') id`, [a.vehicle, b.vehicle])).id;
    assert.equal(id1, id2);
    assert.equal(Number((await one(db, `select score from mx_review_queue where id = $1`, [id1])).score), 0.8);
    await db.query(`update mx_review_queue set status = 'descartado' where id = $1`, [id1]);
    await db.query(`insert into mx_distinct_pairs (vehicle_a, vehicle_b) values (least($1::uuid, $2::uuid), greatest($1::uuid, $2::uuid))`, [a.vehicle, b.vehicle]);
    assert.equal((await one(db, `select mx_enqueue_duplicate($1, $2, 0.9) id`, [a.vehicle, b.vehicle])).id, null);

    const c = await car({ vin: 'WP0AF2A99PS270101' }), d = await car({ vin: 'WP0AF2A99PS270102' });
    assert.equal((await one(db, `select mx_enqueue_duplicate($1, $2, 0.9) id`, [c.vehicle, d.vehicle])).id, null);
  });

  test('solo admin puede encolar, fusionar o resolver', async () => {
    const a = await car(), b = await car();
    for (const sql of [`select mx_enqueue_duplicate($1, $2, 0.5)`, `select mx_merge_vehicles($1, $2, 'manual')`]) {
      await rejects(as(db, 'user', tx => tx.query(sql, [a.vehicle, b.vehicle])), /Solo admin/);
      await rejects(as(db, 'anon', tx => tx.query(sql, [a.vehicle, b.vehicle])), /permission denied/);
    }
    await as(db, 'admin', tx => tx.query(`select mx_enqueue_duplicate($1, $2, 0.5)`, [a.vehicle, b.vehicle]));
  });
});

describe('fusionar y deshacer', () => {
  test('fusionar mueve todo al que se queda y deja lápida; deshacer lo regresa exactamente', async () => {
    const keep = await car({ created: '2026-01-01' });
    const drop = await car({ vin: 'WP0AF2A99PS270201', created: '2026-02-01' });
    await db.query(`insert into mx_transactions (vehicle_id, price, currency, sale_date, source, confidence) values ($1, 9000000, 'MXN', '2026-10-10', 'broker', 'media')`, [drop.vehicle]);
    const before = await snapshot([keep, drop]);

    const { id: mid } = await merge(keep.vehicle, drop.vehicle, 'fotos');
    const v = await one(db, `select (select merged_into from mx_vehicles where id = $2) merged_into, (select vin from mx_vehicles where id = $1) vin,
                                    (select count(*)::int from mx_listings where vehicle_id = $1) listings,
                                    (select count(*)::int from mx_photos where vehicle_id = $1) photos,
                                    (select count(*)::int from mx_specs where vehicle_id = $1) specs,
                                    (select count(*)::int from mx_specs where vehicle_id = $1 and is_canonical) canon,
                                    (select count(*)::int from mx_transactions where vehicle_id = $1) ventas,
                                    mx_live_vehicle($2) live`, [keep.vehicle, drop.vehicle]);
    assert.deepEqual(v, { merged_into: keep.vehicle, vin: 'WP0AF2A99PS270201', listings: 2, photos: 2, specs: 2, canon: 1, ventas: 1, live: keep.vehicle });
    assert.equal((await one(db, `select count(*)::int n from mx_vehicles_live where id = $1`, [drop.vehicle])).n, 0);

    await db.query(`select mx_unmerge($1)`, [mid]);
    assert.deepEqual(await snapshot([keep, drop]), before);
    assert.equal((await one(db, `select count(*)::int n from mx_distinct_pairs where vehicle_a = least($1::uuid, $2::uuid) and vehicle_b = greatest($1::uuid, $2::uuid)`, [keep.vehicle, drop.vehicle])).n, 1);
    await rejects(db.query(`select mx_unmerge($1)`, [mid]), /ya se deshizo/);
    await rejects(merge(keep.vehicle, drop.vehicle), /marcado como distinto/);
  });

  test('se niega a fusionar VIN distintos, modelos distintos, demo con real o dos veces', async () => {
    const a = await car({ vin: 'WP0AF2A99PS270301' }), b = await car({ vin: 'WP0AF2A99PS270302' });
    await rejects(merge(a.vehicle, b.vehicle), /VIN distintos/);
    const f = (await one(db, `insert into mx_vehicles (model_id) values ('ferrari-458') returning id`)).id;
    const p = await car();
    await rejects(merge(p.vehicle, f), /Modelos distintos/);
    const demo = await car({ demo: true });
    await rejects(merge(p.vehicle, demo.vehicle), /demo/);
    const q = await car();
    await merge(p.vehicle, q.vehicle);
    await rejects(merge(p.vehicle, q.vehicle), /ya fue fusionado/);
  });

  test('las revisiones pendientes del que se fusiona se re-apuntan al que se queda', async () => {
    const a = await car({ created: '2026-01-01' }), b = await car({ created: '2026-02-01' }), c = await car({ created: '2026-03-01' });
    await db.query(`select mx_enqueue_duplicate($1, $2, 0.7)`, [b.vehicle, c.vehicle]);
    await merge(a.vehicle, b.vehicle);
    const r = await db.query(`select vehicle_a, vehicle_b from mx_review_queue where status = 'pendiente' and $1 in (vehicle_a, vehicle_b)`, [c.vehicle]);
    assert.equal(r.rows.length, 1);
    assert.deepEqual([r.rows[0].vehicle_a, r.rows[0].vehicle_b].sort(), [a.vehicle, c.vehicle].sort());
  });
});

describe('tu clic en el panel', () => {
  test('"mismo" fusiona (se queda el que tiene VIN) y "distinto" no vuelve a aparecer', async () => {
    const a = await car({ created: '2026-01-01' }), b = await car({ vin: 'WP0AF2A99PS270401', created: '2026-02-01' });
    const rid = (await one(db, `select mx_enqueue_duplicate($1, $2, 0.8) id`, [a.vehicle, b.vehicle])).id;
    const r = (await as(db, 'admin', tx => tx.query(`select mx_resolve_duplicate($1, 'mismo') r`, [rid]), { commit: true })).rows[0].r;
    assert.equal(r.kept, b.vehicle); assert.equal(r.merged, a.vehicle);
    assert.equal((await one(db, `select status from mx_review_queue where id = $1`, [rid])).status, 'mismo');
    await rejects(db.query(`select mx_resolve_duplicate($1, 'mismo')`, [rid]), /ya se resolvió/);

    const c = await car(), d = await car();
    const rid2 = (await one(db, `select mx_enqueue_duplicate($1, $2, 0.6) id`, [c.vehicle, d.vehicle])).id;
    await db.query(`select mx_resolve_duplicate($1, 'distinto')`, [rid2]);
    assert.equal((await one(db, `select mx_enqueue_duplicate($1, $2, 0.99) id`, [c.vehicle, d.vehicle])).id, null);
  });
});

async function snapshot(cars) {
  const ids = cars.map(c => c.vehicle);
  return (await db.query(`select v.id, v.vin, v.merged_into, v.version_id,
      (select array_agg(l.id order by l.id) from mx_listings l where l.vehicle_id = v.id) listings,
      (select array_agg(s.id::text || ':' || s.is_canonical order by s.id) from mx_specs s where s.vehicle_id = v.id) specs,
      (select count(*)::int from mx_photos p where p.vehicle_id = v.id) photos,
      (select array_agg(t.id order by t.id) from mx_transactions t where t.vehicle_id = v.id) ventas
    from mx_vehicles v where v.id = any($1::uuid[]) order by v.id`, [ids])).rows;
}
