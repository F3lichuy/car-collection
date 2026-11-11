-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · Fase 1 · Esquema base
--
-- Reglas que este archivo garantiza a nivel base de datos (no solo en código):
--   · Un VIN / número de chasis = un vehículo (normalizado: mayúsculas, sin guiones).
--   · Una URL canónica = un listing; (fuente, id externo) = un listing.
--   · Un vehículo tiene a lo más una ficha de specs canónica.
--   · Los tramos de precio de un listing no se traslapan (un precio por día).
--   · Una venta confirmada por vehículo y fecha.
--   · Un par de vehículos tiene a lo más una revisión de duplicado pendiente,
--     y un par marcado "distinto" no se vuelve a proponer.
--   · NULL significa "desconocido": nunca se rellena con supuestos.
--   · Todo dato de demostración lleva is_demo = true y se borra con
--       select public.mx_purge_demo();
--
-- Seguridad (RLS): escribir = solo admin (profiles.is_admin) o service_role
-- (GitHub Actions). Leer: ver la sección "LECTURA PÚBLICA" al final; está
-- aislada para poder cerrarla a "solo agregados" cambiando un bloque.
--
-- Idempotente: se puede volver a correr sin romper nada.
-- ════════════════════════════════════════════════════════════════════════

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create extension if not exists pg_trgm   with schema extensions;

-- ── Utilidades ──────────────────────────────────────────────────────────

create or replace function public.mx_touch() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin new.updated_at := now(); return new; end $$;

-- ¿El usuario actual es admin? (profiles.is_admin ya existe en la app)
create or replace function public.mx_is_admin() returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select p.is_admin from public.profiles p where p.user_id = auth.uid()), false)
$$;

-- Distancia de Hamming entre dos hashes perceptuales de 64 bits.
create or replace function public.mx_hamming(a bigint, b bigint) returns int
language sql immutable parallel safe set search_path = public, pg_temp as $$
  select bit_count((a # b)::bit(64))::int
$$;

-- ── Taxonomía: marca > modelo > generación > versión ────────────────────

create table if not exists public.mx_makes (
  id      text primary key check (id ~ '^[a-z0-9-]+$'),
  name    text not null unique,
  country text,
  sort    smallint not null default 100
);

-- segment: el segmento del modelo. "Clásico" NO se guarda aquí: se calcula
-- por año del vehículo con mx_settings.classic_age_years.
create table if not exists public.mx_models (
  id      text primary key check (id ~ '^[a-z0-9-]+$'),
  make_id text not null references public.mx_makes(id) on update cascade,
  name    text not null,
  segment text not null check (segment in ('moderno','exotico','gran_turismo','ultra_lujo')),
  notes   text,
  sort    smallint not null default 100,
  unique (make_id, name)
);

create table if not exists public.mx_generations (
  id        text primary key check (id ~ '^[a-z0-9-]+$'),
  model_id  text not null references public.mx_models(id) on update cascade,
  code      text not null,                 -- '992', 'G', 'C190'
  name      text not null,                 -- '992', 'Serie G'
  year_from smallint not null check (year_from between 1900 and 2100),
  year_to   smallint check (year_to is null or year_to >= year_from),  -- null = en producción
  sort      smallint not null default 100,
  unique (model_id, code)
);

-- transmissions: transmisiones que existieron para esa versión ('{}' = sin dato).
-- Sirve para validar anuncios ("GT3 RS 992 manual" es imposible → revisión).
create table if not exists public.mx_versions (
  id            text primary key check (id ~ '^[a-z0-9-]+$'),
  generation_id text not null references public.mx_generations(id) on update cascade,
  name          text not null,
  year_from     smallint check (year_from between 1900 and 2100),
  year_to       smallint check (year_to is null or year_to >= year_from),
  transmissions text[] not null default '{}'
                check (transmissions <@ array['manual','pdk','dct','f1','automatizada','automatica']),
  notes         text,
  verified      boolean not null default false,  -- lo confirmas tú en el panel admin
  sort          smallint not null default 100,
  unique (generation_id, name)
);

-- Alias para el normalizador (Fase 3): "gt3rs", "c4s", "huracan evo rwd"…
create table if not exists public.mx_aliases (
  alias      text not null check (alias = lower(alias)),
  level      text not null check (level in ('make','model','generation','version')),
  target_id  text not null,
  primary key (alias, level, target_id)
);

-- Catálogo controlado de opciones (para analizar primas por atributo).
create table if not exists public.mx_option_catalog (
  code    text primary key check (code ~ '^[a-z0-9_]+$'),
  label   text not null,
  make_id text references public.mx_makes(id) on update cascade,  -- null = genérica
  aliases text[] not null default '{}'
);

-- ── Configuración ───────────────────────────────────────────────────────

create table if not exists public.mx_settings (
  key         text primary key,
  value       jsonb not null,
  description text not null,
  updated_at  timestamptz not null default now()
);

-- ── Fuentes y corridas ──────────────────────────────────────────────────

create table if not exists public.mx_sources (
  id                   text primary key check (id ~ '^[a-z0-9-]+$'),
  name                 text not null,
  kind                 text not null check (kind in ('agencia_oficial','broker','portal','marketplace','red_social','subasta','directo')),
  base_url             text,
  capture_mode         text not null check (capture_mode in ('scraper','playwright','script_local','manual')),
  enabled              boolean not null default true,
  status               text not null default 'pendiente'
                       check (status in ('pendiente','ok','error','desactivada','captura_manual')),
  last_run_at          timestamptz,
  last_success_at      timestamptz,
  last_error           text,
  consecutive_failures int not null default 0,
  config               jsonb not null default '{}',
  notes                text,
  is_demo              boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.mx_runs (
  id                   bigint generated always as identity primary key,
  source_id            text references public.mx_sources(id) on update cascade on delete cascade,
  trigger              text not null check (trigger in ('cron','manual','local','wayback')),
  started_at           timestamptz not null default now(),
  finished_at          timestamptz,
  ok                   boolean,
  new_listings         int not null default 0,
  updated_listings     int not null default 0,
  disappeared_listings int not null default 0,
  errors               int not null default 0,
  error_log            jsonb not null default '[]',
  notes                text
);

-- ── Vehículos: la identidad de cada auto físico ─────────────────────────

create table if not exists public.mx_vehicles (
  id            uuid primary key default gen_random_uuid(),
  model_id      text not null references public.mx_models(id) on update cascade,
  generation_id text references public.mx_generations(id) on update cascade,
  version_id    text references public.mx_versions(id) on update cascade,
  vin           text unique,        -- VIN de 17 o número de chasis (clásicos)
  vin_kind      text check (vin_kind in ('vin17','chasis')),
  merged_into   uuid references public.mx_vehicles(id),  -- lápida tras fusionar duplicados
  merged_at     timestamptz,
  notes         text,
  is_demo       boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (merged_into is null or merged_into <> id),
  check ((vin is null) = (vin_kind is null))
);

-- Normaliza VIN y completa/valida la jerarquía modelo ← generación ← versión.
create or replace function public.mx_vehicles_before() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare g text; m text;
begin
  if new.vin is not null then
    new.vin := upper(regexp_replace(new.vin, '[^A-Za-z0-9]', '', 'g'));
    if new.vin = '' then new.vin := null; new.vin_kind := null;
    elsif length(new.vin) = 17 then
      if new.vin !~ '^[A-HJ-NPR-Z0-9]{17}$' then
        raise exception 'VIN inválido (contiene I, O o Q): %', new.vin using errcode = '22023';
      end if;
      new.vin_kind := 'vin17';
    elsif length(new.vin) between 4 and 16 then
      new.vin_kind := 'chasis';
    else
      raise exception 'VIN/chasis con longitud inválida: %', new.vin using errcode = '22023';
    end if;
  else
    new.vin_kind := null;
  end if;

  if new.version_id is not null then
    select v.generation_id into g from mx_versions v where v.id = new.version_id;
    if new.generation_id is null then new.generation_id := g;
    elsif new.generation_id <> g then
      raise exception 'La versión % no pertenece a la generación %', new.version_id, new.generation_id using errcode = '23514';
    end if;
  end if;
  if new.generation_id is not null then
    select gg.model_id into m from mx_generations gg where gg.id = new.generation_id;
    if new.model_id is distinct from m then
      raise exception 'La generación % no pertenece al modelo %', new.generation_id, new.model_id using errcode = '23514';
    end if;
  end if;
  if new.merged_into is not null and exists (select 1 from mx_vehicles x where x.id = new.merged_into and x.merged_into is not null) then
    raise exception 'No se puede fusionar contra un vehículo que ya fue fusionado' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists mx_vehicles_before on public.mx_vehicles;
create trigger mx_vehicles_before before insert or update on public.mx_vehicles
  for each row execute function public.mx_vehicles_before();
drop trigger if exists mx_vehicles_touch on public.mx_vehicles;
create trigger mx_vehicles_touch before update on public.mx_vehicles
  for each row execute function public.mx_touch();

-- ── Listings: cada aparición de un auto en una fuente ───────────────────

create table if not exists public.mx_listings (
  id                uuid primary key default gen_random_uuid(),
  vehicle_id        uuid not null references public.mx_vehicles(id),
  source_id         text not null references public.mx_sources(id) on update cascade,
  capture_method    text not null check (capture_method in ('scraper','wayback','script_local','bookmarklet','link','formulario','csv')),
  external_id       text,               -- id del anuncio en la fuente, si lo tiene
  url               text,
  url_canonical     text unique,        -- la normaliza el pipeline (sin utm, fbclid, etc.)
  title             text,
  city              text,
  state             text,
  seller_type       text not null default 'desconocido'
                    check (seller_type in ('agencia_oficial','broker','particular','desconocido')),
  first_seen        date not null,
  last_seen         date not null,
  status            text not null default 'activo'
                    check (status in ('activo','desaparecido','vendido_confirmado','vendido_inferido','republicado')),
  status_changed_at timestamptz not null default now(),
  sold_window_from  date,               -- ventana de venta inferida (Fase 4/5)
  sold_window_to    date,
  republished_as    uuid references public.mx_listings(id),
  is_demo           boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (source_id, external_id),
  check (last_seen >= first_seen),
  check ((url is null) = (url_canonical is null)),
  check (url is not null or capture_method in ('formulario','csv')),
  check (sold_window_to is null or sold_window_from is null or sold_window_to >= sold_window_from),
  check (republished_as is null or republished_as <> id)
);
create index if not exists mx_listings_vehicle on public.mx_listings(vehicle_id);
create index if not exists mx_listings_status  on public.mx_listings(status, last_seen);

-- Datos del anuncio que pueden contener información personal (nombre o
-- teléfono del vendedor particular, descripción libre, JSON crudo).
-- Siempre solo-admin, aunque los listings sean públicos.
create table if not exists public.mx_listing_private (
  listing_id     uuid primary key references public.mx_listings(id) on delete cascade,
  seller_name    text,
  seller_contact text,
  description    text check (length(description) <= 20000),
  raw            jsonb not null default '{}' check (pg_column_size(raw) <= 32768),
  updated_at     timestamptz not null default now()
);

drop trigger if exists mx_listings_touch on public.mx_listings;
create trigger mx_listings_touch before update on public.mx_listings
  for each row execute function public.mx_touch();

-- ── Specs: lo que afirma cada anuncio (o tu captura) sobre el auto ──────
-- Cada listing aporta su propia observación; una de ellas por vehículo es la
-- canónica (la que usan fingerprint y analítica).

create table if not exists public.mx_specs (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references public.mx_vehicles(id),
  listing_id            uuid unique references public.mx_listings(id) on delete cascade,
  is_canonical          boolean not null default false,
  observed_on           date not null default current_date,
  year                  smallint check (year between 1900 and 2100),
  km                    integer  check (km between 0 and 2000000),
  km_raw                text,                 -- "45 mil millas", "8,500 km"
  body                  text check (body in ('coupe','targa','cabriolet','roadster','speedster','suv','sedan','shooting_brake')),
  transmission          text check (transmission in ('manual','pdk','dct','f1','automatizada','automatica')),
  transmission_raw      text,
  exterior_color        text,                 -- nombre del fabricante normalizado: "GT Silver"
  exterior_color_family text check (exterior_color_family in ('negro','blanco','gris','plata','rojo','azul','verde','amarillo','naranja','morado','cafe','beige','dorado','rosa','otro')),
  exterior_color_raw    text,
  paint_to_sample       boolean,
  interior_color        text,
  interior_color_family text check (interior_color_family in ('negro','gris','beige','cafe','rojo','azul','verde','blanco','amarillo','naranja','otro')),
  interior_color_raw    text,
  invoice_type          text check (invoice_type in ('agencia','aseguradora','refacturado','otra')),
  origin                text check (origin in ('nacional','importado','fronterizo','legalizado')),
  owners                smallint check (owners between 0 and 50),
  service_history       text check (service_history in ('agencia_completo','agencia_parcial','taller_externo','sin_historial')),
  antique_plates        boolean,              -- placas de auto antiguo
  notes                 text,
  parse_confidence      numeric(3,2) check (parse_confidence between 0 and 1),
  unresolved            text[] not null default '{}',  -- campos que el parser no pudo resolver
  is_demo               boolean not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists mx_specs_one_canonical on public.mx_specs(vehicle_id) where is_canonical;
create index if not exists mx_specs_vehicle on public.mx_specs(vehicle_id);

drop trigger if exists mx_specs_touch on public.mx_specs;
create trigger mx_specs_touch before update on public.mx_specs
  for each row execute function public.mx_touch();

create table if not exists public.mx_spec_options (
  spec_id     uuid not null references public.mx_specs(id) on delete cascade,
  option_code text not null references public.mx_option_catalog(code) on update cascade,
  primary key (spec_id, option_code)
);

-- ── Precios: un tramo por precio continuo (= un precio por día) ─────────
-- En vez de una fila por día se guarda [observed_from, observed_to]. La vista
-- mx_price_daily lo expande a una fila por día. Ahorra ~50× espacio en el
-- plan gratuito (500 MB) sin perder resolución.

create table if not exists public.mx_price_snapshots (
  id            bigint generated always as identity primary key,
  listing_id    uuid not null references public.mx_listings(id) on delete cascade,
  price         numeric(14,2) check (price > 0 and price < 1000000000),  -- null = "precio a tratar" sin cifra
  currency      text check (currency in ('MXN','USD')),
  negotiable    boolean not null default false,
  observed_from date not null,
  observed_to   date not null,
  is_demo       boolean not null default false,
  check (observed_to >= observed_from),
  check ((price is null) = (currency is null)),
  check (price is not null or negotiable),
  constraint mx_price_no_overlap exclude using gist
    (listing_id with =, daterange(observed_from, observed_to, '[]') with &&)
);

-- ── Fotos: solo URL + hash perceptual (no se guardan imágenes) ──────────

create table if not exists public.mx_photos (
  id         bigint generated always as identity primary key,
  listing_id uuid not null references public.mx_listings(id) on delete cascade,
  vehicle_id uuid not null references public.mx_vehicles(id),  -- copia de listing.vehicle_id (búsquedas rápidas)
  url        text not null,
  position   smallint,
  phash      bigint,                    -- pHash 64 bits de la foto completa; null = aún sin calcular
  phash_center bigint,                  -- pHash del centro (aguanta recortes del broker)
  low_info   boolean not null default false,  -- foto casi lisa (placeholder): no identifica
  width      int,
  height     int,
  hashed_at  timestamptz,
  is_demo    boolean not null default false,
  unique (listing_id, url)
);
create index if not exists mx_photos_vehicle on public.mx_photos(vehicle_id);

-- ── Ventas confirmadas (las capturas tú) ────────────────────────────────

create table if not exists public.mx_transactions (
  id             uuid primary key default gen_random_uuid(),
  vehicle_id     uuid not null references public.mx_vehicles(id),
  listing_id     uuid references public.mx_listings(id) on delete set null,
  price          numeric(14,2) not null check (price > 0 and price < 1000000000),
  currency       text not null check (currency in ('MXN','USD')),
  sale_date      date not null,
  date_precision text not null default 'dia' check (date_precision in ('dia','mes','anio')),
  source         text not null,          -- quién lo reporta: comprador, broker, subasta…
  source_url     text,
  confidence     text not null check (confidence in ('alta','media','baja')),
  notes          text,
  is_demo        boolean not null default false,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (vehicle_id, sale_date)
);
drop trigger if exists mx_transactions_touch on public.mx_transactions;
create trigger mx_transactions_touch before update on public.mx_transactions
  for each row execute function public.mx_touch();

-- ── Tipo de cambio FIX (Banxico) ────────────────────────────────────────

create table if not exists public.mx_fx_rates (
  day        date primary key,
  usd_mxn    numeric(10,4) not null check (usd_mxn > 0),
  source     text not null default 'banxico_fix',
  fetched_at timestamptz not null default now()
);

-- FIX vigente para una fecha (fines de semana y festivos usan el último publicado).
create or replace function public.mx_usd_mxn(d date) returns numeric
language sql stable set search_path = public, pg_temp as $$
  select f.usd_mxn from mx_fx_rates f where f.day <= d order by f.day desc limit 1
$$;

-- ── Anti-duplicados: revisión, fusiones y pares distintos ───────────────

create table if not exists public.mx_review_queue (
  id          bigint generated always as identity primary key,
  kind        text not null check (kind in ('duplicado','normalizacion')),
  status      text not null default 'pendiente'
              check (status in ('pendiente','mismo','distinto','corregido','descartado')),
  vehicle_a   uuid references public.mx_vehicles(id) on delete cascade,
  vehicle_b   uuid references public.mx_vehicles(id) on delete cascade,
  listing_id  uuid references public.mx_listings(id) on delete cascade,
  score       numeric(4,3) check (score between 0 and 1),
  reasons     jsonb not null default '[]',
  payload     jsonb not null default '{}',
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  check (kind <> 'duplicado' or (vehicle_a is not null and vehicle_b is not null and vehicle_a < vehicle_b)),
  check (kind <> 'normalizacion' or listing_id is not null)
);
create unique index if not exists mx_review_one_pending_pair
  on public.mx_review_queue(vehicle_a, vehicle_b) where kind = 'duplicado' and status = 'pendiente';
create unique index if not exists mx_review_one_pending_norm
  on public.mx_review_queue(listing_id) where kind = 'normalizacion' and status = 'pendiente';

create table if not exists public.mx_distinct_pairs (
  vehicle_a  uuid not null references public.mx_vehicles(id) on delete cascade,
  vehicle_b  uuid not null references public.mx_vehicles(id) on delete cascade,
  decided_at timestamptz not null default now(),
  decided_by uuid default auth.uid(),
  primary key (vehicle_a, vehicle_b),
  check (vehicle_a < vehicle_b)
);

create table if not exists public.mx_merges (
  id        bigint generated always as identity primary key,
  kept_id   uuid not null references public.mx_vehicles(id),
  merged_id uuid not null references public.mx_vehicles(id),
  reason    text not null check (reason in ('vin','fotos','fingerprint','manual')),
  evidence  jsonb not null default '{}',
  moved     jsonb not null default '{}',   -- qué listings/specs/fotos se movieron (para deshacer)
  merged_at timestamptz not null default now(),
  merged_by uuid default auth.uid(),
  undone_at timestamptz,
  check (kept_id <> merged_id)
);

-- ── Coherencia de demo y copias de vehicle_id ───────────────────────────
-- Un dato real nunca cuelga de uno demo ni al revés; fotos y precios heredan
-- is_demo de su listing.

create or replace function public.mx_inherit_from_listing() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare l record;
begin
  select vehicle_id, is_demo into l from mx_listings where id = new.listing_id;
  new.is_demo := l.is_demo;
  if tg_table_name = 'mx_photos' then new.vehicle_id := l.vehicle_id; end if;
  return new;
end $$;

drop trigger if exists mx_photos_inherit on public.mx_photos;
create trigger mx_photos_inherit before insert or update of listing_id on public.mx_photos
  for each row execute function public.mx_inherit_from_listing();
drop trigger if exists mx_prices_inherit on public.mx_price_snapshots;
create trigger mx_prices_inherit before insert or update of listing_id on public.mx_price_snapshots
  for each row execute function public.mx_inherit_from_listing();

create or replace function public.mx_check_demo_vehicle() returns trigger
language plpgsql set search_path = public, pg_temp as $$
declare vd boolean;
begin
  if tg_table_name = 'mx_specs' then
    if new.listing_id is not null then
      select vehicle_id into new.vehicle_id from mx_listings where id = new.listing_id;
    end if;
  end if;
  select is_demo into vd from mx_vehicles where id = new.vehicle_id;
  if vd is distinct from new.is_demo then
    raise exception 'is_demo de % (%) no coincide con su vehículo (%)', tg_table_name, new.is_demo, vd using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists mx_listings_demo on public.mx_listings;
create trigger mx_listings_demo before insert or update of vehicle_id, is_demo on public.mx_listings
  for each row execute function public.mx_check_demo_vehicle();
drop trigger if exists mx_specs_demo on public.mx_specs;
create trigger mx_specs_demo before insert or update of vehicle_id, listing_id, is_demo on public.mx_specs
  for each row execute function public.mx_check_demo_vehicle();
drop trigger if exists mx_transactions_demo on public.mx_transactions;
create trigger mx_transactions_demo before insert or update of vehicle_id, is_demo on public.mx_transactions
  for each row execute function public.mx_check_demo_vehicle();

-- Si un listing cambia de vehículo (fusión), sus specs y fotos lo siguen.
create or replace function public.mx_listing_vehicle_moved() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  update mx_specs  set vehicle_id = new.vehicle_id where listing_id = new.id;
  update mx_photos set vehicle_id = new.vehicle_id where listing_id = new.id;
  return null;
end $$;
drop trigger if exists mx_listing_vehicle_moved on public.mx_listings;
create trigger mx_listing_vehicle_moved after update of vehicle_id on public.mx_listings
  for each row when (old.vehicle_id is distinct from new.vehicle_id)
  execute function public.mx_listing_vehicle_moved();

-- ── Registrar un precio observado ───────────────────────────────────────
-- Alarga el tramo vigente si el precio no cambió (tolerando huecos de
-- mx_settings.snapshot_gap_days por si falla un cron), o abre uno nuevo.
-- Para capturas viejas (Wayback) que caen dentro de un tramo con otro precio
-- no sobrescribe nada: devuelve 'conflicto' para que el pipeline lo registre.
-- Devuelve: 'nuevo' | 'extendido' | 'sin_cambio' | 'conflicto'.

create or replace function public.mx_record_price(
  p_listing uuid, p_price numeric, p_currency text, p_negotiable boolean, p_day date
) returns text
language plpgsql set search_path = public, pg_temp as $$
declare
  cur record;
  gap int := coalesce((select (value #>> '{}')::int from mx_settings where key = 'snapshot_gap_days'), 3);
  res text;
begin
  p_negotiable := coalesce(p_negotiable, false);

  select * into cur from mx_price_snapshots
   where listing_id = p_listing and p_day between observed_from and observed_to;
  if found then
    if cur.price is not distinct from p_price and cur.currency is not distinct from p_currency
       and cur.negotiable = p_negotiable then
      res := 'sin_cambio';
    else
      return 'conflicto';
    end if;
  else
    select * into cur from mx_price_snapshots
     where listing_id = p_listing and observed_to < p_day
     order by observed_to desc limit 1;
    if found and cur.price is not distinct from p_price and cur.currency is not distinct from p_currency
       and cur.negotiable = p_negotiable and p_day - cur.observed_to <= gap
       and not exists (select 1 from mx_price_snapshots s where s.listing_id = p_listing
                       and s.observed_from > cur.observed_to and s.observed_from <= p_day) then
      update mx_price_snapshots set observed_to = p_day where id = cur.id;
      res := 'extendido';
    else
      insert into mx_price_snapshots(listing_id, price, currency, negotiable, observed_from, observed_to)
      values (p_listing, p_price, p_currency, p_negotiable, p_day, p_day);
      res := 'nuevo';
    end if;
  end if;

  update mx_listings
     set first_seen = least(first_seen, p_day), last_seen = greatest(last_seen, p_day)
   where id = p_listing and (first_seen > p_day or last_seen < p_day);
  return res;
end $$;

-- ── Vistas ──────────────────────────────────────────────────────────────

-- Un precio por día por listing (expande los tramos).
create or replace view public.mx_price_daily with (security_invoker = true) as
  select s.listing_id, d::date as day, s.price, s.currency, s.negotiable, s.is_demo
    from public.mx_price_snapshots s,
         generate_series(s.observed_from, s.observed_to, interval '1 day') d;

-- Vehículos vigentes (sin las lápidas de fusiones). La analítica cuenta ESTO.
create or replace view public.mx_vehicles_live with (security_invoker = true) as
  select * from public.mx_vehicles where merged_into is null;

-- Estado de fuentes sin detalles de errores (público).
create or replace view public.mx_sources_public as
  select id, name, kind, base_url, capture_mode, status, last_success_at, is_demo
    from public.mx_sources where enabled;

-- ── Borrar datos demo con un comando ────────────────────────────────────

create or replace function public.mx_purge_demo() returns jsonb
language plpgsql set search_path = public, pg_temp as $$
declare out jsonb := '{}'; n int;
begin
  if not (public.mx_is_admin() or current_user in ('postgres','service_role','supabase_admin')) then
    raise exception 'Solo admin puede borrar datos demo' using errcode = '42501';
  end if;
  delete from mx_review_queue where is_demo;             get diagnostics n = row_count; out := out || jsonb_build_object('revisiones', n);
  delete from mx_transactions where is_demo;             get diagnostics n = row_count; out := out || jsonb_build_object('ventas', n);
  delete from mx_listings where is_demo;                 get diagnostics n = row_count; out := out || jsonb_build_object('listings', n);
  delete from mx_specs where is_demo;                    get diagnostics n = row_count; out := out || jsonb_build_object('specs_sueltas', n);
  delete from mx_merges m using mx_vehicles v where v.id in (m.kept_id, m.merged_id) and v.is_demo;
  update mx_vehicles set merged_into = null where is_demo and merged_into is not null;
  delete from mx_vehicles where is_demo;                 get diagnostics n = row_count; out := out || jsonb_build_object('vehiculos', n);
  delete from mx_sources where is_demo;                  get diagnostics n = row_count; out := out || jsonb_build_object('fuentes', n);
  return out;
end $$;

-- ════════════════════════════════════════════════════════════════════════
-- SEGURIDAD (RLS)
-- ════════════════════════════════════════════════════════════════════════

do $$
declare t text;
begin
  foreach t in array array[
    'mx_makes','mx_models','mx_generations','mx_versions','mx_aliases','mx_option_catalog',
    'mx_settings','mx_sources','mx_runs','mx_vehicles','mx_listings','mx_listing_private',
    'mx_specs','mx_spec_options','mx_price_snapshots','mx_photos','mx_transactions',
    'mx_fx_rates','mx_review_queue','mx_distinct_pairs','mx_merges']
  loop
    execute format('alter table public.%I enable row level security', t);
    -- Escribir (y leer todo): solo admin. service_role ignora RLS.
    execute format('drop policy if exists mx_admin_all on public.%I', t);
    execute format('create policy mx_admin_all on public.%I for all to authenticated
                    using (public.mx_is_admin()) with check (public.mx_is_admin())', t);
  end loop;
end $$;

-- ── LECTURA PÚBLICA ─────────────────────────────────────────────────────
-- Catálogos y tipo de cambio: siempre públicos.
-- Vehículos, listings, specs, fotos y precios: públicos porque son anuncios
-- públicos (decisión pendiente de tu confirmación; para cerrar a "solo
-- agregados", quita esas tablas de la segunda lista).
-- NUNCA públicos: mx_listing_private, mx_transactions (solo agregadas, Fase 6),
-- mx_runs, mx_review_queue, mx_distinct_pairs, mx_merges, mx_sources (detalle).

do $$
declare t text;
begin
  foreach t in array array[
    'mx_makes','mx_models','mx_generations','mx_versions','mx_aliases','mx_option_catalog',
    'mx_settings','mx_fx_rates',
    'mx_vehicles','mx_listings','mx_specs','mx_spec_options','mx_price_snapshots','mx_photos']
  loop
    execute format('drop policy if exists mx_public_read on public.%I', t);
    execute format('create policy mx_public_read on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

grant select on public.mx_sources_public to anon, authenticated;

-- Funciones que escriben: no las puede llamar un visitante anónimo.
revoke execute on function public.mx_record_price(uuid, numeric, text, boolean, date) from public, anon;
revoke execute on function public.mx_purge_demo() from public, anon;
grant  execute on function public.mx_record_price(uuid, numeric, text, boolean, date) to authenticated, service_role;
grant  execute on function public.mx_purge_demo() to authenticated, service_role;
