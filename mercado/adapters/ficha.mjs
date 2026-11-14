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
// texto de JSON-LD; "—" o vacío = sin dato
const ldText = v => { const s = stripHtml(String(v ?? '')).trim(); return s && !/^[—–\-]+$/.test(s) ? s : null; };
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
// "25/Octubre/2023" o "25 de octubre de 2023" → "2023-10-25"; lo demás, null
export function spanishDate(s) {
  const m = String(s ?? '').toLowerCase().match(/(\d{1,2})\s*(?:\/|\s+de\s+|\s+)\s*([a-záé]+)\s*(?:\/|\s+de\s+|\s+)\s*(\d{4})/);
  const mm = m && MESES[m[2]];
  return mm ? `${m[3]}-${String(mm).padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}
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
    this.cityRe = this.cfg.city_re ? new RegExp(this.cfg.city_re, 'i') : null;
    this.publishedRe = this.cfg.published_re ? new RegExp(this.cfg.published_re, 'i') : null;
  }

  async urls(ctx) {
    const out = new Set();
    // sin sitemap: config.list_pages = páginas de inventario cuyos enlaces son los autos
    const sitemaps = this.cfg.sitemaps ?? (this.cfg.list_pages ? [] : ['/sitemap.xml']);
    const getLocs = async p => sitemapLocs((await ctx.fetcher.get(new URL(p, this.base).href, { accept: 'application/xml,text/xml' })).text);
    for (const p of sitemaps) {
      for (const u of await getLocs(p)) {
        // índice de sitemaps (Wix: uno por sección): se abre un nivel más
        if (this.cfg.sitemap_index && /\.xml(\?|$)/i.test(u)) { for (const v of await getLocs(u)) if (this.include.test(v)) out.add(v); }
        else if (this.include.test(u)) out.add(u);
      }
    }
    for (const p of this.cfg.list_pages ?? []) {
      let html = (await ctx.fetcher.get(new URL(p, this.base).href)).text;
      // config.list_sold: { split, marker } → en la lista, las tarjetas con la marca de vendido se quitan
      // (Iconic Broker: <div class="car-status sold">Vendido</div> solo en la lista, no en la ficha)
      if (this.cfg.list_sold) html = html.split(this.cfg.list_sold.split).filter(chunk => !chunk.includes(this.cfg.list_sold.marker)).join(' ');
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
      // config.open_all: el slug no trae la marca ("911-carrera-1975"): se abren todas (solo en sitios chicos)
      if (!this.cfg.open_all && /[a-z]/i.test(slug) && !ctx.isKnown(external_id) && ctx.wanted && !ctx.wanted({ title: slug.replace(/[-_]+/g, ' ') })) {
        yield { external_id, url, title: slug.replace(/[-_]+/g, ' ') };   // el pipeline la cuenta como fuera de taxonomía
        continue;
      }
      let html;
      try { html = (await ctx.fetcher.get(url)).text; }
      catch (e) {
        // ficha que ya no existe (el sitemap a veces trae autos retirados): se salta, no tumba la fuente
        if (e.status === 404 || e.status === 410) { ctx.log?.(`    ${e.status} ${url} · ficha retirada`); continue; }
        throw e;
      }
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
    // config.title_re: el <h1> del sitio es un letrero ("DEPORTIVOS" en Wix) y el nombre del auto va en el texto
    const titleRe = this.cfg.title_re ? text.match(new RegExp(this.cfg.title_re, 'i'))?.[1]?.replace(/\s+/g, ' ').trim() : null;
    const title = titleRe || h1 || stripHtml(ld?.name ?? html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').replace(/\s+[-|–]\s+[^-|–]+$/, '');
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
    // precio tachado junto al título (WooCommerce: <del>$5,559,000</del> <ins>$5,189,000</ins>)
    const near = h1At > 0 ? main.slice(h1At, h1At + 4000) : '';
    const delM = stripHtml(near.match(/<del[^>]*>([\s\S]*?)<\/del>/i)?.[1] ?? '').match(/([\d]{1,3}(?:,\d{3})+|\d{5,})/);
    const listPrice = delM ? Number(delM[1].replace(/,/g, '')) : null;

    // Prestige DLC publica "https://prestigedlc.comhttps://…blob…": se toma la URL de adentro
    const ldImages = [].concat(ld?.image ?? []).map(i => (typeof i === 'string' ? i : i?.url)).filter(Boolean)
      .map(u => String(u).replace(/^https?:\/\/[^/]+(?=https?:\/\/)/i, ''));
    // una foto por archivo: WordPress repite cada imagen en tamaños (-300x200, -scaled, -Grande) y YOOtheme
    // (Joomla) la sirve desde /templates/yootheme/cache/ en varios anchos (IMG_1663-43bfb088.jpeg, -b4250055…).
    // De cada una se queda la más grande: el ancho del srcset si lo dice; si no, la original sobre la recortada.
    const byBase = new Map();
    // config.photo_path: carpeta de las fotos de autos en ese sitio (WordPress: /wp-content/uploads/)
    const photoPath = new RegExp(this.cfg.photo_path ?? '/wp-content/uploads/', 'i');
    const abs = u => { try { return new URL(u.replace(/&amp;/g, '&'), url).href; } catch { return null; } };
    const found = [];
    // srcset / data-srcset: "ruta 768w, ruta 1024w"
    for (const m of main.matchAll(/(?:data-)?srcset=["']([^"']+)["']/gi))
      for (const part of m[1].split(',')) { const [u, d] = part.trim().split(/\s+/); if (u) found.push({ u: abs(u), w: Number(String(d ?? '').replace(/w$/, '')) || null }); }
    for (const m of main.matchAll(/(?:https?:\/\/[^"'\s)]+|(?<=["'(])\/[^"'\s)]+)\.(?:jpe?g|png|webp)/gi)) found.push({ u: abs(m[0]), w: null });
    for (const { u, w } of found) {
      if (!u || !photoPath.test(new URL(u).pathname) || /logo|icon|favicon|placeholder|banner/i.test(u)) continue;
      const cache = /\/cache\//i.test(u);
      const base = u.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '').replace(/-(scaled|grande)(?=\.\w+$)/i, '').replace(cache ? /-[0-9a-f]{8}(?=\.\w+$)/i : /$^/, '');
      const resized = /-\d{2,4}x\d{2,4}\.\w+$/.test(u);
      const score = w ?? (resized ? 0 : cache ? 1 : 1e6);
      const prev = byBase.get(base);
      if (!prev || score > prev.score) byBase.set(base, { u, score, order: prev?.order ?? byBase.size });
    }
    const pageImages = [...byBase.values()].sort((x, y) => x.order - y.order).map(x => x.u);
    // config.photos: "og" = solo la foto de portada (og:image), para sitios donde las demás imágenes son del diseño
    const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ?? null;
    const photos = this.cfg.photos === 'og' ? [ogImage].filter(Boolean) : ldImages.length ? ldImages : pageImages;

    return {
      external_id, url, title,
      make: f.make || stripHtml(first(ld?.brand)?.name ?? first(ld?.brand) ?? '') || null,
      model: [f.model, title].filter(Boolean).join(' '), version: f.version ?? null,
      year: yearOf(f.year) ?? yearOf(ld?.vehicleModelDate ?? ld?.modelDate) ?? null,
      km: f.km ?? (ld?.mileageFromOdometer ? String(ld.mileageFromOdometer.value ?? ld.mileageFromOdometer) : null) ?? kmInText(`${title}\n${stripHtml(ld?.description ?? '')}`),
      transmission: f.transmission ?? ldText(ld?.vehicleTransmission), color_ext: f.color_ext ?? ldText(ld?.color),
      color_int: f.color_int ?? ldText(ld?.vehicleInteriorColor),
      vin: ld?.vehicleIdentificationNumber ?? f.vin ?? null,
      price: price > 0 && currency ? price : null, currency: price > 0 ? currency : null,
      list_price: price > 0 && listPrice > price ? listPrice : null,
      description: [stripHtml(ld?.description ?? ''), text.slice(0, 4000)].filter(Boolean).join('\n'),
      photos: photos.slice(0, 40),
      // fecha de publicación que declara la página (JSON-LD del auto o de la página, o la meta de WordPress/Yoast)
      published_on: ld?.datePosted ?? ld?.datePublished ?? findSchemaObjects(jsonLdBlocks(html), ['WebPage', 'ItemPage'])[0]?.datePublished
        ?? html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i)?.[1]
        ?? (this.publishedRe ? spanishDate(`${text}\n${stripHtml(ld?.description ?? '')}`.match(this.publishedRe)?.[1]) : null) ?? null,
      // config.city_re: la ciudad viene en cada ficha (portales nacionales: "Ubicación: Guadalajara, Jalisco")
      city: (this.cityRe ? `${text}\n${stripHtml(ld?.description ?? '')}`.match(this.cityRe)?.[1]?.trim() : null)
        ?? ('city' in this.cfg ? this.cfg.city : this.source.cities?.[0] ?? null),
      seller_type: this.cfg.seller_type ?? 'broker', seller_name: this.source.name,
      extra: {},
    };
  }
}

export default source => new FichaAdapter(source);
