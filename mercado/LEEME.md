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

Opciones: `--fuente a,b` · `--limite N` · `--sin-fotos` · `--hoy AAAA-MM-DD` · `--reporte archivo.json`
· `--exportar carga.sql` · `--semilla archivo.json`.

Para que el anti-duplicados compare contra lo que **ya está en producción** (y no contra una base vacía):

```bash
node scripts/semilla-prod.mjs                       # copia de solo lectura → .capturas/semilla-prod.json
node scripts/ingest.mjs --seco --semilla .capturas/semilla-prod.json --fuente miura-motors --exportar .capturas/carga.sql
```

El SQL exportado deja fuera las filas que venían de la semilla: solo lleva lo nuevo.

| Pieza | Archivo |
|---|---|
| Catálogo de fuentes (todas `enabled: false` hasta tu OK) | `sources.yaml` |
| Cliente HTTP: user-agent honesto, espera por sitio, robots.txt, reintentos, freno si el sitio deja de responder | `core/http.mjs` |
| Extractores: JSON-LD, Next.js (`__NEXT_DATA__` y RSC), sitemaps | `core/extract.mjs` |
| Normalizador por reglas y diccionarios | `core/normalize.mjs`, `data/diccionarios.mjs` |
| Pipeline: normaliza → deduplica → guarda (una transacción por anuncio; una fuente rota no tumba a las demás) | `core/pipeline.mjs`, `core/store.mjs` |
| Adaptadores por plataforma (uno sirve a varias agencias; se elige con `adapter:` en `sources.yaml`) | `shopify` (EuroClassic) · `woocommerce` (JAH) · `vehica` (NetMotors) · `stm-listings` (Montecarlo) · `ficha` = sitemap + JSON-LD o etiquetas de la ficha (Miura, Imperia, Mulsanne) · `seminuevos` (en pausa) |
| Cron diario | `../.github/workflows/mercado-ingesta.yml` (secret `SUPABASE_DB_URL`) |

Un anuncio con confianza menor a 0.7, o con versión ambigua, transmisión imposible o VIN
dudoso, entra igual pero queda en la cola de normalización para que lo revises.

Reglas de datos de los adaptadores:
- **Moneda**: solo la que el sitio declara. Si muestra "$" sin moneda, `config.currency` en `sources.yaml`
  la fija con una nota de cómo se verificó; sin eso el precio queda vacío (no se adivina).
- **Precio 0** o "pregunta por él" = sin precio.
- **Vendidos/agotados** (bandera del sitio o JSON-LD `SoldOut`) no se toman como en venta.
- **Kilometraje de relleno**: si el mismo número exacto aparece en ≥20 % de los autos de una agencia, se trata como sin dato.
- **Réplicas, tributos y kit cars** quedan fuera de la taxonomía; "look X" / "estilo X" no define la versión.
- **Fecha de publicación** (`mx_listings.published_on`): solo la que declara la fuente (Shopify `published_at`,
  WordPress `date`, JSON-LD `datePosted`/`datePublished`, meta `article:published_time`, Mercado Libre `start_time`).
  Si la fuente no la da, queda vacía y la página cuenta "desde que lo vimos" (`first_seen`) y lo dice así.
  La primera fecha que dio la fuente no se reescribe. Al exportar con `--semilla`, a los anuncios que ya estaban
  en producción solo se les completa la fecha si les faltaba.

## Mercado Libre (API oficial, con tu app)

Su robots.txt no permite que un agente lea las páginas (tampoco manejando tu navegador), así que va por la API
con tu app de desarrollador gratuita. Se corre en tu terminal; las llaves no se guardan:

```bash
node scripts/ml-vendedor.mjs 3163409841     # un vendedor (Motorstalgia)
node scripts/ml-vendedor.mjs --modelos      # cada modelo de la taxonomía, para llegar a 5+ comparables
node scripts/ingest.mjs --seco --semilla .capturas/semilla-prod.json --fuente motorstalgia-mty --archivo .capturas/mercadolibre-3163409841.json --exportar .capturas/carga-ml.sql
```

Solo guarda anuncios activos con precio en MXN y dentro de la taxonomía; trae atributos (año, km, transmisión,
color, versión), descripción y fecha de publicación.

## Datos capturados a mano

En la ficha de un auto, un admin ve "Completar datos". Se guarda con `mx_save_manual_specs` (migración 005) en una
fila de `mx_specs` sin anuncio (`listing_id` null) con quién y cuándo. En la página manda sobre lo que dice el
anuncio, campo por campo, y se marca **a mano**. Las notas sirven para anotar de dónde salió el dato.

## Botón "Guardar en Precio de Calle" (Facebook Marketplace y Mercado Libre)

Mercado Libre cerró su buscador a apps de terceros (403) y Facebook prohíbe la recolección automática, así que
esos dos entran solo cuando **tú** navegas: el botón (`../captura-marcador.js`, instalado desde el panel "Agregar
autos" de Precio de Calle) lee la página que estás viendo, la manda a carcollection.app (`#capturar`), la revisas y
se guarda en `mx_capturas` (migración 006, solo admin). La corrida diaria la pasa por el pipeline con el adaptador
`capturas` (`core/capturas.mjs`): normalizador, anti-duplicados, solo pesos; deja el resumen en la captura.
Volver a capturar el mismo auto otro día registra su precio de ese día (así se ven las bajadas).
Páginas de prueba del botón: `tests/fixtures/captura/`.

## Aplicar en Supabase (solo con tu OK)

```bash
npx supabase db query --remote --file ../supabase/mercado/001_esquema.sql
npx supabase db query --remote --file ../supabase/mercado/002_taxonomia.sql
npx supabase db query --remote --file ../supabase/mercado/003_antiduplicados.sql
npx supabase db query --remote --file ../supabase/mercado/004_fuentes_publicas.sql
npx supabase db query --remote --file ../supabase/mercado/005_publicacion_y_captura.sql
npx supabase db query --remote --file ../supabase/mercado/006_capturas.sql
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
