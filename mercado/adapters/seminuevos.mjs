// Adaptador · Seminuevos.com
//
// Lista por marca (o marca/modelo): la página trae un ItemList de schema.org
// Vehicle dentro del payload RSC de Next.js (año, km, transmisión, color,
// precio, moneda, URL con id). Con eso basta para los anuncios que ya
// conocemos (actualizar precio y last_seen). Solo los NUEVOS abren su ficha,
// que trae el objeto "vehicle" completo (versión, ciudad, vendedor, fotos,
// descripción). robots.txt: se usan solo rutas /usados/-/autos/-/<marca>.
import { nextFlight, schemaInText, findSchemaObjects, jsonValuesAfterKey } from '../core/extract.mjs';
import { HttpError, HostUnavailable } from '../core/http.mjs';
import { norm } from '../core/text.mjs';

const BASE = 'https://www.seminuevos.com';
const PER_PAGE = 20;

// Búsquedas por defecto: marcas de la taxonomía; en marcas generalistas, solo los modelos de la taxonomía.
export const DEFAULT_SEARCHES = [
  { path: 'porsche', make: 'porsche' }, { path: 'ferrari', make: 'ferrari' }, { path: 'lamborghini', make: 'lamborghini' },
  { path: 'mclaren', make: 'mclaren' }, { path: 'aston+martin', make: 'aston martin' }, { path: 'bentley', make: 'bentley' },
  { path: 'rolls+royce', make: 'rolls royce' }, { path: 'mercedes+benz/clase+g', make: 'mercedes benz' },
  { path: 'mercedes+benz/sls', make: 'mercedes benz' }, { path: 'ford/mustang', make: 'ford' },
  { path: 'chevrolet/corvette', make: 'chevrolet' }, { path: 'jaguar', make: 'jaguar' },
];

const clean = v => (v === '$undefined' || v === '' || v == null ? null : v);

function mapSeller(type, dealerName) {
  const t = norm(type), d = norm(dealerName);
  if (/private|particular|owner|persona/.test(t)) return 'particular';
  if (/agency|dealer|agencia/.test(t)) {
    if (/(porsche|ferrari|lamborghini|mclaren|bentley|rolls|aston|mercedes).*(centre|center|approved|oficial)|(centre|center) (porsche|ferrari)/.test(d)) return 'agencia_oficial';
    return 'broker';
  }
  return 'desconocido';
}

export class SeminuevosAdapter {
  constructor(source) {
    this.source = source;
    this.searches = source.config?.searches ?? DEFAULT_SEARCHES;
    this.maxPages = source.config?.max_pages ?? source.max_pages_per_run ?? 40;
    this.partial = false;
  }

  async *listings(ctx) {
    const seen = new Set();
    for (const s of this.searches) {
      let total = Infinity;
      for (let page = 1; (page - 1) * PER_PAGE < total; page++) {
        if (page > this.maxPages) { this.partial = true; ctx.log(`  · ${s.path}: tope de ${this.maxPages} páginas`); break; }
        const url = `${BASE}/usados/-/autos/-/${s.path}${page > 1 ? `?page=${page}` : ''}`;
        let html;
        try { html = (await ctx.fetcher.get(url)).text; }
        catch (e) {
          if (e instanceof HttpError && e.status === 404) { ctx.log(`  · ${s.path}: la búsqueda no existe (404), se omite`); break; }
          throw e;
        }
        const flight = nextFlight(html);
        total = Number((flight.match(/"total":(\d+)/) || [])[1] ?? 0);
        const items = findSchemaObjects(schemaInText(flight), 'ItemList')
          .flatMap(l => l.itemListElement ?? []).map(e => e.item)
          .filter(i => i?.url?.includes('/vehicle/') && norm(i.brand?.name ?? i.name).startsWith(s.make.split(' ')[0]));
        if (!items.length) break;
        for (const item of items) {
          const id = (item.url.match(/\/(\d+)(?:[/?#]|$)/) || [])[1];
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const light = fromList(item, id);
          if (ctx.isKnown(id) || (ctx.wanted && !ctx.wanted(light))) { yield light; continue; }
          let detail = null;
          try { detail = await this.detail(ctx, item.url, id); } catch (e) { if (e instanceof HostUnavailable) throw e; ctx.log(`  · ficha ${id}: ${e.message} (uso los datos de la lista)`); }
          yield detail ?? light;
        }
      }
    }
  }

  async detail(ctx, url, id) {
    const flight = nextFlight((await ctx.fetcher.get(url)).text);
    const v = jsonValuesAfterKey(flight, 'vehicle').find(x => x && String(x.id) === String(id) && x.brand);
    if (!v) return null;
    const version = clean(v.version);
    return {
      external_id: String(v.id), url,
      title: [v.brand, v.model, version && norm(version) !== 'estandar' ? version : null, v.year].filter(Boolean).join(' '),
      make: v.brand, model: v.model, version: version && norm(version) !== 'estandar' ? version : null, year: v.year,
      km: clean(v.kilometers), transmission: clean(v.transmission), color_ext: clean(v.color), color_int: clean(v.interior),
      body: clean(v.subtype), price: clean(v.price), currency: clean(v.currencyCode), negotiable: v.priceType === 'Negociable',
      city: clean(v.city), state: clean(v.state), seller_type: mapSeller(v.sellerType, v.dealer?.name),
      seller_name: clean(v.dealer?.name), seller_contact: clean(v.dealer?.phone),
      description: [clean(v.description), ...[v.features, v.extras, v.specials].flat().filter(x => typeof x === 'string')].filter(Boolean).join('\n'),
      photos: [...new Set((v.images ?? []).filter(x => typeof x === 'string'))],
      extra: { via: 'ficha', dealer_id: clean(v.dealer?.id), price_type: clean(v.priceType), fuel: clean(v.fuel) },
    };
  }
}

function fromList(item, id) {
  return {
    external_id: id, url: item.url, title: item.name, make: item.brand?.name, model: item.model, year: Number(item.modelDate) || null,
    km: item.mileageFromOdometer?.value ?? null, transmission: item.vehicleTransmission ?? null, color_ext: item.color ?? null,
    price: item.offers?.price ?? null, currency: item.offers?.priceCurrency ?? null,
    photos: item.image ? [].concat(item.image) : [], extra: { via: 'listado' },
  };
}

export default source => new SeminuevosAdapter(source);
