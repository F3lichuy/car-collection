// Procesa las capturas pendientes del botón "Guardar en Precio de Calle".
// Cada captura pasa por el mismo pipeline que las fuentes web (normalizador +
// anti-duplicados) y queda marcada 'procesada' (con el resumen) o 'error'.
// Una captura rota no detiene a las demás.
// Se toman una por una ('pendiente' → 'procesando'): la corrida diaria y la de cada ~10 minutos
// nunca procesan la misma captura. Una que se quedó 'procesando' más de una hora (proceso caído)
// se vuelve a tomar.
import { runAll } from './pipeline.mjs';

const claim = async db => (await db.query(`update mx_capturas set status = 'procesando', claimed_at = now()
  where id = (select id from mx_capturas
              where status = 'pendiente' or (status = 'procesando' and claimed_at < now() - interval '1 hour')
              order by id limit 1 for update skip locked)
  returning id, source_id, page_url, items`)).rows[0] ?? null;

export async function processCapturas({ db, store, sources, adapters, makeFetcher, today, hashPhotos = true, log = console.log, max = 50 }) {
  const reports = [];
  for (let i = 0; i < max; i++) {
    const c = await claim(db);
    if (!c) break;
    const items = typeof c.items === 'string' ? JSON.parse(c.items) : c.items;
    const base = sources.find(s => s.id === c.source_id) ?? { id: c.source_id, name: c.source_id };
    const src = { ...base, adapter: 'capturas', config: { items, captura_id: Number(c.id), page_url: c.page_url } };
    let r;
    try {
      [r] = await runAll({ sources: [src], adapters, store, makeFetcher, today, trigger: 'manual', hashPhotos, log });
    } catch (e) {
      r = { fuente: c.source_id, ok: false, fatal: e.message, resumen: {} };
    }
    await db.query(`update mx_capturas set status = $2, processed_at = now(), result = $3::jsonb where id = $1`,
      [c.id, r?.ok ? 'procesada' : 'error', JSON.stringify(r?.ok ? r.resumen : { error: r?.fatal ?? 'sin adaptador' })]);
    if (r) reports.push({ ...r, fuente: `${c.source_id} (captura ${c.id})` });
  }
  return reports;
}

// ¿Cuántas esperan? (para que la corrida de cada ~10 minutos no haga nada si no hay)
export async function pendingCapturas(db) {
  return (await db.query(`select count(*)::int n from mx_capturas
    where status = 'pendiente' or (status = 'procesando' and claimed_at < now() - interval '1 hour')`)).rows[0].n;
}
