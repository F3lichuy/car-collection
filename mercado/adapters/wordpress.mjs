// Adaptadores para agencias hechas en WordPress (la mayoría de las mexicanas).
//
// Cada uno lee la fuente MÁS estructurada que el sitio ofrece en público, en
// este orden: API de la tienda (WooCommerce), API REST del tipo de auto
// (temas Vehica y Motors/STM) y, si no hay API, sitemap + ficha (adapters/ficha.mjs).
//
// Moneda: solo se toma la que el sitio declara. Si el sitio muestra "$" sin
// moneda, sources.yaml debe fijar config.currency tras verificarlo a mano
// (y anotar cómo); sin eso el precio queda sin moneda y no entra a estadísticas.
import { stripHtml } from '../core/extract.mjs';

const decode = s => stripHtml(String(s ?? ''));
const J = async (ctx, url) => {
  const r = await ctx.fetcher.get(url, { accept: 'application/json' });
  return { data: JSON.parse(r.text), totalPages: Number(r.headers.get('x-wp-totalpages')) || null };
};

// "Marca: Porsche\nModelo: GT3\nAño: 2023" → { make, model, year, ... }
export const LABELS = {
  make: ['marca', 'make'], model: ['modelo', 'model'], version: ['versión', 'version', 'submodelo'],
  year: ['año', 'made year', 'year', 'año modelo'], km: ['kilometraje', 'kilómetros', 'kilometros', 'mileage', 'km'],
  transmission: ['transmisión', 'transmision', 'transmission', 'caja'], color_ext: ['color exterior', 'color'],
  color_int: ['color interior', 'interiores', 'interior'], vin: ['vin', 'número de serie', 'numero de serie', 'no. de serie'],
};
export function labelFields(text, labels = LABELS) {
  const out = {};
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [field, names] of Object.entries(labels)) {
    for (const n of names) {
      // la etiqueta al inicio de línea, ":" y el valor en la misma línea o en la siguiente
      const m = String(text).match(new RegExp(`(?:^|\\n)[ \\t]*${esc(n)}[ \\t]*:[ \\t]*(?:\\n[ \\t]*)?([^\\n]+)`, 'i'));
      const v = m?.[1]?.trim();
      if (v && !/^[:\-–]?$/.test(v)) { out[field] = v; break; }
    }
  }
  return out;
}
const yearOf = v => { const m = String(v ?? '').match(/\b(19[4-9]\d|20[0-3]\d)\b/); return m ? Number(m[1]) : null; };
const knownCurrency = c => (/^(MXN|USD)$/.test(c ?? '') ? c : null);

// ── WooCommerce · Store API pública (/wp-json/wc/store/v1/products) ─────────
// La usa la propia tienda para pintar el catálogo; no requiere llaves.
export class WooStoreAdapter {
  constructor(source) { this.source = source; this.base = new URL(source.base_url).origin; this.partial = false; }
  async *listings(ctx) {
    const cat = this.source.config?.category ? `&category=${encodeURIComponent(this.source.config.category)}` : '';
    for (let page = 1; page <= 20; page++) {
      const { data } = await J(ctx, `${this.base}/wp-json/wc/store/v1/products?per_page=100&page=${page}${cat}`);
      if (!Array.isArray(data) || !data.length) break;
      for (const p of data) {
        if (p.is_in_stock === false) continue;
        const short = decode(p.short_description), long = decode(p.description);
        const f = labelFields(`${short}\n${long}`);
        const minor = Number(p.prices?.currency_minor_unit ?? 2);
        const amount = Number(p.prices?.price) / 10 ** minor;
        const currency = knownCurrency(this.source.config?.currency ?? p.prices?.currency_code);
        const name = decode(p.name);
        yield {
          external_id: String(p.id), url: p.permalink, title: name,
          make: f.make ?? null, model: f.model ? `${f.model} ${name}` : name, version: f.version ?? null,
          year: yearOf(f.year) ?? yearOf(name), km: f.km ?? null, transmission: f.transmission ?? null,
          color_ext: f.color_ext ?? null, color_int: f.color_int ?? null, vin: f.vin ?? null,
          // precio 0 = "pregunta por él": no es un precio
          price: amount > 0 && currency ? amount : null, currency: amount > 0 ? currency : null,
          description: [short, long].filter(Boolean).join('\n'),
          photos: (p.images ?? []).map(i => i.src).filter(Boolean),
          city: this.source.cities?.[0] ?? null, seller_type: 'broker', seller_name: this.source.name,
          extra: { categorias: (p.categories ?? []).map(c => c.slug) },
        };
      }
      if (data.length < 100) break;
    }
  }
}

// ── Tema Vehica · /wp-json/wp/v2/<cars> ──────────────────────────────────────
// Marca, modelo, transmisión… son taxonomías (vienen con _embed=wp:term y su
// nombre se lee en /taxonomies). Año, km, color, precio y galería son campos
// con id numérico propio de cada sitio: se fijan en config.fields.
export class VehicaAdapter {
  constructor(source) { this.source = source; this.base = new URL(source.base_url).origin; this.partial = false; this.cfg = source.config ?? {}; }
  async *listings(ctx) {
    const F = this.cfg.fields ?? {};
    const restBase = this.cfg.rest_base ?? 'cars';
    const { data: tax } = await J(ctx, `${this.base}/wp-json/wp/v2/taxonomies?type=${this.cfg.post_type ?? 'vehica_car'}`);
    const taxName = Object.fromEntries(Object.entries(tax).map(([slug, t]) => [slug, String(t.name ?? '').toLowerCase()]));
    const all = [];
    for (let page = 1, total = 1; page <= total && page <= 20; page++) {
      const r = await J(ctx, `${this.base}/wp-json/wp/v2/${restBase}?per_page=100&page=${page}&_embed=wp:term`);
      total = r.totalPages ?? 1;
      all.push(...r.data);
    }
    // Kilometraje "de relleno": si el mismo número exacto aparece en ≥20 % de los
    // autos (p. ej. 130000 en clásicos sin odómetro confiable), no es un dato.
    const kmCount = new Map();
    for (const c of all) { const k = String(c[F.km] ?? '').trim(); if (k) kmCount.set(k, (kmCount.get(k) ?? 0) + 1); }
    const fillerKm = new Set([...kmCount].filter(([, n]) => all.length >= 10 && n / all.length >= 0.2).map(([k]) => k));
    if (fillerKm.size) ctx.log(`  · ${this.source.id}: km ${[...fillerKm].join(', ')} se repite en muchos autos; se trata como sin dato`);

    for (const c of all) {
      const terms = {};
      for (const t of (c._embedded?.['wp:term'] ?? []).flat()) terms[taxName[t.taxonomy] ?? t.taxonomy] = decode(t.name);
      const title = decode(c.title?.rendered);
      const priceObj = c[F.price];
      const amount = priceObj && typeof priceObj === 'object' ? Number(Object.values(priceObj)[0]) : Number(priceObj);
      const km = String(c[F.km] ?? '').trim();
      yield {
        external_id: String(c.id), url: c.link, title,
        make: terms.marca ?? null, model: [terms.modelo, title].filter(Boolean).join(' '), version: F.version ? String(c[F.version] ?? '') || null : null,
        year: yearOf(c[F.year]) ?? yearOf(title), km: km && !fillerKm.has(km) ? km : null,
        transmission: terms['transmisión'] ?? terms.transmision ?? null, body: terms['carrocería'] ?? null,
        color_ext: F.color ? String(c[F.color] ?? '') || null : null,
        price: amount > 0 && this.cfg.currency ? amount : null, currency: amount > 0 ? knownCurrency(this.cfg.currency) : null,
        description: decode(c.content?.rendered),
        photos: Array.isArray(c[F.gallery]) ? c[F.gallery].filter(u => typeof u === 'string') : [],
        city: this.source.cities?.[0] ?? null, seller_type: 'broker', seller_name: this.source.name,
        extra: { clasificacion: terms['clasificación'] ?? null, condicion: terms['condición'] ?? null, km_relleno: fillerKm.has(km) || undefined },
      };
    }
  }
}

// ── Tema Motors (StylemixThemes) · /wp-json/wp/v2/listings ───────────────────
// car_meta trae precio, km y VIN; marca/serie/año son taxonomías. Las fotos
// son ids de la galería: se piden a /media solo para autos nuevos que interesan.
export class StmListingsAdapter {
  constructor(source) { this.source = source; this.base = new URL(source.base_url).origin; this.partial = false; this.cfg = source.config ?? {}; }
  async *listings(ctx) {
    for (let page = 1, total = 1; page <= total && page <= 20; page++) {
      const r = await J(ctx, `${this.base}/wp-json/wp/v2/listings?per_page=100&page=${page}&_embed=wp:term`);
      total = r.totalPages ?? 1;
      for (const c of r.data) {
        if (c.vendido === true || c.vendido === '1') continue;   // marcado como vendido por la agencia
        const terms = {};
        for (const t of (c._embedded?.['wp:term'] ?? []).flat()) terms[t.taxonomy] = decode(t.name);
        const m = c.car_meta ?? {};
        const title = decode(c.title?.rendered);
        const sale = Number(m.sale_price), list = Number(m.price);
        const amount = sale > 0 ? sale : list;
        const raw = {
          external_id: String(c.id), url: c.link, title,
          make: terms.make ?? null, model: [terms.serie, title].filter(Boolean).join(' '),
          year: yearOf(terms['ca-year']) ?? yearOf(title), km: m.mileage || null,
          transmission: terms.transmission ?? null, color_ext: terms['exterior-color'] ?? null, color_int: terms['interior-color'] ?? null,
          vin: m.vin_number || null,
          price: amount > 0 && this.cfg.currency ? amount : null, currency: amount > 0 ? knownCurrency(this.cfg.currency) : null,
          description: decode(c.content?.rendered),
          photos: [], city: this.source.cities?.[0] ?? null, seller_type: 'broker', seller_name: this.source.name,
          extra: { condicion: terms.condition ?? null },
        };
        const ids = [c.featured_media, ...Object.values(m.gallery ?? {})].filter(x => Number(x) > 0);
        if (ids.length && !ctx.isKnown(raw.external_id) && (!ctx.wanted || ctx.wanted(raw))) {
          try {
            const { data: media } = await J(ctx, `${this.base}/wp-json/wp/v2/media?include=${[...new Set(ids)].slice(0, 40).join(',')}&per_page=40&_fields=id,source_url`);
            const byId = new Map(media.map(x => [String(x.id), x.source_url]));
            raw.photos = [...new Set(ids)].map(id => byId.get(String(id))).filter(Boolean);
          } catch (e) { ctx.log(`  · ${this.source.id}: sin fotos para ${raw.url} (${e.message})`); }
        }
        yield raw;
      }
    }
  }
}

export const wooStore = source => new WooStoreAdapter(source);
export const vehica = source => new VehicaAdapter(source);
export const stmListings = source => new StmListingsAdapter(source);
