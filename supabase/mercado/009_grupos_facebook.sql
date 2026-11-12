-- ════════════════════════════════════════════════════════════════════════
-- Mercado MX · 009: fuente para el modo grupo del botón (grupos de Facebook)
--
-- El botón "Guardar en Precio de Calle", dentro de un grupo de Facebook, baja
-- solo por el grupo que tú abriste y manda las publicaciones de venta por
-- tandas a mx_capturas con source_id = 'facebook-grupos'. Las capturas
-- necesitan que la fuente exista antes de la primera corrida que sincroniza
-- sources.yaml, por eso se crea aquí también. Idempotente.
-- ════════════════════════════════════════════════════════════════════════
insert into public.mx_sources (id, name, kind, base_url, capture_mode, enabled, status)
values ('facebook-grupos', 'Grupos de Facebook (compra-venta de autos)', 'red_social', 'https://www.facebook.com/groups', 'script_local', false, 'captura_manual')
on conflict (id) do nothing;
