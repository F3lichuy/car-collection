# Búsqueda de imágenes en la web

La página busca fotos en la web a través de esta función de Supabase. La llave del buscador se guarda
como secreto en Supabase y nunca aparece en el código público de la página.

## Activarla (una sola vez)

1. Crea una llave en **Brave Search API** (https://brave.com/search/api/). El plan gratuito incluye
   USD 5 de crédito al mes (unas 1,000 búsquedas).
   - Alternativa: **SerpApi** (https://serpapi.com/, Google Imágenes, 250 búsquedas gratis al mes).
2. Desde la carpeta del proyecto, en una terminal:

   ```bash
   npx supabase login
   npx supabase link --project-ref tayybbmbhsqxocugwzji
   npx supabase secrets set BRAVE_API_KEY=tu_llave
   npx supabase functions deploy image-search
   ```

   Con SerpApi, en el paso 3 usa `SERPAPI_KEY=tu_llave` en su lugar.

3. Listo: en la página, "Investigar → Fotos → Web" ya muestra resultados de la web.
   Mientras no esté activada, la página usa Wikimedia Commons como respaldo.

## Qué hace

- Solo responde a usuarios con sesión iniciada (protege la cuota del buscador).
- `{ q }` busca imágenes; `{ action: "save", url }` descarga la foto elegida (solo imágenes, máx. 8 MB)
  y guarda una copia en el bucket `images`, en la carpeta del usuario.
