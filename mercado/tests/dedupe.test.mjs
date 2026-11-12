// Fase 2 · Motor de identidad: casos típicos de duplicados en el mercado MX.
// Las fotos son escenas sintéticas (sin derechos de terceros) con las mismas
// transformaciones que hace un broker o un repost: marca de agua, recompresión,
// reducción, recorte. Cuando lleguen datos reales (Fase 3) se agregan como fixtures.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { IdentityIndex, kmCompare } from '../core/dedupe.mjs';
import { normalizeVin, findVins } from '../core/vin.mjs';
import { phash } from '../core/phash.mjs';
import { original, transforms, placeholder } from './helpers/images.mjs';

const H = async buf => { const p = await phash(buf); return { hash: p.hash, center: p.center, lowInfo: p.lowInfo }; };
const photos = {}; // nombre → [{hash, center, lowInfo}]
const set = async (name, seeds, t) => { photos[name] = []; for (const s of seeds) { const o = await original(s); photos[name].push(await H(t ? await transforms[t](o) : o)); } };

const GT3RS = { model_id: 'porsche-911', generation_id: 'porsche-911-992-1', version_id: 'porsche-911-992-1-gt3-rs' };
const specsRS = { year: 2023, km: 1200, exterior_color: 'GT Silver', exterior_color_family: 'plata',
  interior_color: 'Negro', interior_color_family: 'negro', transmission: 'pdk', observed_on: '2026-11-01' };
const vehicle = (id, extra = {}) => ({ id, created_at: `2026-10-${String(10 + id.length).padStart(2, '0')}`, ...GT3RS, specs: specsRS, photos: [], ...extra });

before(async () => {
  await set('agencia', [101, 102, 103, 104, 105, 106]);
  await set('broker_marca_agua', [101, 102, 103, 104], 'marca_de_agua');
  await set('broker_recorte', [102, 103, 105], 'recorte_5');
  await set('marketplace', [101, 103, 106], 'marketplace');
  await set('dueno_fotos_nuevas', [201, 202, 203]);
  await set('otro_auto', [301, 302, 303, 304]);
  await set('prensa', [401, 402, 403]);
  await set('propias_a', [501, 502]); await set('propias_b', [511, 512]); await set('propias_c', [521, 522]); await set('propias_d', [531, 532]);
  photos.placeholder = [await H(await placeholder())];
});

describe('VIN', () => {
  test('se normaliza y se encuentra en texto libre aunque venga partido', () => {
    assert.equal(normalizeVin(' wp0-af2a9 9ps270001 ').vin, 'WP0AF2A99PS270001');
    assert.deepEqual(findVins('Excelente, VIN: wp0-af2a9 9ps270001, factura de agencia'), ['WP0AF2A99PS270001']);
    assert.deepEqual(findVins('Tel 81 1234 5678 · folio 12345678901234567 · precio a tratar'), []);
    assert.throws(() => normalizeVin('WP0AF2A99PS27000O'), /I, O o Q/);
  });

  test('mismo VIN en otro sitio → mismo auto, aunque cambien las fotos', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { vin: 'WP0AF2A99PS270001', photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, vin: 'wp0af2a99ps270001', specs: specsRS, photos: photos.dueno_fotos_nuevas });
    assert.equal(r.action, 'match'); assert.equal(r.vehicleId, 'v1'); assert.equal(r.reason, 'vin');
  });
});

describe('fotos', () => {
  test('caso típico: el GT3 RS de la agencia aparece en un broker con marca de agua → mismo auto', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { vin: 'WP0AF2A99PS270001', photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, specs: { ...specsRS, km: 1250 }, photos: photos.broker_marca_agua });
    assert.equal(r.action, 'match'); assert.equal(r.vehicleId, 'v1'); assert.equal(r.reason, 'fotos');
    assert.ok(r.evidence.photos.strong >= 3);
  });

  test('broker que recorta las fotos → mismo auto', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, specs: {}, photos: photos.broker_recorte });
    assert.equal(r.action, 'match'); assert.equal(r.vehicleId, 'v1');
  });

  test('repost en Marketplace (reducida + marca de agua + recompresión): nunca queda como auto nuevo sin revisión', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, specs: { ...specsRS, km: 1300, observed_on: '2026-11-08' }, photos: photos.marketplace });
    const ok = (r.action === 'match' && r.vehicleId === 'v1') || r.reviews[0]?.vehicleId === 'v1';
    assert.ok(ok, JSON.stringify(r));
  });

  test('mismas fotos pero otro año (aunque sea por 1) → autos distintos: ni fusión ni pregunta', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, specs: { ...specsRS, year: 2024 }, photos: photos.broker_marca_agua });
    assert.equal(r.action, 'new');
    assert.equal(r.reviews.length, 0);
  });

  test('fotos reusadas en un auto con VIN distinto → ni fusión ni revisión', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { vin: 'WP0AF2A99PS270001', photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, vin: 'WP0AF2A91PS270999', specs: specsRS, photos: photos.broker_marca_agua });
    assert.equal(r.action, 'new'); assert.equal(r.reviews.length, 0);
  });

  test('fotos de prensa que usa medio mercado → se ignoran (genéricas)', () => {
    const idx = new IdentityIndex()
      .addVehicle(vehicle('f1', { vin: 'ZFF92LMA000250001', specs: { year: 2020 }, photos: [...photos.prensa, ...photos.propias_a] }))
      .addVehicle(vehicle('f2', { vin: 'ZFF92LMA000250002', specs: { year: 2021 }, photos: [...photos.prensa, ...photos.propias_b] }))
      .addVehicle(vehicle('f3', { vin: 'ZFF92LMA000250003', specs: { year: 2022 }, photos: [...photos.prensa, ...photos.propias_c] }));
    const r = idx.resolve({ ...GT3RS, specs: { year: 2019 }, photos: [...photos.prensa, ...photos.propias_d] });
    assert.equal(r.action, 'new');
    assert.equal(r.evidence.genericPhotos, 3);
    assert.equal(r.reviews.length, 0);
  });

  test('"Foto próximamente" (imagen lisa) no identifica a nadie', () => {
    assert.equal(photos.placeholder[0].lowInfo, true);
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { specs: { year: 2021 }, photos: [...photos.placeholder, ...photos.placeholder] }));
    const r = idx.resolve({ ...GT3RS, specs: { year: 2023 }, photos: [...photos.placeholder, ...photos.otro_auto] });
    assert.equal(r.action, 'new'); assert.equal(r.reviews.length, 0);
  });

  test('si el anuncio coincide con dos autos que teníamos separados → se une al mejor y se propone revisar el otro par', () => {
    const idx = new IdentityIndex()
      .addVehicle(vehicle('v1', { created_at: '2026-01-01', photos: photos.agencia }))
      .addVehicle(vehicle('v2', { created_at: '2026-02-01', photos: photos.broker_marca_agua.slice(0, 2) }));
    const r = idx.resolve({ ...GT3RS, specs: specsRS, photos: photos.agencia.slice(0, 4) });
    assert.equal(r.action, 'match'); assert.equal(r.vehicleId, 'v1');
    assert.equal(r.reviews[0].vehicleId, 'v2'); assert.equal(r.reviews[0].pairWith, 'v1');
  });
});

describe('fingerprint (siempre a revisión)', () => {
  test('el dueño republica con fotos nuevas: misma versión, año, colores y km → revisión con score alto', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, specs: { ...specsRS, km: 1230 }, photos: photos.dueno_fotos_nuevas });
    assert.equal(r.action, 'new');
    assert.equal(r.reviews[0].vehicleId, 'v1');
    assert.ok(r.reviews[0].score >= 0.8, String(r.reviews[0].score));
  });

  test('dos GT3 Touring blancos iguales de la misma agencia con VIN distinto → no se proponen', () => {
    const t = { model_id: 'porsche-911', generation_id: 'porsche-911-991-2', version_id: 'porsche-911-991-2-gt3-touring' };
    const sp = { year: 2018, km: 8000, exterior_color: 'Carrara White', exterior_color_family: 'blanco', interior_color_family: 'negro', transmission: 'manual' };
    const idx = new IdentityIndex().addVehicle({ id: 'w1', ...t, vin: 'WP0AC2A99JS175001', specs: sp, photos: photos.agencia });
    const r = idx.resolve({ ...t, vin: 'WP0AC2A97JS175002', specs: { ...sp, km: 8150 }, photos: photos.otro_auto });
    assert.equal(r.reviews.length, 0);
    // Sin VIN en el anuncio nuevo no se puede saber → sí va a revisión.
    const r2 = idx.resolve({ ...t, specs: { ...sp, km: 8150 }, photos: photos.otro_auto });
    assert.equal(r2.reviews[0]?.vehicleId, 'w1');
  });

  test('el mismo auto 8 meses después con +3,000 km sigue siendo candidato; con −20% km ya no', () => {
    assert.equal(kmCompare({ km: 10000, observed_on: '2026-01-01' }, { km: 13000, observed_on: '2026-09-01' }), 'agree');
    assert.equal(kmCompare({ km: 10000, observed_on: '2026-01-01' }, { km: 8000, observed_on: '2026-09-01' }), 'conflict');
    assert.equal(kmCompare({ km: 50 }, { km: 300 }), 'agree');          // auto casi nuevo: tolerancia mínima de 300 km
    assert.equal(kmCompare({ km: 20000 }, { km: 20700 }), 'conflict');  // >3% el mismo día
  });

  test('sin colores (anuncio pobre): versión + año + km → revisión, con menos score que el completo', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    const pobre = idx.resolve({ ...GT3RS, specs: { year: 2023, km: 1210 }, photos: [] });
    const completo = idx.resolve({ ...GT3RS, specs: { ...specsRS, km: 1210 }, photos: [] });
    assert.equal(pobre.reviews[0].vehicleId, 'v1');
    assert.ok(pobre.reviews[0].score < completo.reviews[0].score);
  });

  test('color distinto o año distinto → no es candidato', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    assert.equal(idx.resolve({ ...GT3RS, specs: { ...specsRS, exterior_color: 'Shark Blue', exterior_color_family: 'azul' }, photos: [] }).reviews.length, 0);
    assert.equal(idx.resolve({ ...GT3RS, specs: { ...specsRS, year: 2025 }, photos: [] }).reviews.length, 0);
  });

  test('versión desconocida en el anuncio: solo con generación igual y ≥3 campos', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { photos: photos.agencia }));
    const { version_id, ...sinVersion } = GT3RS;
    assert.equal(idx.resolve({ ...sinVersion, specs: { ...specsRS, km: 1210 }, photos: [] }).reviews[0]?.vehicleId, 'v1');
    assert.equal(idx.resolve({ ...sinVersion, specs: { year: 2023, km: 1210 }, photos: [] }).reviews.length, 0);
  });
});

describe('barreras', () => {
  test('mismo listing (URL canónica) → mismo auto', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { listings: [{ url_canonical: 'https://agencia.mx/911-gt3rs', source_id: 'agencia', external_id: '77' }] }));
    assert.equal(idx.resolve({ ...GT3RS, specs: {}, photos: [], listing: { url_canonical: 'https://agencia.mx/911-gt3rs' } }).reason, 'listing');
    assert.equal(idx.resolve({ ...GT3RS, specs: {}, photos: [], listing: { source_id: 'agencia', external_id: '77' } }).vehicleId, 'v1');
  });

  test('demo nunca se mezcla con real', () => {
    const idx = new IdentityIndex().addVehicle(vehicle('v1', { is_demo: true, photos: photos.agencia }));
    const r = idx.resolve({ ...GT3RS, specs: specsRS, photos: photos.agencia });
    assert.equal(r.action, 'new'); assert.equal(r.reviews.length, 0);
  });

  test('un par que marcaste "distinto" no se vuelve a proponer', () => {
    const idx = new IdentityIndex()
      .addVehicle(vehicle('a1', { created_at: '2026-01-01', photos: photos.agencia }))
      .addVehicle(vehicle('a2', { created_at: '2026-02-01', photos: photos.dueno_fotos_nuevas }));
    assert.equal(idx.scanAll().reviews.length, 1);
    idx.addDistinct('a2', 'a1');
    assert.equal(idx.scanAll().reviews.length, 0);
  });
});

describe('barrido completo (scanAll)', () => {
  test('dos vehículos guardados con las mismas fotos → fusión segura, se queda el más antiguo', () => {
    const idx = new IdentityIndex()
      .addVehicle(vehicle('nuevo', { created_at: '2026-05-01', photos: photos.broker_marca_agua }))
      .addVehicle(vehicle('viejo', { created_at: '2026-01-01', photos: photos.agencia }))
      .addVehicle(vehicle('otro', { created_at: '2026-03-01', specs: { year: 2019 }, photos: photos.otro_auto }));
    const r = idx.scanAll();
    assert.deepEqual(r.merges.map(m => [m.keep, m.drop, m.reason]), [['viejo', 'nuevo', 'fotos']]);
    assert.equal(r.reviews.length, 0);
  });
});

// Casos reales (2026-11-12): tarjetas de Mercado Libre con UNA sola foto y el mismo auto en agencia y ML.
describe('una sola foto y datos idénticos', () => {
  const URUS = { model_id: 'lamborghini-urus', generation_id: null, version_id: null };
  const urus = (id, specs, extra = {}) => ({ id, created_at: `2026-11-${String(10 + id.length).padStart(2, '0')}`, ...URUS, specs, photos: [], ...extra });

  test('misma foto de portada, mismo año y mismos km (Urus de Benito Juárez publicado dos veces) → mismo auto', () => {
    const s = { year: 2021, km: 30000, observed_on: '2026-11-12' };
    const idx = new IdentityIndex().addVehicle(urus('v1', s, { photos: [photos.agencia[0]] }));
    const r = idx.resolve({ ...URUS, specs: s, photos: [photos.agencia[0]] });
    assert.equal(r.action, 'match'); assert.equal(r.reason, 'fotos'); assert.equal(r.vehicleId, 'v1');
  });

  test('una foto parecida (mismo estudio) pero otro año → ni fusión ni revisión', () => {
    const idx = new IdentityIndex().addVehicle(urus('v1', { year: 2022, km: 8687 }, { photos: [photos.agencia[0]] }));
    const r = idx.resolve({ ...URUS, specs: { year: 2025, km: 4500 }, photos: [photos.marketplace[0]] });
    assert.equal(r.action, 'new'); assert.equal(r.reviews.length, 0);
  });

  test('una sola foto igual pero km que no cuadran → revisión, no fusión', () => {
    const idx = new IdentityIndex().addVehicle(urus('v1', { year: 2025, km: 7381, observed_on: '2026-11-12' }, { photos: [photos.agencia[0]] }));
    const r = idx.resolve({ ...URUS, specs: { year: 2025, km: 4500, observed_on: '2026-11-12' }, photos: [photos.agencia[0]] });
    assert.equal(r.action, 'new'); assert.equal(r.reviews[0].vehicleId, 'v1');
  });

  test('mismos km exactos "no redondos" y mismo año en agencia y Mercado Libre → mismo auto, aunque no haya foto en común', () => {
    const idx = new IdentityIndex().addVehicle(urus('v1', { year: 2023, km: 12972, observed_on: '2026-11-12' }, { prices: [6500000] }));
    const r = idx.resolve({ ...URUS, specs: { year: 2023, km: 12972, observed_on: '2026-11-12' }, price: 6800000, photos: [] });
    assert.equal(r.action, 'match'); assert.equal(r.reason, 'datos');
  });

  test('km redondos y el mismo precio (Huracán Sterrato 1,200 km a $9.3 M, que eran dos autos) → solo revisión', () => {
    const base = { year: 2023, km: 1200, observed_on: '2026-11-12' };
    const idx = new IdentityIndex().addVehicle(urus('v1', base, { prices: [9300000] }));
    const r = idx.resolve({ ...URUS, specs: base, price: 9300000, photos: [] });
    assert.equal(r.action, 'new'); assert.deepEqual(r.reviews[0].reasons, ['mismos_km_exactos', 'mismo_precio']); assert.equal(r.reviews[0].score, 0.9);
    const r2 = idx.resolve({ ...URUS, specs: base, price: 9600000, photos: [] });
    assert.equal(r2.action, 'new'); assert.equal(r2.reviews.length, 0);
  });

  test('autos casi nuevos (10 km, mismo precio de lista) nunca se unen por datos', () => {
    const base = { year: 2026, km: 10, observed_on: '2026-11-12' };
    const idx = new IdentityIndex().addVehicle(urus('v1', base, { prices: [5900000] }));
    assert.equal(idx.resolve({ ...URUS, specs: base, price: 5900000, photos: [] }).action, 'new');
  });

  test('tu regla: otro color, otra carrocería o un precio de otro mundo → autos distintos, no se pregunta', () => {
    const a = { year: 2024, km: 5000, exterior_color_family: 'amarillo', body: 'suv', observed_on: '2026-11-12' };
    const idx = new IdentityIndex().addVehicle(urus('v1', a, { prices: [7999000] }));
    const none = inc => assert.equal(idx.resolve({ ...URUS, photos: [], ...inc }).reviews.length, 0);
    none({ specs: { ...a, exterior_color_family: 'verde' }, price: 7999000 });                 // otro color
    none({ specs: { ...a, body: 'cabriolet' }, price: 7999000 });                              // otra carrocería
    none({ specs: a, price: 1200000 });                                                        // 1.2 M contra 8 M
    // lo que sí puede cambiar: ciudad, fuente, km y precio razonable → se pregunta
    assert.equal(idx.resolve({ ...URUS, photos: [], specs: a, price: 7999000 }).reviews.length, 1);
  });

  test('foto de color vivo: un Urus verde y uno amarillo con los mismos datos no se preguntan', () => {
    const a = { year: 2024, km: 5000, photo_color: 'amarillo', observed_on: '2026-11-12' };
    const idx = new IdentityIndex().addVehicle(urus('v1', a, { prices: [7999000] }));
    assert.equal(idx.resolve({ ...URUS, specs: { ...a, photo_color: 'verde' }, price: 7999000, photos: [] }).reviews.length, 0);
    assert.equal(idx.resolve({ ...URUS, specs: a, price: 7999000, photos: [] }).reviews.length, 1);
  });

  test('el barrido no toca autos que la dueña borró y descarta revisiones entre modelos distintos', () => {
    const s = { year: 2021, km: 30000, observed_on: '2026-11-12' };
    const idx = new IdentityIndex()
      .addVehicle(urus('v1', s, { photos: [photos.agencia[0]] }))
      .addVehicle(urus('v2', s, { photos: [photos.agencia[0]], deleted: true }))
      .addVehicle({ id: 'v3', ...GT3RS, specs: specsRS, photos: [photos.agencia[0]] });
    const { merges, reviews } = idx.scanAll();
    assert.equal(merges.length, 0); assert.equal(reviews.length, 0);
    assert.deepEqual(idx.reviewStillValid('v1', 'v3'), { ok: false, why: 'modelo_distinto' });
    assert.equal(idx.reviewStillValid('v1', 'v2').ok, false);
  });
});

describe('repetidos evidentes sin km (clásicos)', () => {
  test('la misma foto, mismo año y mismo precio exacto → mismo auto aunque el anuncio no traiga km', () => {
    const SL = { model_id: 'mercedes-benz-sl-r107', generation_id: null, version_id: null };
    const s = { year: 1977, observed_on: '2026-11-12' };
    const idx = new IdentityIndex().addVehicle({ id: 'v1', created_at: '2026-11-11', ...SL, specs: s, photos: [photos.agencia[0]], prices: [300000] });
    const r = idx.resolve({ ...SL, specs: s, price: 300000, photos: [photos.agencia[0]] });
    assert.equal(r.action, 'match'); assert.equal(r.reason, 'fotos');
    // con otro precio, solo se pregunta
    assert.equal(idx.resolve({ ...SL, specs: s, price: 350000, photos: [photos.agencia[0]] }).action, 'new');
  });
});
