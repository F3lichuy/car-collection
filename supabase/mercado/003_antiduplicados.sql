-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · Fase 2 · Anti-duplicados (lado base de datos)
--
--   mx_enqueue_duplicate(a, b, score, reasons)  → propone un par a revisión (sin repetir)
--   mx_merge_vehicles(keep, drop, reason, ev)   → fusiona dos vehículos (todo o nada)
--   mx_unmerge(merge_id)                        → deshace una fusión y marca el par "distinto"
--   mx_resolve_duplicate(review_id, decision)   → tu clic en el panel: 'mismo' | 'distinto'
--   mx_live_vehicle(id)                         → sigue las lápidas hasta el vehículo vigente
--
-- Idempotente. Todas exigen admin (o service_role desde GitHub Actions).
-- ════════════════════════════════════════════════════════════════════════

-- Fotos: hash del centro (aguanta recortes) y marca de foto sin información.
alter table public.mx_photos add column if not exists phash_center bigint;
alter table public.mx_photos add column if not exists low_info boolean not null default false;
drop index if exists public.mx_photos_ph_a;
drop index if exists public.mx_photos_ph_b;
drop index if exists public.mx_photos_ph_c;
drop index if exists public.mx_photos_ph_d;
alter table public.mx_photos drop column if exists ph_a;
alter table public.mx_photos drop column if exists ph_b;
alter table public.mx_photos drop column if exists ph_c;
alter table public.mx_photos drop column if exists ph_d;

-- Ajustes calibrados en la Fase 2 (reemplazan phash_max_distance).
delete from public.mx_settings where key = 'phash_max_distance';

create or replace function public.mx_require_admin() returns void
language plpgsql stable set search_path = public, pg_temp as $$
begin
  if not (public.mx_is_admin() or current_user in ('postgres','service_role','supabase_admin')) then
    raise exception 'Solo admin' using errcode = '42501';
  end if;
end $$;

create or replace function public.mx_live_vehicle(p_id uuid) returns uuid
language sql stable set search_path = public, pg_temp as $$
  with recursive c(id, nxt, depth) as (
    select id, merged_into, 0 from mx_vehicles where id = p_id
    union all
    select v.id, v.merged_into, c.depth + 1 from mx_vehicles v join c on v.id = c.nxt where c.depth < 20
  )
  select id from c where nxt is null limit 1
$$;

-- ── Proponer un par a revisión ──────────────────────────────────────────
create or replace function public.mx_enqueue_duplicate(
  p_a uuid, p_b uuid, p_score numeric, p_reasons jsonb default '[]', p_payload jsonb default '{}'
) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare a uuid; b uuid; da boolean; db boolean; rid bigint;
begin
  perform mx_require_admin();
  a := mx_live_vehicle(p_a); b := mx_live_vehicle(p_b);
  if a is null or b is null or a = b then return null; end if;
  if a > b then select b, a into a, b; end if;
  if exists (select 1 from mx_distinct_pairs where vehicle_a = a and vehicle_b = b) then return null; end if;
  select is_demo into da from mx_vehicles where id = a;
  select is_demo into db from mx_vehicles where id = b;
  if da <> db then return null; end if;
  if (select count(distinct vin) from mx_vehicles where id in (a, b) and vin is not null) = 2 then
    return null;  -- VIN distintos: no son el mismo auto
  end if;
  insert into mx_review_queue (kind, vehicle_a, vehicle_b, score, reasons, payload, is_demo)
  values ('duplicado', a, b, p_score, coalesce(p_reasons, '[]'), coalesce(p_payload, '{}'), da)
  on conflict (vehicle_a, vehicle_b) where kind = 'duplicado' and status = 'pendiente'
  do update set score = greatest(mx_review_queue.score, excluded.score), reasons = excluded.reasons, payload = excluded.payload
  returning id into rid;
  return rid;
end $$;

-- ── Fusionar ────────────────────────────────────────────────────────────
-- Mueve listings (con sus specs, fotos y precios), specs sueltas y ventas de
-- p_drop a p_keep; deja p_drop como lápida. Registra todo en mx_merges.moved
-- para poder deshacerlo.
create or replace function public.mx_merge_vehicles(
  p_keep uuid, p_drop uuid, p_reason text, p_evidence jsonb default '{}'
) returns bigint
language plpgsql set search_path = public, pg_temp as $$
declare
  k mx_vehicles; d mx_vehicles;
  ls uuid[]; sp uuid[]; tr uuid[]; tomb uuid[]; canon_unset uuid;
  vin_moved text; version_filled boolean := false; mid bigint;
  pend record;
begin
  perform mx_require_admin();
  if p_keep = p_drop then raise exception 'No se puede fusionar un vehículo consigo mismo' using errcode = '22023'; end if;
  select * into k from mx_vehicles where id = p_keep for update;
  select * into d from mx_vehicles where id = p_drop for update;
  if k.id is null or d.id is null then raise exception 'Vehículo inexistente' using errcode = '22023'; end if;
  if k.merged_into is not null or d.merged_into is not null then raise exception 'Uno de los dos ya fue fusionado' using errcode = '22023'; end if;
  if k.is_demo <> d.is_demo then raise exception 'No se mezcla demo con real' using errcode = '22023'; end if;
  if k.vin is not null and d.vin is not null and k.vin <> d.vin then
    raise exception 'VIN distintos (% / %): no son el mismo auto', k.vin, d.vin using errcode = '22023';
  end if;
  if k.model_id <> d.model_id then
    raise exception 'Modelos distintos (% / %): corrige el modelo antes de fusionar', k.model_id, d.model_id using errcode = '22023';
  end if;
  if k.version_id is not null and d.version_id is not null and k.version_id <> d.version_id then
    raise exception 'Versiones distintas (% / %): corrige la versión antes de fusionar', k.version_id, d.version_id using errcode = '22023';
  end if;
  if exists (select 1 from mx_distinct_pairs where vehicle_a = least(p_keep, p_drop) and vehicle_b = greatest(p_keep, p_drop)) then
    raise exception 'Este par está marcado como distinto' using errcode = '22023';
  end if;
  if exists (select 1 from mx_transactions t1 join mx_transactions t2 on t1.sale_date = t2.sale_date
             where t1.vehicle_id = p_keep and t2.vehicle_id = p_drop) then
    raise exception 'Ambos tienen una venta en la misma fecha: revísalas antes de fusionar' using errcode = '22023';
  end if;

  -- una sola ficha canónica: gana la del que se queda
  select id into canon_unset from mx_specs where vehicle_id = p_drop and is_canonical;
  if canon_unset is not null and exists (select 1 from mx_specs where vehicle_id = p_keep and is_canonical) then
    update mx_specs set is_canonical = false where id = canon_unset;
  else
    canon_unset := null;
  end if;

  select coalesce(array_agg(id), '{}') into ls from mx_listings where vehicle_id = p_drop;
  update mx_listings set vehicle_id = p_keep where vehicle_id = p_drop;      -- specs y fotos del listing lo siguen (trigger)
  select coalesce(array_agg(id), '{}') into sp from mx_specs where vehicle_id = p_drop;
  update mx_specs set vehicle_id = p_keep where vehicle_id = p_drop;
  select coalesce(array_agg(id), '{}') into tr from mx_transactions where vehicle_id = p_drop;
  update mx_transactions set vehicle_id = p_keep where vehicle_id = p_drop;
  select coalesce(array_agg(id), '{}') into tomb from mx_vehicles where merged_into = p_drop;
  update mx_vehicles set merged_into = p_keep where merged_into = p_drop;

  if k.vin is null and d.vin is not null then
    vin_moved := d.vin;
    update mx_vehicles set vin = null where id = p_drop;
    update mx_vehicles set vin = vin_moved where id = p_keep;
  end if;
  if k.version_id is null and d.version_id is not null then
    version_filled := true;
    update mx_vehicles set version_id = d.version_id, generation_id = d.generation_id where id = p_keep;
  elsif k.generation_id is null and d.generation_id is not null then
    version_filled := true;
    update mx_vehicles set generation_id = d.generation_id where id = p_keep;
  end if;

  -- "distinto de X" del que se va también aplica al que se queda
  insert into mx_distinct_pairs (vehicle_a, vehicle_b, decided_by)
  select least(p_keep, x), greatest(p_keep, x), auth.uid() from (
    select case when vehicle_a = p_drop then vehicle_b else vehicle_a end x
      from mx_distinct_pairs where p_drop in (vehicle_a, vehicle_b)) s
  where x <> p_keep
  on conflict do nothing;

  update mx_vehicles set merged_into = p_keep, merged_at = now() where id = p_drop;

  -- revisiones pendientes: la del par queda resuelta; las demás se re-apuntan al que se queda
  update mx_review_queue set status = 'mismo', resolved_at = now(), resolved_by = auth.uid()
   where kind = 'duplicado' and status = 'pendiente'
     and vehicle_a = least(p_keep, p_drop) and vehicle_b = greatest(p_keep, p_drop);
  for pend in select * from mx_review_queue
               where kind = 'duplicado' and status = 'pendiente' and p_drop in (vehicle_a, vehicle_b) loop
    update mx_review_queue set status = 'descartado', resolved_at = now() where id = pend.id;
    perform mx_enqueue_duplicate(case when pend.vehicle_a = p_drop then pend.vehicle_b else pend.vehicle_a end,
                                 p_keep, pend.score, pend.reasons, pend.payload);
  end loop;

  insert into mx_merges (kept_id, merged_id, reason, evidence, moved)
  values (p_keep, p_drop, p_reason, coalesce(p_evidence, '{}'), jsonb_build_object(
    'listings', to_jsonb(ls), 'specs', to_jsonb(sp), 'transactions', to_jsonb(tr), 'tombstones', to_jsonb(tomb),
    'canonical_unset', canon_unset, 'vin_moved', vin_moved, 'version_filled', version_filled,
    'keep_version_before', k.version_id, 'keep_generation_before', k.generation_id))
  returning id into mid;
  return mid;
end $$;

-- ── Deshacer una fusión ─────────────────────────────────────────────────
create or replace function public.mx_unmerge(p_merge bigint) returns void
language plpgsql set search_path = public, pg_temp as $$
declare m mx_merges; mv jsonb;
begin
  perform mx_require_admin();
  select * into m from mx_merges where id = p_merge for update;
  if m.id is null then raise exception 'Fusión inexistente' using errcode = '22023'; end if;
  if m.undone_at is not null then raise exception 'Esa fusión ya se deshizo' using errcode = '22023'; end if;
  if not exists (select 1 from mx_vehicles where id = m.merged_id and merged_into = m.kept_id) then
    raise exception 'Hubo cambios posteriores sobre estos vehículos; deshazlos en orden inverso' using errcode = '22023';
  end if;
  mv := m.moved;

  update mx_vehicles set merged_into = null, merged_at = null where id = m.merged_id;
  if mv->>'vin_moved' is not null then
    update mx_vehicles set vin = null where id = m.kept_id;
    update mx_vehicles set vin = mv->>'vin_moved' where id = m.merged_id;
  end if;
  if (mv->>'version_filled')::boolean then
    update mx_vehicles set version_id = mv->>'keep_version_before', generation_id = mv->>'keep_generation_before' where id = m.kept_id;
  end if;
  update mx_listings     set vehicle_id = m.merged_id where id in (select jsonb_array_elements_text(mv->'listings')::uuid) and vehicle_id = m.kept_id;
  update mx_specs        set vehicle_id = m.merged_id where id in (select jsonb_array_elements_text(mv->'specs')::uuid) and vehicle_id = m.kept_id;
  update mx_transactions set vehicle_id = m.merged_id where id in (select jsonb_array_elements_text(mv->'transactions')::uuid) and vehicle_id = m.kept_id;
  update mx_vehicles     set merged_into = m.merged_id where id in (select jsonb_array_elements_text(mv->'tombstones')::uuid) and merged_into = m.kept_id;
  if mv->>'canonical_unset' is not null then
    update mx_specs set is_canonical = true where id = (mv->>'canonical_unset')::uuid;
  end if;

  -- si se deshace es porque no eran el mismo auto: que no se vuelva a proponer
  insert into mx_distinct_pairs (vehicle_a, vehicle_b, decided_by)
  values (least(m.kept_id, m.merged_id), greatest(m.kept_id, m.merged_id), auth.uid())
  on conflict do nothing;
  update mx_merges set undone_at = now() where id = p_merge;
end $$;

-- ── Tu clic en la cola de revisión ──────────────────────────────────────
-- 'mismo': se queda el vehículo más antiguo (o el que tiene VIN).
create or replace function public.mx_resolve_duplicate(p_review bigint, p_decision text) returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare r mx_review_queue; a uuid; b uuid; keep uuid; drop_ uuid; mid bigint;
begin
  perform mx_require_admin();
  if p_decision not in ('mismo','distinto') then raise exception 'Decisión inválida: %', p_decision using errcode = '22023'; end if;
  select * into r from mx_review_queue where id = p_review and kind = 'duplicado' for update;
  if r.id is null then raise exception 'Revisión inexistente' using errcode = '22023'; end if;
  if r.status <> 'pendiente' then raise exception 'Esta revisión ya se resolvió (%)', r.status using errcode = '22023'; end if;
  a := mx_live_vehicle(r.vehicle_a); b := mx_live_vehicle(r.vehicle_b);

  if p_decision = 'distinto' then
    insert into mx_distinct_pairs (vehicle_a, vehicle_b, decided_by)
    values (least(a, b), greatest(a, b), auth.uid()) on conflict do nothing;
    update mx_review_queue set status = 'distinto', resolved_at = now(), resolved_by = auth.uid() where id = p_review;
    return jsonb_build_object('decision', 'distinto');
  end if;

  if a = b then
    update mx_review_queue set status = 'mismo', resolved_at = now(), resolved_by = auth.uid() where id = p_review;
    return jsonb_build_object('decision', 'mismo', 'ya_fusionados', true);
  end if;
  select id into keep from mx_vehicles where id in (a, b)
   order by (vin is not null) desc, created_at, id limit 1;
  drop_ := case when keep = a then b else a end;
  mid := mx_merge_vehicles(keep, drop_, 'manual', jsonb_build_object('review_id', p_review, 'reasons', r.reasons, 'score', r.score));
  update mx_review_queue set status = 'mismo', resolved_at = now(), resolved_by = auth.uid() where id = p_review;
  return jsonb_build_object('decision', 'mismo', 'kept', keep, 'merged', drop_, 'merge_id', mid);
end $$;

revoke execute on function public.mx_enqueue_duplicate(uuid, uuid, numeric, jsonb, jsonb) from public, anon;
revoke execute on function public.mx_merge_vehicles(uuid, uuid, text, jsonb) from public, anon;
revoke execute on function public.mx_unmerge(bigint) from public, anon;
revoke execute on function public.mx_resolve_duplicate(bigint, text) from public, anon;
grant execute on function public.mx_enqueue_duplicate(uuid, uuid, numeric, jsonb, jsonb) to authenticated, service_role;
grant execute on function public.mx_merge_vehicles(uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.mx_unmerge(bigint) to authenticated, service_role;
grant execute on function public.mx_resolve_duplicate(bigint, text) to authenticated, service_role;
