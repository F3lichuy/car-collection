// Acceso a la base para el pipeline. Una interfaz mínima { query, transaction }
// que funciona igual con Supabase (postgres.js) y con PGlite (pruebas / corrida
// en seco). Todo el SQL del pipeline vive aquí.

export const fromPglite = db => ({
  query: (sql, params = []) => db.query(sql, params),
  transaction: fn => db.transaction(tx => fn({ query: (s, p = []) => tx.query(s, p) })),
  close: () => db.close?.(),
});

export const fromPostgres = sql => ({
  query: async (text, params = []) => ({ rows: await sql.unsafe(text, params) }),
  transaction: fn => sql.begin(tx => fn({ query: async (t, p = []) => ({ rows: await tx.unsafe(t, p) }) })),
  close: () => sql.end({ timeout: 5 }),
});

const one = async (db, sql, p) => (await db.query(sql, p)).rows[0] ?? null;

export class Store {
  constructor(db) { this.db = db; }

  // ── fuentes y corridas ────────────────────────────────────────────────
  async syncSources(list) {
    for (const s of list) {
      await this.db.query(`
        insert into mx_sources (id, name, kind, base_url, capture_mode, enabled, status, config, notes)
        values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
        on conflict (id) do update set name = excluded.name, kind = excluded.kind, base_url = excluded.base_url,
          capture_mode = excluded.capture_mode, enabled = excluded.enabled, config = excluded.config, notes = excluded.notes,
          status = case when mx_sources.status = 'pendiente' or excluded.status in ('captura_manual','desactivada')
                        then excluded.status else mx_sources.status end`,
        [s.id, s.name, s.kind, s.base_url ?? null, s.capture_mode, !!s.enabled,
          s.capture_mode === 'manual' ? 'captura_manual' : s.enabled ? 'pendiente' : 'desactivada',
          JSON.stringify(s.config ?? {}), [s.data, s.verify, s.notes].filter(Boolean).join(' · ') || null]);
    }
  }

  async startRun(sourceId, trigger) {
    return (await one(this.db, `insert into mx_runs (source_id, trigger) values ($1, $2) returning id`, [sourceId, trigger])).id;
  }

  async finishRun(runId, sourceId, r) {
    await this.db.query(`update mx_runs set finished_at = now(), ok = $2, new_listings = $3, updated_listings = $4,
        disappeared_listings = $5, errors = $6, error_log = $7::jsonb, notes = $8 where id = $1`,
      [runId, r.ok, r.nuevos, r.actualizados, r.no_vistos, r.errores.length, JSON.stringify(r.errores.slice(0, 50)), JSON.stringify(r.resumen)]);
    await this.db.query(`update mx_sources set last_run_at = now(),
        last_success_at = case when $2 then now() else last_success_at end,
        status = case when $2 then 'ok' else 'error' end,
        last_error = case when $2 then null else $3 end,
        consecutive_failures = case when $2 then 0 else consecutive_failures + 1 end
      where id = $1`, [sourceId, r.ok, r.fatal ?? (r.errores[0]?.error ?? null)]);
  }

  // ── índice de identidad ───────────────────────────────────────────────
  async loadIndexRows() {
    const q = async s => (await this.db.query(s)).rows;
    return {
      // los borrados siguen en el índice: si su anuncio vuelve a salir, se reconoce y sigue oculto
      vehicles: await q(`select id, vin, model_id, generation_id, version_id, is_demo, created_at::text, deleted_at is not null as deleted
                         from mx_vehicles where merged_into is null`),
      // precios en pesos de sus anuncios (para "mismos km y mismo precio")
      prices: await q(`select distinct l.vehicle_id, p.price::float8 as price from mx_listings l join mx_price_snapshots p on p.listing_id = l.id
                       where p.currency = 'MXN' and p.price is not null`),
      specs: await q(`select vehicle_id, is_canonical, year, km, observed_on::text, exterior_color, exterior_color_family,
                             interior_color, interior_color_family, transmission, body from mx_specs where is_canonical`),
      photos: await q(`select id, vehicle_id, phash::text, phash_center::text, low_info from mx_photos where phash is not null`),
      // color estimado de las primeras fotos de cada anuncio (008)
      photoColors: await q(`select vehicle_id, listing_id, position, color_family from mx_photos where color_checked and position <= 2`),
      listings: await q(`select vehicle_id, url_canonical, source_id, external_id from mx_listings`),
      distinctPairs: await q(`select vehicle_a, vehicle_b from mx_distinct_pairs`),
    };
  }

  async knownExternalIds(sourceId) {
    return new Set((await this.db.query(`select external_id from mx_listings where source_id = $1 and external_id is not null`, [sourceId])).rows.map(r => r.external_id));
  }

  async findListing(db, { source_id, external_id, url_canonical }) {
    return one(db, `select id, vehicle_id, status from mx_listings
                    where (source_id = $1 and external_id = $2) or (url_canonical is not null and url_canonical = $3)
                    order by (source_id = $1 and external_id = $2) desc limit 1`,
      [source_id, external_id, url_canonical]);
  }

  // ── escritura de un anuncio (dentro de una transacción) ───────────────
  async insertVehicle(db, v) {
    return (await one(db, `insert into mx_vehicles (model_id, generation_id, version_id, vin) values ($1, $2, $3, $4) returning id`,
      [v.model_id, v.generation_id, v.version_id, v.vin])).id;
  }

  async insertListing(db, vehicleId, l, day) {
    return (await one(db, `insert into mx_listings (vehicle_id, source_id, capture_method, external_id, url, url_canonical, title,
        city, state, seller_type, first_seen, last_seen, published_on) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12) returning id`,
      [vehicleId, l.source_id, l.capture_method, l.external_id, l.url, l.url_canonical, l.title, l.city, l.state, l.seller_type, day, l.published_on ?? null])).id;
  }

  async touchListing(db, listingId, l, day) {
    await db.query(`update mx_listings set last_seen = greatest(last_seen, $2::date), first_seen = least(first_seen, $2::date),
        title = coalesce($3, title), city = coalesce($4, city), state = coalesce($5, state),
        published_on = coalesce(published_on, $6::date),   -- la primera fecha que dio la fuente no se reescribe
        status = case when status in ('desaparecido') then 'activo' else status end,
        status_changed_at = case when status in ('desaparecido') then now() else status_changed_at end
      where id = $1`, [listingId, day, l.title, l.city, l.state, l.published_on ?? null]);
  }

  async upsertPrivate(db, listingId, p) {
    if (!p) return;
    await db.query(`insert into mx_listing_private (listing_id, seller_name, seller_contact, description, raw)
        values ($1, $2, $3, $4, $5::jsonb)
      on conflict (listing_id) do update set seller_name = coalesce(excluded.seller_name, mx_listing_private.seller_name),
        seller_contact = coalesce(excluded.seller_contact, mx_listing_private.seller_contact),
        description = coalesce(excluded.description, mx_listing_private.description), raw = excluded.raw, updated_at = now()`,
      [listingId, p.seller_name, p.seller_contact, p.description?.slice(0, 20000) ?? null, JSON.stringify(p.raw ?? {})]);
  }

  // La ficha del anuncio (una por listing). Con { canonical } también es la del vehículo.
  async upsertSpecs(db, vehicleId, listingId, s, { canonical = false } = {}) {
    const cols = ['year', 'km', 'km_raw', 'body', 'transmission', 'transmission_raw', 'exterior_color', 'exterior_color_family', 'exterior_color_raw',
      'paint_to_sample', 'interior_color', 'interior_color_family', 'interior_color_raw', 'invoice_type', 'origin', 'owners', 'service_history',
      'antique_plates', 'parse_confidence', 'unresolved'];
    const vals = cols.map(c => s[c] ?? (c === 'unresolved' ? [] : null));
    const set = cols.map(c => `${c} = coalesce(excluded.${c}, mx_specs.${c})`).join(', ');
    const row = await one(db, `insert into mx_specs (vehicle_id, listing_id, is_canonical, observed_on, ${cols.join(', ')})
        values ($1, $2, $3, $4, ${cols.map((_, i) => '$' + (i + 5)).join(', ')})
      on conflict (listing_id) do update set observed_on = excluded.observed_on, ${set}, updated_at = now()
      returning id`, [vehicleId, listingId, canonical, s.observed_on, ...vals]);
    if (s.options?.length) {
      await db.query(`insert into mx_spec_options (spec_id, option_code) select $1, unnest($2::text[]) on conflict do nothing`, [row.id, s.options]);
    }
    return row.id;
  }

  async recordPrice(db, listingId, price, day) {
    if (!price) return null;
    const r = (await one(db, `select mx_record_price($1, $2, $3, $4, $5) r`, [listingId, price.price, price.currency, price.negotiable, day])).r;
    // precio "antes" que la fuente muestra tachado (migración 007): va en el tramo de este día
    if (price.list_price != null && r !== 'conflicto') {
      await db.query(`update mx_price_snapshots set list_price = $2 where listing_id = $1 and $3::date between observed_from and observed_to
        and list_price is distinct from $2 and (price is null or $2 > price)`, [listingId, price.list_price, day]);
    }
    return r;
  }

  async insertPhotos(db, listingId, photos, firstPosition = 0) {
    for (const [j, p] of photos.entries()) {
      const i = firstPosition + j;
      await db.query(`insert into mx_photos (listing_id, url, position, phash, phash_center, low_info, width, height, hashed_at, color_family, color_share, color_checked)
          values ($1, $2, $3, $4::bigint, $5::bigint, $6, $7, $8, case when $4::bigint is null then null else now() end, $9, $10, $11)
        on conflict (listing_id, url) do nothing`,
        [listingId, p.url, i, p.signed ?? null, p.centerSigned ?? null, !!p.lowInfo, p.width ?? null, p.height ?? null,
          p.color?.family ?? null, p.color?.share ?? null, !!p.colorChecked]);
    }
  }

  // ── barrido de duplicados (al final de cada corrida) ──────────────────
  // 'datos' (mismos km exactos) se registra en mx_merges como 'fingerprint'.
  async mergeVehicles(keep, drop, reason, evidence) {
    const r = { fotos: 'fotos', vin: 'vin', datos: 'fingerprint' }[reason] ?? 'fingerprint';
    return (await one(this.db, `select mx_merge_vehicles($1, $2, $3, $4::jsonb) id`, [keep, drop, r, JSON.stringify({ motivo: reason, ...evidence })])).id;
  }
  async pendingDuplicateReviews() {
    return (await this.db.query(`select id, vehicle_a, vehicle_b, reasons from mx_review_queue where kind = 'duplicado' and status = 'pendiente'`)).rows;
  }
  async discardReview(id, why) {
    await this.db.query(`update mx_review_queue set status = 'descartado', resolved_at = now(),
        payload = payload || jsonb_build_object('descartado_por', $2::text) where id = $1 and status = 'pendiente'`, [id, why]);
  }
  // Fotos guardadas sin hash (caídas, o anuncios que llegaron con más fotos después)
  async unhashedPhotos(limit) {
    return (await this.db.query(`select ph.id, ph.url, ph.vehicle_id from mx_photos ph join mx_vehicles v on v.id = ph.vehicle_id
        where ph.phash is null and v.merged_into is null order by ph.position nulls last, ph.id limit $1`, [limit])).rows;
  }
  // primeras fotos (portada y dos más) a las que aún no se les estima el color
  async photosWithoutColor(limit) {
    return (await this.db.query(`select ph.id, ph.url from mx_photos ph join mx_vehicles v on v.id = ph.vehicle_id
        where not ph.color_checked and ph.position <= 2 and v.merged_into is null order by ph.position, ph.id limit $1`, [limit])).rows;
  }
  async setPhotoColor(id, c) {
    await this.db.query(`update mx_photos set color_family = $2, color_share = $3, color_checked = true where id = $1`, [id, c?.family ?? null, c?.share ?? null]);
  }
  async setPhotoHash(id, p) {
    await this.db.query(`update mx_photos set phash = $2::bigint, phash_center = $3::bigint, low_info = $4, hashed_at = now() where id = $1`,
      [id, p.signed, p.centerSigned, !!p.lowInfo]);
  }

  async enqueueDuplicate(db, a, b, score, reasons, payload) {
    return (await one(db, `select mx_enqueue_duplicate($1, $2, $3, $4::jsonb, $5::jsonb) id`, [a, b, score, JSON.stringify(reasons), JSON.stringify(payload ?? {})])).id;
  }

  async enqueueNormalization(db, listingId, payload, score) {
    await db.query(`insert into mx_review_queue (kind, listing_id, score, reasons, payload)
        values ('normalizacion', $1, $2, $3::jsonb, $4::jsonb)
      on conflict (listing_id) where kind = 'normalizacion' and status = 'pendiente'
      do update set score = excluded.score, reasons = excluded.reasons, payload = excluded.payload`,
      [listingId, score, JSON.stringify(payload.reasons), JSON.stringify(payload)]);
  }

  // Activos de la fuente que hoy no aparecieron (la Fase 5 decide si se vendieron).
  async notSeenSince(sourceId, day) {
    return (await this.db.query(`select count(*)::int n from mx_listings where source_id = $1 and status = 'activo' and last_seen < $2::date`, [sourceId, day])).rows[0].n;
  }
}
