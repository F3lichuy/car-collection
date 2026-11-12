-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 005: fecha de publicación y datos capturados a mano
--
-- 1. mx_listings.published_on: la fecha en que la FUENTE dice que publicó el
--    anuncio (Shopify published_at, WordPress date, Mercado Libre start_time).
--    Null si la fuente no la da: entonces la antigüedad se cuenta desde que
--    nosotros lo vimos por primera vez (first_seen) y la página lo dice así.
-- 2. Captura manual de especificaciones: una fila de mx_specs por vehículo
--    con listing_id null. No sale de ningún anuncio, así que se guarda quién
--    la capturó y cuándo (captured_by, updated_at) para poder rastrearla.
--    Solo admin puede escribirla (RLS mx_admin_all de 001).
-- ════════════════════════════════════════════════════════════════════════

alter table public.mx_listings add column if not exists published_on date;
alter table public.mx_listings drop constraint if exists mx_listings_published_on_check;
alter table public.mx_listings add constraint mx_listings_published_on_check
  check (published_on is null or published_on >= date '1995-01-01');
comment on column public.mx_listings.published_on is
  'Fecha de publicación que declara la fuente. Null = la fuente no la da (usar first_seen).';

alter table public.mx_specs add column if not exists captured_by uuid;
comment on column public.mx_specs.captured_by is
  'Quién capturó a mano esta ficha (solo filas con listing_id null).';
-- Sin índice único: si se fusionan dos autos que tenían captura manual, quedan
-- las dos filas y manda la más reciente (updated_at); no se pierde ninguna.
create index if not exists mx_specs_manual on public.mx_specs(vehicle_id) where listing_id is null;

-- Guarda (o actualiza) la ficha manual de un vehículo. Solo los campos de la
-- lista; un valor null o "" borra ese dato de la captura manual (el auto
-- vuelve a mostrar lo que diga el anuncio). security invoker: aplica RLS.
create or replace function public.mx_save_manual_specs(p_vehicle uuid, p_data jsonb)
returns uuid
language plpgsql security invoker set search_path = public, pg_temp as $$
declare
  allowed constant text[] := array['year','km','body','transmission','exterior_color','exterior_color_family',
    'interior_color','interior_color_family','invoice_type','origin','owners','service_history','antique_plates','notes'];
  k text; clean jsonb := '{}'; rec public.mx_specs; sid uuid;
begin
  if not public.mx_is_admin() then raise exception 'Solo un admin puede capturar datos' using errcode = '42501'; end if;
  for k in select jsonb_object_keys(p_data) loop
    if not k = any(allowed) then raise exception 'Campo no permitido: %', k; end if;
    if p_data->>k is not null and p_data->>k <> '' then clean := clean || jsonb_build_object(k, p_data->k); end if;
  end loop;
  rec := jsonb_populate_record(null::public.mx_specs, clean);
  select id into sid from public.mx_specs where vehicle_id = p_vehicle and listing_id is null order by updated_at desc limit 1;
  if sid is null then
    insert into public.mx_specs (vehicle_id, listing_id, is_canonical, observed_on, captured_by, parse_confidence,
      year, km, body, transmission, exterior_color, exterior_color_family, interior_color, interior_color_family,
      invoice_type, origin, owners, service_history, antique_plates, notes)
    values (p_vehicle, null, false, current_date, auth.uid(), 1,
      rec.year, rec.km, rec.body, rec.transmission, rec.exterior_color, rec.exterior_color_family, rec.interior_color, rec.interior_color_family,
      rec.invoice_type, rec.origin, rec.owners, rec.service_history, rec.antique_plates, rec.notes)
    returning id into sid;
  else
    update public.mx_specs set observed_on = current_date, captured_by = auth.uid(),
      year = rec.year, km = rec.km, body = rec.body, transmission = rec.transmission,
      exterior_color = rec.exterior_color, exterior_color_family = rec.exterior_color_family,
      interior_color = rec.interior_color, interior_color_family = rec.interior_color_family,
      invoice_type = rec.invoice_type, origin = rec.origin, owners = rec.owners,
      service_history = rec.service_history, antique_plates = rec.antique_plates, notes = rec.notes
    where id = sid;
  end if;
  return sid;
end $$;

revoke execute on function public.mx_save_manual_specs(uuid, jsonb) from public, anon;
grant  execute on function public.mx_save_manual_specs(uuid, jsonb) to authenticated;
