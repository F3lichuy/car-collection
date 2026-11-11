// Fase 3 · Pipeline, robots.txt y extractores (sin red: adaptadores y fetcher falsos).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { freshDb } from './helpers/db.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { runSource, runAll } from '../core/pipeline.mjs';
import { parseRobots, PoliteFetcher, HostUnavailable } from '../core/http.mjs';
import { jsonLdBlocks, nextFlight, schemaInText, findSchemaObjects, jsonValuesAfterKey, sitemapLocs } from '../core/extract.mjs';

const one = async (db, sql, p) => (await db.query(sql, p)).rows[0];
const fakeAdapter = (items, { throwAt } = {}) => () => ({
  partial: false,
  async *listings() { for (const [i, it] of items.entries()) { if (throwAt === i) throw new Error('el sitio cambió su HTML'); yield it; } },
});
const silent = () => {};

const RS = { make: 'Porsche', model: '911 GT3 RS', title: 'Porsche 911 GT3 RS 2023', year: 2023, km: 1200, transmission: 'PDK',
  color_ext: 'GT Silver', color_int: 'Negro', currency: 'MXN', city: 'San Pedro Garza García', state: 'Nuevo León', seller_type: 'broker' };

let pg, store;
before(async () => {
  pg = await freshDb();
  store = new Store(fromPglite(pg));
  await store.syncSources([
    { id: 'agencia-a', name: 'Agencia A', kind: 'broker', capture_mode: 'scraper', enabled: true },
    { id: 'agencia-b', name: 'Agencia B', kind: 'broker', capture_mode: 'scraper', enabled: true },
    { id: 'rota', name: 'Rota', kind: 'broker', capture_mode: 'scraper', enabled: true },
  ]);
});

describe('pipeline', () => {
  test('día 1: anuncio nuevo → vehículo, listing, ficha canónica, precio, corrida y estado de la fuente', async () => {
    const r = await runSource({ adapter: fakeAdapter([
      { ...RS, external_id: 'A1', url: 'https://a.mx/autos/A1?utm_source=ig', price: 9800000, seller_name: 'Juan', seller_contact: '81 1111 1111', description: 'Factura de agencia, único dueño' },
      { make: 'Porsche', model: 'Macan GTS', title: 'Porsche Macan GTS 2022', year: 2022, external_id: 'A2', url: 'https://a.mx/autos/A2', price: 1e6 },
    ])(), source: { id: 'agencia-a' }, store, fetcher: null, today: '2026-11-01', hashPhotos: false, log: silent });
    assert.equal(r.ok, true); assert.equal(r.nuevos, 1); assert.equal(r.fuera_de_taxonomia, 1);
    const l = await one(pg, `select l.url_canonical, l.first_seen::text, v.version_id, s.is_canonical, s.invoice_type, s.owners, p.seller_contact
      from mx_listings l join mx_vehicles v on v.id = l.vehicle_id join mx_specs s on s.listing_id = l.id
      join mx_listing_private p on p.listing_id = l.id where l.external_id = 'A1'`);
    assert.deepEqual(l, { url_canonical: 'https://a.mx/autos/A1', first_seen: '2026-11-01', version_id: 'porsche-911-992-1-gt3-rs',
      is_canonical: true, invoice_type: 'agencia', owners: 1, seller_contact: '81 1111 1111' });
    const run = await one(pg, `select ok, new_listings from mx_runs where source_id = 'agencia-a' order by id desc limit 1`);
    assert.deepEqual(run, { ok: true, new_listings: 1 });
    assert.equal((await one(pg, `select status from mx_sources where id = 'agencia-a'`)).status, 'ok');
  });

  test('día 2: mismo anuncio con precio más bajo → actualizado, sin duplicar; se cuenta lo que no apareció', async () => {
    const r = await runSource({ adapter: fakeAdapter([{ ...RS, external_id: 'A1', url: 'https://a.mx/autos/A1', price: 9500000 }])(),
      source: { id: 'agencia-a' }, store, fetcher: null, today: '2026-11-02', hashPhotos: false, log: silent });
    assert.deepEqual([r.nuevos, r.actualizados], [0, 1]);
    assert.equal((await one(pg, `select count(*)::int n from mx_listings where external_id = 'A1'`)).n, 1);
    const prices = (await pg.query(`select price::int, observed_from::text, observed_to::text from mx_price_snapshots s join mx_listings l on l.id = s.listing_id where l.external_id = 'A1' order by observed_from`)).rows;
    assert.deepEqual(prices, [{ price: 9800000, observed_from: '2026-11-01', observed_to: '2026-11-01' }, { price: 9500000, observed_from: '2026-11-02', observed_to: '2026-11-02' }]);
    const r3 = await runSource({ adapter: fakeAdapter([])(), source: { id: 'agencia-a' }, store, fetcher: null, today: '2026-11-03', hashPhotos: false, log: silent });
    assert.equal(r3.no_vistos, 1);
  });

  test('el mismo auto en otra agencia con su VIN → un vehículo, dos listings; con fingerprint → a revisión', async () => {
    await pg.query(`update mx_vehicles set vin = 'WP0AF2A99PS270001' where id = (select vehicle_id from mx_listings where external_id = 'A1')`);
    const r = await runSource({ adapter: fakeAdapter([
      { ...RS, external_id: 'B7', url: 'https://b.mx/v/7', price: 9900000, description: 'VIN: WP0AF2A99PS270001' },
      { ...RS, external_id: 'B8', url: 'https://b.mx/v/8', price: 9700000, km: 1220 },
    ])(), source: { id: 'agencia-b' }, store, fetcher: null, today: '2026-11-03', hashPhotos: false, log: silent });
    assert.equal(r.nuevos, 2); assert.equal(r.unidos_a_auto_existente, 1); assert.equal(r.a_revision_duplicado, 1);
    const v = await one(pg, `select count(distinct vehicle_id)::int vehiculos, count(*)::int listings from mx_listings where external_id in ('A1', 'B7')`);
    assert.deepEqual(v, { vehiculos: 1, listings: 2 });
    assert.equal((await one(pg, `select count(*)::int n from mx_review_queue where kind = 'duplicado' and status = 'pendiente'`)).n, 1);
  });

  test('anuncio con datos pobres → entra, pero va a la cola de normalización', async () => {
    const r = await runSource({ adapter: fakeAdapter([{ make: 'Porsche', model: '911', title: 'Porsche 911 impecable', external_id: 'A9', url: 'https://a.mx/autos/A9', price_text: 'a tratar' }])(),
      source: { id: 'agencia-a' }, store, fetcher: null, today: '2026-11-04', hashPhotos: false, log: silent });
    assert.equal(r.a_revision_normalizacion, 1);
    const q = await one(pg, `select q.reasons from mx_review_queue q join mx_listings l on l.id = q.listing_id where l.external_id = 'A9' and q.kind = 'normalizacion'`);
    assert.ok(q.reasons.includes('sin_version'));
  });

  test('parser roto: falla solo esa fuente, queda registrada y las demás corren', async () => {
    const reps = await runAll({
      sources: [{ id: 'rota', adapter: 'rota' }, { id: 'agencia-b', adapter: 'b' }],
      adapters: { rota: fakeAdapter([RS], { throwAt: 0 }), b: fakeAdapter([]) },
      store, makeFetcher: () => null, today: '2026-11-05', hashPhotos: false, log: silent,
    });
    assert.deepEqual(reps.map(r => [r.fuente, r.ok]), [['rota', false], ['agencia-b', true]]);
    const s = await one(pg, `select status, last_error, consecutive_failures from mx_sources where id = 'rota'`);
    assert.deepEqual([s.status, s.consecutive_failures], ['error', 1]); assert.match(s.last_error, /cambió su HTML/);
  });

  test('10 anuncios seguidos que truenan → se detiene la fuente (no ensucia la base)', async () => {
    const bad = Array.from({ length: 12 }, (_, i) => ({ ...RS, external_id: `X${i}`, url: 'nota-url', price: 1 }));
    const r = await runSource({ adapter: fakeAdapter(bad)(), source: { id: 'rota' }, store, fetcher: null, today: '2026-11-05', hashPhotos: false, log: silent });
    assert.equal(r.ok, false); assert.match(r.fatal, /parece roto/);
  });
});

describe('freno por sitio', () => {
  test('un sitio que corta conexiones: tras 5 fallas seguidas se deja de insistir', async () => {
    let calls = 0;
    const f = new PoliteFetcher({ minDelayMs: 0, retries: 2, breakerAfter: 5, fetchImpl: async () => { calls++; throw new TypeError('fetch failed'); } });
    f.robots.set('https://lento.mx', { delay: null, allowed: () => true });
    await assert.rejects(f.get('https://lento.mx/a'), /fetch failed/);      // 3 intentos
    await assert.rejects(f.get('https://lento.mx/b'), HostUnavailable);    // 2 más → freno
    const before = calls;
    await assert.rejects(f.get('https://lento.mx/c'), HostUnavailable);    // ya ni lo intenta
    assert.equal(calls, before);
  });
});

describe('robots.txt', () => {
  const r = parseRobots(`User-agent: *\nDisallow: /*?seller=*\nDisallow: /search\nAllow: /search/ok\nCrawl-delay: 20\n\nUser-agent: GPTBot\nDisallow: /`);
  test('reglas con comodín, la más específica gana y Crawl-delay', () => {
    assert.equal(r.allowed('/usados/-/autos/-/porsche'), true);
    assert.equal(r.allowed('/usados/-/autos/-/porsche?seller=5'), false);
    assert.equal(r.allowed('/search?q=1'), false);
    assert.equal(r.allowed('/search/ok'), true);
    assert.equal(r.delay, 20);
  });
  test('un sitio que prohíbe todo a todos', () => assert.equal(parseRobots('User-agent: *\nDisallow: /').allowed('/x'), false));
});

describe('extractores', () => {
  test('JSON-LD, RSC de Next.js, objetos tras una clave y sitemap', () => {
    const html = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Car","name":"911"}</script>
      <script>self.__next_f.push([1,"{\\"x\\":{\\"@context\\":\\"https://schema.org\\",\\"@type\\":\\"ItemList\\",\\"itemListElement\\":[{\\"item\\":{\\"@type\\":[\\"Product\\",\\"Vehicle\\"],\\"name\\":\\"GT3\\"}}]},\\"vehicle\\":{\\"id\\":\\"9\\",\\"brand\\":\\"Porsche\\"}}"])</script>`;
    assert.equal(jsonLdBlocks(html)[0].name, '911');
    const flight = nextFlight(html);
    assert.equal(findSchemaObjects(schemaInText(flight), 'Vehicle')[0].name, 'GT3');
    assert.deepEqual(jsonValuesAfterKey(flight, 'vehicle'), [{ id: '9', brand: 'Porsche' }]);
    assert.deepEqual(sitemapLocs('<urlset><url><loc>https://a.mx/1</loc></url><url><loc> https://a.mx/2?a=1&amp;b=2 </loc></url></urlset>'), ['https://a.mx/1', 'https://a.mx/2?a=1&b=2']);
  });
});
