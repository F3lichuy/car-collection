// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Motor de identidad (anti-duplicados)
//
// Para cada anuncio entrante decide si es un auto que ya conocemos:
//   0. Mismo listing (URL canónica o id externo)      → mismo auto, seguro.
//   1. VIN igual                                       → mismo auto, seguro.
//   2. ≥2 fotos con coincidencia fuerte y sin
//      contradicciones en specs                        → mismo auto (los brokers reusan fotos).
//      Con contradicciones                             → revisión.
//   3. Fingerprint (versión + año + colores + km±3%)   → SIEMPRE revisión, nunca fusiona solo.
//   Barreras que nunca se cruzan: VIN distinto, par marcado "distinto" por ti,
//   demo vs. real.
//
// Puro JS, sin red ni base de datos: recibe un índice en memoria y devuelve una
// decisión con su evidencia. Quien llama (pipeline, Edge Function) la aplica.
// ════════════════════════════════════════════════════════════════════════
import { norm } from './text.mjs';
import { normalizeVin } from './vin.mjs';
import { toUnsigned } from './phash.mjs';
import { DEFAULTS } from './settings.mjs';
import { carColor } from './photocolor.mjs';

// ── Hashes como dos enteros de 32 bits (popcount rápido sin BigInt) ──────
const split = h => { if (h == null) return null; const u = toUnsigned(h); return [Number(u >> 32n), Number(u & 0xffffffffn)]; };
const pop32 = x => { x -= (x >>> 1) & 0x55555555; x = (x & 0x33333333) + ((x >>> 2) & 0x33333333); return Math.imul((x + (x >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24; };
const ham = (a, b) => pop32((a[0] ^ b[0]) >>> 0) + pop32((a[1] ^ b[1]) >>> 0);
const dist = (p, q) => {
  let d = ham(p.h, q.h);
  if (q.c) d = Math.min(d, ham(p.h, q.c));
  if (p.c) d = Math.min(d, ham(p.c, q.h));
  return d;
};
const prepPhoto = p => (p && p.hash != null && !p.lowInfo) ? { h: split(p.hash), c: split(p.center), ref: p.ref ?? p.id ?? null } : null;

// título para comparar: minúsculas, sin acentos ni signos, espacios simples
const normTitle = t => (t ? norm(String(t)).replace(/[^a-z0-9]+/g, ' ').trim() : '');

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ── Comparación de specs ─────────────────────────────────────────────────

// km: el posterior puede tener más km (uso) pero no menos (salvo tolerancia).
export function kmCompare(a, b, s = DEFAULTS) {
  if (a?.km == null || b?.km == null) return 'unknown';
  const [e, l] = (a.observed_on ?? '') <= (b.observed_on ?? '') ? [a, b] : [b, a];
  const days = e.observed_on && l.observed_on ? Math.max(0, (Date.parse(l.observed_on) - Date.parse(e.observed_on)) / 864e5) : 0;
  const tol = Math.max(s.fingerprint_km_floor, Math.max(e.km, l.km) * s.fingerprint_km_tolerance);
  const diff = l.km - e.km;
  return diff >= -tol && diff <= tol + days * s.fingerprint_km_per_day ? 'agree' : 'conflict';
}

const colorCompare = (a, b, name, fam) => {
  const an = norm(a?.[name]), bn = norm(b?.[name]);
  if (an && bn) return an === bn ? 'agree' : (a[fam] && b[fam] && a[fam] === b[fam] ? 'unknown' : 'conflict');
  if (a?.[fam] && b?.[fam]) return a[fam] === b[fam] ? 'agree' : 'conflict';
  return 'unknown';
};

// Compara un auto entrante contra un vehículo conocido.
// hard: imposibles de conciliar · soft: probables errores de captura · agree: coinciden
export function compare(inc, v, s = DEFAULTS, distinct = false) {
  const hard = [], soft = [], agree = [];
  if (distinct) hard.push('marcado_distinto');
  if (inc.vin && v.vin && inc.vin !== v.vin) hard.push('vin_distinto');
  if (inc.is_demo !== v.is_demo) hard.push('demo_vs_real');
  if (inc.model_id && v.model_id && inc.model_id !== v.model_id) hard.push('modelo_distinto');
  if (inc.generation_id && v.generation_id && inc.generation_id !== v.generation_id) hard.push('generacion_distinta');
  if (inc.version_id && v.version_id) (inc.version_id === v.version_id ? agree : hard).push(inc.version_id === v.version_id ? 'version' : 'version_distinta');
  const a = inc.specs ?? {}, b = v.specs ?? {};
  if (a.year != null && b.year != null) {
    const d = Math.abs(a.year - b.year);
    if (d === 0) agree.push('anio'); else if (d === 1) soft.push('anio_mas_menos_1'); else hard.push('anio_distinto');
  }
  const km = kmCompare(a, b, s);
  if (km === 'agree') agree.push('km'); else if (km === 'conflict') soft.push('km_no_cuadra');
  for (const [k, n, f] of [['color_ext', 'exterior_color', 'exterior_color_family'], ['color_int', 'interior_color', 'interior_color_family']]) {
    const c = colorCompare(a, b, n, f);
    if (c === 'agree') agree.push(k); else if (c === 'conflict') soft.push(`${k}_distinto`);
  }
  if (a.transmission && b.transmission) (a.transmission === b.transmission ? agree : soft).push(a.transmission === b.transmission ? 'transmision' : 'transmision_distinta');
  // carrocería (Targa contra coupé, convertible contra coupé)
  if (a.body && b.body) (a.body === b.body ? agree : hard).push(a.body === b.body ? 'carroceria' : 'carroceria_distinta');
  // color estimado por la foto (solo colores vivos: rojo, verde, amarillo…). Se usa si el anuncio no lo dice.
  const fa = a.exterior_color_family ?? a.photo_color, fb = b.exterior_color_family ?? b.photo_color;
  if (!(a.exterior_color_family && b.exterior_color_family) && fa && fb && (a.photo_color || b.photo_color)) {
    if (fa === fb) agree.push('color_foto');
    else if (VIVID.has(fa) && VIVID.has(fb)) hard.push('color_foto_distinto');   // verde contra amarillo: otro auto
  }
  // precio: el mismo auto puede bajar o subir, pero no al triple (1,200,000 contra 160,000)
  const pa = [].concat(inc.prices ?? [], inc.price != null ? [inc.price] : []).map(Number).filter(p => p > 0), pb = [].concat(v.prices ?? []).map(Number).filter(p => p > 0);
  if (pa.length && pb.length) {
    const r = Math.min(...pa.flatMap(x => pb.map(y => Math.max(x, y) / Math.min(x, y))));
    if (r > (s.price_ratio_max ?? 1.5)) hard.push('precio_muy_distinto');
  }
  return { hard, soft, agree };
}
const VIVID = new Set(['rojo', 'naranja', 'amarillo', 'verde', 'azul', 'morado', 'rosa']);

// Las barreras definitivas: ni siquiera se proponen a revisión.
const BLOCKING = new Set(['vin_distinto', 'marcado_distinto', 'demo_vs_real']);
// Fotos casi iguales entre autos de otro modelo, generación o año: es el mismo estudio de la agencia
// (mismo fondo y ángulo), no el mismo auto. Tampoco se proponen a revisión.
const PHOTO_BLOCKING = new Set([...BLOCKING, 'modelo_distinto', 'generacion_distinta', 'anio_distinto']);
// Tu regla (2026-11-12): pueden cambiar ciudad, fuente, km y precio. Si cambia marca/modelo, generación,
// versión, año, color, carrocería o el precio es de otro mundo, son autos distintos: NO se pregunta.
const REVIEW_BLOCKING = new Set([...PHOTO_BLOCKING, 'version_distinta', 'anio_mas_menos_1', 'color_ext_distinto', 'color_int_distinto',
  'color_foto_distinto', 'carroceria_distinta', 'precio_muy_distinto']);
// Y con dos o más detalles que no cuadran (km y caja), tampoco.
const SOFT_MISMATCH = new Set(['km_no_cuadra', 'transmision_distinta']);
export const worthReviewing = reasons => !reasons.some(r => REVIEW_BLOCKING.has(r)) && reasons.filter(r => SOFT_MISMATCH.has(r)).length < 2;

// ── Índice en memoria ────────────────────────────────────────────────────

export class IdentityIndex {
  constructor(settings = DEFAULTS) {
    this.s = { ...DEFAULTS, ...settings };
    this.vehicles = new Map();   // id → vehículo vigente
    this.byVin = new Map();
    this.byListing = new Map();  // url canónica o "fuente|id externo" → vehicle_id
    this.distinct = new Set();
  }

  // v: { id, vin, model_id, generation_id, version_id, is_demo, created_at,
  //      specs: {year, km, observed_on, exterior_color, …}, photos: [{hash, center, lowInfo}],
  //      listings: [{url_canonical, source_id, external_id}] }
  addVehicle(v) {
    if (v.merged_into) return this;
    const vin = v.vin ? normalizeVin(v.vin)?.vin : null;
    const rec = { ...v, vin, is_demo: !!v.is_demo, photos: (v.photos ?? []).map(prepPhoto).filter(Boolean),
      titles: v.titles ?? (v.listings ?? []).map(l => normTitle(l.title)).filter(Boolean) };
    this.vehicles.set(v.id, rec);
    if (vin) this.byVin.set(vin, v.id);
    for (const l of v.listings ?? []) for (const k of listingKeys(l)) this.byListing.set(k, v.id);
    return this;
  }
  // Suma evidencia a un vehículo ya indexado (fotos y llaves de un anuncio nuevo).
  addEvidence(id, { photos = [], listings = [] } = {}) {
    const v = this.vehicles.get(id);
    if (!v) return this;
    v.photos.push(...photos.map(prepPhoto).filter(Boolean));
    for (const l of listings) { for (const k of listingKeys(l)) this.byListing.set(k, id); const t = normTitle(l.title); if (t) v.titles = [...(v.titles ?? []), t]; }
    return this;
  }
  addDistinct(a, b) { this.distinct.add(pairKey(a, b)); return this; }
  isDistinct(a, b) { return this.distinct.has(pairKey(a, b)); }

  // Construye el índice desde filas de la base (ver mercado/LEEME.md).
  static fromRows({ vehicles = [], specs = [], photos = [], listings = [], distinctPairs = [], prices = [], photoColors = [] }, settings) {
    const idx = new IdentityIndex(settings);
    const canon = new Map(specs.filter(s => s.is_canonical).map(s => [s.vehicle_id, s]));
    const ph = group(photos, 'vehicle_id'), ls = group(listings, 'vehicle_id'), pr = group(prices, 'vehicle_id');
    // color por foto: cada anuncio da el de su portada; si dos anuncios del auto dicen distinto, no se sabe
    const pc = new Map();
    for (const [vid, rows] of group(photoColors, 'vehicle_id')) {
      const per = [...group(rows, 'listing_id').values()].map(r => carColor(r.sort((a, b) => a.position - b.position).map(x => (x.color_family ? { family: x.color_family } : null)))).filter(Boolean);
      if (per.length && per.every(f => f === per[0])) pc.set(vid, per[0]);
    }
    for (const v of vehicles) idx.addVehicle({
      ...v, specs: { ...(canon.get(v.id) ?? {}), photo_color: pc.get(v.id) ?? null }, prices: (pr.get(v.id) ?? []).map(p => Number(p.price)),
      photos: (ph.get(v.id) ?? []).map(p => ({ hash: p.phash, center: p.phash_center, lowInfo: p.low_info, ref: p.id })),
      listings: ls.get(v.id) ?? [], titles: (ls.get(v.id) ?? []).map(l => normTitle(l.title)).filter(Boolean),
    });
    for (const p of distinctPairs) idx.addDistinct(p.vehicle_a, p.vehicle_b);
    return idx;
  }

  // Coincidencias de fotos del entrante contra cada vehículo.
  photoMatches(incomingPhotos, { exclude, skipDeleted = false } = {}) {
    const { phash_strong_distance: S, phash_weak_distance: W, phash_generic_vehicles: G } = this.s;
    // 1) quitar fotos repetidas dentro del mismo anuncio
    const inc = [];
    for (const p of incomingPhotos.map(prepPhoto).filter(Boolean)) if (!inc.some(q => dist(p, q) <= S)) inc.push(p);
    // 2) pares candidatos (foto entrante, foto del vehículo, distancia)
    const I = this.s.phash_identical_distance ?? 2;
    const perVehicle = new Map(), strongVehiclesPerPhoto = inc.map(() => new Set()), identicalPerPhoto = inc.map(() => new Set());
    for (const [id, v] of this.vehicles) {
      if (id === exclude || (skipDeleted && v.deleted)) continue;
      for (let i = 0; i < inc.length; i++) for (let j = 0; j < v.photos.length; j++) {
        const d = dist(inc[i], v.photos[j]);
        if (d > W) continue;
        if (!perVehicle.has(id)) perVehicle.set(id, []);
        perVehicle.get(id).push([i, j, d]);
        if (d <= S) strongVehiclesPerPhoto[i].add(id);
        if (d <= I) identicalPerPhoto[i].add(id);
      }
    }
    // 3) fotos genéricas: la misma toma aparece en muchos autos (banner, prensa). Una foto que se
    //    "parece" a varias del mismo estudio pero es IDÉNTICA a una sola es esa gemela, no un banner.
    const generic = new Set(strongVehiclesPerPhoto.flatMap((set, i) => set.size >= G && identicalPerPhoto[i].size !== 1 ? [i] : []));
    // 4) emparejamiento 1 a 1 (una foto no cuenta dos veces)
    const out = new Map();
    for (const [id, pairs] of perVehicle) {
      pairs.sort((x, y) => x[2] - y[2]);
      const ui = new Set(), uj = new Set(); let strong = 0, weak = 0; const best = [];
      for (const [i, j, d] of pairs) {
        if (generic.has(i) || ui.has(i) || uj.has(j)) continue;
        ui.add(i); uj.add(j); best.push(d);
        if (d <= S) strong++; else weak++;
      }
      if (strong || weak) out.set(id, { strong, weak, distances: best });
    }
    return { matches: out, genericPhotos: generic.size, usablePhotos: inc.length };
  }

  // incoming: { vin, model_id, generation_id, version_id, is_demo, specs, photos, listing }
  // skipDeleted (barrido): los autos borrados por la dueña no cuentan como candidatos.
  resolve(incoming, { exclude, skipDeleted = false } = {}) {
    const off = id => id === exclude || (skipDeleted && !!this.vehicles.get(id)?.deleted);
    const s = this.s;
    const inc = { ...incoming, is_demo: !!incoming.is_demo, vin: incoming.vin ? normalizeVin(incoming.vin)?.vin : null };
    const reviews = [], seen = new Set([exclude]);
    const review = (vehicleId, score, reasons, extra = {}) => {
      if (seen.has(vehicleId)) return;
      if (!worthReviewing(reasons)) return;   // datos que no cuadran: son autos distintos, no se pregunta
      seen.add(vehicleId);
      reviews.push({ vehicleId, score: Math.round(Math.min(score, 0.99) * 1000) / 1000, reasons, ...extra });
    };
    const done = (r) => ({ ...r, reviews: reviews.sort((a, b) => b.score - a.score).slice(0, 3) });

    // 0. mismo listing
    if (incoming.listing) for (const k of listingKeys(incoming.listing)) {
      const id = this.byListing.get(k);
      if (id && id !== exclude) {
        const v = this.vehicles.get(id), c = compare(inc, v, s);
        if (c.hard.includes('vin_distinto')) return done({ action: 'conflict', vehicleId: id, reason: 'listing', evidence: { message: 'El anuncio ya existe pero trae otro VIN', ...c } });
        return done({ action: 'match', vehicleId: id, reason: 'listing', evidence: { key: k, warnings: [...c.hard, ...c.soft] } });
      }
    }

    // 1. VIN
    if (inc.vin) {
      const id = this.byVin.get(inc.vin);
      if (id && id !== exclude) {
        const c = compare(inc, this.vehicles.get(id), s);
        if (!c.hard.includes('demo_vs_real')) return done({ action: 'match', vehicleId: id, reason: 'vin', evidence: { vin: inc.vin, warnings: [...c.hard, ...c.soft] } });
      }
    }

    // 2. Fotos
    // Con 2+ fotos fuertes basta (y sin contradicciones, se une). Con UNA sola foto por lado (las tarjetas
    // de Mercado Libre traen solo la portada) hace falta que sea la MISMA imagen (≤ phash_identical_distance)
    // y que año y km coincidan: dos autos distintos fotografiados en el mismo estudio salen "parecidos".
    const pm = this.photoMatches(inc.photos ?? [], { exclude, skipDeleted });
    const clean = [], I = s.phash_identical_distance ?? 2;
    for (const [id, m] of pm.matches) {
      const v = this.vehicles.get(id), c = compare(inc, v, s, this.isDistinct(id, exclude ?? ''));
      const few = Math.min(pm.usablePhotos, v.photos.length) <= 2;
      const identical = m.distances.length > 0 && Math.min(...m.distances) <= I;
      // …y mismos km, o (anuncios sin km, como los clásicos y Marketplace) el mismo precio o uno que cambió
      // poco (≤5 %: $5,299,000 contra $5,309,000): con la MISMA imagen, eso basta
      const incP = [].concat(inc.prices ?? [], inc.price != null ? [inc.price] : []).map(Number).filter(p => p > 0);
      const samePrice = incP.some(a => [].concat(v.prices ?? []).map(Number).filter(p => p > 0).some(p => Math.max(a, p) / Math.min(a, p) <= 1.05));
      const single = few && identical && c.agree.includes('anio') && (c.agree.includes('km') || samePrice);
      if (c.hard.some(h => PHOTO_BLOCKING.has(h))) continue;     // fotos reusadas o de estudio en otro auto
      if (m.strong < s.phash_min_matches && !single) {
        // la misma imagen pero algún dato no cuadra (¿km mal capturados?): que lo veas tú
        if (few && identical) review(id, 0.75, ['misma_foto', ...c.hard, ...c.soft], { photos: m });
        continue;
      }
      if (c.hard.length || c.soft.length) review(id, 0.85, ['fotos_iguales', ...c.hard, ...c.soft], { photos: m });
      else clean.push({ id, m, c });
    }
    if (clean.length) {
      clean.sort((a, b) => b.m.strong - a.m.strong || String(this.vehicles.get(a.id).created_at ?? '').localeCompare(String(this.vehicles.get(b.id).created_at ?? '')));
      const [best, ...rest] = clean;
      // Si comparte fotos con dos autos que tenemos separados, esos dos quizá son el mismo.
      for (const o of rest) review(o.id, 0.9, ['fotos_iguales', 'tambien_coincide_con', best.id], { photos: o.m, pairWith: best.id });
      return done({ action: 'match', vehicleId: best.id, reason: 'fotos', evidence: { photos: best.m, agree: best.c.agree, genericPhotos: pm.genericPhotos } });
    }

    // 2b. Datos idénticos: mismo modelo y año y los MISMOS km "no redondos" (12,972 · 5,863), desde
    // fingerprint_exact_km_min (autos nuevos de 10 km se confundirían) → el mismo auto publicado por dos
    // vendedores (agencia y Mercado Libre). Con km redondos (1,200 · 5,000) y el mismo precio solo se
    // PROPONE: dos Huracán Sterrato 2023 de 1,200 km a $9.3 M resultaron ser autos distintos (placas).
    const exact = [];
    const a0 = inc.specs ?? {}, kmMin = s.fingerprint_exact_km_min ?? 1000;
    if (inc.model_id && a0.year != null && a0.km != null && a0.km >= kmMin) {
      for (const [id, v] of this.vehicles) {
        if (off(id) || seen.has(id) || v.model_id !== inc.model_id) continue;
        const b = v.specs ?? {};
        if (b.year !== a0.year || b.km !== a0.km) continue;
        const incP = [].concat(inc.prices ?? [], inc.price != null ? [inc.price] : []);
        const samePrice = incP.some(a => [].concat(v.prices ?? []).some(p => Math.abs(Number(a) - Number(p)) < 1));
        const round = a0.km % 100 === 0;
        if (round && !samePrice) continue;
        const c = compare(inc, v, s, this.isDistinct(id, exclude ?? ''));
        if (c.hard.some(h => BLOCKING.has(h))) continue;
        const why = ['mismos_km_exactos', ...(samePrice ? ['mismo_precio'] : [])];
        if (round || c.hard.length || c.soft.length) { review(id, round && !c.hard.length && !c.soft.length ? 0.9 : 0.8, [...why, ...c.hard, ...c.soft]); continue; }
        exact.push({ id, c, samePrice });
      }
    }
    if (exact.length === 1) {
      const [e] = exact;
      return done({ action: 'match', vehicleId: e.id, reason: 'datos', evidence: { km: a0.km, year: a0.year, samePrice: e.samePrice, agree: e.c.agree } });
    }
    for (const e of exact) review(e.id, 0.9, ['mismos_km_exactos', ...(e.samePrice ? ['mismo_precio'] : []), 'varios_candidatos']);

    // 3. Fingerprint → solo revisión
    for (const [id, v] of this.vehicles) {
      if (off(id) || seen.has(id)) continue;
      if (inc.model_id !== v.model_id) continue;
      const sameVersion = inc.version_id && v.version_id && inc.version_id === v.version_id;
      const sameGen = inc.generation_id && v.generation_id && inc.generation_id === v.generation_id;
      if (!sameVersion && !(sameGen && (!inc.version_id || !v.version_id))) continue;
      const c = compare(inc, v, s, this.isDistinct(id, exclude ?? ''));
      if (c.hard.length || c.soft.length) continue;
      if (!c.agree.includes('anio')) continue;                   // año conocido y exacto, obligatorio
      const fields = c.agree.filter(a => ['km', 'color_ext', 'color_int', 'transmision'].includes(a));
      const m = pm.matches.get(id) ?? { strong: 0, weak: 0 };
      const ok = sameVersion ? (fields.includes('km') || fields.length >= 2 || m.strong + m.weak > 0) : fields.length >= 3;
      if (!ok) continue;
      const score = 0.35 + 0.12 * fields.length + (sameVersion ? 0.1 : 0) + 0.15 * Math.min(m.strong, 1) + 0.05 * Math.min(m.weak, 2);
      review(id, score, ['fingerprint', ...c.agree, ...(m.strong || m.weak ? ['alguna_foto_parecida'] : [])], { photos: m });
    }
    // 3b. Sin km (Marketplace casi nunca lo da): mismo título, mismo año y precio igual o casi (±3 %) → que lo veas tú.
    //     Facebook guarda una copia distinta de la foto en cada publicación (otro recorte), así que la foto no lo confirma.
    const a1 = inc.specs ?? {}, incTitles = [].concat(inc.titles ?? [], inc.listing?.title ? [normTitle(inc.listing.title)] : []).filter(Boolean);
    const incPs = [].concat(inc.prices ?? [], inc.price != null ? [inc.price] : []).map(Number).filter(p => p > 0);
    if (inc.model_id && a1.year != null && incTitles.length && incPs.length) {
      for (const [id, v] of this.vehicles) {
        if (off(id) || seen.has(id) || v.model_id !== inc.model_id) continue;
        const b = v.specs ?? {};
        if (b.year !== a1.year || (a1.km != null && b.km != null)) continue;            // con km de los dos, deciden las otras reglas
        if (!(v.titles ?? []).some(t => incTitles.includes(t))) continue;
        const close = incPs.some(p => (v.prices ?? []).some(q => Math.max(p, q) / Math.min(p, q) <= 1.03));
        if (!close) continue;
        const c = compare(inc, v, s, this.isDistinct(id, exclude ?? ''));
        const same = incPs.some(p => (v.prices ?? []).some(q => Math.abs(p - q) < 1));
        review(id, same ? 0.8 : 0.7, ['mismo_titulo', same ? 'mismo_precio' : 'precio_parecido', ...c.hard, ...c.soft]);
      }
    }

    // Fotos parecidas (débiles) sin fingerprint: también vale la pena que lo veas.
    for (const [id, m] of pm.matches) {
      if (seen.has(id) || m.strong + m.weak < 2) continue;
      const c = compare(inc, this.vehicles.get(id), s, this.isDistinct(id, exclude ?? ''));
      if (c.hard.some(h => PHOTO_BLOCKING.has(h))) continue;
      review(id, 0.5 + 0.1 * m.strong, ['fotos_parecidas', ...c.hard, ...c.soft], { photos: m });
    }
    return done({ action: 'new', evidence: { usablePhotos: pm.usablePhotos, genericPhotos: pm.genericPhotos } });
  }

  // ¿Sigue valiendo la pena revisar este par? No, si uno ya no existe (se fusionó), si la dueña borró
  // uno, o si son de otro modelo/generación/año (fotos del mismo estudio, no el mismo auto).
  reviewStillValid(a, b) {
    const va = this.vehicles.get(a), vb = this.vehicles.get(b);
    if (!va || !vb) return { ok: false, why: 'ya_no_existe' };
    if (va.deleted || vb.deleted) return { ok: false, why: 'borrado' };
    const c = compare(va, vb, this.s, this.isDistinct(a, b));
    const all = [...c.hard, ...c.soft];
    if (worthReviewing(all)) return { ok: true };
    return { ok: false, why: all.find(h => REVIEW_BLOCKING.has(h)) ?? 'varios_datos_no_cuadran' };
  }

  // Barrido completo: busca duplicados entre vehículos ya guardados (p. ej.
  // cuando sus fotos se hashean después). Devuelve fusiones seguras y revisiones.
  scanAll() {
    const merges = [], reviews = new Map(), merged = new Set();
    const ids = [...this.vehicles.keys()].sort((a, b) =>
      String(this.vehicles.get(a).created_at ?? '').localeCompare(String(this.vehicles.get(b).created_at ?? '')) || a.localeCompare(b));
    // Los borrados por la dueña no se tocan: ni se fusionan (reaparecerían) ni se proponen.
    const gone = id => merged.has(id) || !!this.vehicles.get(id)?.deleted;
    for (const id of ids) {
      if (gone(id)) continue;
      const v = this.vehicles.get(id);
      const r = this.resolve({ ...v, photos: v.photos.map(p => ({ hash: joinHash(p.h), center: p.c && joinHash(p.c) })), listing: null }, { exclude: id, skipDeleted: true });
      for (const rv of r.reviews) if (gone(rv.vehicleId)) rv.skip = true;
      if (r.action === 'match' && ['fotos', 'vin', 'datos'].includes(r.reason) && !gone(r.vehicleId)) {
        const [keep, drop] = [r.vehicleId, id].sort((a, b) => older(this.vehicles.get(a), this.vehicles.get(b)));
        merges.push({ keep, drop, reason: r.reason, evidence: r.evidence });
        merged.add(drop);
      }
      for (const rv of r.reviews) {
        if (rv.skip || merged.has(rv.vehicleId) || this.isDistinct(id, rv.vehicleId)) continue;
        const k = pairKey(id, rv.vehicleId);
        if (!reviews.has(k) || reviews.get(k).score < rv.score) reviews.set(k, { a: k.split('|')[0], b: k.split('|')[1], score: rv.score, reasons: rv.reasons });
      }
    }
    return { merges, reviews: [...reviews.values()].filter(r => !merged.has(r.a) && !merged.has(r.b)) };
  }
}

const joinHash = ([hi, lo]) => (BigInt(hi >>> 0) << 32n) | BigInt(lo >>> 0);
const older = (a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || String(a.id).localeCompare(String(b.id));

export function listingKeys(l) {
  if (!l) return [];
  const k = [];
  if (l.url_canonical) k.push(`url:${l.url_canonical}`);
  if (l.source_id && l.external_id) k.push(`ext:${l.source_id}|${l.external_id}`);
  return k;
}

function group(rows, key) {
  const m = new Map();
  for (const r of rows) { if (!m.has(r[key])) m.set(r[key], []); m.get(r[key]).push(r); }
  return m;
}
