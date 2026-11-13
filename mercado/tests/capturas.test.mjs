// Migración 006 y proceso de capturas del botón "Guardar en Precio de Calle".
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as } from './helpers/db.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { processCapturas } from '../core/capturas.mjs';
import { adapters } from '../adapters/index.mjs';

const fails = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail('debió fallar'); };
const items = [
  { external_id: '111', url: 'https://www.facebook.com/marketplace/item/111/', title: '1987 Porsche 911 Carrera 3.2', year: 1987, km: '98000', km_unit: 'km',
    price: 1450000, currency: 'MXN', city: 'Monterrey, NL', published_on: '2026-10-20', extra: { publicado_texto: 'hace 3 semanas' } },
  { external_id: '222', url: 'https://www.facebook.com/marketplace/item/222/', title: '2019 Nissan Versa Advance', year: 2019, price: 210000, currency: 'MXN' },
  { external_id: '333', url: 'https://www.facebook.com/marketplace/item/333/', title: '1989 Porsche 911 Speedster', year: 1989, price: 90000, currency: 'USD' },
];

describe('capturas del botón', () => {
  let db, store;
  before(async () => {
    db = await freshDb();
    store = new Store(fromPglite(db));
    await db.query(`insert into mx_sources (id, name, kind, capture_mode) values ('facebook-marketplace', 'Facebook Marketplace', 'marketplace', 'script_local') on conflict do nothing`);
  });

  test('solo admin guarda y lee capturas', async () => {
    await as(db, 'admin', tx => tx.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-marketplace', 'https://www.facebook.com/marketplace/monterrey', $1::jsonb)`, [JSON.stringify(items)]), { commit: true });
    for (const who of ['anon', 'user']) {
      await fails(as(db, who, tx => tx.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-marketplace', 'https://x.mx', '[{"title":"x"}]')`)), /row-level security|permission denied/);
      const r = await as(db, who, tx => tx.query(`select count(*)::int n from mx_capturas`)).catch(e => ({ rows: [{ n: e.message }] }));
      assert.ok(r.rows[0].n === 0 || /permission denied/.test(r.rows[0].n), `${who} no debe ver capturas`);
    }
  });

  test('una captura vacía o de una página sin https se rechaza', async () => {
    await fails(db.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-marketplace', 'https://x.mx', '[]')`), /check constraint/);
    await fails(db.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-marketplace', 'http://x.mx', '[{"title":"x"}]')`), /check constraint/);
  });

  test('la corrida diaria la pasa por el pipeline: entra lo de la taxonomía, en pesos, sin duplicar', async () => {
    const makeFetcher = () => null;   // sin red: no se descargan fotos
    const [r] = await processCapturas({ db, store, sources: [], adapters, makeFetcher, today: '2026-11-12', hashPhotos: false, log: () => {} });
    assert.equal(r.ok, true);
    assert.equal(r.nuevos, 1);                 // el 911 Carrera 3.2
    assert.equal(r.fuera_de_taxonomia, 1);     // el Versa
    const { rows: [l] } = await db.query(`select capture_method, source_id, published_on::text p, first_seen::text f from mx_listings where external_id = '111'`);
    assert.deepEqual(l, { capture_method: 'bookmarklet', source_id: 'facebook-marketplace', p: '2026-10-20', f: '2026-11-12' });
    assert.equal((await db.query(`select count(*)::int n from mx_listings where external_id = '333'`)).rows[0].n, 0);   // en dólares: no entra
    const { rows: [c] } = await db.query(`select status, result->>'nuevos' nuevos from mx_capturas`);
    assert.deepEqual(c, { status: 'procesada', nuevos: '1' });

    // volver a capturar la misma página otro día con otro precio = cambio de precio, no auto nuevo
    const again = [{ ...items[0], price: 1390000 }];
    await db.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-marketplace', 'https://www.facebook.com/marketplace/item/111/', $1::jsonb)`, [JSON.stringify(again)]);
    const [r2] = await processCapturas({ db, store, sources: [], adapters, makeFetcher, today: '2026-11-20', hashPhotos: false, log: () => {} });
    assert.equal(r2.nuevos, 0);
    const prices = (await db.query(`select price::int p from mx_price_snapshots s join mx_listings l on l.id = s.listing_id where l.external_id = '111' order by observed_from`)).rows.map(x => x.p);
    assert.deepEqual(prices, [1450000, 1390000]);
    assert.equal((await db.query(`select count(*)::int n from mx_vehicles`)).rows[0].n, 1);
  });

  test('modo grupo: una publicación vieja entra con su fecha y como "ya no aparece"; una reciente, activa', async () => {
    const grupo = [
      { external_id: 'gautosmty_1', url: 'https://www.facebook.com/groups/autosmty/posts/1/', title: 'Vendo Porsche 911 Carrera S 2013 PDK', year: 2013, km: '38000',
        price: 1650000, currency: 'MXN', published_on: '2023-10-12', observed_on: '2023-10-12' },
      { external_id: 'gautosmty_2', url: 'https://www.facebook.com/groups/autosmty/posts/2/', title: 'Ferrari 458 Italia 2012', year: 2012,
        price: 4200000, list_price: 4500000, currency: 'MXN', published_on: '2026-11-25', observed_on: '2026-11-25' },
    ];
    await db.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-grupos', 'https://www.facebook.com/groups/autosmty', $1::jsonb)`, [JSON.stringify(grupo)]);
    const [r] = await processCapturas({ db, store, sources: [], adapters, makeFetcher: () => null, today: '2026-11-26', hashPhotos: false, log: () => {} });
    assert.equal(r.ok, true, r.fatal);
    const ls = (await db.query(`select external_id, status, first_seen::text f, published_on::text p from mx_listings where source_id = 'facebook-grupos' order by external_id`)).rows;
    assert.deepEqual(ls, [
      { external_id: 'gautosmty_1', status: 'desaparecido', f: '2023-10-12', p: '2023-10-12' },
      { external_id: 'gautosmty_2', status: 'activo', f: '2026-11-25', p: '2026-11-25' },
    ]);
    const { rows: [p] } = await db.query(`select price::int, list_price::int, observed_from::text from mx_price_snapshots s join mx_listings l on l.id = s.listing_id where l.external_id = 'gautosmty_2'`);
    assert.deepEqual(p, { price: 4200000, list_price: 4500000, observed_from: '2026-11-25' });
  });

  test('"Por revisar": cualquier marca y modelo que apruebas entra (se crea el modelo); sin aprobar, fuera lo que no funciona o es muy barato', async () => {
    const fb = n => `https://www.facebook.com/groups/autosmty/posts/9${n}/`;
    const aprobados = [
      { external_id: 'r1', url: fb(1), title: 'Vendo BMW M3 Competition 2021', make: 'BMW', model: 'M3', year: 2021, km: '15000', price: 1750000, currency: 'MXN', revisado: true },
      { external_id: 'r2', url: fb(2), title: 'Nissan Versa Advance 2019', make: 'Nissan', model: 'Versa', year: 2019, price: 210000, currency: 'MXN', revisado: true },
      { external_id: 'r3', url: fb(3), title: 'Ferrari Roma Spider 2025', make: 'Ferrari', model: 'Roma', year: 2025, price: 6900000, currency: 'MXN', revisado: true },
      { external_id: 'r4', url: fb(4), title: 'Ford Mustang Mach 1 2022', make: 'Ford', model: 'Mustang', year: 2022, price: 1100000, currency: 'MXN', revisado: true },
    ];
    const sinRevisar = [
      { external_id: 'x1', url: fb(5), title: 'Porsche 911 Carrera 1987', description: 'No arranca, para piezas', year: 1987, price: 400000, currency: 'MXN' },
      { external_id: 'x2', url: fb(6), title: 'Porsche 911 Carrera 1987', year: 1987, price: 45000, currency: 'MXN' },
    ];
    await db.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-grupos', 'https://www.facebook.com/groups/autosmty', $1::jsonb)`, [JSON.stringify([...aprobados, ...sinRevisar])]);
    const [r] = await processCapturas({ db, store, sources: [], adapters, makeFetcher: () => null, today: '2026-11-26', hashPhotos: false, log: () => {} });
    assert.equal(r.ok, true, r.fatal);
    const got = (await db.query(`select l.external_id e, v.model_id m, v.generation_id g from mx_listings l join mx_vehicles v on v.id = l.vehicle_id
      where l.external_id like 'r%' or l.external_id like 'x%' order by 1`)).rows;
    assert.deepEqual(got, [
      { e: 'r1', m: 'bmw-m3', g: null },
      { e: 'r2', m: 'nissan-versa', g: null },
      { e: 'r3', m: 'ferrari-roma', g: null },
      { e: 'r4', m: 'ford-mustang', g: null },   // ya estaba el modelo; 2022 no tiene generación en la taxonomía
    ]);
    assert.deepEqual((await db.query(`select id, name from mx_makes where id = 'nissan'`)).rows, [{ id: 'nissan', name: 'Nissan' }]);
    // los aprobados no van a la cola de normalización por no tener generación
    assert.equal((await db.query(`select count(*)::int n from mx_review_queue q join mx_listings l on l.id = q.listing_id where l.external_id like 'r%'`)).rows[0].n, 0);
    // la siguiente corrida ya conoce el modelo creado (sin "revisado")
    const otro = [{ external_id: 'r9', url: fb(9), title: 'BMW M3 2018 manual', year: 2018, price: 1200000, currency: 'MXN' }];
    await db.query(`insert into mx_capturas (source_id, page_url, items) values ('facebook-grupos', 'https://www.facebook.com/groups/autosmty', $1::jsonb)`, [JSON.stringify(otro)]);
    await processCapturas({ db, store, sources: [], adapters, makeFetcher: () => null, today: '2026-11-27', hashPhotos: false, log: () => {} });
    assert.equal((await db.query(`select v.model_id m from mx_listings l join mx_vehicles v on v.id = l.vehicle_id where l.external_id = 'r9'`)).rows[0]?.m, 'bmw-m3');
  });
});

