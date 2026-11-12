// Adaptador genérico · sitemap + ficha de cada auto
//
// Para sitios sin API pública (Miura, Imperia, Mulsanne…):
//   1. lee los sitemaps de config.sitemaps y se queda con las URLs de autos (config.include)
//   2. antes de abrir una ficha, descarta por el texto de la URL los autos que
//      de todos modos quedarían fuera de la taxonomía (ctx.wanted)
//   3. en la ficha: primero JSON-LD (Product/Car/Vehicle + Offer); lo que falte,
//      de las etiquetas "Marca: …", "Año: …", "Kilometraje: …"
//
// config:
//   sitemaps: [rutas]          include: regex de URL de auto
//   currency: MXN|USD           solo si el sitio muestra "$" sin moneda y se verificó a mano
//   content_end: regex          dónde termina la ficha (antes de "autos relacionados")
//   sold: regex                 texto que marca la ficha como vendida (se omite)
import { jsonLdBlocks, findSchemaObjects, sitemapLocs, stripHtml } from '../core/extract.mjs';
import { labelFields, LABELS } from './wordpress.mjs';

const clean = html => stripHtml(String(html).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ''));
const yearOf = v => { const m = String(v ?? '').match(/\b(19[4-9]\d|20[0-3]\d)\b/); return m ? Number(m[1]) : null; };
const knownCurrency = c => (/^(MXN|USD)$/i.test(c ?? '') ? c.toUpperCase() : null);
const first = v => (Array.isArray(v) ? v[0] : v);
// "1,700 km", "14mil km", "con 14,000 kilómetros" en el título o la descripción del propio auto
// (no en toda la página: ahí hay "0-100 km/h" y autos relacionados). Uno solo; si hay varios distintos, no se adivina.
export function kmInText(s) {
  const found = new Set();
  for (const m of String(s ?? '').matchAll(/(\d{1,3}(?:[,.]\d{3})+|\d{1,6})\s*(mil\s*)?(?:km|kms|kilómetros|kilometros)\b(?!\s*\/\s*h)/gi)) {
    found.add(Number(m[1].replace(/[,.]/g, '')) * (m[2] ? 1000 : 1));
  }
  return found.size === 1 ? String([...found][0]) : null;
}

export class FichaAdapter {
  constructor(source) {
    this.source = source; this.base = new URL(source.base_url).origin; this.partial = false;
    this.cfg = source.config ?? {};
    this.include = new RegExp(this.cfg.include ?? '.');
    this.contentEnd = this.cfg.content_end ? new RegExp(this.cfg.content_end, 'i') : null;
    this.sold = this.cfg.sold ? new RegExp(this.cfg.sold, 'i') : null;
  }

  async urls(ctx) {
    const out = new Set();
    // sin sitemap: config.list_pages = páginas de inventario cuyos enlaces son los autos
    const sitemaps = this.cfg.sitemaps ?? (this.cfg.list_pages ? [] : ['/sitemap.xml']);
    for (const p of sitemaps) {
      const xml = (await ctx.fetcher.get(new URL(p, this.base).href, { accept: 'application/xml,text/xml' })).text;
      for (const u of sitemapLocs(xml)) if (this.include.test(u)) out.add(u);
    }
    for (const p of this.cfg.list_pages ?? []) {
      const html = (await ctx.fetcher.get(new URL(p, this.base).href)).text;
      for (const [, href] of html.matchAll(/href="([^"#]+)"/gi)) {
        const u = new URL(href.replace(/&amp;/g, '&'), this.base);
        if (u.origin === this.base && this.include.test(u.pathname)) out.add(u.origin + u.pathname);
      }
    }
    return [...out];
  }

  async *listings(ctx) {
    for (const url of await this.urls(ctx)) {
      const slug = decodeURIComponent(new URL(url).pathname).split('/').filter(Boolean).pop() ?? '';
      const external_id = slug;
      // "porsche-macan-s-blindada" → fuera sin abrir la ficha. Slugs sin letras ("5459") sí se abren.
      if (/[a-z]/i.test(slug) && !ctx.isKnown(external_id) && ctx.wanted && !ctx.wanted({ title: slug.replace(/[-_]+/g, ' ') })) {
        yield { external_id, url, title: slug.replace(/[-_]+/g, ' ') };   // el pipeline la cuenta como fuera de taxonomía
        continue;
      }
      const html = (await ctx.fetcher.get(url)).text;
      const raw = this.parse(html, url, external_id);
      if (raw) yield raw;
    }
  }

  parse(html, url, external_id) {
    const main = this.contentEnd ? html.split(this.contentEnd)[0] : html;
    // el texto de la ficha empieza en el título (antes solo hay menú y encabezado)
    const h1At = main.search(/<h1[\s>]/i);
    const text = clean(h1At > 0 ? main.slice(h1At) : main);
    if (this.sold && this.sold.test(text)) return null;

    const ld = findSchemaObjects(jsonLdBlocks(html), ['Product', 'Car', 'Vehicle'])[0] ?? null;
    const offer = first(ld?.offers);
    if (offer?.availability && /(OutOfStock|SoldOut|Discontinued)/i.test(offer.availability)) return null;

    const h1 = stripHtml(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? '');
    // sin <h1> (Exotic Avenue): nombre del JSON-LD o <title>, sin el " - Nombre del sitio"
    const title = h1 || stripHtml(ld?.name ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+[-|–]\s+[^-|–]+$/, '');
    // config.labels reemplaza etiquetas de un sitio (Exotic Avenue llama "Modelo" al año)
    const f = labelFields(text, { ...LABELS, ...(this.cfg.labels ?? {}) });

    // precio: JSON-LD, si no el primer "$ 950,000 (MXN)" después del título
    let price = null, currency = null;
    if (offer?.price != null) { price = Number(offer.price); currency = knownCurrency(offer.priceCurrency); }
    if (!(price > 0)) {
      const after = h1 ? text.slice(Math.max(0, text.indexOf(h1))) : text;
      const m = after.match(/\$\s?([\d]{1,3}(?:,\d{3})+|\d{5,})(?:\.\d{2})?\s*(MXN|USD)?/i);
      if (m) { price = Number(m[1].replace(/,/g, '')); currency = knownCurrency(m[2]); }
    }
    currency = currency ?? knownCurrency(this.cfg.currency);

    const ldImages = [].concat(ld?.image ?? []).map(i => (typeof i === 'string' ? i : i?.url)).filter(Boolean);
    // una foto por archivo: WordPress repite cada imagen en tamaños (-300x200, -scaled, -Grande)
    const byBase = new Map();
    // config.photo_path: carpeta de las fotos de autos en ese sitio (WordPress: /wp-content/uploads/)
    const photoPath = new RegExp(this.cfg.photo_path ?? '/wp-content/uploads/', 'i');
    const candidates = [...main.matchAll(/(?:https?:\/\/[^"'\s)]+|(?<=["'(])\/[^"'\s)]+)\.(?:jpe?g|png|webp)/gi)]
      .map(m => { try { return new URL(m[0], url).href; } catch { return null; } })
      .filter(u => u && photoPath.test(new URL(u).pathname));
    for (const u of candidates) {
      if (/logo|icon|favicon|placeholder|banner/i.test(u)) continue;
      const base = u.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '').replace(/-(scaled|grande)(?=\.\w+$)/i, '');
      const resized = /-\d{2,4}x\d{2,4}\.\w+$/.test(u);
      if (!byBase.has(base) || (byBase.get(base).resized && !resized)) byBase.set(base, { u, resized });
    }
    const pageImages = [...byBase.values()].map(x => x.u);
    const photos = ldImages.length ? ldImages : pageImages;

    return {
      external_id, url, title,
      make: f.make || stripHtml(first(ld?.brand)?.name ?? first(ld?.brand) ?? '') || null,
      model: [f.model, title].filter(Boolean).join(' '), version: f.version ?? null,
      year: yearOf(f.year) ?? yearOf(ld?.vehicleModelDate ?? ld?.modelDate) ?? null,
      km: f.km ?? (ld?.mileageFromOdometer ? String(ld.mileageFromOdometer.value ?? ld.mileageFromOdometer) : null) ?? kmInText(`${title}\n${stripHtml(ld?.description ?? '')}`),
      transmission: f.transmission ?? null, color_ext: f.color_ext ?? null, color_int: f.color_int ?? null,
      vin: ld?.vehicleIdentificationNumber ?? f.vin ?? null,
      price: price > 0 && currency ? price : null, currency: price > 0 ? currency : null,
      description: [stripHtml(ld?.description ?? ''), text.slice(0, 4000)].filter(Boolean).join('\n'),
      photos: photos.slice(0, 40),
      city: this.source.cities?.[0] ?? null, seller_type: 'broker', seller_name: this.source.name,
      extra: {},
    };
  }
}

export default source => new FichaAdapter(source);
