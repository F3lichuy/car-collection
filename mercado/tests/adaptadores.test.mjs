// Adaptadores de agencias (WordPress / sitemap + ficha) con respuestas grabadas: sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PoliteFetcher } from '../core/http.mjs';
import { normalizeListing } from '../core/normalize.mjs';
import { adapters } from '../adapters/index.mjs';
import { labelFields } from '../adapters/wordpress.mjs';

// fetch falso: ruta (sin origen) → cuerpo; robots.txt permite todo
function fakeFetcher(routes) {
  const fetchImpl = async url => {
    const u = new URL(url);
    if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    const key = Object.keys(routes).find(k => (u.pathname + u.search).startsWith(k));
    if (!key) return new Response('no', { status: 404 });
    const r = routes[key];
    const body = typeof r === 'string' ? r : JSON.stringify(r.body ?? r);
    return new Response(body, { status: 200, headers: r.headers ?? {} });
  };
  return new PoliteFetcher({ minDelayMs: 0, retries: 0, fetchImpl });
}
const ctxFor = (source, fetcher) => ({ fetcher, source, log: () => {}, isKnown: () => false,
  wanted: raw => normalizeListing({ source_id: source.id, observed_on: '2026-11-11', ...raw }).inScope });
const collect = async (source, routes) => { const out = []; for await (const r of adapters[source.adapter](source).listings(ctxFor(source, fakeFetcher(routes)))) out.push(r); return out; };

describe('etiquetas de ficha', () => {
  test('misma línea o línea siguiente; "Color" no se confunde con "Color interior"', () => {
    const f = labelFields('Make: \nPorsche\nMade Year:\n1988\nKilometraje : 82,083 km\nColor interior: Negro\nColor : Azul\nTransmisión:\nManual');
    assert.equal(f.make, 'Porsche'); assert.equal(f.year, '1988'); assert.equal(f.km, '82,083 km');
    assert.equal(f.color_ext, 'Azul'); assert.equal(f.color_int, 'Negro'); assert.equal(f.transmission, 'Manual');
  });
});

describe('WooCommerce', () => {
  const source = { id: 'jah', adapter: 'woocommerce', name: 'JAH', base_url: 'https://jah.test', cities: ['Monterrey'] };
  test('precio 0 = sin precio; agotados fuera; etiquetas Marca/Modelo/Año', async () => {
    const rows = await collect(source, { '/wp-json/wc/store/v1/products': [
      { id: 1, name: 'Porsche GT3 2023', permalink: 'https://jah.test/p/gt3', is_in_stock: true, short_description: '<p><strong>Marca:</strong> Porsche</p><p><strong>Modelo:</strong> GT3</p><p><strong>Año:</strong> 2023</p>',
        prices: { price: '0', currency_code: 'MXN', currency_minor_unit: 2 }, images: [{ src: 'https://jah.test/a.jpg' }], categories: [] },
      { id: 2, name: 'Ferrari 488 Pista 2019', permalink: 'https://jah.test/p/488', is_in_stock: true, short_description: '',
        prices: { price: '850000000', currency_code: 'MXN', currency_minor_unit: 2 }, images: [], categories: [] },
      { id: 3, name: 'Ferrari F40 1990', permalink: 'https://jah.test/p/f40', is_in_stock: false, prices: { price: '1' }, images: [], categories: [] },
    ] });
    assert.equal(rows.length, 2);
    assert.deepEqual([rows[0].make, rows[0].year, rows[0].price, rows[0].currency], ['Porsche', 2023, null, null]);
    assert.deepEqual([rows[1].price, rows[1].currency], [8500000, 'MXN']);
  });
});

describe('Vehica', () => {
  const source = { id: 'net', adapter: 'vehica', name: 'Net', base_url: 'https://net.test', cities: ['CDMX'],
    config: { currency: 'MXN', fields: { year: 'v_y', km: 'v_km', price: 'v_p', gallery: 'v_g' } } };
  test('km repetido en ≥20 % de los autos se trata como sin dato', async () => {
    const cars = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, link: `https://net.test/auto/${i}`, title: { rendered: `Mini Cooper 199${i}` },
      v_y: `199${i}`, v_km: i < 3 ? '130000' : String(50000 + i), v_p: { vehica_currency_x: 400000 + i }, v_g: ['https://net.test/f.jpg'],
      _embedded: { 'wp:term': [[{ taxonomy: 'vehica_1', name: 'Mini' }], [{ taxonomy: 'vehica_2', name: 'Cooper' }]] } }));
    const rows = await collect(source, {
      '/wp-json/wp/v2/taxonomies': { vehica_1: { name: 'Marca' }, vehica_2: { name: 'Modelo' } },
      '/wp-json/wp/v2/cars': { body: cars, headers: { 'x-wp-totalpages': '1' } },
    });
    assert.equal(rows.length, 10);
    assert.equal(rows[0].km, null); assert.equal(rows[0].extra.km_relleno, true);
    assert.equal(rows[5].km, '50005');
    assert.deepEqual([rows[0].make, rows[0].year, rows[0].price, rows[0].currency], ['Mini', 1990, 400000, 'MXN']);
  });
  test('sin moneda verificada en config, el precio no se inventa', async () => {
    const s = { ...source, config: { ...source.config, currency: undefined } };
    const rows = await collect(s, {
      '/wp-json/wp/v2/taxonomies': {},
      '/wp-json/wp/v2/cars': { body: [{ id: 1, link: 'x', title: { rendered: 'Porsche 911 1988' }, v_p: { a: 900000 } }], headers: { 'x-wp-totalpages': '1' } },
    });
    assert.equal(rows[0].price, null);
  });
});

describe('Motors (STM)', () => {
  const source = { id: 'mc', adapter: 'stm-listings', name: 'MC', base_url: 'https://mc.test', cities: ['Querétaro'], config: { currency: 'MXN' } };
  test('vendidos fuera; fotos de la galería solo para autos que interesan', async () => {
    const terms = (make, serie, y) => ({ 'wp:term': [[{ taxonomy: 'make', name: make }], [{ taxonomy: 'serie', name: serie }], [{ taxonomy: 'ca-year', name: y }]] });
    const rows = await collect(source, {
      '/wp-json/wp/v2/listings': { body: [
        { id: 1, link: 'https://mc.test/l/1', title: { rendered: 'Porsche 911 Carrera S 2017' }, vendido: false, featured_media: 10, car_meta: { price: '1990000.0', mileage: '30000', gallery: { 1: 11 } }, _embedded: terms('Porsche', '911', '2017') },
        { id: 2, link: 'https://mc.test/l/2', title: { rendered: 'Mercedes Benz Clase GLC 2019' }, vendido: false, featured_media: 20, car_meta: { price: '638000.0' }, _embedded: terms('Mercedes Benz', 'Clase GLC', '2019') },
        { id: 3, link: 'https://mc.test/l/3', title: { rendered: 'Porsche 911 Turbo 2018' }, vendido: true, car_meta: { price: '1' }, _embedded: terms('Porsche', '911', '2018') },
      ], headers: { 'x-wp-totalpages': '1' } },
      '/wp-json/wp/v2/media': [{ id: 10, source_url: 'https://mc.test/a.jpg' }, { id: 11, source_url: 'https://mc.test/b.jpg' }],
    });
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].photos, ['https://mc.test/a.jpg', 'https://mc.test/b.jpg']);
    assert.deepEqual([rows[0].price, rows[0].km, rows[0].year], [1990000, '30000', 2017]);
    assert.deepEqual(rows[1].photos, []);   // GLC: fuera de la taxonomía, no se piden sus fotos
  });
});

describe('sitemap + ficha', () => {
  const source = { id: 'fi', adapter: 'ficha', name: 'Fi', base_url: 'https://fi.test', cities: ['Puebla'],
    config: { sitemaps: ['/sm.xml'], include: '/autos/', content_end: 'También podría interesarte', currency: 'MXN' } };
  const sm = `<urlset><url><loc>https://fi.test/autos/porsche-911-carrera-2015/</loc></url><url><loc>https://fi.test/autos/porsche-macan-s-blindada/</loc></url>
    <url><loc>https://fi.test/autos/ferrari-458-italia/</loc></url><url><loc>https://fi.test/nosotros/</loc></url></urlset>`;
  const labels = `<header>Marca: Menú</header><h1>Porsche 911 Carrera 2015</h1><p>$ 1,450,000 MXN</p>
    <img src="https://fi.test/wp-content/uploads/a-300x200.jpg"><img src="https://fi.test/wp-content/uploads/a.jpg"><img src="https://fi.test/wp-content/uploads/a-scaled.jpg">
    <p>Marca : Porsche<br>Año : 2015<br>Kilometraje : 41,000 km<br>Transmisión : PDK</p>
    <h3>También podría interesarte</h3><img src="https://fi.test/wp-content/uploads/otro.jpg"><p>$ 99,000</p>`;
  const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Product","name":"Ferrari 458 Italia 2012 - Fi","image":[{"@type":"ImageObject","url":"https://fi.test/x.jpg"}],
    "offers":{"@type":"Offer","price":"4800000.00","priceCurrency":"MXN","availability":"https://schema.org/InStock"}}]}</script><h1>Ferrari 458 Italia 2012</h1>`;
  test('descarta por URL lo que no es de la taxonomía; etiquetas, precio y fotos sin repetir ni de otros autos', async () => {
    const rows = await collect(source, { '/sm.xml': sm, '/autos/porsche-911-carrera-2015/': labels, '/autos/ferrari-458-italia/': ld });
    const p = rows.find(r => r.external_id === 'porsche-911-carrera-2015');
    assert.deepEqual([p.make, p.year, p.km, p.transmission, p.price, p.currency], ['Porsche', 2015, '41,000 km', 'PDK', 1450000, 'MXN']);
    assert.deepEqual(p.photos, ['https://fi.test/wp-content/uploads/a.jpg']);
    const macan = rows.find(r => r.external_id === 'porsche-macan-s-blindada');
    assert.equal(macan.price, undefined);   // no se abrió su ficha
    const f = rows.find(r => r.external_id === 'ferrari-458-italia');
    assert.deepEqual([f.title, f.price, f.currency, f.photos.length], ['Ferrari 458 Italia 2012', 4800000, 'MXN', 1]);
    assert.equal(rows.length, 3);
  });
  test('JSON-LD agotado = no está en venta', async () => {
    const sold = ld.replace('InStock', 'SoldOut');
    const rows = await collect({ ...source, config: { ...source.config, sitemaps: ['/sm2.xml'] } },
      { '/sm2.xml': '<urlset><url><loc>https://fi.test/autos/ferrari-458-italia/</loc></url></urlset>', '/autos/ferrari-458-italia/': sold });
    assert.equal(rows.length, 0);
  });
});

describe('normalizador · réplicas y "look"', () => {
  const n = title => normalizeListing({ source_id: 'x', observed_on: '2026-11-11', title });
  test('una réplica no es el auto que imita', () => {
    assert.equal(n('Porsche 356 Speedster Replica 1968').inScope, false);
    assert.ok(n('Ferrari 308 GTS réplica 1982').issues.includes('replica'));
  });
  test('"look Sport Classic" no hace Sport Classic al auto', () => {
    assert.notEqual(n('Porsche 911 Carrera GTS 2024 Look Sport Classic').vehicle.version_id, 'porsche-911-992-1-sport-classic');
    assert.equal(n('Porsche 911 Sport Classic 2023').vehicle.version_id, 'porsche-911-992-1-sport-classic');
  });
});

describe('errores encontrados en la primera corrida real', () => {
  test('"911 Carrera GTS 2024" junta 17 caracteres pero no es un VIN', async () => {
    const { findVins } = await import('../core/vin.mjs');
    assert.deepEqual(findVins('Vista rápida Porsche 911 Carrera GTS 2024 Look'), []);
    assert.deepEqual(findVins('VIN: WP0-AF2A9 9PS270001'), ['WP0AF2A99PS270001']);   // partido, con dígito verificador válido
    assert.deepEqual(findVins('serie WP0ZZZ99ZTS392124'), ['WP0ZZZ99ZTS392124']);    // europeo de una pieza: no se exige
  });
  test('WordPress escribe el signo de pesos como &#036;', async () => {
    const { stripHtml } = await import('../core/extract.mjs');
    assert.equal(stripHtml('&#036;395,000 &#8220;BRABUS&#8221; Tambi&eacute;n'), '$395,000 “BRABUS” También');
  });
  test('"SOLD" en el título: no entra como en venta', async () => {
    const { freshDb } = await import('./helpers/db.mjs');
    const { Store, fromPglite } = await import('../core/store.mjs');
    const { runSource } = await import('../core/pipeline.mjs');
    const store = new Store(fromPglite(await freshDb()));
    await store.syncSources([{ id: 'prueba-sold', name: 'P', kind: 'broker', capture_mode: 'scraper', enabled: true }]);
    const adapter = { partial: false, async *listings() {
      yield { external_id: '1', url: 'https://p.mx/1', title: 'Ferrari SF90 Spider SOLD', year: 2022, price: 9000000, currency: 'MXN' };
      yield { external_id: '2', url: 'https://p.mx/2', title: 'Ferrari 458 Italia 2012', price: 4000000, currency: 'MXN' };
    } };
    const r = await runSource({ adapter, source: { id: 'prueba-sold' }, store, fetcher: null, today: '2026-11-11', hashPhotos: false, log: () => {} });
    assert.equal(r.marcados_vendidos, 1); assert.equal(r.nuevos, 1);
  });
  test('kilometraje en la descripción del auto: uno solo o nada', async () => {
    const { kmInText } = await import('../adapters/ficha.mjs');
    assert.equal(kmInText('Porsche 911 GTS 14mil km'), '14000');
    assert.equal(kmInText('0-100 km/h en 3.2 s'), null);
    assert.equal(kmInText('1,700 km; antes 2,000 km'), null);
  });
});

describe('ficha sin sitemap (Exotic Avenue)', () => {
  const source = { id: 'ea', adapter: 'ficha', name: 'EA', base_url: 'https://ea.test', cities: ['CDMX'],
    config: { list_pages: ['/nuestros-autos'], include: String.raw`^/nuestros-autos/9-[a-z-]+/\d+-`, content_end: 'Acerca del Auto',
      labels: { year: ['modelo', 'año'], model: [] }, photo_path: '^/images/autos/', sold: String.raw`Precio\s+VENDIDO` } };
  const ficha = (name, precio) => `<title>${name}</title>\n<img src="/images/logo.png"><img src="/images/autos/a.jpg"><img src="/images/autos/a.jpg">
    <p>Modelo:</p><p>2018</p><p>Kilometraje:</p><p>8,700 km</p><p>Precio</p><p>${precio}</p><h3>Acerca del Auto</h3><img src="/images/autos/otro.jpg">`;
  test('lista de inventario, título de <title>, "Modelo" = año, fotos relativas, vendidos fuera', async () => {
    const rows = await collect(source, {
      '/nuestros-autos/9-x/70-mclaren-720-s-2018': ficha('Mclaren 720 S 2018', 'VENDIDO'),
      '/nuestros-autos/9-x/71-mclaren-720-s-2019': ficha('Mclaren 720 S 2019', '$5,400,000.00 MXN'),
      '/nuestros-autos': '<a href="/nuestros-autos/9-x/70-mclaren-720-s-2018">a</a><a href="/nuestros-autos/9-x/71-mclaren-720-s-2019">b</a><a href="/contacto">c</a>',
    });
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].title, rows[0].year, rows[0].price, rows[0].currency], ['Mclaren 720 S 2019', 2018, 5400000, 'MXN']);
    assert.deepEqual(rows[0].photos, ['https://ea.test/images/autos/a.jpg']);
  });
});
