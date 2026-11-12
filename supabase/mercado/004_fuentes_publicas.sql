-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 004 · Fuentes visibles al público
--
-- La vista mostraba solo fuentes con enabled = true. Una fuente cargada a mano
-- (o apagada después) dejaba sus anuncios sin nombre de origen en la página.
-- Ahora: las encendidas + cualquiera que tenga anuncios (cada precio debe poder
-- rastrearse a su fuente). Sigue sin exponer errores ni configuración.
-- ════════════════════════════════════════════════════════════════════════

create or replace view public.mx_sources_public as
  select s.id, s.name, s.kind, s.base_url, s.capture_mode, s.status, s.last_success_at, s.is_demo
    from public.mx_sources s
   where s.enabled or exists (select 1 from public.mx_listings l where l.source_id = s.id);

grant select on public.mx_sources_public to anon, authenticated;
