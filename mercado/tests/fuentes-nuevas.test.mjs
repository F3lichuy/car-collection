// Adaptadores agregados el 2026-11-12 (Euromotors, GM Motors, El Auto Clásico, Prestige DLC, Elegance)
// con páginas de ejemplo hechas a mano que imitan la estructura de cada sitio: sin red.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { PoliteFetcher } from '../core/http.mjs';
import { normalizeListing } from '../core/normalize.mjs';
import { sitemapLocs } from '../core/extract.mjs';
import { adapters } from '../adapters/index.mjs';
import { spanishDate } from '../adapters/ficha.mjs';

function fakeFetcher(routes, hits = []) {
  const fetchImpl = async url => {
    const u = new URL(url); hits.push(u.pathname);
    if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n', { status: 200 });
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find(k => (u.pathname + u.search) === k || (u.pathname + u.search).startsWith(k + '?'));
    if (!key) return new Response('no', { status: 404 });
    const r = routes[key];
    return new Response(typeof r === 'string' ? r : JSON.stringify(r), { status: 200 });
  };
  return new PoliteFetcher({ minDelayMs: 0, retries: 0, fetchImpl });
}
const ctxFor = (source, fetcher, known = []) => ({ fetcher, source, log: () => {}, isKnown: id => known.includes(String(id)),
  wanted: raw => normalizeListing({ source_id: source.id, observed_on: '2026-11-12', ...raw }).inScope });
const collect = async (source, routes, { known = [], hits = [] } = {}) => {
  const out = [];
  for await (const r of adapters[source.adapter](source).listings(ctxFor(source, fakeFetcher(routes, hits), known))) out.push(r);
  return out;
};
const sitemap = urls => `<?xml version="1.0"?><urlset>${urls.map(u => `<url><loc>${u}</loc></url>`).join('')}</urlset>`;

describe('sitemaps y fechas', () => {
  test('<loc> con CDATA (PrestaShop)', () => {
    assert.deepEqual(sitemapLocs('<url><loc><![CDATA[https://x.test/a/1-porsche.html]]></loc></url><url><loc> https://x.test/b </loc></url>'),
      ['https://x.test/a/1-porsche.html', 'https://x.test/b']);
  });
  test('fechas en español', () => {
    assert.equal(spanishDate('25/Octubre/2023'), '2023-10-25');
    assert.equal(spanishDate('3 de marzo de 2024'), '2024-03-03');
    assert.equal(spanishDate('ayer'), null);
  });
});

describe('Car Dealer (Euromotors)', () => {
  const B = 'https://euro.test';
  const source = { id: 'euromotors', adapter: 'cardealer', name: 'Euromotors', base_url: B, cities: ['CDMX', 'Monterrey', 'León'],
    config: { sitemaps: ['/wp-sitemap-posts-cars-1.xml'], include: '/inventario/[^/]+/?$', city: null } };
  const related = `<div class="elementor-widget-cdhl_vehicle-related-vehicles"><div class="price car-price related-slider"><bdi class="new-price"><span class="currency currency-MXN">&#036;</span>9,999,999.00</bdi></div>
    <img src="${B}/wp-content/uploads/2024/01/otro-auto.jpg"></div>`;
  const ficha = ({ title, price, sold = false }) => `<html><head><meta property="og:title" content="${title}"></head><body>
    ${related}
    <div class="elementor-widget-cdhl_vehicle-title"><h3 class="vehicle-title">${title}</h3></div>
    <div class="elementor-widget-cdhl_vehicle-gallery"><a href="${B}/wp-content/uploads/2024/08/IMG_1.jpg"><img src="${B}/wp-content/uploads/2024/08/IMG_1-876x535.jpg"></a>
      <img src="${B}/wp-content/uploads/2024/08/IMG_2-876x535.jpg"></div>
    <div class="elementor-widget-cdhl_vehicle-price"><div class="price car-price text-left hide-status">${sold ? '<span class="sold"></span>' : ''}<bdi class="new-price"><span class="currency currency-MXN">&#036;</span>${price}</bdi></div></div>
    <div class="elementor-widget-cdhl_vehicle-attributes"><ul class="car-attributes"><li class="car_year"><span>Año</span> <strong class="text-right">1985</strong></li>
      <li class="car_make"><span>Marca</span> <strong class="text-right">Porsche</strong></li><li class="car_model"><span>Modelo</span> <strong class="text-right">911</strong></li>
      <li class="car_mileage"><span>Kilometraje</span> <strong class="text-right">113,000</strong></li><li class="car_transmission"><span>Transmisión</span> <strong class="text-right">Manual</strong></li>
      <li class="car_exterior_color"><span>Color Exterior</span> <strong class="text-right">Rojo</strong></li></ul></div></body></html>`;

  test('precio del auto (no de los relacionados), fotos solo de su galería, vendidos y fichas retiradas fuera', async () => {
    const rows = await collect(source, {
      '/wp-sitemap-posts-cars-1.xml': sitemap([`${B}/inventario/porsche-911-targa-1985/`, `${B}/inventario/porsche-911-carrera-1987/`, `${B}/inventario/porsche-911-sc-1981/`]),
      '/inventario/porsche-911-targa-1985/': ficha({ title: 'Porsche 911 Targa 1985', price: '1,500,000.00' }),
      '/inventario/porsche-911-carrera-1987/': ficha({ title: 'Porsche 911 Carrera 1987', price: '1,800,000.00', sold: true }),
      // porsche-911-sc-1981: 404 (el sitemap trae un auto retirado)
    });
    assert.equal(rows.length, 1);
    const [r] = rows;
    assert.deepEqual([r.title, r.make, r.year, r.km, r.transmission, r.color_ext, r.price, r.currency, r.city],
      ['Porsche 911 Targa 1985', 'Porsche', 1985, '113,000', 'Manual', 'Rojo', 1500000, 'MXN', null]);
    assert.deepEqual(r.photos, [`${B}/wp-content/uploads/2024/08/IMG_1.jpg`, `${B}/wp-content/uploads/2024/08/IMG_2-876x535.jpg`]);
    assert.ok(normalizeListing({ source_id: source.id, observed_on: '2026-11-12', ...r }).inScope);
  });
});

describe('Next.js __NEXT_DATA__ (GM Motors)', () => {
  const B = 'https://gm.test';
  const source = { id: 'gm-motors', adapter: 'next-inventario', name: 'GM Motors', base_url: B, cities: ['Monterrey'], config: { currency: 'MXN' } };
  const page = props => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: props } })}</script></body></html>`;
  const media = id => [{ file_url: `${B}/m/${id}/2.png`, is_primary: false, sort_order: 1, media_type: 'photo' }, { file_url: `${B}/m/${id}/1.png`, is_primary: true, sort_order: 0, media_type: 'photo' }];
  const list = [
    { id: 'a1', brand: 'PORSCHE', model: '911', version: 'GT3 TOURING', year: 2022, mileage: 8000, public_price: 4999000, transmission: 'manual', vehicle_media: media('a1') },
    { id: 'b2', brand: 'Volkswagen', model: 'AMAROK', version: 'Highline', year: 2021, mileage: 50000, public_price: 650000, transmission: 'automatic', vehicle_media: [] },
    { id: 'c3', brand: 'PORSCHE', model: '911', version: 'CARRERA S', year: 2020, mileage: 20000, public_price: 2899000, transmission: 'automatic', vehicle_media: [] },
    { id: 'd4', brand: 'PORSCHE', model: '911', version: 'TURBO S', year: 2021, mileage: 10000, public_price: 4100000, transmission: 'automatic', vehicle_media: [], status: 'sold' },
  ];
  test('lista + ficha solo para los nuevos de la taxonomía; apartados y vendidos fuera', async () => {
    const hits = [];
    const rows = await collect(source, {
      '/inventario': page({ vehicles: list }),
      '/auto/a1': page({ vehicle: { ...list[0], color: 'GRIS', status: 'available', invoice_type: 'original', vehicle_media: media('a1') } }),
      '/auto/c3': page({ vehicle: { ...list[2], status: 'reserved' } }),
    }, { hits });
    assert.deepEqual(rows.map(r => r.external_id), ['a1', 'b2']);
    const [gt3, amarok] = rows;
    assert.deepEqual([gt3.price, gt3.currency, gt3.km, gt3.transmission, gt3.color_ext], [4999000, 'MXN', '8000', 'Manual', 'GRIS']);
    assert.equal(gt3.photos[0], `${B}/m/a1/1.png`);   // la principal primero
    assert.match(gt3.description, /Factura: original/);
    assert.equal(normalizeListing({ source_id: source.id, observed_on: '2026-11-12', ...amarok }).inScope, false);
    assert.ok(!hits.includes('/auto/b2'), 'no abre la ficha de un auto fuera de la taxonomía');
  });
  test('si el sitio cambia y ya no trae la lista, falla esa fuente con un mensaje claro', async () => {
    await assert.rejects(collect(source, { '/inventario': page({ otra: [] }) }), /props\.pageProps\.vehicles/);
  });
});

describe('ficha con JSON-LD (El Auto Clásico, Prestige DLC)', () => {
  test('portal nacional: ciudad y fecha de publicación desde la descripción', async () => {
    const B = 'https://clasico.test';
    const source = { id: 'el-auto-clasico', adapter: 'ficha', name: 'El Auto Clásico', base_url: B, cities: [],
      config: { sitemaps: ['/1_mx_0_sitemap.xml'], include: '/\\d+-[^/]+\\.html$', city_re: 'Ubicaci[oó]n:\\s*(.+?)\\s*(?:Publicado|\\n|$)',
        published_re: 'Publicado desde:\\s*(\\d{1,2}/[A-Za-zé]+/\\d{4})', seller_type: 'desconocido', photo_path: '-large_default/' } };
    const html = `<html><body><h1>1986 porsche 911 carrera coupe</h1>
      <script type="application/ld+json">{"@type":"Product","name":"1986 porsche 911 carrera coupe","image":"${B}/222-large_default/944.jpg",
        "offers":{"@type":"Offer","priceCurrency":"MXN","price":"750000.00","availability":"https://schema.org/InStock"}}</script>
      <div itemprop="description">Motor 2.5 Precio:$750000.00 MXN Vendedor: Fulano Ubicación:Guadalajara, Jalisco, México Publicado desde:25/Octubre/2023 Último refrendo:27/Agosto/2024</div></body></html>`;
    const rows = await collect(source, {
      '/1_mx_0_sitemap.xml': `<urlset><url><loc><![CDATA[${B}/europeos/30-1986-porsche-911-carrera-coupe.html]]></loc></url><url><loc><![CDATA[${B}/contact-us]]></loc></url></urlset>`,
      '/europeos/30-1986-porsche-911-carrera-coupe.html': html,
    });
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].price, rows[0].currency, rows[0].city, rows[0].published_on, rows[0].seller_type],
      [750000, 'MXN', 'Guadalajara, Jalisco, México', '2023-10-25', 'desconocido']);
  });

  test('foto con la URL repetida del sitio se arregla; transmisión y colores del JSON-LD ("—" = sin dato)', async () => {
    const B = 'https://prestige.test';
    const source = { id: 'prestige-dlc', adapter: 'ficha', name: 'Prestige DLC', base_url: B, cities: ['Guadalajara'],
      config: { sitemaps: ['/sitemap.xml'], include: '/vehiculo/\\d+$' } };
    const html = `<html><body><h1>Porsche 911 Carrera S · 2021</h1><script type="application/ld+json">{"@type":"Vehicle","name":"Porsche 911 Carrera S 2021",
      "brand":{"@type":"Brand","name":"Porsche"},"vehicleModelDate":"2021","color":"Gris Ágata","vehicleInteriorColor":"—","vehicleTransmission":"PDK",
      "mileageFromOdometer":{"value":12000},"image":["${B}https://blob.test/v/181/1.jpg"],"offers":{"@type":"Offer","price":2950000,"priceCurrency":"MXN"}}</script></body></html>`;
    const rows = await collect(source, { '/sitemap.xml': sitemap([`${B}/vehiculo/181`]), '/vehiculo/181': html });
    assert.deepEqual([rows[0].photos[0], rows[0].transmission, rows[0].color_ext, rows[0].color_int, rows[0].km, rows[0].city],
      ['https://blob.test/v/181/1.jpg', 'PDK', 'Gris Ágata', null, '12000', 'Guadalajara']);
  });
});
