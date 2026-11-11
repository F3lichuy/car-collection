# Mercado MX

Inteligencia de mercado de autos de entusiasta en México. Todo con costo $0:
Supabase (plan gratuito), GitHub Actions y el sitio estático de siempre.

## Estructura

| Ruta | Qué es |
|---|---|
| `../supabase/mercado/001_esquema.sql` | Tablas, reglas anti-duplicados, funciones y seguridad (RLS). |
| `../supabase/mercado/002_taxonomia.sql` | Semilla **generada**: marcas, modelos, generaciones, versiones, alias, opciones, fuentes genéricas y ajustes. |
| `../supabase/mercado/003_antiduplicados.sql` | Fusionar, deshacer, encolar y resolver duplicados (`mx_merge_vehicles`, `mx_unmerge`, `mx_enqueue_duplicate`, `mx_resolve_duplicate`). |
| `core/dedupe.mjs` | Motor de identidad: decide si un anuncio es un auto que ya conocemos. |
| `core/phash.mjs` | Hash perceptual de fotos (completa + centro). |
| `core/vin.mjs` | Normaliza VIN/chasis y los encuentra en texto libre. |
| `data/taxonomia.mjs` | Fuente editable de la taxonomía. Edita aquí, nunca el `.sql`. |
| `scripts/build-taxonomy-sql.mjs` | Valida la taxonomía y regenera `002_taxonomia.sql`. |
| `tests/` | Pruebas sobre Postgres real (PGlite), sin tocar producción. |

## Probar localmente

```bash
cd mercado
npm install
npm test
```

Tras editar `data/taxonomia.mjs`:

```bash
npm run build:taxonomia
```

## Ingesta (Fase 3)

Probar una fuente de verdad, sin tocar Supabase (base temporal en memoria):

```bash
node scripts/ingest.mjs --seco --fuente seminuevos-com --limite 20
```

Opciones: `--fuente a,b` · `--limite N` · `--sin-fotos` · `--hoy AAAA-MM-DD` · `--reporte archivo.json`.

| Pieza | Archivo |
|---|---|
| Catálogo de fuentes (todas `enabled: false` hasta tu OK) | `sources.yaml` |
| Cliente HTTP: user-agent honesto, espera por sitio, robots.txt, reintentos, freno si el sitio deja de responder | `core/http.mjs` |
| Extractores: JSON-LD, Next.js (`__NEXT_DATA__` y RSC), sitemaps | `core/extract.mjs` |
| Normalizador por reglas y diccionarios | `core/normalize.mjs`, `data/diccionarios.mjs` |
| Pipeline: normaliza → deduplica → guarda (una transacción por anuncio; una fuente rota no tumba a las demás) | `core/pipeline.mjs`, `core/store.mjs` |
| Adaptadores | `adapters/seminuevos.mjs`, `adapters/shopify.mjs` |
| Cron diario | `../.github/workflows/mercado-ingesta.yml` (secret `SUPABASE_DB_URL`) |

Un anuncio con confianza menor a 0.7, o con versión ambigua, transmisión imposible o VIN
dudoso, entra igual pero queda en la cola de normalización para que lo revises.

## Aplicar en Supabase (solo con tu OK)

```bash
npx supabase db query --remote --file ../supabase/mercado/001_esquema.sql
npx supabase db query --remote --file ../supabase/mercado/002_taxonomia.sql
npx supabase db query --remote --file ../supabase/mercado/003_antiduplicados.sql
```

Todos son idempotentes: se pueden volver a correr.

## Anti-duplicados: cómo decide

| Evidencia | Resultado |
|---|---|
| Misma URL canónica o mismo id externo en la fuente | Mismo auto |
| Mismo VIN | Mismo auto |
| ≥2 fotos con coincidencia fuerte (≤8 bits) y specs sin contradicciones | Mismo auto |
| Fotos iguales pero año ±1, km o color que no cuadran | Revisión |
| Fingerprint: versión + año + colores + km ±3% (o 300 km) | **Siempre** revisión |
| 2+ fotos parecidas (9–12 bits) | Revisión |
| VIN distinto, par marcado "distinto", demo vs. real | Nunca se juntan |

Las fotos que aparecen en 3+ autos (banners, fotos de prensa) y las casi lisas
("foto próximamente") se ignoran. Toda fusión se puede deshacer con `mx_unmerge`, y al
deshacerla el par queda marcado como distinto.

## Datos demo

Todo dato de demostración lleva `is_demo = true`, se muestra con la etiqueta DEMO
y se borra con un solo comando:

```bash
npx supabase db query --remote "select public.mx_purge_demo()"
```

## Decisiones de diseño

- **NULL = desconocido.** Nunca se rellena un dato con un supuesto.
- **Precios por tramos.** `mx_price_snapshots` guarda `[observed_from, observed_to]` por
  precio continuo; `mx_price_daily` lo expande a un precio por día.
- **Fotos.** Solo URL + pHash de 64 bits; no se guardan imágenes.
- **Datos personales** del anuncio (nombre y teléfono del vendedor, descripción, JSON crudo)
  viven en `mx_listing_private`, que siempre es solo-admin.
- **Fusiones reversibles.** Un vehículo fusionado queda como lápida (`merged_into`) y la
  fusión se registra en `mx_merges` con lo que se movió.
- **Clásico** no es un segmento fijo: se calcula por año con `mx_settings.classic_age_years`.
- **Wayback.** Se marca con `capture_method = 'wayback'`; `source_id` sigue siendo la agencia
  original, para no perder de dónde era el anuncio.
