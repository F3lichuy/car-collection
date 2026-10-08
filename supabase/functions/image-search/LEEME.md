# Búsqueda de imágenes en la web (gratis)

La página busca fotos en la web a través de esta función de Supabase. Por defecto usa **Bing Imágenes**,
que es gratis y no necesita llave ni tarjeta. Las funciones de Supabase también son gratis en el plan actual.

- En tu computadora (`node design-lab/serve.mjs` → http://localhost:5500) ya funciona sin hacer nada:
  el servidor local hace la búsqueda.
- En carcollection.app hace falta publicar la función una vez.

## Publicarla (una sola vez)

Desde la carpeta del proyecto, en una terminal:

```bash
npx supabase login
npx supabase link --project-ref tayybbmbhsqxocugwzji
npx supabase functions deploy image-search
```

## Opcional: proveedores oficiales

Bing se lee de su página de resultados (no es una API oficial); si algún día cambia el formato, la búsqueda
puede dejar de traer resultados y la página usará Wikimedia Commons como respaldo. Para algo más estable:

```bash
npx supabase secrets set BRAVE_API_KEY=tu_llave     # Brave Search API (USD 5 de crédito gratis al mes)
npx supabase secrets set SERPAPI_KEY=tu_llave       # o SerpApi (Google Imágenes, 250 gratis al mes)
```

## Qué hace

- Solo responde a usuarios con sesión iniciada.
- `{ q }` busca imágenes; `{ action: "save", url }` descarga la foto elegida (solo imágenes, máx. 8 MB)
  y guarda una copia en el bucket `images`, en la carpeta del usuario.
