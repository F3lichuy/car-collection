// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Pipeline de ingesta
//
//   adaptador.listings(ctx)  → descubre, descarga y extrae (anuncios crudos)
//   normalizeListing         → taxonomía, specs, precio, confianza
//   IdentityIndex.resolve    → ¿auto que ya conocemos? (anti-duplicados)
//   Store                    → guarda en una transacción por anuncio
//
// Aislamiento: cada fuente corre en su propio try/catch y deja su corrida en
// mx_runs; si su parser se rompe (muchos errores seguidos) se detiene SOLO esa
// fuente y queda en estado 'error'. Las demás siguen.
// ════════════════════════════════════════════════════════════════════════
import { normalizeListing } from './normalize.mjs';
import { IdentityIndex } from './dedupe.mjs';
import { phash } from './phash.mjs';
import { loadSettings } from './settings.mjs';

export const NORMALIZATION_REVIEW_BELOW = 0.7;
const MAX_PHOTOS_TO_HASH = 6;

export async function runSource({ adapter, source, store, fetcher, today, trigger = 'cron', limit = Infinity, hashPhotos = true, log = console.log }) {
  const r = { fuente: source.id, ok: false, nuevos: 0, actualizados: 0, sin_cambio: 0, fuera_de_taxonomia: 0, unidos_a_auto_existente: 0,
    a_revision_duplicado: 0, a_revision_normalizacion: 0, no_vistos: 0, completa: false, errores: [], resumen: {}, muestras: [] };
  const runId = await store.startRun(source.id, trigger);
  try {
    const settings = loadSettings((await store.db.query(`select key, value from mx_settings`)).rows);
    const index = IdentityIndex.fromRows(await store.loadIndexRows(), settings);
    const known = await store.knownExternalIds(source.id);
    // wanted(): el adaptador lo usa con los datos de la lista para no abrir la
    // ficha de autos que de todos modos quedarían fuera de la taxonomía.
    const ctx = { fetcher, source, today, log, isKnown: id => known.has(String(id)),
      wanted: raw => normalizeListing({ source_id: source.id, observed_on: today, ...raw }).inScope };
    let seen = 0, consecutiveErrors = 0;

    for await (const raw of adapter.listings(ctx)) {
      if (seen >= limit) break;
      seen++;
      try {
        const n = normalizeListing({ source_id: source.id, observed_on: today, ...raw });
        if (!n.inScope) { r.fuera_de_taxonomia++; continue; }
        await ingestOne({ n, store, index, today, hashPhotos, fetcher, r });
        consecutiveErrors = 0;
      } catch (e) {
        consecutiveErrors++;
        r.errores.push({ url: raw?.url ?? null, error: e.message });
        log(`  ✗ ${raw?.url ?? '?'}: ${e.message}`);
        if (consecutiveErrors >= 10) throw new Error(`10 errores seguidos: el parser de ${source.id} parece roto (${e.message})`);
      }
    }
    r.completa = seen < limit && !adapter.partial;
    // Solo si la corrida recorrió todo: los activos que no aparecieron.
    if (r.completa) r.no_vistos = await store.notSeenSince(source.id, today);
    r.ok = true;
  } catch (e) {
    r.fatal = e.message;
    r.errores.push({ error: e.message });
    log(`✗ ${source.id}: ${e.message}`);
  }
  r.resumen = { ...pick(r, ['nuevos', 'actualizados', 'sin_cambio', 'fuera_de_taxonomia', 'unidos_a_auto_existente', 'a_revision_duplicado', 'a_revision_normalizacion', 'no_vistos', 'completa']),
    peticiones: fetcher?.requests ?? null };
  await store.finishRun(runId, source.id, r);
  return r;
}

async function ingestOne({ n, store, index, today, hashPhotos, fetcher, r }) {
  const existing = await store.findListing(store.db, n.listing);
  if (existing) {
    const res = await store.db.transaction(async tx => {
      await store.touchListing(tx, existing.id, n.listing, today);
      if (n.private.description || n.private.seller_name) await store.upsertPrivate(tx, existing.id, n.private);
      await store.upsertSpecs(tx, existing.vehicle_id, existing.id, n.specs);
      return store.recordPrice(tx, existing.id, n.price, today);
    });
    if (res === 'nuevo') r.actualizados++; else r.sin_cambio++;
    return;
  }

  // Fotos: se hashean antes de decidir identidad (los brokers reusan fotos).
  const photos = n.photos.map(url => ({ url }));
  if (hashPhotos && fetcher) {
    for (const p of photos.slice(0, MAX_PHOTOS_TO_HASH)) {
      try { Object.assign(p, await phash((await fetcher.get(p.url, { as: 'buffer', accept: 'image/*', checkRobots: false, minDelayMs: 500 })).buffer)); }
      catch { /* foto caída: se guarda sin hash y se reintenta en otra corrida */ }
    }
  }

  const decision = index.resolve({ ...n.vehicle, is_demo: false, specs: n.specs, photos: photos.filter(p => p.hash != null), listing: n.listing });
  const result = await store.db.transaction(async tx => {
    let vehicleId, isNewVehicle = false;
    if (decision.action === 'match') vehicleId = decision.vehicleId;
    else { vehicleId = await store.insertVehicle(tx, n.vehicle); isNewVehicle = true; }
    const listingId = await store.insertListing(tx, vehicleId, n.listing, today);
    await store.upsertPrivate(tx, listingId, n.private);
    await store.upsertSpecs(tx, vehicleId, listingId, n.specs, { canonical: isNewVehicle });
    await store.insertPhotos(tx, listingId, photos);
    await store.recordPrice(tx, listingId, n.price, today);
    let dupReviews = 0;
    for (const rv of decision.reviews) {
      const a = rv.pairWith ?? vehicleId;
      if (await store.enqueueDuplicate(tx, a, rv.vehicleId, rv.score, rv.reasons, { listing_id: listingId, decision: decision.action })) dupReviews++;
    }
    let normReview = false;
    if (n.confidence < NORMALIZATION_REVIEW_BELOW || n.issues.some(i => /imposible|ambigua|vin_invalido|varios_vin/.test(i))) {
      await store.enqueueNormalization(tx, listingId, { reasons: [...n.issues, ...n.unresolved.map(u => `sin_${u}`)], confidence: n.confidence, inferred: n.inferred }, n.confidence);
      normReview = true;
    }
    return { vehicleId, listingId, isNewVehicle, dupReviews, normReview };
  });

  // El índice aprende en la misma corrida (el mismo auto dos veces en una fuente).
  const hashed = photos.filter(p => p.hash != null).map(p => ({ hash: p.hash, center: p.center, lowInfo: p.lowInfo }));
  if (result.isNewVehicle) index.addVehicle({ id: result.vehicleId, ...n.vehicle, is_demo: false, created_at: new Date().toISOString(), specs: n.specs, photos: hashed, listings: [n.listing] });
  else index.addEvidence(result.vehicleId, { photos: hashed, listings: [n.listing] });

  r.nuevos++;
  if (!result.isNewVehicle) r.unidos_a_auto_existente++;
  r.a_revision_duplicado += result.dupReviews;
  if (result.normReview) r.a_revision_normalizacion++;
  if (r.muestras.length < 12) r.muestras.push({ titulo: n.listing.title, version: n.vehicle.version_id, anio: n.specs.year, km: n.specs.km,
    precio: n.price?.price ?? null, moneda: n.price?.currency ?? null, transmision: n.specs.transmission, confianza: n.confidence,
    identidad: decision.action === 'match' ? `mismo auto (${decision.reason})` : decision.reviews.length ? 'nuevo · a revisión' : 'nuevo' });
}

const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o[k]]));

// Corre varias fuentes, una tras otra; ninguna tumba a las demás.
export async function runAll({ sources, adapters, store, makeFetcher, today, trigger, limit, hashPhotos, log = console.log }) {
  const reports = [];
  for (const source of sources) {
    const adapter = adapters[source.adapter ?? source.id];
    if (!adapter) { log(`· ${source.id}: sin adaptador todavía (se omite)`); continue; }
    log(`▶ ${source.id}`);
    const fetcher = makeFetcher(source);
    reports.push(await runSource({ adapter: adapter(source), source, store, fetcher, today, trigger, limit, hashPhotos, log }));
  }
  return reports;
}
