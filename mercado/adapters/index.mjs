// Registro de adaptadores. En sources.yaml, `adapter:` elige uno; si no hay,
// se busca por el id de la fuente. Una fuente sin adaptador se omite (y se avisa).
import seminuevos from './seminuevos.mjs';
import shopify from './shopify.mjs';
import archivoJson from './archivo-json.mjs';
import ficha from './ficha.mjs';
import { wooStore, vehica, stmListings } from './wordpress.mjs';
import capturas from './capturas.mjs';
import cardealer from './cardealer.mjs';
import nextInventario from './next-inventario.mjs';

export const adapters = {
  seminuevos,
  shopify,
  'archivo-json': archivoJson,
  woocommerce: wooStore,
  vehica,
  'stm-listings': stmListings,
  ficha,
  capturas,
  cardealer,
  'next-inventario': nextInventario,
};
