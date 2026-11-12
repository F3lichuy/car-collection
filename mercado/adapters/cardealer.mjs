// Adaptador · tema "Car Dealer" de Potenza para WordPress (Euromotors)
//
// No tiene API ni JSON-LD, pero la ficha es muy ordenada:
//   <li class="car_year"><span>Año</span> <strong>1985</strong></li> … (car_make, car_mileage, car_transmission…)
//   <div class="price car-price …"><bdi class="new-price"><span class="currency currency-MXN">$</span>1,500,000.00</bdi>
//   (los "vehículos relacionados" usan "car-price related-slider": se ignoran)
// Las URLs salen del sitemap (config.sitemaps / include), igual que el adaptador ficha.
//
// config: sitemaps, include (como ficha) · city (null si el sitio no dice en qué sucursal está cada auto)
import { FichaAdapter } from './ficha.mjs';
import { stripHtml } from '../core/extract.mjs';

const FIELD = {
  car_year: 'year', car_make: 'make', car_model: 'model', car_trim: 'version', car_mileage: 'km',
  car_transmission: 'transmission', car_exterior_color: 'color_ext', car_interior_color: 'color_int',
  car_vin_number: 'vin', car_body_style: 'body', car_engine: 'engine',
};
// trozo de la página que ocupa un widget de Elementor (hasta el siguiente widget)
const widget = (html, name) => {
  const i = html.indexOf(`elementor-widget-cdhl_${name}`);
  if (i < 0) return '';
  const j = html.indexOf('elementor-widget-cdhl_', i + 30);
  return html.slice(i, j < 0 ? undefined : j);
};

export class CarDealerAdapter extends FichaAdapter {
  parse(html, url, external_id) {
    const a = {};
    for (const m of html.matchAll(/<li class="(car_[a-z_]+)"[^>]*>\s*<span>[^<]*<\/span>\s*<strong[^>]*>([\s\S]*?)<\/strong>/g)) {
      const k = FIELD[m[1]], v = stripHtml(m[2]).trim();
      if (k && v && !a[k]) a[k] = v;
    }
    // precio del auto (no el de los relacionados)
    const block = [...html.matchAll(/<div class="price car-price(?![^"]*related)[^"]*">([\s\S]*?)<\/div>/g)][0]?.[1] ?? '';
    if (/class="[^"]*\bsold\b|vendido/i.test(block)) return null;
    const pm = block.match(/<bdi class="new-price">\s*<span class="currency currency-([A-Z]{3})">[^<]*<\/span>\s*([\d,]+)(?:\.\d+)?/)
      ?? block.match(/<span class="currency currency-([A-Z]{3})">[^<]*<\/span>\s*([\d,]+)/);
    const currency = /^(MXN|USD)$/.test(pm?.[1] ?? '') ? pm[1] : null;
    const price = pm ? Number(pm[2].replace(/,/g, '')) : null;

    const title = stripHtml(html.match(/<h3 class="vehicle-title">([\s\S]*?)<\/h3>/)?.[1]
      ?? html.match(/<meta property="og:title" content="([^"]+)"/)?.[1] ?? '').trim();
    if (!title) return null;

    // fotos: solo la galería del auto, una por archivo (sin la copia -876x535)
    const gallery = widget(html, 'vehicle-gallery') || html.match(/<div[^>]+class="[^"]*slider-for[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
    const seen = new Map();
    for (const [u] of gallery.matchAll(/https?:\/\/[^"'\s)]+\/wp-content\/uploads\/[^"'\s)]+\.(?:jpe?g|png|webp)/gi)) {
      const base = u.replace(/-\d{2,4}x\d{2,4}(?=\.\w+$)/, '');
      if (!seen.has(base) || /-\d{2,4}x\d{2,4}\.\w+$/.test(seen.get(base))) seen.set(base, u);
    }
    // la ficha no trae texto libre útil (las pestañas son el mapa de la sucursal): solo carrocería y motor

    return {
      external_id, url, title,
      make: a.make ?? null, model: [a.model, title].filter(Boolean).join(' '), version: a.version ?? null,
      year: Number(a.year) || null, km: a.km ?? null, transmission: a.transmission ?? null,
      color_ext: a.color_ext ?? null, color_int: a.color_int ?? null, vin: a.vin ?? null,
      price: price > 0 && currency ? price : null, currency: price > 0 ? currency : null,
      description: [a.body && `Carrocería: ${a.body}`, a.engine && `Motor: ${a.engine}`].filter(Boolean).join('\n') || null,
      photos: [...seen.values()].slice(0, 40),
      published_on: html.match(/<meta[^>]+property=["']article:published_time["'][^>]+content=["']([^"']+)/i)?.[1] ?? null,
      city: 'city' in this.cfg ? this.cfg.city : this.source.cities?.[0] ?? null,
      seller_type: 'broker', seller_name: this.source.name, extra: {},
    };
  }
}

export default source => new CarDealerAdapter(source);
