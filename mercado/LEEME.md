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
| Adaptadores por plataforma (uno sirve a varias agencias; se elige con `adapter:` en `sources.yaml`) | `shopify` (EuroClassic) · `woocommerce` (JAH) · `vehica` (NetMotors) · `stm-listings` (Montecarlo) · `ficha` = sitemap + JSON-LD o etiquetas de la ficha (Miura, Imperia, Mulsanne, Elegance Company Motors, Prestige DLC, El Auto Clásico) · `cardealer` = tema Car Dealer de WordPress (Euromotors) · `next-inventario` = inventario en `__NEXT_DATA__` (GM Motors) · `seminuevos` (en pausa) |
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

En el mismo panel, **Buscar más autos por ciudad** arma las búsquedas de un modelo en Facebook Marketplace
(CDMX, Guadalajara, Monterrey, Querétaro, Puebla, Mérida, Cancún y "cerca de mí", desde $100,000) y en Mercado Libre.
Solo son ligas que abre el admin; los modelos con menos autos para comparar salen primero.

## Modo grupo: grupos y búsquedas de Facebook

También funciona en la **búsqueda de Facebook** (`facebook.com/search/…`): buscas lo que quieras ("ferrari en venta
mexico"), eliges los filtros de Facebook (Publicaciones, "Fecha de publicación" por año, "Publicaciones recientes") y
le das clic al botón. En la búsqueda no se exige que el texto mencione una marca (lo que buscaste ya es el filtro);
la corrida deja fuera lo que no está en la taxonomía. Reconoce ligas de grupos, de páginas (`/pagina/posts/pfbid…`),
`permalink.php` y Marketplace. Página de prueba: `tests/fixtures/captura/fb-busqueda.html`.

Dentro de un grupo de compra-venta (`facebook.com/groups/…`), el mismo botón ya no lee una sola vez: **baja solo por el
grupo en tu pestaña**, a ritmo pausado (una pantalla cada ~4 s), hasta 30 minutos o hasta el final del grupo. Un panel
abajo a la derecha muestra cuántas publicaciones leyó y cuántos autos encontró, con Pausar y Terminar.

- Cada publicación se pone al centro de la pantalla, se le da clic a **"Ver más"** y se espera a que salga el texto
  completo. La fecha exacta, el texto completo y las **fotos en su tamaño original (sin el recorte de la cuadrícula)**
  salen de los datos que Facebook ya le mandó a tu navegador (los de arranque y los que llegan al bajar). Si una
  publicación no los trae, se abre su primera foto en el visor de Facebook, se recorren con "Siguiente" y se cierra;
  si tampoco, el globo de la hora y las fotos que se ven.
- Sin precio (aun con el texto completo, p. ej. "informes por inbox") no se guarda; el panel dice cuántas.
- De cada publicación de venta: fecha exacta (la del globo de la hora), texto, precio escrito a mano (`$1,650,000`,
  `4.2 mdp`, `850 mil`; con "antes … ahora" guarda la rebaja), año, km, ciudad, fotos y la liga a la publicación.
- No se atora: los bloques de Reels, videos, personas y páginas de la búsqueda se brincan sin tocarlos; nunca se le
  da clic a un "Ver más" que sea liga; si algo saca la página (Reels, video, foto) regresa solo (3 intentos, si no, se
  pausa y lo dice); ninguna publicación lo detiene más de 25 s. En la búsqueda conviene la pestaña "Publicaciones".
- Antes de leer una publicación espera a que Facebook termine de dibujarla (texto y fotos estables, mínimo 1.5 s).
  Quita emojis, banderas y viñetas del texto. El título es el renglón con marca o modelo; si no hay, uno con año y
  palabras; nunca un renglón que solo dice km, precio o ciudad.
- Se brincan y se cuentan aparte ("no son autos"): casas, departamentos, terrenos y locales; relojes (Rolex, AP, Patek…), piezas y accesorios cuando el título
  empieza con ellos (rines, faros, defensas, asientos… salvo que diga el kilometraje), modelos a escala y rentas.
  La lista "Por revisar" los vuelve a revisar (llegan sin palomita).
- Se brinca "busco/compro", pláticas sin precio ni año, comentarios y lo vendido. No lee quién publicó; quita teléfonos,
  correos y ligas de WhatsApp del texto.
- Manda tandas de 25 a la ventana de carcollection.app que abre al empezar. **Nada se guarda solo**: todo cae en la lista
  **"Por revisar"** (también lo de Marketplace y Mercado Libre). Ahí marcas cuáles sí, corriges la marca y el modelo
  detectados y guardas; los demás se descartan. La lista vive en ese navegador hasta que la guardas.
- **Marca y modelo** se reconocen con el catálogo de la base (modelos y alias, también los que creaste): "Porsche
  Veracruz … este 911 Turbo S" → Porsche · 911. Si no está, la palabra que sigue a la marca, saltando ciudades, zonas,
  nombres de agencia y palabras comunes. Arriba de la lista van los que traen marca y modelo (✓ = del catálogo); los
  incompletos llegan sin palomita y abajo (al completarlos se marcan solos).
- **Precio editable** en cada auto de la lista (en pesos: `1,650,000`, `1.65 mdp`, `850 mil`): al corregirlo se vuelve a
  evaluar (uno "sin precio" o "muy barato" puede quedar marcado) y se guarda el que escribiste.
- **Todas las fotos y la liga exacta**: la publicación se reconoce en los datos de Facebook por su liga, su texto o
  cualquiera de sus fotos. Si ahí vienen menos de 4 fotos, se recorren todas en el visor ("Foto siguiente" o →) y se
  juntan sin repetir. La liga a la publicación sale de la hora; si no, del número que llevan las ligas de sus fotos
  (`set=pcb.<número>`), con el grupo de la página o del encabezado de la publicación.
- **Fotos que subes tú** (en la lista "Por revisar" y en la ficha de cualquier auto guardado, solo admin): eliges
  archivos, los arrastras o pegas una imagen copiada (Ctrl + V). Se reducen a 1600 px, se guardan en el almacenamiento
  "images" de Supabase (no caducan, a diferencia de las ligas de fotos de Facebook) y quedan como portada. En la ficha
  se agregan a `mx_photos` del anuncio más reciente; la corrida de cada 10 minutos les calcula la huella (repetidos).
- **Cualquier marca y modelo**: si apruebas un auto cuyo modelo no está en la taxonomía (BMW M3, Ferrari Roma, Nissan
  Versa…), la corrida crea la marca y el modelo en `mx_makes`/`mx_models` (sin generaciones) y desde ahí lo reconoce
  siempre. Lo que apruebas no vuelve a la cola de normalización por confianza baja.
- Llegan **sin palomita**, con el motivo: los que dicen que no funcionan o son para piezas ("no arranca", "para piezas",
  "motor desvielado"…), los de menos de $100,000 MXN, los sin precio y los en dólares. En las fuentes que no pasan por
  "Por revisar" (agencias, Wayback), esos mismos quedan fuera (`JUNK` y `MIN_PRICE_MXN` en `core/normalize.mjs`).
- El día de cada auto es el de la publicación: una de hace meses entra como "ya no aparece"; una de esta semana, activa.
  La misma publicación vista otro día no cuenta como que sigue en venta. Un auto republicado con otro precio se une al
  anterior por sus fotos (así salen las rebajas).
- Facebook prohíbe la recolección automática y puede pedir verificación o limitar la cuenta si nota actividad rara:
  úsalo en sesiones cortas, mientras estás en la computadora. Página de prueba: `tests/fixtures/captura/fb-grupo.html`.

## Fotos de las fuentes web

- `ficha` lee también `srcset`/`data-srcset` y se queda con la versión más grande de cada foto (YOOtheme de Joomla
  sirve cada foto en varios anchos desde `/templates/yootheme/cache/`, como Exotic Avenue desde 2026-11).
- Si el adaptador leyó la ficha completa (`fotos_completas`: `ficha` y WooCommerce), la corrida quita del anuncio las
  fotos que el sitio ya no publica (nunca las que subiste tú); las nuevas van al final.
- En la página, si una portada ya no abre se prueba la siguiente (hasta 8), y las fotos de Facebook (caducan) van al final.
- Diagnóstico de solo lectura: Actions → "Mercado MX · diagnóstico de fotos" (`scripts/diagnostico-fotos.mjs`): por
  fuente, anuncios sin fotos, fotos guardadas que ya no abren y qué fotos encuentra hoy el adaptador.

## Wayback Machine (anuncios ya borrados)

`adapters/wayback.mjs` busca en el índice público de archive.org (CDX) copias de anuncios de Mercado Libre, Seminuevos,
Kavak y Autocosmos cuya dirección menciona una marca o modelo de la taxonomía, y abre una copia por anuncio por mes.
Cada copia entra con **su** fecha: varias copias del mismo anuncio = su historial de precio. Se guardan con el
`source_id` del sitio original y `capture_method = 'wayback'`; lo viejo entra como "ya no aparece".

```bash
node scripts/ingest.mjs --seco --fuente wayback --limite 30          # probar, sin tocar Supabase
```

Avance entre corridas: `.capturas/wayback-estado.json` (en GitHub Actions vive en la caché). Cada corrida lee hasta
`max_snapshots_per_run` copias (250, ~25 min) y sigue donde se quedó; al terminar un sitio lo repasa cada 30 días.
En GitHub, "Run workflow" con **seco** prueba cualquier fuente sin tocar la base.

## Aplicar en Supabase (solo con tu OK)

```bash
npx supabase db query --remote --file ../supabase/mercado/001_esquema.sql
npx supabase db query --remote --file ../supabase/mercado/002_taxonomia.sql
npx supabase db query --remote --file ../supabase/mercado/003_antiduplicados.sql
npx supabase db query --remote --file ../supabase/mercado/004_fuentes_publicas.sql
npx supabase db query --remote --file ../supabase/mercado/005_publicacion_y_captura.sql
npx supabase db query --remote --file ../supabase/mercado/006_capturas.sql
npx supabase db query --remote --file ../supabase/mercado/010_grupos_facebook.sql
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
