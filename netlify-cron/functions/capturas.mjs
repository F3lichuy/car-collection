// Cada 10 minutos: le pide a GitHub correr "Mercado MX · capturas". Si no guardaste autos nuevos,
// esa corrida termina sola en menos de un minuto sin tocar nada.
import { dispatch } from '../lib/disparar.mjs';

export default async () => {
  try {
    await dispatch('mercado-capturas.yml');
    console.log('capturas: corrida pedida a GitHub');
    return new Response('ok');
  } catch (e) {
    console.error(`capturas: ${e.message}`);
    return new Response(e.message, { status: 500 });
  }
};

export const config = { schedule: '*/10 * * * *' };
