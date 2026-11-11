// Pruebas del esquema de Mercado MX (Fase 1). Correr: npm test (desde mercado/)
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { freshDb, applySchema, applySeed, as, vehicleWithListing } from './helpers/db.mjs';
import { buildSql, expand } from '../scripts/build-taxonomy-sql.mjs';

const rejects = (p, re) => assert.rejects(p, e => re.test(e.message), `esperaba error ${re}`);
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];

let db;
before(async () => { db = await freshDb(); });

describe('instalación', () => {
  test('el SQL generado de la taxonomía está al día con taxonomia.mjs', () => {
    const file = readFileSync(new URL('../../supabase/mercado/002_taxonomia.sql', import.meta.url), 'utf8');
    assert.equal(file, buildSql(), 'Corre `npm run build:taxonomia`');
    assert.deepEqual(expand().errors, []);
  });

  test('esquema y semilla se pueden volver a aplicar sin errores ni duplicar filas', async () => {
    const before = await one(db, 'select count(*)::int n from mx_versions');
    await applySchema(db); await applySeed(db);
    const after = await one(db, 'select count(*)::int n from mx_versions');
    assert.equal(after.n, before.n);
  });

  test('taxonomía: ~40+ modelos y la ruta Porsche > 911 > 992 > GT3 RS', async () => {
    const { n } = await one(db, 'select count(*)::int n from mx_models');
    assert.ok(n >= 40, `solo ${n} modelos`);
    const r = await one(db, `
      select mk.name make, m.name model, g.name gen, v.name ver, v.transmissions
        from mx_versions v join mx_generations g on g.id = v.generation_id
        join mx_models m on m.id = g.model_id join mx_makes mk on mk.id = m.make_id
       where v.id = 'porsche-911-992-1-gt3-rs'`);
    assert.deepEqual([r.make, r.model, r.gen, r.ver], ['Porsche', '911', '992.1', 'GT3 RS']);
    assert.deepEqual(r.transmissions, ['pdk']);
    const al = await db.query(`select target_id from mx_aliases where alias = 'gt3rs' and level = 'version' order by 1`);
    assert.ok(al.rows.length >= 4, 'gt3rs debe apuntar a las GT3 RS de varias generaciones');
    const g = await db.query(`select target_id from mx_aliases where alias = '992' and level = 'generation' order by 1`);
    assert.deepEqual(g.rows.map(x => x.target_id), ['porsche-911-992-1', 'porsche-911-992-2']);
  });
});

describe('seguridad (RLS)', () => {
  test('anónimo lee taxonomía y estado público de fuentes', async () => {
    await as(db, 'anon', async tx => {
      assert.ok((await tx.query('select 1 from mx_versions limit 1')).rows.length === 1);
      assert.ok((await tx.query('select * from mx_sources_public')).rows.length >= 3);
    });
  });

  test('anónimo y usuario normal no pueden escribir', async () => {
    for (const who of ['anon', 'user']) {
      await rejects(as(db, who, tx => tx.query(`insert into mx_vehicles (model_id) values ('porsche-911')`)), /row-level security|permission denied/);
      await rejects(as(db, who, tx => tx.query(`insert into mx_makes (id, name) values ('x', 'X')`)), /row-level security|permission denied/);
    }
    // update/delete silenciosos: 0 filas afectadas
    const r = await as(db, 'user', tx => tx.query(`update mx_models set name = 'hack' where id = 'porsche-911'`));
    assert.equal(r.affectedRows, 0);
  });

  test('admin sí escribe', async () => {
    await as(db, 'admin', async tx => {
      const r = await tx.query(`insert into mx_vehicles (model_id) values ('porsche-911') returning id`);
      assert.equal(r.rows.length, 1);
    });
  });

  test('ventas confirmadas, datos privados del anuncio, colas y corridas: invisibles al público', async () => {
    const { vehicle, listing } = await vehicleWithListing(db);
    await db.query(`insert into mx_transactions (vehicle_id, price, currency, sale_date, source, confidence)
                    values ($1, 9500000, 'MXN', '2026-10-01', 'comprador', 'alta')`, [vehicle]);
    await db.query(`insert into mx_listing_private (listing_id, seller_name, seller_contact) values ($1, 'Juan', '55 1234 5678')`, [listing]);
    await db.query(`insert into mx_runs (source_id, trigger, ok, error_log) values ('instagram', 'manual', false, '["x"]')`);
    for (const who of ['anon', 'user']) {
      await as(db, who, async tx => {
        for (const t of ['mx_transactions', 'mx_listing_private', 'mx_runs', 'mx_review_queue', 'mx_merges', 'mx_sources']) {
          assert.equal((await tx.query(`select * from ${t}`)).rows.length, 0, `${who} ve ${t}`);
        }
        assert.equal((await tx.query(`select * from mx_listings where id = $1`, [listing])).rows.length, 1);
      });
    }
    await as(db, 'admin', async tx => {
      assert.equal((await tx.query(`select * from mx_listing_private where listing_id = $1`, [listing])).rows.length, 1);
    });
  });

  test('anónimo no puede borrar datos demo ni registrar precios', async () => {
    await rejects(as(db, 'anon', tx => tx.query('select mx_purge_demo()')), /permission denied/);
    await rejects(as(db, 'user', tx => tx.query('select mx_purge_demo()')), /Solo admin/);
    await rejects(as(db, 'anon', tx => tx.query(`select mx_record_price(gen_random_uuid(), 1, 'MXN', false, current_date)`)), /permission denied/);
  });
});

describe('cero duplicados a nivel base de datos', () => {
  test('VIN: se normaliza y no se puede repetir', async () => {
    const { rows: [v] } = await db.query(`insert into mx_vehicles (model_id, vin) values ('porsche-911', 'wp0-af2a9 9ps270001') returning vin, vin_kind`);
    assert.deepEqual([v.vin, v.vin_kind], ['WP0AF2A99PS270001', 'vin17']);
    await rejects(db.query(`insert into mx_vehicles (model_id, vin) values ('porsche-911', 'WP0AF2A99PS270001')`), /duplicate key/);
    await rejects(db.query(`insert into mx_vehicles (model_id, vin) values ('porsche-911', 'WP0AF2A99PS27000O')`), /I, O o Q/);
    const { rows: [c] } = await db.query(`insert into mx_vehicles (model_id, vin) values ('porsche-356', '81234') returning vin_kind`);
    assert.equal(c.vin_kind, 'chasis');
  });

  test('jerarquía: la versión completa la generación y no puede ser de otro modelo', async () => {
    const { rows: [v] } = await db.query(`insert into mx_vehicles (model_id, version_id) values ('porsche-911', 'porsche-911-997-2-gt3-rs-4-0') returning generation_id`);
    assert.equal(v.generation_id, 'porsche-911-997-2');
    await rejects(db.query(`insert into mx_vehicles (model_id, version_id) values ('ferrari-458', 'porsche-911-997-2-gt3-rs-4-0')`), /no pertenece/);
  });

  test('listing: misma URL canónica o mismo id externo en la fuente → rechazado', async () => {
    const a = await vehicleWithListing(db, { url: 'https://agencia.mx/911-gt3', ext: 'A-1' });
    await rejects(vehicleWithListing(db, { url: 'https://agencia.mx/911-gt3' }), /duplicate key/);
    await rejects(vehicleWithListing(db, { ext: 'A-1' }), /duplicate key/);
    assert.ok(a.listing);
  });

  test('una sola ficha canónica de specs por vehículo', async () => {
    const { vehicle } = await vehicleWithListing(db);
    await db.query(`insert into mx_specs (vehicle_id, is_canonical, year, km) values ($1, true, 2023, 1200)`, [vehicle]);
    await rejects(db.query(`insert into mx_specs (vehicle_id, is_canonical, year) values ($1, true, 2023)`, [vehicle]), /duplicate key/);
  });

  test('una venta confirmada por vehículo y fecha', async () => {
    const { vehicle } = await vehicleWithListing(db);
    const ins = `insert into mx_transactions (vehicle_id, price, currency, sale_date, source, confidence) values ($1, 1, 'USD', '2026-09-09', 'x', 'media')`;
    await db.query(ins, [vehicle]);
    await rejects(db.query(ins, [vehicle]), /duplicate key/);
  });

  test('cola de revisión: un par pendiente una sola vez, en orden a < b', async () => {
    const a = (await vehicleWithListing(db)).vehicle, b = (await vehicleWithListing(db)).vehicle;
    const [lo, hi] = [a, b].sort();
    const ins = `insert into mx_review_queue (kind, vehicle_a, vehicle_b, score) values ('duplicado', $1, $2, 0.7)`;
    await db.query(ins, [lo, hi]);
    await rejects(db.query(ins, [lo, hi]), /duplicate key/);
    await rejects(db.query(ins, [hi, lo]), /check constraint/);
  });
});

describe('precios', () => {
  test('mismo precio varios días = un tramo; cambio = tramo nuevo; huecos y conflictos', async () => {
    const { listing } = await vehicleWithListing(db);
    const rec = async (p, d, cur = 'MXN', neg = false) =>
      (await one(db, 'select mx_record_price($1, $2, $3, $4, $5) r', [listing, p, cur, neg, d])).r;
    assert.equal(await rec(9800000, '2026-11-01'), 'nuevo');
    assert.equal(await rec(9800000, '2026-11-02'), 'extendido');
    assert.equal(await rec(9800000, '2026-11-02'), 'sin_cambio');
    assert.equal(await rec(9800000, '2026-11-05'), 'extendido');          // hueco de 3 días tolerado
    assert.equal(await rec(9500000, '2026-11-06'), 'nuevo');              // bajó de precio
    assert.equal(await rec(9500000, '2026-11-20'), 'nuevo');              // hueco largo → tramo nuevo
    assert.equal(await rec(9900000, '2026-11-03'), 'conflicto');          // captura vieja contradictoria: no pisa nada
    assert.equal(await rec(null, '2026-10-01', null, true), 'nuevo');     // "precio a tratar", y extiende first_seen
    const rows = (await db.query(`select price, observed_from::text f, observed_to::text t from mx_price_snapshots where listing_id = $1 order by observed_from`, [listing])).rows;
    assert.deepEqual(rows.map(r => [r.price && Number(r.price), r.f, r.t]), [
      [null, '2026-10-01', '2026-10-01'], [9800000, '2026-11-01', '2026-11-05'],
      [9500000, '2026-11-06', '2026-11-06'], [9500000, '2026-11-20', '2026-11-20']]);
    const daily = await one(db, `select count(*)::int n from mx_price_daily where listing_id = $1`, [listing]);
    assert.equal(daily.n, 1 + 5 + 1 + 1);
    const l = await one(db, `select first_seen::text f, last_seen::text t from mx_listings where id = $1`, [listing]);
    assert.deepEqual([l.f, l.t], ['2026-10-01', '2026-11-20']);
  });

  test('tramos traslapados insertados a mano → rechazados', async () => {
    const { listing } = await vehicleWithListing(db);
    await db.query(`insert into mx_price_snapshots (listing_id, price, currency, observed_from, observed_to) values ($1, 1, 'USD', '2026-01-01', '2026-01-10')`, [listing]);
    await rejects(db.query(`insert into mx_price_snapshots (listing_id, price, currency, observed_from, observed_to) values ($1, 2, 'USD', '2026-01-10', '2026-01-12')`, [listing]), /mx_price_no_overlap/);
    await rejects(db.query(`insert into mx_price_snapshots (listing_id, price, currency, observed_from, observed_to) values ($1, 2, 'EUR', '2026-02-01', '2026-02-01')`, [listing]), /check constraint/);
  });

  test('tipo de cambio FIX: fin de semana usa el último publicado', async () => {
    await db.query(`insert into mx_fx_rates (day, usd_mxn) values ('2026-11-06', 18.4321), ('2026-11-09', 18.5)`);
    assert.equal(Number((await one(db, `select mx_usd_mxn('2026-11-08') r`)).r), 18.4321);
  });
});

describe('fotos', () => {
  test('Hamming y columnas del pHash', async () => {
    assert.equal((await one(db, 'select mx_hamming(0, 7) d')).d, 3);
    assert.equal((await one(db, 'select mx_hamming(-1, 0) d')).d, 64);
    const { listing, vehicle } = await vehicleWithListing(db);
    const p = await one(db, `insert into mx_photos (listing_id, url, phash, phash_center) values ($1, 'https://x/1.jpg', -1, 5) returning vehicle_id, phash_center, low_info, is_demo`, [listing]);
    assert.deepEqual([p.vehicle_id, Number(p.phash_center), p.low_info, p.is_demo], [vehicle, 5, false, false]);
    await rejects(db.query(`insert into mx_photos (listing_id, url) values ($1, 'https://x/1.jpg')`, [listing]), /duplicate key/);
  });

  test('si un listing cambia de vehículo (fusión), specs y fotos lo siguen', async () => {
    const a = await vehicleWithListing(db), b = await vehicleWithListing(db);
    await db.query(`insert into mx_specs (vehicle_id, listing_id, year) values ($1, $2, 2023)`, [a.vehicle, a.listing]);
    await db.query(`insert into mx_photos (listing_id, url) values ($1, 'https://x/2.jpg')`, [a.listing]);
    await db.query(`update mx_listings set vehicle_id = $1 where id = $2`, [b.vehicle, a.listing]);
    assert.equal((await one(db, `select vehicle_id from mx_specs where listing_id = $1`, [a.listing])).vehicle_id, b.vehicle);
    assert.equal((await one(db, `select vehicle_id from mx_photos where listing_id = $1`, [a.listing])).vehicle_id, b.vehicle);
  });
});

describe('datos demo', () => {
  test('un dato demo no puede colgar de uno real (ni al revés)', async () => {
    const real = await vehicleWithListing(db);
    await rejects(db.query(`insert into mx_listings (vehicle_id, source_id, capture_method, first_seen, last_seen, is_demo)
                            values ($1, 'contacto-directo', 'formulario', current_date, current_date, true)`, [real.vehicle]), /is_demo/);
  });

  test('mx_purge_demo() borra todo lo demo y nada real', async () => {
    const realBefore = await one(db, `select (select count(*) from mx_vehicles where not is_demo)::int v, (select count(*) from mx_listings where not is_demo)::int l`);
    const d1 = await vehicleWithListing(db, { demo: true }), d2 = await vehicleWithListing(db, { demo: true });
    await db.query(`select mx_record_price($1, 5000000, 'MXN', false, '2026-11-01')`, [d1.listing]);
    await db.query(`insert into mx_photos (listing_id, url) values ($1, 'https://demo/1.jpg')`, [d1.listing]);
    await db.query(`insert into mx_specs (vehicle_id, listing_id, year, is_demo) values ($1, $2, 2020, true)`, [d1.vehicle, d1.listing]);
    await db.query(`insert into mx_transactions (vehicle_id, price, currency, sale_date, source, confidence, is_demo) values ($1, 1, 'MXN', '2026-01-01', 'demo', 'baja', true)`, [d2.vehicle]);
    const [lo, hi] = [d1.vehicle, d2.vehicle].sort();
    await db.query(`insert into mx_review_queue (kind, vehicle_a, vehicle_b, is_demo) values ('duplicado', $1, $2, true)`, [lo, hi]);
    await db.query(`update mx_vehicles set merged_into = $1 where id = $2`, [d1.vehicle, d2.vehicle]);
    await db.query(`insert into mx_merges (kept_id, merged_id, reason) values ($1, $2, 'manual')`, [d1.vehicle, d2.vehicle]);

    const r = await as(db, 'admin', tx => tx.query('select mx_purge_demo() r'), { commit: true });
    assert.equal(r.rows[0].r.vehiculos, 2);
    const left = await one(db, `select
      (select count(*) from mx_vehicles where is_demo) + (select count(*) from mx_listings where is_demo) +
      (select count(*) from mx_price_snapshots where is_demo) + (select count(*) from mx_photos where is_demo) +
      (select count(*) from mx_specs where is_demo) + (select count(*) from mx_transactions where is_demo) +
      (select count(*) from mx_review_queue where is_demo) as n`);
    assert.equal(Number(left.n), 0);
    const realAfter = await one(db, `select (select count(*) from mx_vehicles where not is_demo)::int v, (select count(*) from mx_listings where not is_demo)::int l`);
    assert.deepEqual(realAfter, realBefore);
  });
});
