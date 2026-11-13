-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 009 · Versión a mano
--
-- Un auto que quedó "Versión por confirmar" se corrige a mano (solo admin):
--   · eligiendo una versión del catálogo de ese modelo (mx_versions), o
--   · con "Otro": un texto libre que no inventa versiones en el catálogo (version_custom).
-- Cada cambio queda en mx_version_edits (antes, después, quién y cuándo) para poder rastrearlo.
-- La carga diaria no reescribe la versión de un auto ya guardado.
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════
alter table public.mx_vehicles add column if not exists version_custom text;
alter table public.mx_vehicles add column if not exists version_manual_at timestamptz;
alter table public.mx_vehicles add column if not exists version_manual_by uuid;
do $$ begin
  alter table public.mx_vehicles add constraint mx_vehicles_version_custom_ok
    check (version_custom is null or length(btrim(version_custom)) between 1 and 80);
-- (si una fusión le pone versión del catálogo a un auto con texto propio, manda la del catálogo)
exception when duplicate_object then null; end $$;

create table if not exists public.mx_version_edits (
  id             bigint generated always as identity primary key,
  vehicle_id     uuid not null references public.mx_vehicles(id) on delete cascade,
  before_version text,
  before_custom  text,
  after_version  text,
  after_custom   text,
  edited_by      uuid default auth.uid(),
  edited_at      timestamptz not null default now()
);
alter table public.mx_version_edits enable row level security;
drop policy if exists mx_admin_all on public.mx_version_edits;
create policy mx_admin_all on public.mx_version_edits for all to authenticated
  using (public.mx_is_admin()) with check (public.mx_is_admin());
revoke all on public.mx_version_edits from anon;

-- p_version: id de mx_versions (del mismo modelo) · p_custom: texto libre ("Otro")
-- Los dos en null: vuelve a "Versión por confirmar".
create or replace function public.mx_set_vehicle_version(p_vehicle uuid, p_version text default null, p_custom text default null)
returns jsonb
language plpgsql security invoker set search_path = public, pg_temp as $$
declare v public.mx_vehicles; g text; vm text; c text := nullif(btrim(coalesce(p_custom, '')), '');
begin
  if not public.mx_is_admin() then raise exception 'Solo un admin puede cambiar la versión' using errcode = '42501'; end if;
  if p_version is not null and c is not null then raise exception 'Elige una versión de la lista u "Otro", no las dos' using errcode = '22023'; end if;
  if c is not null and length(c) > 80 then raise exception 'La versión escrita es muy larga (máximo 80 letras)' using errcode = '22023'; end if;
  select * into v from public.mx_vehicles where id = p_vehicle for update;
  if v.id is null then raise exception 'Ese auto no existe' using errcode = '22023'; end if;
  if p_version is not null then
    select gg.id, gg.model_id into g, vm from public.mx_versions ve join public.mx_generations gg on gg.id = ve.generation_id where ve.id = p_version;
    if g is null then raise exception 'Esa versión no existe en el catálogo' using errcode = '22023'; end if;
    if vm <> v.model_id then raise exception 'Esa versión es de otro modelo' using errcode = '22023'; end if;
    update public.mx_vehicles set version_id = p_version, generation_id = g, version_custom = null,
      version_manual_at = now(), version_manual_by = auth.uid() where id = p_vehicle;
  else
    update public.mx_vehicles set version_id = null, version_custom = c,
      version_manual_at = case when c is null then null else now() end, version_manual_by = case when c is null then null else auth.uid() end
    where id = p_vehicle;
  end if;
  insert into public.mx_version_edits (vehicle_id, before_version, before_custom, after_version, after_custom)
  values (p_vehicle, v.version_id, v.version_custom, p_version, c);
  return jsonb_build_object('vehicle', p_vehicle, 'version', p_version, 'custom', c);
end $$;

revoke execute on function public.mx_set_vehicle_version(uuid, text, text) from public, anon;
grant execute on function public.mx_set_vehicle_version(uuid, text, text) to authenticated, service_role;

-- ── Fecha de publicación aproximada ─────────────────────────────────────
-- Mercado Libre y Marketplace dicen "Publicado hace 3 meses" (solo dentro del anuncio): la fecha que
-- se guarda es una estimación al mes. published_approx = true la marca así en la página ("≈ ago 2026").
alter table public.mx_listings add column if not exists published_approx boolean not null default false;
-- Las fechas que ya teníamos de Mercado Libre y Marketplace salieron de "Publicado hace …": son aproximadas.
update public.mx_listings set published_approx = true
 where source_id in ('mercadolibre-autos', 'facebook-marketplace') and published_on is not null and not published_approx;
