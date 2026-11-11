// Fase 3 · Normalizador: anuncios típicos del mercado MX.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeListing, resolveTaxonomy, parseKm, parsePrice, parseColor } from '../core/normalize.mjs';
import { canonicalUrl } from '../core/extract.mjs';

const tx = (title, year, extra = {}) => resolveTaxonomy({ make: extra.make ?? title.split(' ')[0], model: title, title, year, ...extra });
const n = (raw) => normalizeListing({ source_id: 'test', url: 'https://x.mx/a/1', observed_on: '2026-11-10', ...raw });

describe('taxonomía', () => {
  const cases = [
    ['Porsche 911 GT3 RS', 2023, 'porsche-911-992-1-gt3-rs'],
    ['Porsche 911 GT3RS', 2016, 'porsche-911-991-1-gt3-rs'],
    ['Porsche 911 GT3 Touring', 2018, 'porsche-911-991-2-gt3-touring'],
    ['Porsche 911 Carrera 4S', 2015, 'porsche-911-991-1-carrera-4s'],
    ['Porsche 911 Carrera 4 GTS', 2018, 'porsche-911-991-2-carrera-4-gts'],
    ['Porsche 911 Carrera SC', 1980, 'porsche-911-g-911-sc'],
    ['Porsche 911 Turbo S', 2022, 'porsche-911-992-1-turbo-s'],
    ['Ferrari 458 Italia', 2012, 'ferrari-458-458-458-italia'],
    ['Ferrari 488 Pista Spider', 2019, 'ferrari-488-488-488-pista-spider'],
    ['Lamborghini Huracán EVO RWD', 2021, 'lamborghini-huracan-lb724-evo-rwd'],
    ['Lambo Huracan LP610-4', 2016, 'lamborghini-huracan-lb724-lp610-4'],
    ['Mercedes-Benz G 63 AMG', 2016, 'mercedes-benz-clase-g-amg-w463-g-63-amg'],
    ['McLaren 720S Spider', 2020, 'mclaren-super-series-720s-720s-spider'],
    ['Aston Martin DBX707', 2023, 'aston-martin-dbx-dbx-dbx707'],
  ];
  for (const [title, year, id] of cases) test(`${title} ${year} → ${id}`, () => assert.equal(tx(title, year).version_id, id, JSON.stringify(tx(title, year))));

  test('fuera de la taxonomía (Macan) no entra', () => {
    const r = tx('Porsche Macan GTS', 2022);
    assert.equal(r.model_id, null); assert.ok(r.issues.includes('modelo_fuera_de_taxonomia'));
  });
  test('Cayenne Turbo NO es un 911 Turbo (caso real de la primera corrida en seco)', () => {
    const r = tx('Porsche CAYENNE TURBO', 2022);
    assert.equal(r.model_id, null); assert.equal(r.excluded, 'cayenne');
    assert.equal(tx('Porsche Turbo S', 2022).model_id, null);            // "Turbo S" solo no identifica al 911
    assert.equal(tx('Porsche GT3 RS', 2023).version_id, 'porsche-911-992-1-gt3-rs'); // "GT3 RS" sí
  });
  test('"automática" sin versión exacta: la generación 982 solo tuvo manual o PDK → PDK', () => {
    const r = n({ title: 'Porsche 718 Boxster S 2018', make: 'Porsche', model: '718 Boxster S', year: 2018, transmission: 'Automática' });
    assert.equal(r.specs.transmission, 'pdk');
  });
  test('clásicos de colección de EuroClassic (títulos reales) se reconocen', () => {
    const cases = [
      ['Mercedes 560 SL 1989', 1989, 'mercedes-benz', 'mercedes-benz-sl-r107-r107-560-sl'],
      ['Mercedes-Benz 230 GE (Steyr-Puch) 1993', 1993, 'mercedes-benz', 'mercedes-benz-clase-g-clasica-w461-230-ge'],
      ['Alfa Romeo Spider 2000 1978', 1978, 'alfa romeo', 'alfa-romeo-spider-s2-2000'],
      ['Land Rover Defender 110 TD4 1987', 1987, 'land rover', 'land-rover-defender-90-110-110'],
      ['Peugeot 205 GTI 1.9 1988', 1988, 'peugeot', 'peugeot-205-gti-205gti-1-9'],
      ['Rover Mini Cooper 1993 — British Racing Green', 1993, 'rover mini', 'mini-mini-clasico-clasico-cooper'],
      ['Rover Mini British Open 1992', 1992, 'rover mini', 'mini-mini-clasico-clasico-british-open'],
      ['Volkswagen Karmann Ghia 1970', 1970, 'volkswagen', 'volkswagen-karmann-ghia-typ14-typ-14'],
      ['Audi RS6 2004', 2004, 'audi', 'audi-rs6-c5-rs6-c5'],
      ['BMW 318i Touring 1990', 1990, 'bmw', 'bmw-serie-3-e30-e30-318i'],
      ['Mercedes-Benz 300 SL 1987', 1987, 'mercedes-benz', 'mercedes-benz-sl-r107-r107-300-sl'],
      ['Mercedes-Benz 300 SL Gullwing 1955', 1955, 'mercedes-benz', 'mercedes-benz-300-sl-w198-gullwing'],
    ];
    for (const [title, year, make, id] of cases) assert.equal(tx(title, year, { make }).version_id, id, `${title}: ${JSON.stringify(tx(title, year, { make }))}`);
    // fuera: modernos de esas marcas y lo que no es de colección
    for (const [title, year, make] of [['Mini Cooper S', 2018, 'mini'], ['Land Rover Defender 110', 2022, 'land rover'], ['BMW M3', 2021, 'bmw'], ['Audi RS6 Avant', 2021, 'audi'], ['MG MGF', 1996, 'mg']])
      assert.equal(tx(title, year, { make }).model_id ?? null, null, title);
  });
  test('modelo en la taxonomía pero generación no (Mustang 2022) → fuera', () => {
    const r = tx('Ford Mustang GT', 2022);
    assert.equal(r.model_id, null); assert.ok(r.issues.includes('anio_fuera_de_taxonomia'));
    assert.equal(tx('Ford Mustang Mach 1', 1970).version_id, 'ford-mustang-1-mach-1');
  });
  test('versión que no está en la lista: modelo y generación sí, versión no (sin inventar)', () => {
    const r = tx('Porsche 718 Boxster S', 2018);
    assert.deepEqual([r.model_id, r.generation_id, r.version_id], ['porsche-boxster', 'porsche-boxster-982', null]);
  });
  test('"992" en el título con año frontera → generación ambigua, a revisión', () => {
    const r = tx('Porsche 911 GT3 992', 2024);
    assert.equal(r.version_id, null); assert.ok(r.issues.includes('version_ambigua'));
  });
});

describe('campos', () => {
  test('km', () => {
    assert.equal(parseKm('8,500 km').km, 8500);
    assert.equal(parseKm('45 mil millas').km, 72420);
    assert.equal(parseKm('1.200 Kms.').km, 1200);
    assert.equal(parseKm(35497).km, 35497);
    assert.equal(parseKm('').km, null);
  });
  test('precio', () => {
    assert.deepEqual(parsePrice('$1,250,000 MXN'), { price: 1250000, currency: 'MXN', negotiable: false });
    assert.deepEqual(parsePrice('USD 185,000'), { price: 185000, currency: 'USD', negotiable: false });
    assert.deepEqual(parsePrice('Precio a tratar'), { price: null, currency: null, negotiable: true });
    assert.deepEqual(parsePrice('9.8 millones'), { price: 9800000, currency: 'MXN', negotiable: false });
    assert.equal(parsePrice(2000000, 'MXN').currency, 'MXN');
  });
  test('colores de fábrica y familias', () => {
    assert.deepEqual(parseColor('GT Silver Metallic'), { name: 'GT Silver', family: 'plata', raw: 'GT Silver Metallic' });
    assert.deepEqual(parseColor('Rosso Corsa'), { name: 'Rosso Corsa', family: 'rojo', raw: 'Rosso Corsa' });
    assert.equal(parseColor('Verde').family, 'verde');
    assert.equal(parseColor('Gris Oxford').family, 'gris');
    assert.equal(parseColor('xyz').family, null);
  });
  test('URL canónica quita rastreo', () => {
    assert.equal(canonicalUrl('https://WWW.Agencia.mx/auto/911/?utm_source=fb&fbclid=1#fotos'), 'https://www.agencia.mx/auto/911');
    assert.equal(canonicalUrl('https://x.mx/v?id=5&utm_medium=a'), 'https://x.mx/v?id=5');
  });
});

describe('anuncio completo', () => {
  test('anuncio típico de agencia mexicana', () => {
    const r = n({
      title: 'Porsche 911 GT3 Touring 2018', make: 'Porsche', model: '911 GT3 Touring', year: '2018',
      km: '12,300 km', price: '$4,350,000', transmission: 'Estándar', color_ext: 'GT Silver', color_int: 'Negro',
      description: 'Factura de agencia, único dueño, todos los servicios en agencia. Front axle lift, PCCB y Sport Chrono. Nacional. VIN WP0AC2A99JS175001',
    });
    assert.equal(r.inScope, true);
    assert.equal(r.vehicle.version_id, 'porsche-911-991-2-gt3-touring');
    assert.equal(r.vehicle.vin, 'WP0AC2A99JS175001');
    assert.deepEqual([r.specs.year, r.specs.km, r.specs.transmission, r.specs.exterior_color, r.specs.interior_color_family],
      [2018, 12300, 'manual', 'GT Silver', 'negro']);
    assert.deepEqual([r.specs.invoice_type, r.specs.owners, r.specs.service_history, r.specs.origin], ['agencia', 1, 'agencia_completo', 'nacional']);
    assert.deepEqual(r.specs.options, ['frenos_carbono_ceramicos', 'lift_delantero', 'sport_chrono']);
    assert.deepEqual(r.price, { price: 4350000, currency: 'MXN', negotiable: false });
    assert.equal(r.confidence, 1);
  });

  test('"automática" en un 991 Carrera 4S = PDK (Tiptronic ya no existía)', () => {
    const r = n({ title: 'Porsche 911 Carrera 4S 2015', make: 'Porsche', model: '911 Carrera 4S', year: 2015, transmission: 'Automática' });
    assert.equal(r.specs.transmission, 'pdk'); assert.deepEqual(r.inferred, ['automatica_es_pdk']);
  });

  test('Ferrari "F1" de 2012 es doble embrague; GT3 RS 992 "manual" es imposible → baja confianza', () => {
    assert.equal(n({ title: 'Ferrari 458 Italia F1', make: 'Ferrari', model: '458 Italia', year: 2012 }).specs.transmission, 'dct');
    const r = n({ title: 'Porsche 911 GT3 RS', make: 'Porsche', model: '911 GT3 RS', year: 2023, transmission: 'Manual', km: 900, price: 9e6 });
    assert.ok(r.issues.includes('transmision_imposible_para_la_version'));
    assert.ok(r.confidence < 1);
  });

  test('aseguradora, legalizado, millas y "a tratar"', () => {
    const r = n({ title: 'Lamborghini Gallardo LP560-4 2010', make: 'Lamborghini', model: 'Gallardo LP560-4', year: 2010,
      km: '20 mil millas', price_text: 'Precio a tratar', description: 'Factura de aseguradora, legalizado, e-gear' , transmission: 'e-gear'});
    assert.deepEqual([r.specs.invoice_type, r.specs.origin, r.specs.km, r.specs.transmission], ['aseguradora', 'legalizado', 32187, 'automatizada']);
    assert.deepEqual(r.price, { price: null, currency: null, negotiable: true });
    assert.ok(r.unresolved.includes('precio'));
  });

  test('"Alfa Romeo Spider 2000 1978": el año es 1978, no el 2000 del nombre (caso real)', () => {
    const r = n({ title: 'Alfa Romeo Spider 2000 1978', model: 'Alfa Romeo Spider 2000 1978', price: 550000, currency: 'MXN' });
    assert.equal(r.specs.year, 1978);
    assert.equal(r.vehicle.version_id, 'alfa-romeo-spider-s2-2000');
  });

  test('nunca inventa: campos sin dato quedan null', () => {
    const r = n({ title: 'Porsche 911', make: 'Porsche', model: '911' });
    assert.equal(r.vehicle.version_id, null);
    assert.equal(r.specs.year, null);
    assert.equal(r.specs.invoice_type, null);
    assert.ok(r.confidence < 0.5);
  });
});
