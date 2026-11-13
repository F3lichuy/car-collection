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
});
