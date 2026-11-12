-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 006: capturas con el botón "Guardar en Precio de Calle"
--
-- Mientras navegas Facebook Marketplace o Mercado Libre, el botón lee los
-- autos de la página que TÚ estás viendo y los manda a carcollection.app.
-- Ahí los revisas y los guardas aquí como "pendientes". No entran directo a
-- mx_listings: la corrida diaria los pasa por el normalizador y el
-- anti-duplicados (el mismo motor que todo lo demás) y anota el resultado.
-- Solo admin escribe y lee (RLS). Nunca públicas: pueden traer descripciones
-- con datos de contacto.
-- ════════════════════════════════════════════════════════════════════════

create table if not exists public.mx_capturas (
  id           bigint generated always as identity primary key,
  captured_at  timestamptz not null default now(),
  captured_by  uuid default auth.uid(),
  source_id    text not null references public.mx_sources(id) on update cascade,
  page_url     text not null check (page_url ~ '^https://'),
  items        jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 200
                                     and pg_column_size(items) <= 524288),
  status       text not null default 'pendiente' check (status in ('pendiente', 'procesada', 'error')),
  processed_at timestamptz,
  result       jsonb
);
create index if not exists mx_capturas_pendientes on public.mx_capturas(id) where status = 'pendiente';

alter table public.mx_capturas enable row level security;
drop policy if exists mx_admin_all on public.mx_capturas;
create policy mx_admin_all on public.mx_capturas for all to authenticated
  using (public.mx_is_admin()) with check (public.mx_is_admin());
revoke all on public.mx_capturas from anon;

-- Las dos fuentes que llegan por el botón (la corrida diaria también las sincroniza desde sources.yaml).
insert into public.mx_sources (id, name, kind, base_url, capture_mode, enabled, status)
values ('facebook-marketplace', 'Facebook Marketplace', 'marketplace', 'https://www.facebook.com/marketplace', 'script_local', false, 'captura_manual'),
       ('mercadolibre-autos', 'Mercado Libre Autos', 'portal', 'https://autos.mercadolibre.com.mx', 'script_local', false, 'captura_manual')
on conflict (id) do nothing;
