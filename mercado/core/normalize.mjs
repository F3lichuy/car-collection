// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Normalizador por reglas y diccionarios
//
// Entrada: anuncio crudo de un adaptador (texto como viene).
// Salida: listing + specs + vehículo (taxonomía) + precio, con una confianza
// y la lista de campos que no se pudieron resolver. NUNCA rellena con
// supuestos: lo que no se sabe queda null y va en `unresolved`.
// Si la confianza es baja, el pipeline lo manda a la cola de normalización.
// ════════════════════════════════════════════════════════════════════════
import { norm } from './text.mjs';
import { findVins, normalizeVin } from './vin.mjs';
import { canonicalUrl, stripHtml } from './extract.mjs';
import { expand } from '../scripts/build-taxonomy-sql.mjs';
import { options as OPTION_CATALOG } from '../data/taxonomia.mjs';
import * as D from '../data/diccionarios.mjs';

// ── Índice de taxonomía ─────────────────────────────────────────────────
const tokens = s => norm(s).replace(/(\d)\.(\d)/g, '$1p$2').split(/[^a-z0-9]+/).filter(Boolean);
const compact = s => norm(s).replace(/[^a-z0-9]/g, '');

let TAX = null;
export function taxonomy() {
  if (TAX) return TAX;
  const t = expand();
  const makesByAlias = new Map();
  const modelsByMake = new Map();
  for (const [alias, level, target] of t.aliases) {
    if (level === 'make') makesByAlias.set(alias, target);
  }
  const versionsByGen = new Map(), gensByModel = new Map();
  for (const g of t.gens) { if (!gensByModel.has(g.model_id)) gensByModel.set(g.model_id, []); gensByModel.get(g.model_id).push(g); }
  for (const v of t.versions) { if (!versionsByGen.has(v.generation_id)) versionsByGen.set(v.generation_id, []); versionsByGen.get(v.generation_id).push({ ...v, tok: tokens(v.name), cmp: compact(v.name) }); }
  const modelAliases = new Map(); // model_id → [tokens…]
  for (const [alias, level, target] of t.aliases) if (level === 'model') {
    if (!modelAliases.has(target)) modelAliases.set(target, []);
    modelAliases.get(target).push(tokens(alias));
  }
  for (const m of t.models) { if (!modelsByMake.has(m.make_id)) modelsByMake.set(m.make_id, []); modelsByMake.get(m.make_id).push({ ...m, aliases: modelAliases.get(m.id) ?? [tokens(m.name)] }); }
  const genAliases = new Map();
  for (const [alias, level, target] of t.aliases) if (level === 'generation') {
    if (!genAliases.has(target)) genAliases.set(target, new Set());
    genAliases.get(target).add(compact(alias));
  }
  TAX = { ...t, makesByAlias, modelsByMake, gensByModel, versionsByGen, genAliases, makes: new Map(t.makes.map(m => [m.id, m])) };
  return TAX;
}

const containsSeq = (hay, needle) => {
  if (!needle.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((t, k) => hay[i + k] === t)) return true;
  return false;
};

export function resolveMake(text) {
  const T = taxonomy(); const n = norm(text);
  let best = null;
  for (const [alias, id] of T.makesByAlias) {
    const re = new RegExp(`(^|[^a-z0-9])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`);
    if (re.test(n) && (!best || alias.length > best.alias.length)) best = { alias, id };
  }
  return best?.id ?? null;
}

// Cuánto coincide una versión con el texto. Todas sus palabras deben aparecer
// (en cualquier orden); si no, se prueba pegado ("gt3rs", "lp6104"). Una
// versión cuyo nombre es solo el del modelo ("911", "Testarossa") no cuenta:
// sería suponer la versión base.
// Las palabras del modelo dentro del nombre de la versión ("718 Cayman GT4 RS") no son obligatorias:
// "Porsche 718 GT4RS" es esa versión. Cuentan como del modelo su nombre y sus alias numéricos (718).
const mixed = s => s.length >= 4 || (s.length === 3 && /\d/.test(s) && /[a-z]/.test(s));
function versionScore(v, tset, cmpText, model) {
  // (solo números de 3+ cifras: "718", "911"; un "63" de "G 63" sí distingue la versión)
  const modelTok = new Set(model ? [...tokens(model.name), ...(model.aliases ?? []).flat().filter(t => /^\d{3,}$/.test(t))] : []);
  if (v.tok.every(x => modelTok.has(x))) return 0;
  if (v.tok.every(x => tset.has(x))) return v.tok.length * 10 + v.cmp.length;
  // pegado: "gt3rs", "lp6104"; con 3 caracteres solo si mezcla letra y número ("g63" en "G63 AMG")
  if (mixed(v.cmp) && cmpText.includes(v.cmp)) return 5 + v.cmp.length;
  const dist = v.tok.filter(x => !modelTok.has(x));
  if (dist.length < v.tok.length) {
    if (dist.every(x => tset.has(x))) return dist.length * 10 + dist.join('').length;
    if (mixed(dist.join('')) && cmpText.includes(dist.join(''))) return 5 + dist.join('').length;
  }
  return 0;
}

// Devuelve { model_id, generation_id, version_id, candidates, issues }
export function resolveTaxonomy({ make, model, version, title, year }) {
  const T = taxonomy(), issues = [];
  const makeId = resolveMake(make) ?? resolveMake(`${model ?? ''} ${title ?? ''}`);
  if (!makeId) return { make_id: null, issues: ['marca_fuera_de_taxonomia'] };
  // "911 GTS look Sport Classic": lo que sigue a "look"/"estilo" describe la apariencia, no la versión.
  const text = [model, version, title].filter(Boolean).join(' ').replace(/\b(look|estilo)\s+([^\s,/|-]+\s+){0,2}[^\s,/|-]+/gi, ' ');
  const tk = tokens(text);
  // modelos de la marca fuera de la taxonomía a propósito (Cayenne, Roma…)
  const out = (D.OUT_OF_SCOPE_MODELS[makeId] ?? []).find(m => containsSeq(tk, tokens(m)));
  if (out) return { make_id: makeId, model_id: null, issues: ['modelo_fuera_de_taxonomia'], excluded: out };
  // Un modelo "cabe" si alguna de sus generaciones cubre el año (±1) o si no hay año.
  const fitsYear = id => !year || (T.gensByModel.get(id) ?? []).some(g => year >= g.year_from - 1 && year <= (g.year_to ?? 9999) + 1);
  // modelo: alias más largo que aparece como secuencia de palabras; entre
  // alias, gana el que además cabe por año ("300 SL" 1987 es R107, no W198).
  let model_id = null, bestLen = 0, bestFits = false;
  for (const m of T.modelsByMake.get(makeId) ?? []) for (const a of m.aliases) {
    if (!a.length || !containsSeq(tk, a)) continue;
    const len = a.join(' ').length, fits = fitsYear(m.id);
    if ((fits && !bestFits) || (fits === bestFits && len > bestLen)) { model_id = m.id; bestLen = len; bestFits = fits; }
  }
  // Nadie escribe "Super Series": si no aparece el modelo (o el alias no cabe
  // por año), se deduce por una versión inequívoca de esa marca. Solo versiones
  // con número en el nombre ("720S", "GT3 RS", "DBX707", "LP610-4", "560 SL"):
  // "Turbo" o "GTS" solos no bastan.
  if (!model_id || !bestFits) {
    const hits = new Set();
    for (const m of T.modelsByMake.get(makeId) ?? []) for (const g of T.gensByModel.get(m.id) ?? [])
      for (const v of T.versionsByGen.get(g.id) ?? [])
        if (/\d/.test(v.cmp) && fitsYear(m.id) && (!year || (year >= (v.year_from ?? 0) - 1 && year <= (v.year_to ?? 9999) + 1))
            && versionScore(v, new Set(tk), compact(text), m) > 0) hits.add(m.id);
    if (hits.size === 1) model_id = [...hits][0];
  }
  if (!model_id) return { make_id: makeId, model_id: null, issues: ['modelo_fuera_de_taxonomia'] };
  const modelRec = (T.modelsByMake.get(makeId) ?? []).find(m => m.id === model_id);

  // generación: por año y por código escrito (992, 991.2, w463a…)
  const gens = T.gensByModel.get(model_id) ?? [];
  const cmpText = compact(text);
  const byCode = gens.filter(g => [...(T.genAliases.get(g.id) ?? [])].some(a => a.length >= 3 && new RegExp(`(^|[^a-z0-9])${a}([^0-9]|$)`).test(norm(text).replace(/\./g, ''))));
  const byYear = year ? gens.filter(g => year >= g.year_from - 1 && year <= (g.year_to ?? 9999) + 1) : [];
  // Mustang 2022, Corvette C7…: el modelo existe pero esa generación no está en la taxonomía.
  if (year && !byYear.length) return { make_id: makeId, model_id: null, issues: ['anio_fuera_de_taxonomia'] };
  let genCands = byCode.length ? byCode : byYear.length ? byYear : gens;
  if (byCode.length && byYear.length) { const both = byCode.filter(g => byYear.includes(g)); if (both.length) genCands = both; }

  // versión: más palabras de la versión presentes (sin importar orden), luego más letras
  const tset = new Set(tk);
  let best = [];
  for (const g of genCands) for (const v of T.versionsByGen.get(g.id) ?? []) {
    const score = versionScore(v, tset, cmpText, modelRec);
    if (!score) continue;
    if (year && v.year_from && (year < v.year_from - 1 || (v.year_to && year > v.year_to + 1))) continue;
    if (!best.length || score > best[0].score) best = [{ v, g, score }];
    else if (score === best[0].score) best.push({ v, g, score });
  }
  // Empate por la tolerancia de ±1 año ("Carrera 4S 2020": 991.2 hasta 2019 y 992.1 desde 2020):
  // si el año cae exacto en una sola de las versiones empatadas, es esa.
  if (best.length > 1 && year) {
    const exact = best.filter(b => year >= (b.v.year_from ?? 0) && year <= (b.v.year_to ?? 9999));
    if (exact.length === 1) best = exact;
  }
  let generation_id = genCands.length === 1 ? genCands[0].id : null, version_id = null;
  // Generación con una sola versión (Carrera GT, 918, 512 TR…): esa es, no hay que suponer.
  if (!best.length && generation_id && (T.versionsByGen.get(generation_id) ?? []).length === 1) {
    best = [{ v: T.versionsByGen.get(generation_id)[0], g: genCands[0], score: 1 }];
  }
  if (best.length === 1) { version_id = best[0].v.id; generation_id = best[0].g.id; }
  else if (best.length > 1) {
    const gs = new Set(best.map(b => b.g.id));
    if (gs.size === 1) generation_id = [...gs][0];
    issues.push('version_ambigua');
  }
  if (!generation_id) issues.push(genCands.length > 1 ? 'generacion_ambigua' : 'generacion_desconocida');
  if (!version_id && !issues.includes('version_ambigua')) issues.push('version_desconocida');
  // Cajas que existieron en la generación (si todas sus versiones tienen dato):
  // sirve para interpretar "automática" aunque no se sepa la versión exacta.
  const genVersions = generation_id ? T.versionsByGen.get(generation_id) ?? [] : [];
  const genTransmissions = genVersions.length && genVersions.every(v => v.transmissions.length)
    ? [...new Set(genVersions.flatMap(v => v.transmissions))] : [];
  return { make_id: makeId, model_id, generation_id, version_id, issues, genTransmissions,
    version: version_id ? T.versions.find(v => v.id === version_id) : null };
}

// ── Campos sueltos ──────────────────────────────────────────────────────
export function parseKm(v, unitHint) {
  if (v == null || v === '') return { km: null, raw: null };
  if (typeof v === 'number') return { km: unitHint === 'mi' ? Math.round(v * 1.609344) : Math.round(v), raw: String(v) };
  const raw = String(v); const s = norm(raw);
  const miles = /\b(millas|mi|miles)\b/.test(s) || unitHint === 'mi';
  const m = s.match(/(\d[\d.,]*)\s*(mil|k)?\b/);
  if (!m) return { km: null, raw };
  let n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.'));
  if (m[2]) n *= 1000;
  if (!Number.isFinite(n)) return { km: null, raw };
  return { km: Math.round(miles ? n * 1.609344 : n), raw };
}

export function parsePrice(v, currencyHint, text = '') {
  const t = norm(`${typeof v === 'string' ? v : ''} ${text}`);
  const negotiable = D.NEGOTIABLE.some(re => re.test(t));
  let price = null, currency = null;
  if (typeof v === 'number') price = v;
  else if (v) {
    const m = norm(v).match(/(\d[\d.,]*)\s*(m(illones?)?|mdp|k|mil)?\b/);
    if (m) { price = Number(m[1].replace(/[.,](?=\d{3}\b)/g, '').replace(',', '.')); const mult = m[2]; if (mult === 'k' || mult === 'mil') price *= 1e3; else if (mult && mult.startsWith('m')) price *= 1e6; }
  }
  const cur = norm(currencyHint || '') + ' ' + t;
  if (/\b(usd|us\$|dolares|dlls|dls|u\.s\.)\b/.test(cur)) currency = 'USD'; else if (price != null) currency = 'MXN';
  if (currencyHint && /^(MXN|USD)$/i.test(currencyHint)) currency = currencyHint.toUpperCase();
  if (price != null && (!Number.isFinite(price) || price < 1)) price = null;
  return { price, currency: price != null ? currency : null, negotiable: negotiable || price == null };
}

export function parseTransmission(raw, title, version, year, makeId) {
  const s = norm([raw, title].filter(Boolean).join(' '));
  let tx = null;
  for (const [code, res] of D.TRANSMISSION) if (res.some(re => re.test(s))) { tx = code; break; }
  const inferred = [];
  // Ferrari "F1" después de 2009 es doble embrague
  if (tx === 'f1' && makeId === 'ferrari' && year && year >= 2010) { tx = 'dct'; inferred.push('f1_post_2009_es_dct'); }
  // "Automática" en una versión que solo existió con una caja no-manual → esa caja
  const allowed = version?.transmissions ?? [];
  if (tx === 'automatica' && allowed.length && !allowed.includes('automatica')) {
    const auto = allowed.filter(t => t !== 'manual');
    if (auto.length === 1) { tx = auto[0]; inferred.push(`automatica_es_${auto[0]}`); }
  }
  const impossible = tx && allowed.length && !allowed.includes(tx);
  return { transmission: tx, raw: raw ?? null, inferred, impossible: !!impossible };
}

export function parseColor(raw) {
  if (!raw) return { name: null, family: null, raw: null };
  const s = norm(raw);
  for (const [k, name, fam] of D.FACTORY_COLORS) if (s.includes(k)) return { name, family: fam, raw };
  for (const [fam, words] of D.COLOR_FAMILY) if (words.some(w => new RegExp(`(^|[^a-z])${norm(w)}`).test(s))) return { name: null, family: fam, raw };
  return { name: null, family: null, raw };
}

const firstMatch = (table, text) => { for (const [v, res] of table) if (res.some(re => re.test(text))) return v; return null; };

export function detectOptions(text, makeId) {
  const s = norm(text); const out = new Set();
  for (const [code, , make, aliases] of OPTION_CATALOG) {
    if (make && make !== makeId) continue;
    if (aliases.some(a => new RegExp(`(^|[^a-z0-9])${norm(a).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z0-9])`).test(s))) out.add(code);
  }
  return [...out].sort();
}

// ── Normalizar un anuncio ───────────────────────────────────────────────
// raw: { source_id, capture_method, external_id, url, title, make, model, version, year,
//        km, km_unit, price, currency, price_text, negotiable, transmission, color_ext,
//        color_int, body, city, state, seller_type, seller_name, seller_contact,
//        description, photos, vin, observed_on, published_on, extra }
// Fecha de publicación que declara la fuente ("2026-10-02T14:03:00-06:00" → "2026-10-02").
// Fechas imposibles (antes de 1995 o en el futuro respecto a hoy) se descartan.
export function publishedOn(v, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v ?? ''));
  if (!m) return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`, max = today ?? new Date().toISOString().slice(0, 10);
  return d >= '1995-01-01' && d <= max && !Number.isNaN(Date.parse(d)) ? d : null;
}

const REPLICA = /(^|[^a-z])(replica|tribute|tributo|kit car|recreacion|recreation|evocation)([^a-z]|$)/;

export function normalizeListing(raw) {
  const issues = [], unresolved = [];
  const desc = stripHtml(raw.description ?? '');
  const all = norm([raw.title, raw.model, raw.version, desc].filter(Boolean).join(' \n '));
  // Año: el campo si viene; si no, el ÚLTIMO número con forma de año del título
  // ("Alfa Romeo Spider 2000 1978" → 1978, no 2000).
  const lastYear = s => { const a = [...String(s ?? '').matchAll(/\b(19[4-9]\d|20[0-3]\d)\b/g)].map(m => Number(m[1])); return a.length ? a[a.length - 1] : null; };
  const year = Number.isInteger(raw.year) ? raw.year : (lastYear(raw.year) ?? lastYear(raw.title));

  // Réplicas, tributos y kit cars no son el auto que imitan: fuera de la taxonomía.
  const replica = REPLICA.test(norm([raw.title, raw.model, raw.version].filter(Boolean).join(' ')));
  const tax = replica ? { model_id: null, issues: ['replica'] } : resolveTaxonomy({ make: raw.make, model: raw.model, version: raw.version, title: raw.title, year });
  const inScope = !!tax.model_id;
  issues.push(...tax.issues);

  let { km, raw: kmRaw } = parseKm(raw.km, raw.km_unit);
  // sin campo de km: "con 14,000 km" en el título o la descripción (un solo número; si hay varios, no se adivina)
  // En la descripción solo con contexto ("kilometraje: 35,000", "con 12 mil km", "recorrido 8,000 km"):
  // un "servicio cada 10,000 km" no es el kilometraje del auto.
  if (km == null) {
    const N = '(?:\\d{1,3}(?:[,.]\\d{3})+|\\d{1,6})\\s*(?:mil\\s*)?';
    const ctx = [
      ...[...desc.matchAll(new RegExp(`(?:kilometraje|recorrido|od[oó]metro)\\s*:?\\s*(${N}(?:km|kms|kil[oó]metros)?)`, 'gi'))].map(m => m[1]),
      ...[...desc.matchAll(new RegExp(`(?:\\bcon|\\btiene|\\bs[oó]lo|\\bapenas)\\s+(${N}(?:km|kms|kil[oó]metros))\\b(?!\\s*\\/\\s*h)`, 'gi'))].map(m => m[1]),
      // renglón que solo dice el kilometraje: "• 11,000 km"
      ...[...desc.matchAll(new RegExp(`(?:^|\\n)\\s*[•·*-]?\\s*(${N}(?:km|kms|kil[oó]metros))\\s*\\.?\\s*(?=\\n|$)`, 'gi'))].map(m => m[1]),
    ];
    const t = kmInText(raw.title) ?? (new Set(ctx.map(s => parseKm(s).km)).size === 1 ? ctx[0] : null);
    if (t) ({ km, raw: kmRaw } = parseKm(t));
  }
  const price = parsePrice(raw.price ?? raw.price_text, raw.currency, raw.price_text ?? '');
  if (raw.negotiable) price.negotiable = true;
  // precio "antes" que la fuente muestra tachado; solo si es mayor que el actual y en la misma moneda
  if (price.price != null && raw.list_price != null) {
    const lp = parsePrice(raw.list_price, raw.currency ?? price.currency);
    if (lp.price != null && lp.currency === price.currency && lp.price > price.price && lp.price < price.price * 3) price.list_price = lp.price;
  }
  const tx = parseTransmission(raw.transmission, raw.title, tax.version ?? { transmissions: tax.genTransmissions ?? [] }, year, tax.make_id);
  if (tx.impossible) issues.push('transmision_imposible_para_la_version');
  const ext = parseColor(raw.color_ext), int = parseColor(raw.color_int);

  let vin = null;
  try { vin = raw.vin ? normalizeVin(raw.vin)?.vin : null; } catch { issues.push('vin_invalido'); }
  if (!vin) { const found = findVins(`${raw.title ?? ''} ${desc}`); if (found.length === 1) vin = found[0]; else if (found.length > 1) issues.push('varios_vin_en_texto'); }

  const specs = {
    // carrocería: el campo; si no viene, la palabra clara del título ("911 Targa 4S", "SL Convertible")
    year, km, km_raw: kmRaw, body: raw.body ? mapBody(raw.body) : bodyInTitle(raw.title),
    transmission: tx.transmission, transmission_raw: tx.raw,
    exterior_color: ext.name, exterior_color_family: ext.family, exterior_color_raw: ext.raw,
    interior_color: int.name, interior_color_family: int.family && D.COLOR_FAMILY.some(([f]) => f === int.family) && ['negro', 'gris', 'beige', 'cafe', 'rojo', 'azul', 'verde', 'blanco', 'amarillo', 'naranja'].includes(int.family) ? int.family : (int.family ? 'otro' : null),
    interior_color_raw: int.raw,
    paint_to_sample: D.PAINT_TO_SAMPLE.some(re => re.test(all)) || null,
    invoice_type: firstMatch(D.INVOICE, all), origin: firstMatch(D.ORIGIN, all), owners: firstMatch(D.OWNERS, all),
    service_history: firstMatch(D.SERVICE, all), antique_plates: D.ANTIQUE_PLATES.some(re => re.test(all)) || null,
    options: inScope ? detectOptions(all, tax.make_id) : [],
  };

  // confianza: lo esencial pesa más
  const checks = [
    [!!tax.model_id, 0.25, 'modelo'], [!!tax.generation_id, 0.15, 'generacion'], [!!tax.version_id, 0.2, 'version'],
    [year != null, 0.15, 'anio'], [km != null, 0.1, 'km'], [price.price != null, 0.1, 'precio'], [!!tx.transmission, 0.05, 'transmision'],
  ];
  let confidence = 0;
  for (const [ok, w, f] of checks) { if (ok) confidence += w; else unresolved.push(f); }
  if (issues.includes('transmision_imposible_para_la_version')) confidence -= 0.15;
  confidence = Math.max(0, Math.round(confidence * 100) / 100);

  const url = raw.url ? canonicalUrl(raw.url) : null;
  return {
    inScope, confidence, issues, unresolved,
    vehicle: { model_id: tax.model_id ?? null, generation_id: tax.generation_id ?? null, version_id: tax.version_id ?? null, vin },
    listing: {
      source_id: raw.source_id, capture_method: raw.capture_method ?? 'scraper', external_id: raw.external_id != null ? String(raw.external_id) : null,
      url: raw.url ?? null, url_canonical: url, title: raw.title ?? null, city: raw.city ?? null, state: raw.state ?? null,
      seller_type: raw.seller_type ?? 'desconocido', published_on: publishedOn(raw.published_on, raw.observed_on),
    },
    private: { seller_name: raw.seller_name ?? null, seller_contact: raw.seller_contact ?? null, description: desc || null, raw: raw.extra ?? {} },
    specs: { ...specs, parse_confidence: confidence, unresolved, observed_on: raw.observed_on },
    price: price.price != null || price.negotiable ? price : null,
    photos: (raw.photos ?? []).filter(Boolean),
    inferred: tx.inferred,
  };
}

function bodyInTitle(t) {
  const s = norm(t ?? '');
  if (/\btarga\b/.test(s)) return 'targa';
  if (/\bspeedster\b/.test(s)) return 'speedster';
  if (/\b(cabrio|cabriolet|convertible|descapotable|spider|spyder|volante)\b/.test(s)) return 'cabriolet';
  if (/\broadster\b/.test(s)) return 'roadster';
  if (/\b(coupe|coupé)\b/.test(s)) return 'coupe';
  return null;
}

// "1,700 km", "14mil km", "con 14,000 kilómetros" (no "0-100 km/h"). Uno solo; si hay varios distintos, null.
export function kmInText(s) {
  const found = new Set();
  for (const m of String(s ?? '').matchAll(/(\d{1,3}(?:[,.]\d{3})+|\d{1,6})\s*(mil\s*)?(?:km|kms|kilómetros|kilometros)\b(?!\s*\/\s*h)/gi)) {
    found.add(Number(m[1].replace(/[,.]/g, '')) * (m[2] ? 1000 : 1));
  }
  return found.size === 1 ? String([...found][0]) : null;
}

function mapBody(b) {
  const s = norm(b);
  if (/targa/.test(s)) return 'targa';
  if (/cabrio|convertible|spider|spyder|volante|descapotable/.test(s)) return 'cabriolet';
  if (/roadster/.test(s)) return 'roadster';
  if (/speedster/.test(s)) return 'speedster';
  if (/suv|camioneta|todoterreno/.test(s)) return 'suv';
  if (/sedan/.test(s)) return 'sedan';
  if (/shooting|sport turismo/.test(s)) return 'shooting_brake';
  if (/coupe|cupe|coupé/.test(s)) return 'coupe';
  return null;
}
