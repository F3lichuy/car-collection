// Adaptador de Wayback Machine: copias viejas de anuncios de Mercado Libre, sin red
// (el índice CDX y las copias salen de tests/fixtures/wayback).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { freshDb } from './helpers/db.mjs';
import { Store, fromPglite } from '../core/store.mjs';
import { PoliteFetcher } from '../core/http.mjs';
import { runSource } from '../core/pipeline.mjs';
import { adapters } from '../adapters/index.mjs';
import { parseMercadoLibre, parseCdx, decodeHtml, cdxFilter, urlTerms, mlPhotos } from '../adapters/wayback.mjs';

const fx = f => readFileSync(new URL(`./fixtures/wayback/${f}`, import.meta.url));
const ML_GT3 = 'https://auto.mercadolibre.com.mx/MLM-845012345-porsche-911-gt3-2018-_JM';
const ML_360 = 'http://auto.mercadolibre.com.mx/MLM-120012345-ferrari-360-modena-f1-2002-rojo-_JM';
const ML_FIN = 'https://auto.mercadolibre.com.mx/MLM-999999999-lamborghini-huracan-2016-_JM';

describe('lectura de una copia', () => {
  test('Mercado Libre 2012 en ISO-8859-1: título, precio, specs, fotos grandes, fecha relativa a la copia', () => {
    const html = decodeHtml(fx('ml-2012.html'), 'text/html');
    const { items: [x] } = parseMercadoLibre(html, { original: ML_360, day: '2012-09-15' });
    assert.equal(x.title, 'Ferrari 360 Modena F1 2002 Rojo');
    assert.equal(x.external_id, 'MLM120012345');
    assert.equal(x.url, 'https://auto.mercadolibre.com.mx/MLM-120012345-ferrari-360-modena-f1-2002-rojo-_JM');
    assert.equal(x.price, 1350000);
    assert.equal(x.currency, 'MXN');
    assert.equal(x.year, 2002);
    assert.equal(x.km, '38,000 Km');
    assert.equal(x.make, 'Ferrari');
    assert.equal(x.transmission, 'Automatizada');
    assert.equal(x.published_on, '2012-06-17');   // "hace 3 meses" desde la copia del 15 de septiembre
    assert.deepEqual(x.photos, [
      'https://mlm-s1-p.mlstatic.com/ferrari-360-modena-f1-2002-rojo-12345-MLM20012345_062012-O.jpg',
      'https://mlm-s2-p.mlstatic.com/ferrari-360-modena-f1-2002-rojo-12346-MLM20012346_062012-O.jpg']);
  });

  test('Mercado Libre 2021: JSON-LD, tabla de specs y la foto grande de cada imagen', () => {
    const { items: [x] } = parseMercadoLibre(decodeHtml(fx('ml-2021.html')), { original: ML_GT3, day: '2021-03-20' });
    assert.equal(x.price, 4890000);
    assert.equal(x.version, 'GT3');
    assert.equal(x.year, 2018);
    assert.equal(x.color_ext, 'Plata');
    assert.equal(x.published_on, '2021-03-08');
    assert.equal(x.photos.length, 2);
    assert.ok(x.photos.every(u => /_2X_.*-F\.webp$/.test(u)));
  });

  test('publicación finalizada o pausada: no se toma', () => {
    assert.equal(parseMercadoLibre(decodeHtml(fx('ml-finalizada.html')), { original: ML_FIN, day: '2021-03-20' }).skip, 'finalizada');
  });

  test('fotos: sin logos ni íconos', () => {
    assert.deepEqual(mlPhotos('<img src="https://http2.mlstatic.com/frontend-assets/ui-navigation/5.19.1/mercadolibre/logo__large_plus.png">'), []);
  });

  test('índice CDX: renglones y llave para seguir', () => {
    const { rows, resumeKey } = parseCdx(`20120915000000 ${ML_360}\n20210320000000 ${ML_GT3}\n\ncom%2Cmercadolibre%2Cauto)%2Fmlm-9+2021\n`);
    assert.equal(rows.length, 2);
    assert.equal(resumeKey, 'com%2Cmercadolibre%2Cauto)%2Fmlm-9+2021');
    assert.equal(parseCdx(`20120915000000 ${ML_360}\n`).resumeKey, null);
  });

  test('filtro de direcciones: marcas exóticas completas y solo los modelos de la taxonomía de las demás', () => {
    const re = new RegExp(cdxFilter(urlTerms()).replace(/^original:\(\?i\)/, ''), 'i');
    assert.ok(re.test(ML_GT3));
    assert.ok(re.test('https://auto.mercadolibre.com.mx/MLM-1-ford-mustang-gt-2015-_JM'));
    assert.ok(!re.test('https://auto.mercadolibre.com.mx/MLM-1-ford-fiesta-2015-_JM'));
    assert.ok(!re.test('https://auto.mercadolibre.com.mx/MLM-1-nissan-versa-spider-_JM'));
    assert.ok(!re.test('https://auto.mercadolibre.com.mx/MLM-1-mercedes-benz-slk-2010-_JM'));
  });
});

describe('corrida completa contra la base', () => {
  let db, store, stateFile;
  const pages = { [ML_360]: { 20120915000000: 'ml-2012.html' }, [ML_GT3]: { 20210320000000: 'ml-2021.html', 20210325000000: 'ml-2021.html', 20210610000000: 'ml-2021-junio' }, [ML_FIN]: { 20210320000000: 'ml-finalizada.html' } };
  const cdx = `20120915000000 ${ML_360}\n20210320000000 ${ML_FIN}\n20210320000000 ${ML_GT3}\n20210325000000 ${ML_GT3}\n20210610000000 ${ML_GT3}\n`;
  const hits = [];
  const fetcher = () => new PoliteFetcher({ minDelayMs: 0, retries: 0, fetchImpl: async url => {
    const u = new URL(url); hits.push(url);
    if (u.pathname === '/robots.txt') return new Response('User-agent: *\nAllow: /\n');
    if (u.pathname === '/cdx/search/cdx') return new Response(cdx);
    const m = url.match(/\/web\/(\d{14})id_\/(.+)$/);
    const f = m && pages[m[2]]?.[m[1]];
    if (!f) return new Response('no', { status: 404 });
    const body = f === 'ml-2021-junio' ? fx('ml-2021.html').toString().replaceAll('4,890,000', '4,750,000').replace('4890000', '4750000') : fx(f);
    return new Response(body, { headers: { 'content-type': 'text/html' } });
  } });
  const source = () => ({ id: 'wayback', adapter: 'wayback', name: 'Wayback', config: { state_file: stateFile,
    targets: [{ id: 'ml', source: 'mercadolibre-autos', parser: 'mercadolibre', prefixes: ['auto.mercadolibre.com.mx/MLM-'], id_re: 'MLM-?(\\d{6,})', id_prefix: 'MLM' }] } });

  before(async () => {
    db = await freshDb();
    store = new Store(fromPglite(db));
    stateFile = join(mkdtempSync(join(tmpdir(), 'wb-')), 'estado.json');
    await db.query(`insert into mx_sources (id, name, kind, capture_mode) values ('wayback', 'Wayback', 'portal', 'scraper'), ('mercadolibre-autos', 'ML', 'portal', 'script_local') on conflict do nothing`);
  });

  test('cada copia con su fecha; dos meses con precio distinto = rebaja; viejos como "ya no aparece"', async () => {
    const r = await runSource({ adapter: adapters.wayback(source()), source: source(), store, fetcher: fetcher(), today: '2026-11-12', hashPhotos: false, log: () => {} });
    assert.equal(r.ok, true, r.fatal);
    assert.equal(r.nuevos, 2);
    const ls = (await db.query(`select external_id, source_id, capture_method, status, first_seen::text f, last_seen::text l, published_on::text p from mx_listings order by external_id`)).rows;
    assert.deepEqual(ls, [
      { external_id: 'MLM120012345', source_id: 'mercadolibre-autos', capture_method: 'wayback', status: 'desaparecido', f: '2012-09-15', l: '2012-09-15', p: '2012-06-17' },
      { external_id: 'MLM845012345', source_id: 'mercadolibre-autos', capture_method: 'wayback', status: 'desaparecido', f: '2021-03-20', l: '2021-06-10', p: '2021-03-08' },
    ]);
    const prices = (await db.query(`select price::int p, observed_from::text a from mx_price_snapshots s join mx_listings l on l.id = s.listing_id
      where l.external_id = 'MLM845012345' order by observed_from`)).rows;
    assert.deepEqual(prices, [{ p: 4890000, a: '2021-03-20' }, { p: 4750000, a: '2021-06-10' }]);
    // la del 25 de marzo era del mismo mes: no se abrió
    assert.ok(!hits.some(u => u.includes('20210325000000')));
    // no se guarda nada en pesos dudosos ni datos del vendedor en la ficha pública
    assert.equal((await db.query(`select count(*)::int n from mx_listings where title ilike '%juan%'`)).rows[0].n, 0);
    assert.ok(existsSync(stateFile));
  });

  test('la siguiente corrida sigue donde se quedó: no vuelve a abrir las mismas copias', async () => {
    const before = hits.filter(u => u.includes('/web/')).length;
    const r = await runSource({ adapter: adapters.wayback(source()), source: source(), store, fetcher: fetcher(), today: '2026-11-13', hashPhotos: false, log: () => {} });
    assert.equal(r.ok, true, r.fatal);
    assert.equal(hits.filter(u => u.includes('/web/')).length, before);
    assert.equal((await db.query(`select count(*)::int n from mx_listings`)).rows[0].n, 2);
  });
});
