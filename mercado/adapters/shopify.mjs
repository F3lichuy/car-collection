// Adaptador genérico · tiendas Shopify (p. ej. EuroClassic Import)
//
// Shopify publica /products.json (catálogo estructurado) y /meta.json (moneda
// de la tienda). Sin HTML que adivinar. Los productos agotados ("available":
// false) no se toman como activos: si desaparecen, la Fase 5 lo interpreta.
import { stripHtml } from '../core/extract.mjs';

export class ShopifyAdapter {
  constructor(source) { this.source = source; this.base = new URL(source.base_url).origin; this.partial = false; this.maxPages = source.config?.max_pages ?? 20; }

  async *listings(ctx) {
    let currency = null;
    try { currency = JSON.parse((await ctx.fetcher.get(`${this.base}/meta.json`, { accept: 'application/json' })).text).currency ?? null; } catch { /* sin meta */ }
    if (!/^(MXN|USD)$/.test(currency ?? '')) ctx.log(`  · ${this.source.id}: moneda de la tienda desconocida (${currency}); los precios quedan sin moneda`);
    for (let page = 1; ; page++) {
      if (page > this.maxPages) { this.partial = true; break; }
      // config.collection: solo esa colección (p. ej. EuroClassic: "autos-disponibles-en-mexico",
      // para no mezclar autos que siguen en el extranjero con precios de otros mercados).
      const path = this.source.config?.collection ? `/collections/${encodeURIComponent(this.source.config.collection)}/products.json` : '/products.json';
      const j = JSON.parse((await ctx.fetcher.get(`${this.base}${path}?limit=250&page=${page}`, { accept: 'application/json' })).text);
      const products = j.products ?? [];
      if (!products.length) break;
      for (const p of products) {
        const v = p.variants?.[0] ?? {};
        if (v.available === false) continue;
        const tags = (Array.isArray(p.tags) ? p.tags : String(p.tags ?? '').split(',')).map(t => t.trim()).filter(Boolean);
        const tagText = [tags.includes('importacion') ? 'importado' : null, `Etiquetas: ${tags.join(', ')}`].filter(Boolean).join('. ');
        yield {
          external_id: String(p.id), url: `${this.base}/products/${p.handle}`, title: p.title,
          // La marca sale del título (lo escribe la persona); vendor/product_type de
          // Shopify a veces vienen mal puestos y sacarían el auto de la taxonomía.
          make: null, model: p.title,
          year: yearFromTitle(p.title),
          price: v.price != null && /^(MXN|USD)$/.test(currency ?? '') ? Number(v.price) : null, currency: /^(MXN|USD)$/.test(currency ?? '') ? currency : null,
          // "compare at": el precio tachado que muestra la tienda
          list_price: Number(v.compare_at_price) > Number(v.price) ? Number(v.compare_at_price) : null,
          description: `${stripHtml(p.body_html)}\n${tagText}`,
          photos: (p.images ?? []).map(i => i.src).filter(Boolean),
          published_on: p.published_at ?? p.created_at ?? null,   // cuándo la tienda lo puso a la venta
          city: this.source.cities?.[0] ?? null, seller_type: 'broker', seller_name: this.source.name,
          extra: { tags, vendor: p.vendor ?? null, product_type: p.product_type ?? null, shopify_updated_at: p.updated_at },
        };
      }
      if (products.length < 250) break;
    }
  }
}

// "Alfa Romeo Spider 2000 1978": el año modelo es el ÚLTIMO número con forma de año, no el "2000" del nombre.
export function yearFromTitle(t) {
  const all = [...String(t ?? '').matchAll(/\b(19[4-9]\d|20[0-3]\d)\b/g)].map(m => Number(m[1]));
  return all.length ? all[all.length - 1] : null;
}

export default source => new ShopifyAdapter(source);
