// Barrido de repetidos (al final de cada corrida): une lo seguro, limpia revisiones que no sirven
// y nunca toca autos borrados por la dueña. Casos sacados de los Urus reales (2026-11-12).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/db.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { runSource, rescan } from '../core/pipeline.mjs';
import { normalizeListing } from '../core/normalize.mjs';

const silent = () => {};
const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];
const fake = items => ({ partial: false, async *listings() { yield* items; } });
const URUS = { make: 'Lamborghini', model: 'Urus', currency: 'MXN', seller_type: 'broker' };

// Guarda un auto como lo habría guardado el motor viejo: vehículo propio, sin buscar repetidos.
async function legacyInsert(store, raw, day = '2026-11-12') {
  const n = normalizeListing({ observed_on: day, ...raw });
  return store.db.transaction(async tx => {
    const vid = await store.insertVehicle(tx, n.vehicle);
    const lid = await store.insertListing(tx, vid, n.listing, day);
    await store.upsertSpecs(tx, vid, lid, n.specs, { canonical: true });
    await store.recordPrice(tx, lid, n.price, day);
    return vid;
  });
}

let pg, store;
before(async () => {
  pg = await freshDb();
  store = new Store(fromPglite(pg));
  await store.syncSources([
    { id: 'mulsanne', name: 'Mulsanne', kind: 'broker', capture_mode: 'scraper', enabled: true },
    { id: 'mercadolibre-autos', name: 'Mercado Libre', kind: 'broker', capture_mode: 'scraper', enabled: true },
  ]);
});

describe('barrido de repetidos', () => {
  test('al cargar: el mismo Urus en la agencia y en Mercado Libre (mismos km exactos) entra como UN auto', async () => {
    await runSource({ adapter: fake([{ ...URUS, title: 'Lamborghini Urus S', year: 2023, km: 12972, price: 6500000, external_id: 'M1', url: 'https://mulsanne.mx/urus-s' }]),
      source: { id: 'mulsanne' }, store, fetcher: null, today: '2026-11-12', hashPhotos: false, log: silent });
    const r = await runSource({ adapter: fake([{ ...URUS, title: 'Lamborghini Urus 2023 4.0 V8 S At', year: 2023, km: 12972, price: 6500000, external_id: 'MLM1', url: 'https://auto.mercadolibre.com.mx/MLM-1-urus' }]),
      source: { id: 'mercadolibre-autos' }, store, fetcher: null, today: '2026-11-12', hashPhotos: false, log: silent });
    assert.equal(r.unidos_a_auto_existente, 1);
    const { n } = await one(pg, `select count(distinct vehicle_id)::int n from mx_listings where external_id in ('M1','MLM1')`);
    assert.equal(n, 1);
  });

  test('lo que el motor viejo dejó repetido se une en el barrido; lo dudoso queda a revisión; lo borrado no se toca', async () => {
    // Gallardo 2005 en Netmotors y en Mercado Libre: los mismos 24,336 km → el mismo auto
    const a = await legacyInsert(store, { source_id: 'mercadolibre-autos', make: 'Lamborghini', model: 'Gallardo', currency: 'MXN', title: 'Lamborghini Gallardo 2005 V10', year: 2005, km: 24336, price: 2388000, external_id: 'MLM2', url: 'https://auto.mercadolibre.com.mx/MLM-2' });
    const b = await legacyInsert(store, { source_id: 'mulsanne', make: 'Lamborghini', model: 'Gallardo', currency: 'MXN', title: 'LAMBORGHINI GALLARDO 2005', year: 2005, km: 24336, price: 2388000, external_id: 'N2', url: 'https://netmotors.mx/gallardo' });
    // mismos km redondos pero otro precio: solo revisión (por versión, año y km)
    const c = await legacyInsert(store, { source_id: 'mercadolibre-autos', ...URUS, title: 'Lamborghini Urus 2024 Performante', year: 2024, km: 5000, price: 7999000, external_id: 'MLM4', url: 'https://auto.mercadolibre.com.mx/MLM-4' });
    const d = await legacyInsert(store, { source_id: 'mercadolibre-autos', ...URUS, title: 'Lamborghini Urus 2024 Performante', year: 2024, km: 5000, price: 8700000, external_id: 'MLM5', url: 'https://auto.mercadolibre.com.mx/MLM-5' });
    // un repetido que la dueña ya borró: se queda borrado y aparte
    const e = await legacyInsert(store, { source_id: 'mercadolibre-autos', make: 'Lamborghini', model: 'Gallardo', currency: 'MXN', title: 'Lamborghini Gallardo 2005', year: 2005, km: 24336, price: 2388000, external_id: 'MLM6', url: 'https://auto.mercadolibre.com.mx/MLM-6' });
    await pg.query(`update mx_vehicles set deleted_at = now() where id = $1`, [e]);
    // una revisión basura de antes (fotos del mismo estudio entre un Urus y otro modelo)
    const gt3 = await legacyInsert(store, { source_id: 'mulsanne', make: 'Porsche', model: '911 GT3', title: 'Porsche 911 GT3 2022', year: 2022, km: 3000, price: 4500000, currency: 'MXN', external_id: 'M9', url: 'https://mulsanne.mx/gt3' });
    await store.enqueueDuplicate(pg, a, gt3, 0.85, ['fotos_iguales', 'modelo_distinto']);

    const r = await rescan({ store, fetcher: null, log: silent });
    assert.equal(r.ok, true);
    assert.equal(r.fusionados, 1);
    assert.equal(r.revisiones_descartadas, 1);
    const live = async id => (await one(pg, `select mx_live_vehicle($1) id`, [id])).id;
    assert.equal(await live(a), await live(b));                // Gallardo: uno solo
    assert.notEqual(await live(c), await live(d));             // Performante 5,000 km: siguen separados…
    const { n } = await one(pg, `select count(*)::int n from mx_review_queue where kind = 'duplicado' and status = 'pendiente'
      and vehicle_a = least($1::uuid, $2::uuid) and vehicle_b = greatest($1::uuid, $2::uuid)`, [c, d]);
    assert.equal(n, 1);                                        // …pero a revisión
    assert.equal(await live(e), e);                            // el borrado no se unió
    const { m } = await one(pg, `select count(*)::int m from mx_merges where reason = 'fingerprint' and evidence->>'motivo' = 'datos'`);
    assert.equal(m, 1, JSON.stringify((await pg.query('select reason, evidence from mx_merges')).rows));   // la unión queda registrada (se puede deshacer)

    // correrlo otra vez no hace nada nuevo
    const r2 = await rescan({ store, fetcher: null, log: silent });
    assert.equal(r2.fusionados, 0); assert.equal(r2.a_revision, 0);
  });

  test('si el anuncio vuelve con más fotos, se suman sin repetir las que ya tenía', async () => {
    const src = { id: 'mercadolibre-autos' };
    const base = { ...URUS, title: 'Lamborghini Urus 2022 4.0 V8', year: 2022, km: 8687, price: 5980000, external_id: 'MLM7', url: 'https://auto.mercadolibre.com.mx/MLM-7' };
    const foto = n => `https://http2.mlstatic.com/D_NQ_NP_2X_${n}-MLM1234567890_112025-F.webp`;
    await runSource({ adapter: fake([{ ...base, photos: [foto('600001')] }]), source: src, store, fetcher: null, today: '2026-11-12', hashPhotos: false, log: silent });
    const r = await runSource({ adapter: fake([{ ...base, photos: [foto('600001').replace('_2X_', '_').replace('-F.', '-O.'), foto('600002'), foto('600003')] }]),
      source: src, store, fetcher: null, today: '2026-11-13', hashPhotos: false, log: silent });
    assert.equal(r.fotos_agregadas, 2);
    const { n } = await one(pg, `select count(*)::int n from mx_photos ph join mx_listings l on l.id = ph.listing_id where l.external_id = 'MLM7'`);
    assert.equal(n, 3);
  });
});
