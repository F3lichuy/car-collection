-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 007 · Borrar autos (solo el dueño) y precio anterior anunciado
--
-- 1. Borrar = ocultar, con deshacer. Solo la cuenta dueña (mx_owners), no
--    cualquier admin. El auto borrado deja de verse para todos los demás y,
--    si su anuncio vuelve a salir en la captura diaria, sigue oculto: el
--    anti-duplicados lo reconoce y no lo vuelve a crear.
-- 2. Nadie borra filas del mercado desde la app (ni un admin): se retira el
--    permiso DELETE/TRUNCATE a anon y authenticated en todas las tablas mx_.
--    La captura diaria (conexión directa) y mx_purge_demo no lo usan desde la app.
-- 3. mx_price_snapshots.list_price: el precio "antes" que la propia fuente
--    muestra tachado ("El precio original era $5,559,000"). No sabemos cuándo
--    cambió, por eso no se inventa un tramo con fecha: se guarda junto al precio.
-- Idempotente: se puede volver a correr.
-- ════════════════════════════════════════════════════════════════════════

-- ── Dueño ───────────────────────────────────────────────────────────────
create table if not exists public.mx_owners (
  user_id uuid primary key,
  note text,
  added_at timestamptz not null default now()
);
alter table public.mx_owners enable row level security;   -- sin políticas: nadie lo lee desde la app
revoke all on public.mx_owners from anon, authenticated;

-- feli_chuy (único admin al 2026-11-12)
insert into public.mx_owners (user_id, note) values ('bd816609-76e3-45bb-9990-794dd4f22f5a', 'feli_chuy')
on conflict (user_id) do nothing;

create or replace function public.mx_is_owner() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.mx_owners o where o.user_id = auth.uid())
$$;
-- la usan las políticas de lectura pública: anon también la ejecuta (para anon siempre es false)
grant execute on function public.mx_is_owner() to anon, authenticated, service_role;

-- ── Borrado reversible ──────────────────────────────────────────────────
alter table public.mx_vehicles add column if not exists deleted_at timestamptz;
alter table public.mx_vehicles add column if not exists deleted_by uuid;
alter table public.mx_vehicles add column if not exists delete_reason text;

create table if not exists public.mx_vehicle_deletions (
  id bigint generated always as identity primary key,
  vehicle_id uuid not null references public.mx_vehicles(id) on delete cascade,
  action text not null check (action in ('borrado', 'restaurado')),
  reason text,
  done_by uuid,
  done_at timestamptz not null default now()
);
alter table public.mx_vehicle_deletions enable row level security;
revoke all on public.mx_vehicle_deletions from anon, authenticated;
drop policy if exists mx_owner_read on public.mx_vehicle_deletions;
create policy mx_owner_read on public.mx_vehicle_deletions for select to authenticated using (public.mx_is_owner());
grant select on public.mx_vehicle_deletions to authenticated;

-- Lectura pública: lo borrado solo lo ve el dueño (para poder restaurarlo).
drop policy if exists mx_public_read on public.mx_vehicles;
create policy mx_public_read on public.mx_vehicles for select to anon, authenticated
  using (deleted_at is null or public.mx_is_owner());

-- (security definer: con la RLS de quien consulta, el auto borrado ni se vería y el anuncio quedaría visible)
create or replace function public.mx_vehicle_deleted(p_vehicle uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.mx_vehicles v where v.id = p_vehicle and v.deleted_at is not null)
$$;
grant execute on function public.mx_vehicle_deleted(uuid) to anon, authenticated, service_role;

drop policy if exists mx_public_read on public.mx_listings;
create policy mx_public_read on public.mx_listings for select to anon, authenticated
  using (public.mx_is_owner() or not public.mx_vehicle_deleted(vehicle_id));

create or replace function public.mx_delete_vehicle(p_vehicle uuid, p_reason text default null) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.mx_is_owner() then raise exception 'Solo el dueño de Precio de Calle puede borrar autos'; end if;
  update public.mx_vehicles set deleted_at = now(), deleted_by = auth.uid(), delete_reason = nullif(trim(p_reason), '')
   where id = p_vehicle and deleted_at is null;
  if not found then raise exception 'Ese auto no existe o ya estaba borrado'; end if;
  insert into public.mx_vehicle_deletions (vehicle_id, action, reason, done_by) values (p_vehicle, 'borrado', nullif(trim(p_reason), ''), auth.uid());
end $$;

create or replace function public.mx_restore_vehicle(p_vehicle uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.mx_is_owner() then raise exception 'Solo el dueño de Precio de Calle puede restaurar autos'; end if;
  update public.mx_vehicles set deleted_at = null, deleted_by = null, delete_reason = null
   where id = p_vehicle and deleted_at is not null;
  if not found then raise exception 'Ese auto no está borrado'; end if;
  insert into public.mx_vehicle_deletions (vehicle_id, action, done_by) values (p_vehicle, 'restaurado', auth.uid());
end $$;

revoke execute on function public.mx_delete_vehicle(uuid, text) from public, anon;
revoke execute on function public.mx_restore_vehicle(uuid) from public, anon;
grant execute on function public.mx_delete_vehicle(uuid, text) to authenticated;
grant execute on function public.mx_restore_vehicle(uuid) to authenticated;

-- ── Nadie borra filas desde la app ──────────────────────────────────────
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' and tablename like 'mx\_%' loop
    execute format('revoke delete, truncate on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ── Precio anterior anunciado por la fuente ─────────────────────────────
alter table public.mx_price_snapshots add column if not exists list_price numeric;
do $$ begin
  alter table public.mx_price_snapshots add constraint mx_price_snapshots_list_price_ok
    check (list_price is null or (list_price > 0 and (price is null or list_price > price)));
exception when duplicate_object then null; end $$;
