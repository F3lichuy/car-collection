// Todos los días a las 06:17 de CDMX (12:17 UTC): la carga completa de las agencias.
// Si el horario propio de GitHub ya la corrió hoy, no la repite.
import { dispatch, ranSince } from '../lib/disparar.mjs';

export default async () => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    if (await ranSince('mercado-ingesta.yml', `${today}T12:00:00Z`)) {
      console.log('ingesta diaria: GitHub ya la corrió hoy; no se repite');
      return new Response('ya corrió');
    }
    await dispatch('mercado-ingesta.yml');
    console.log('ingesta diaria: corrida pedida a GitHub');
    return new Response('ok');
  } catch (e) {
    console.error(`ingesta diaria: ${e.message}`);
    return new Response(e.message, { status: 500 });
  }
};

export const config = { schedule: '17 12 * * *' };
