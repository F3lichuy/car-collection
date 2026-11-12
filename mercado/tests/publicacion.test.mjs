// Migración 005: fecha de publicación que declara la fuente y fichas capturadas a mano.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb, as, vehicleWithListing } from './helpers/db.mjs';
import { publishedOn, normalizeListing } from '../core/normalize.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { ShopifyAdapter } from '../adapters/shopify.mjs';

const fails = async (p, re) => { try { await p; } catch (e) { assert.match(e.message, re); return; } assert.fail('debió fallar'); };

describe('fecha de publicación', () => {
  test('toma solo la fecha y descarta las imposibles', () => {
    assert.equal(publishedOn('2026-10-02T14:03:00-06:00', '2026-11-11'), '2026-10-02');
    assert.equal(publishedOn('2026-11-12', '2026-11-11'), null);          // en el futuro
    assert.equal(publishedOn('1970-01-01T00:00:00Z', '2026-11-11'), null); // fecha "cero"
    assert.equal(publishedOn('hace 3 días', '2026-11-11'), null);
    assert.equal(publishedOn(null), null);
  });

  test('el normalizador la pasa al anuncio', () => {
    const n = normalizeListing({ source_id: 'x', observed_on: '2026-11-11', title: 'Porsche 911 Carrera 3.2 1987', url: 'https://x.mx/a', published_on: '2026-09-30T10:00:00' });
    assert.equal(n.listing.published_on, '2026-09-30');
  });

  test('Shopify usa published_at de la tienda', async () => {
    const products = { products: [{ id: 1, handle: 'mini', title: 'Mini Cooper 1993', published_at: '2026-08-15T12:00:00-06:00', variants: [{ price: '530000.00', available: true }], images: [] }] };
    const fetcher = { get: async url => ({ text: url.endsWith('/meta.json') ? JSON.stringify({ currency: 'MXN' }) : JSON.stringify(url.includes('page=1') ? products : { products: [] }) }) };
    const out = [];
    for await (const r of new ShopifyAdapter({ id: 's', base_url: 'https://s.test', name: 'S' }).listings({ fetcher, log: () => {} })) out.push(r);
    assert.equal(out[0].published_on, '2026-08-15T12:00:00-06:00');
  });
});

describe('base: published_on y captura manual', () => {
  let db;
  before(async () => { db = await freshDb(); });

  test('la primera fecha que dio la fuente no se reescribe', async () => {
    const store = new Store(fromPglite(db));
    const { listing } = await vehicleWithListing(db);
    await store.touchListing(db, listing, { published_on: '2026-09-01' }, '2026-11-02');
    await store.touchListing(db, listing, { published_on: '2026-10-20' }, '2026-11-03');
    const { rows: [l] } = await db.query(`select published_on::text p from mx_listings where id = $1`, [listing]);
    assert.equal(l.p, '2026-09-01');
  });

  test('admin guarda la ficha manual; se sobreescribe completa y queda quién y cuándo', async () => {
    const { vehicle } = await vehicleWithListing(db);
    await as(db, 'admin', async tx => {
      await tx.query(`select mx_save_manual_specs($1, $2::jsonb)`, [vehicle, JSON.stringify({ km: 45000, invoice_type: 'agencia', owners: 2, notes: 'Llamé a la agencia' })]);
      let { rows: [s] } = await tx.query(`select km, invoice_type, owners, notes, captured_by is not null as quien, listing_id from mx_specs where vehicle_id = $1 and listing_id is null`, [vehicle]);
      assert.deepEqual(s, { km: 45000, invoice_type: 'agencia', owners: 2, notes: 'Llamé a la agencia', quien: true, listing_id: null });
      // segunda captura: lo que no viene (o viene vacío) se borra de la captura manual
      await tx.query(`select mx_save_manual_specs($1, $2::jsonb)`, [vehicle, JSON.stringify({ km: 46000, owners: '' })]);
      ({ rows: [s] } = await tx.query(`select km, invoice_type, owners, count(*) over () n from mx_specs where vehicle_id = $1 and listing_id is null`, [vehicle]));
      assert.deepEqual([s.km, s.invoice_type, s.owners, Number(s.n)], [46000, null, null, 1]);
    });
  });

  test('valores fuera de catálogo o campos no permitidos se rechazan', async () => {
    const { vehicle } = await vehicleWithListing(db);
    await fails(as(db, 'admin', tx => tx.query(`select mx_save_manual_specs($1, '{"invoice_type":"pirata"}'::jsonb)`, [vehicle])), /check constraint/);
    await fails(as(db, 'admin', tx => tx.query(`select mx_save_manual_specs($1, '{"is_canonical":true}'::jsonb)`, [vehicle])), /Campo no permitido/);
  });

  test('usuario normal y anónimo no pueden capturar', async () => {
    const { vehicle } = await vehicleWithListing(db);
    await fails(as(db, 'user', tx => tx.query(`select mx_save_manual_specs($1, '{"km":1}'::jsonb)`, [vehicle])), /Solo un admin/);
    await fails(as(db, 'anon', tx => tx.query(`select mx_save_manual_specs($1, '{"km":1}'::jsonb)`, [vehicle])), /permission denied/);
  });

  test('el público lee la ficha manual (como el resto de las fichas)', async () => {
    const { vehicle } = await vehicleWithListing(db);
    await as(db, 'admin', tx => tx.query(`select mx_save_manual_specs($1, '{"origin":"nacional"}'::jsonb)`, [vehicle]), { commit: true });
    const r = await as(db, 'anon', tx => tx.query(`select origin from mx_specs where vehicle_id = $1 and listing_id is null`, [vehicle]));
    assert.equal(r.rows[0].origin, 'nacional');
  });
});
