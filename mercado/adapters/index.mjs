// Registro de adaptadores. En sources.yaml, `adapter:` elige uno; si no hay,
// se busca por el id de la fuente. Una fuente sin adaptador se omite (y se avisa).
import seminuevos from './seminuevos.mjs';
import shopify from './shopify.mjs';
import archivoJson from './archivo-json.mjs';

export const adapters = {
  seminuevos,
  shopify,
  'archivo-json': archivoJson,
};
