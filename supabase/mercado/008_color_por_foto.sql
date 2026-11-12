-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 008 · Color estimado por la foto
--
-- Cuando el anuncio no dice el color, se estima de las primeras fotos (solo colores vivos:
-- rojo, naranja, amarillo, verde, azul, morado, rosa). Se guarda por foto; el auto toma el de su
-- portada (mercado/core/photocolor.mjs). En la página siempre se muestra como "estimado por la foto".
-- color_checked: ya se revisó esa foto (aunque no se haya podido estimar), para no volver a bajarla.
-- Idempotente.
-- ════════════════════════════════════════════════════════════════════════
alter table public.mx_photos add column if not exists color_family text;
alter table public.mx_photos add column if not exists color_share real;
alter table public.mx_photos add column if not exists color_checked boolean not null default false;
do $$ begin
  alter table public.mx_photos add constraint mx_photos_color_family_ok
    check (color_family is null or color_family in ('rojo','naranja','amarillo','verde','azul','morado','rosa'));
exception when duplicate_object then null; end $$;

-- ── Capturas del botón: procesadas en minutos ───────────────────────────
-- Un proceso cada ~10 minutos (GitHub Actions) toma las capturas pendientes. 'procesando' + claimed_at
-- evitan que la corrida diaria y la de capturas tomen la misma captura a la vez; si un proceso se cae,
-- a la hora se puede volver a tomar.
alter table public.mx_capturas add column if not exists claimed_at timestamptz;
alter table public.mx_capturas drop constraint if exists mx_capturas_status_check;
alter table public.mx_capturas add constraint mx_capturas_status_check
  check (status in ('pendiente', 'procesando', 'procesada', 'error'));
