// ════════════════════════════════════════════════════════════════════════
// Adaptador · Wayback Machine (archive.org)
//
// Mercado Libre y los portales borran los anuncios cuando el auto se vende,
// pero archive.org guardó copias de muchos de ellos durante años. Este
// adaptador:
//   1. Pregunta al índice público de archive.org (CDX) por las copias de cada
//      sitio cuya dirección menciona una marca o modelo de la taxonomía.
//   2. Abre cada copia (una por anuncio por mes) tal como se guardó y la lee.
//   3. Entrega el anuncio con la fecha de ESA copia (observed_on): el
//      pipeline guarda el precio de ese día, así que varias copias del mismo
//      anuncio en distintos meses = su historial de precio (y sus rebajas).
//
// source_id es el sitio original (mercadolibre-autos, seminuevos-com…), no
// "wayback"; capture_method = 'wayback'. Los anuncios viejos entran como
// "ya no aparece" (el pipeline lo decide con la fecha de la copia).
//
// Avance: .capturas/wayback-estado.json guarda por dónde va cada sitio en el
// índice y qué copias ya se leyeron. Cada corrida lee como máximo
// config.max_snapshots_per_run copias y sigue donde se quedó la anterior.
// Sin el archivo, empieza de nuevo (y lo ya guardado solo se "toca").
// ════════════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsonLdBlocks, findSchemaObjects, stripHtml } from '../core/extract.mjs';
import { taxonomy } from '../core/normalize.mjs';
import { makeAliases } from '../data/taxonomia.mjs';

const CDX = 'https://web.archive.org/cdx/search/cdx';
const DEFAULT_STATE = fileURLToPath(new URL('../.capturas/wayback-estado.json', import.meta.url));
// Marcas cuyo nombre solo ya es suficiente (todo lo que venden nos interesa).
// De las demás (Ford, BMW, Mercedes…) solo se buscan los modelos de la taxonomía.
const WHOLE_MAKES = ['porsche', 'ferrari', 'lamborghini', 'mclaren', 'aston-martin', 'bentley', 'rolls-royce'];

// Nombres de modelo que solos significan otra cosa ("spider" = cualquier convertible): solo con la marca enfrente
const GENERIC = /^(mini|serie|clase|coupe|sport|spider|ninety|one-ten|puch|gt|sl)(-|$)/;
const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// Palabras que, en la dirección de un anuncio, delatan un auto que seguimos: "ferrari", "aston-martin", "mustang", "e30"…
export function urlTerms() {
  const t = taxonomy(), out = new Set();
  for (const m of WHOLE_MAKES) for (const a of makeAliases[m] ?? [m]) if (a.length >= 4) out.add(slug(a));
  for (const m of t.models) {
    if (WHOLE_MAKES.includes(m.make_id)) continue;
    const aliases = t.aliases.filter(([, level, target]) => level === 'model' && target === m.id).map(([a]) => a);
    for (const a of [m.name, ...aliases]) {
      const s = slug(a);
      // "Mini" o "SL" solos atraparían medio Mercado Libre: con la marca enfrente
      if (s.length >= 4 && !/^\d{1,3}$/.test(s) && !GENERIC.test(s)) out.add(s);
      for (const ma of makeAliases[m.make_id] ?? []) if (s) out.add(`${slug(ma)}-${s}`);
    }
  }
  return [...out].sort();
}

// Filtro del índice CDX (expresión regular de Java sobre la dirección original).
export function cdxFilter(terms) {
  const esc = terms.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return `original:(?i).*[-/_](${esc.join('|')})([-/_.?].*|)$`;
}

// "20190314123456" → "2019-03-14"
export const tsDay = ts => `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`;

// Respuesta de texto del CDX ("timestamp original" por renglón; renglón vacío y la llave para seguir).
export function parseCdx(text) {
  const lines = String(text).split('\n');
  const rows = [], blank = lines.findIndex(l => !l.trim());
  const body = blank >= 0 ? lines.slice(0, blank) : lines;
  for (const l of body) { const [ts, ...rest] = l.trim().split(' '); if (/^\d{14}$/.test(ts) && rest.length) rows.push([ts, rest.join(' ')]); }
  const resumeKey = blank >= 0 ? lines.slice(blank + 1).map(s => s.trim()).find(Boolean) ?? null : null;
  return { rows, resumeKey };
}

// HTML viejo de Mercado Libre viene en ISO-8859-1: se decodifica con el juego de caracteres que declara.
export function decodeHtml(buf, contentType = '') {
  const head = buf.subarray(0, 4096).toString('latin1');
  const cs = (String(contentType).match(/charset=["']?([\w-]+)/i) ?? head.match(/<meta[^>]+charset=["']?([\w-]+)/i) ?? [])[1]?.toLowerCase();
  try { return new TextDecoder(cs && cs !== 'utf8' ? cs : 'utf-8').decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

// ── lectura de una copia ────────────────────────────────────────────────
const NUM = '\\d{1,3}(?:[.,]\\d{3})+|\\d{4,9}';
const metaContent = (html, re) => { const m = html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["'](?:${re})["'][^>]*>`, 'i')); return m ? (m[0].match(/content=["']([^"']*)["']/i) ?? [])[1] ?? null : null; };
const num = s => { const n = Number(String(s ?? '').replace(/[^\d]/g, '')); return n > 0 ? n : null; };
const USD_RE = /U\$S|US\$|USD|d[oó]lares/i;

function lines(html) {
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<\/(li|tr|td|th|dt|dd|div|p|h\d|span|strong|label)>/gi, '$&\n');
  return stripHtml(body).split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
}
// "Año" → "2012" (en el mismo renglón tras ":" o en el siguiente)
function labelValue(ls, labels) {
  for (let i = 0; i < ls.length; i++) for (const lb of labels) {
    const m = ls[i].match(new RegExp(`^${lb}\\s*:?\\s*(.*)$`, 'i'));
    if (m) { const v = (m[1] || ls[i + 1] || '').trim(); if (v && v.length < 80) return v; }
  }
  return null;
}
// "Publicado hace 3 días" / "hace 2 meses" respecto al día de la copia
function agoFrom(text, day) {
  const m = String(text).match(/publicad[oa]\s+hace\s+(un|una|\d+)\s+(d[ií]as?|semanas?|mes(?:es)?|años?)/i);
  if (m) {
    const n = /^un/i.test(m[1]) ? 1 : Number(m[1]), u = m[2].toLowerCase();
    const d = /^d/.test(u) ? 1 : /^s/.test(u) ? 7 : /^m/.test(u) ? 30 : 365;
    return new Date(Date.parse(day + 'T12:00:00Z') - n * d * 864e5).toISOString().slice(0, 10);
  }
  const f = String(text).match(/publicad[oa]\s+(?:el\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
  return f ? `${f[3]}-${f[2].padStart(2, '0')}-${f[1].padStart(2, '0')}` : null;
}
// Fotos de Mercado Libre: una por imagen, la grande (-O / -F / 2X) sobre la miniatura
export function mlPhotos(html) {
  const byKey = new Map();
  for (const m of html.matchAll(/(?:https?:)?\/\/[a-z0-9-]+\.mlstatic\.com\/[^"'\s)<>\\]+?\.(?:jpe?g|webp|png)/gi)) {
    const u = m[0].replace(/^(?:https?:)?\/\//, 'https://');
    const key = (u.match(/(\d{3,}-MLM\d+_\d+)/) ?? [])[1];
    if (!key) continue;   // logos, íconos, avatares
    const big = /-[OF]\.(jpe?g|webp|png)$|_2X_/.test(u);
    const prev = byKey.get(key);
    if (!prev || (big && !prev.big)) byKey.set(key, { u, big });
  }
  return [...byKey.values()].map(x => x.u).slice(0, 20);
}

const ENDED = /publicaci[oó]n\s+(finalizada|pausada|inactiva)|esta publicaci[oó]n (est[aá] pausada|ha finalizado|finaliz[oó])|art[ií]culo\s+vendido|ya no est[aá] disponible/i;

// Una copia de un anuncio de Mercado Libre (cualquier época: 2008 a hoy).
export function parseMercadoLibre(html, { original, day }) {
  const ld = findSchemaObjects(jsonLdBlocks(html), ['Product', 'Car', 'Vehicle'])[0] ?? null;
  const ls = lines(html);
  const text = ls.join('\n');
  const titleTag = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) ?? [])[1] ?? '';
  const h1 = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) ?? [])[1];
  const title = stripHtml(h1 ?? '') || ld?.name || metaContent(html, 'og:title') || stripHtml(titleTag).replace(/\s*[-|]\s*\$?\s*[\d.,]+.*$/, '').replace(/\s*[-|]\s*Mercado\s*Libre.*$/i, '');
  if (!title) return { skip: 'sin_titulo' };
  if (ENDED.test(text.slice(0, 6000))) return { skip: 'finalizada' };

  // precio: datos estructurados → meta → etiquetas de precio de cada época → <title> ("… - $ 4,200,000 en Mercado Libre")
  const off = [].concat(ld?.offers ?? [])[0] ?? {};
  let price = num(off.price) ?? num(metaContent(html, 'price|product:price:amount|og:price:amount'));
  let curHint = off.priceCurrency ?? metaContent(html, 'priceCurrency|product:price:currency|og:price:currency');
  if (!price) {
    const tag = html.match(/class=["'][^"']*(?:andes-money-amount__fraction|price-tag-fraction)[^"']*["'][^>]*>\s*([\d.,]+)/i)
      ?? html.match(/class=["'][^"']*(?:ch-price|vip-price|price)[^"']*["'][^>]*>[^<$]*(?:<[^>]+>\s*)*((?:U\$S|US\$|\$)\s*[\d.,]+)/i);
    if (tag) { price = num(tag[1]); const around = html.slice(Math.max(0, tag.index - 300), tag.index + 80); if (!curHint && USD_RE.test(around)) curHint = 'USD'; }
  }
  if (!price) {
    const t = stripHtml(titleTag).match(new RegExp(`(U\\$S|US\\$|\\$)\\s*(${NUM})`));
    if (t) { price = num(t[2]); if (/U/.test(t[1])) curHint = 'USD'; }
  }
  if (price && (price < 20000 || price > 400000000)) price = null;   // "apártalo con $5,000", errores de captura
  const currency = /^USD$/i.test(curHint ?? '') ? 'USD' : price ? 'MXN' : null;

  const sub = ls.find(l => /\d{4}\s*[|·]\s*[\d.,]+\s*km/i.test(l)) ?? '';
  const yearTxt = labelValue(ls, ['Año', 'Ano', 'Año del modelo']) ?? (sub.match(/\b(19[4-9]\d|20[0-3]\d)\b/) ?? [])[0] ?? ld?.vehicleModelDate ?? ld?.modelDate;
  const kmTxt = labelValue(ls, ['Kilómetros', 'Kilometros', 'Kilometraje', 'Recorrido']) ?? (sub.match(/([\d.,]+)\s*km/i) ?? [])[0];
  const ext = original.match(/MLM-?(\d{6,})/i);
  const item = {
    external_id: ext ? `MLM${ext[1]}` : null,
    url: original.replace(/^http:/, 'https:').split('#')[0],
    title: title.trim().slice(0, 300),
    make: labelValue(ls, ['Marca']) ?? ld?.brand?.name ?? (typeof ld?.brand === 'string' ? ld.brand : null),
    model: labelValue(ls, ['Modelo']) ?? null,
    version: labelValue(ls, ['Versión', 'Version']) ?? null,
    year: yearTxt ? Number((String(yearTxt).match(/\b(19[4-9]\d|20[0-3]\d)\b/) ?? [])[0]) || null : null,
    km: kmTxt ?? null,
    transmission: labelValue(ls, ['Transmisión', 'Transmision']) ?? null,
    color_ext: labelValue(ls, ['Color exterior', 'Color']) ?? null,
    color_int: labelValue(ls, ['Color interior', 'Color de interiores', 'Interior']) ?? null,
    body: labelValue(ls, ['Tipo de carrocería', 'Tipo de carroceria', 'Carrocería']) ?? null,
    city: labelValue(ls, ['Ubicación del vehículo', 'Ubicación', 'Ubicacion']) ?? null,
    price, currency,
    description: stripHtml((html.match(/class=["'][^"']*(?:ui-pdp-description__content|item-description__text|description-content)[^"']*["'][^>]*>([\s\S]*?)<\/(?:p|div|pre)>/i) ?? [])[1] ?? '').slice(0, 4000) || ld?.description || null,
    photos: mlPhotos(html),
    published_on: agoFrom(text, day),
  };
  return { items: [item] };
}

// Otros sitios: solo con datos estructurados (JSON-LD de vehículo/producto). Sin ellos no se adivina:
// una nota de prensa con "precio estimado" no es un anuncio.
export function parseJsonLd(html, { original }) {
  const objs = findSchemaObjects(jsonLdBlocks(html), ['Car', 'Vehicle', 'Product', 'IndividualProduct']);
  const items = [];
  for (const o of objs) {
    const off = [].concat(o.offers ?? [])[0] ?? {};
    if (/(OutOfStock|SoldOut|Discontinued)/i.test(String(off.availability ?? ''))) continue;
    const price = num(off.price ?? off.priceSpecification?.price);
    const img = [].concat(o.image ?? []).map(i => (typeof i === 'string' ? i : i?.url)).filter(Boolean).map(u => u.replace(/^\/\//, 'https://').replace(/^http:/, 'https:'));
    let url = off.url ?? o.url ?? original;
    try { url = new URL(url.replace(/^https?:\/\/web\.archive\.org\/web\/\d+[a-z_]*\//, ''), original).href; } catch { url = original; }
    items.push({
      external_id: o.sku ?? o.productID ?? null, url: url.replace(/^http:/, 'https:'), title: o.name ?? null,
      make: o.brand?.name ?? (typeof o.brand === 'string' ? o.brand : null) ?? o.manufacturer?.name ?? null,
      model: o.model ? String(o.model.name ?? o.model) : null,
      year: Number((String(o.vehicleModelDate ?? o.modelDate ?? o.productionDate ?? '').match(/\b(19[4-9]\d|20[0-3]\d)\b/) ?? [])[0]) || null,
      km: o.mileageFromOdometer ? String(o.mileageFromOdometer.value ?? o.mileageFromOdometer) : null,
      transmission: o.vehicleTransmission ?? null, color_ext: o.color ?? null, vin: o.vehicleIdentificationNumber ?? null,
      price: price && price >= 20000 ? price : null, currency: price && /^(MXN|USD)$/i.test(off.priceCurrency ?? '') ? off.priceCurrency.toUpperCase() : null,
      description: o.description ? String(o.description).slice(0, 4000) : null, photos: img.slice(0, 20),
      published_on: o.datePosted ?? o.datePublished ?? null,
    });
  }
  return { items: items.filter(x => x.title) };
}

const PARSERS = { mercadolibre: parseMercadoLibre, jsonld: parseJsonLd };

// ── estado (por dónde va cada sitio) ────────────────────────────────────
function loadState(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return { targets: {}, seen: {} }; }
}
function saveState(file, state) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file + '.tmp', JSON.stringify(state));
  renameSync(file + '.tmp', file);   // nunca queda un archivo a medias
}

export class WaybackAdapter {
  constructor(source) {
    this.source = source; this.partial = true;
    this.cfg = { max_snapshots_per_run: 250, cdx_page: 3000, rescan_days: 30, per_month: 1, ...(source.config ?? {}) };
    this.stateFile = this.cfg.state_file ?? process.env.WAYBACK_ESTADO ?? DEFAULT_STATE;
  }

  keyOf(target, original) {
    const re = target.id_re ? new RegExp(target.id_re, 'i') : null, m = re ? original.match(re) : null;
    return m ? `${target.id_prefix ?? ''}${m[1]}` : original.replace(/^https?:\/\/(www\.)?/i, '').replace(/[?#].*$/, '').replace(/\/$/, '').toLowerCase();
  }

  // Siguiente página del índice para un sitio: agrega a la cola las copias que faltan (una por anuncio por mes).
  async refill(ctx, target, st, state, filter) {
    const today = ctx.today ?? new Date().toISOString().slice(0, 10);
    if (st.exhausted_on) {
      const age = (Date.parse(today) - Date.parse(st.exhausted_on)) / 864e5;
      if (age < this.cfg.rescan_days) return false;
      Object.assign(st, { exhausted_on: null, prefix_i: 0, resumeKey: null });   // repasar: archive.org sigue guardando copias nuevas
    }
    st.prefix_i ??= 0;
    const prefixes = [].concat(target.prefixes ?? []);
    if (st.prefix_i >= prefixes.length) { st.exhausted_on = today; return false; }
    const qs = new URLSearchParams({ url: prefixes[st.prefix_i], matchType: 'prefix', fl: 'timestamp,original', limit: String(this.cfg.cdx_page), showResumeKey: 'true' });
    qs.append('filter', 'statuscode:200');
    qs.append('filter', 'mimetype:text/html');
    qs.append('filter', filter);
    if (target.from) qs.set('from', String(target.from));
    if (st.resumeKey) qs.set('resumeKey', st.resumeKey);
    const res = await ctx.fetcher.get(`${CDX}?${qs}`, { accept: 'text/plain', timeoutMs: 180000 });
    const { rows, resumeKey } = parseCdx(res.text);
    const queued = new Set(st.queue.map(([, , k]) => k));
    let added = 0;
    for (const [ts, original] of rows) {
      const k = `${target.source}|${this.keyOf(target, original)}|${ts.slice(0, 6)}`;
      if (state.seen[k] || queued.has(k)) continue;
      queued.add(k); st.queue.push([ts, original, k]); added++;
    }
    if (resumeKey) st.resumeKey = resumeKey;
    else { st.resumeKey = null; st.prefix_i++; }
    ctx.log(`  · ${target.id}: ${rows.length} copias en el índice, ${added} por leer${resumeKey ? '' : ` (fin de ${prefixes[st.prefix_i - 1]})`}`);
    return true;
  }

  async *listings(ctx) {
    const state = loadState(this.stateFile);
    const filter = cdxFilter(this.cfg.terms ?? urlTerms());
    const targets = (this.cfg.targets ?? []).filter(t => t.enabled !== false);
    if (!targets.length) throw new Error('config.targets vacío en sources.yaml');
    let budget = this.cfg.max_snapshots_per_run, done = 0;
    try {
      // Una vuelta por sitio a la vez, para que todos avancen aunque uno tenga millones de copias.
      let progress = true;
      while (budget > 0 && progress) {
        progress = false;
        for (const target of targets) {
          if (budget <= 0) break;
          const st = (state.targets[target.id] ??= { queue: [] });
          st.queue ??= [];
          if (!st.queue.length) {
            try { if (!(await this.refill(ctx, target, st, state, filter))) continue; }
            catch (e) { ctx.log(`  ✗ índice de ${target.id}: ${e.message}`); continue; }
          }
          const take = st.queue.splice(0, Math.min(25, budget));
          if (take.length) progress = true;
          for (const [ts, original, k] of take) {
            budget--;
            const day = tsDay(ts);
            let parsed;
            try {
              const res = await ctx.fetcher.get(`https://web.archive.org/web/${ts}id_/${original}`, { as: 'buffer', timeoutMs: 60000 });
              parsed = (PARSERS[target.parser] ?? parseJsonLd)(decodeHtml(res.buffer, res.headers?.get?.('content-type')), { original, day });
            } catch (e) {
              if (e.status === 404 || e.status === 403) { state.seen[k] = 1; continue; }   // copia que archive.org ya no sirve
              st.queue.unshift([ts, original, k]);   // falla de red: se reintenta en otra corrida
              throw e;
            }
            state.seen[k] = 1;
            if (++done % 10 === 0) saveState(this.stateFile, state);
            for (const it of parsed.items ?? []) {
              if (it.currency === 'USD') continue;   // regla: solo precios en pesos
              yield {
                seller_type: 'desconocido', ...it, source_id: target.source, capture_method: 'wayback', observed_on: day,
                extra: { wayback: `https://web.archive.org/web/${ts}/${original}`, copia: day },
              };
            }
          }
        }
      }
    } finally {
      saveState(this.stateFile, state);
      ctx.log(`  · copias leídas en esta corrida: ${done}; pendientes en cola: ${targets.map(t => `${t.id} ${state.targets[t.id]?.queue?.length ?? 0}`).join(', ')}`);
    }
  }
}

export default source => new WaybackAdapter(source);
