// Adaptador · inventario en __NEXT_DATA__ de un sitio Next.js (GM Motors)
//
// La página de inventario trae todos los autos en el JSON que Next.js manda con la página
// (props.pageProps.vehicles): marca, modelo, año, versión, km, precio, transmisión y foto.
// Solo para los autos nuevos que sí están en la taxonomía se abre la ficha
// (props.pageProps.vehicle): color, combustible, estado, factura y todas las fotos.
//
// config:
//   list_page: /inventario      list_key: vehicles
//   detail: /auto/{id}          detail_key: vehicle
//   currency: MXN               el sitio no declara moneda; se fija a mano con una nota en sources.yaml
import { nextData } from '../core/extract.mjs';

const TRANS = { automatic: 'Automática', manual: 'Manual' };
const photosOf = v => [...(v.vehicle_media ?? [])]
  .filter(m => m && m.is_active !== false && (m.media_type ?? 'photo') === 'photo' && m.file_url)
  .sort((a, b) => (b.is_primary === true) - (a.is_primary === true) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
  .map(m => m.file_url);

export class NextInventarioAdapter {
  constructor(source) {
    this.source = source; this.base = new URL(source.base_url).origin; this.partial = false;
    this.cfg = { list_page: '/inventario', list_key: 'vehicles', detail: '/auto/{id}', detail_key: 'vehicle', ...(source.config ?? {}) };
  }

  map(v) {
    const currency = /^(MXN|USD)$/.test(this.cfg.currency ?? '') ? this.cfg.currency : null;
    const price = Number(v.public_price ?? v.price) || null;
    const title = [v.brand, v.model, v.version, v.year].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    return {
      external_id: String(v.id), url: `${this.base}${this.cfg.detail.replace('{id}', encodeURIComponent(v.id))}`, title,
      make: v.brand ?? null, model: [v.model, v.version].filter(Boolean).join(' '), version: v.version ?? null,
      year: Number(v.year) || null, km: v.mileage != null ? String(v.mileage) : null,
      transmission: TRANS[v.transmission] ?? v.transmission ?? null, color_ext: v.color ?? null,
      price: price && currency ? price : null, currency: price && currency ? currency : null,
      description: [v.description_public, v.engine && `Motor ${v.engine}${v.cylinders ? ` · ${v.cylinders} cilindros` : ''}`,
        v.fuel_type && `Combustible: ${v.fuel_type}`, v.invoice_type && `Factura: ${v.invoice_type}`, v.origin && `Procedencia: ${v.origin}`]
        .filter(Boolean).join('\n'),
      photos: photosOf(v).slice(0, 40),
      city: this.source.cities?.[0] ?? null, seller_type: 'broker', seller_name: this.source.name,
      extra: { stock_code: v.stock_code ?? null, estado: v.status ?? v.operational_status ?? null },
    };
  }

  async *listings(ctx) {
    const page = nextData((await ctx.fetcher.get(this.base + this.cfg.list_page)).text);
    const list = page?.props?.pageProps?.[this.cfg.list_key];
    if (!Array.isArray(list)) throw new Error(`no encontré props.pageProps.${this.cfg.list_key} en ${this.cfg.list_page} (¿cambió el sitio?)`);
    if (!this.cfg.currency) ctx.log(`  · ${this.source.id}: sin config.currency; los precios quedan sin moneda`);
    for (const v of list) {
      if (!v?.id) continue;
      if (v.status && v.status !== 'available') continue;
      const raw = this.map(v);
      // conocidos: basta la lista (precio y km del día). Fuera de taxonomía: no se abre la ficha.
      if (ctx.isKnown(raw.external_id) || (ctx.wanted && !ctx.wanted(raw))) { yield raw; continue; }
      let d = null;
      try { d = nextData((await ctx.fetcher.get(raw.url)).text)?.props?.pageProps?.[this.cfg.detail_key] ?? null; }
      catch (e) { if (e.status === 404 || e.status === 410) continue; throw e; }
      if (d?.status && d.status !== 'available') continue;   // apartado o vendido
      yield d ? this.map({ ...v, ...d }) : raw;
    }
  }
}

export default source => new NextInventarioAdapter(source);
