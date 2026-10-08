// Supabase Edge Function: búsqueda de imágenes en la web + copia de la foto elegida al almacenamiento.
// La llave del buscador vive aquí como secreto (nunca en el código público de la página).
//
//   Proveedores (usa el primero que tenga llave):
//     BRAVE_API_KEY   → Brave Search API (imágenes)      https://brave.com/search/api/
//     SERPAPI_KEY     → SerpApi, Google Imágenes          https://serpapi.com/
//
//   Acciones (POST JSON, requiere sesión iniciada):
//     { q: "Ferrari F430 Giallo Modena", count?: 30 }  → { results: [{ url, thumb, title, page, source, w, h }] }
//     { action: "save", url: "https://…/foto.jpg" }    → { url: "<URL pública en el bucket images>" }

import { createClient } from "jsr:@supabase/supabase-js@2";

const ALLOWED_ORIGINS = ["https://carcollection.app", "https://www.carcollection.app", "http://localhost:5500"];
const MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

function cors(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(origin), "Content-Type": "application/json" } });

type Result = { url: string; thumb: string; title: string; page: string; source: string; w: number; h: number };

async function searchBrave(q: string, count: number, key: string): Promise<Result[]> {
  const u = new URL("https://api.search.brave.com/res/v1/images/search");
  u.searchParams.set("q", q);
  u.searchParams.set("count", String(Math.min(count, 100)));
  u.searchParams.set("safesearch", "strict");
  const r = await fetch(u, { headers: { "Accept": "application/json", "X-Subscription-Token": key } });
  if (!r.ok) throw new Error("brave " + r.status);
  const j = await r.json();
  return (j.results || []).map((x: any) => ({
    url: x.properties?.url || "", thumb: x.thumbnail?.src || x.properties?.url || "",
    title: x.title || "", page: x.url || "", source: x.source || x.meta_url?.hostname || "",
    w: x.properties?.width || 0, h: x.properties?.height || 0,
  }));
}

async function searchSerpApi(q: string, count: number, key: string): Promise<Result[]> {
  const u = new URL("https://serpapi.com/search.json");
  u.searchParams.set("engine", "google_images");
  u.searchParams.set("q", q);
  u.searchParams.set("safe", "active");
  u.searchParams.set("api_key", key);
  const r = await fetch(u);
  if (!r.ok) throw new Error("serpapi " + r.status);
  const j = await r.json();
  return (j.images_results || []).slice(0, count).map((x: any) => ({
    url: x.original || "", thumb: x.thumbnail || x.original || "", title: x.title || "",
    page: x.link || "", source: x.source || "", w: x.original_width || 0, h: x.original_height || 0,
  }));
}

// evita que la función se use para pedir direcciones internas (SSRF)
function safeImageUrl(raw: string): URL | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return null;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(h) || h.includes(":")) return null;   // sin IPs literales
    return u;
  } catch { return null; }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });
  if (req.method !== "POST") return json({ error: "method" }, 405, origin);

  // solo usuarios con sesión: protege la cuota del buscador
  const supa = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
  });
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return json({ error: "auth" }, 401, origin);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "body" }, 400, origin); }

  // ---- guardar copia de una foto elegida ----
  if (body?.action === "save") {
    const u = safeImageUrl(String(body.url || ""));
    if (!u) return json({ error: "url" }, 400, origin);
    try {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(u, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (CarCollection image saver)", "Accept": "image/*" } });
      clearTimeout(t);
      const type = (r.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!r.ok || !IMAGE_TYPES[type]) return json({ error: "not_image" }, 422, origin);
      const buf = new Uint8Array(await r.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) return json({ error: "too_big" }, 413, origin);
      const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-1", buf))).slice(0, 10).map(b => b.toString(16).padStart(2, "0")).join("");
      const path = `${user.id}/web-${hash}.${IMAGE_TYPES[type]}`;
      const up = await supa.storage.from("images").upload(path, buf, { contentType: type, upsert: true });
      if (up.error) return json({ error: "storage", detail: up.error.message }, 500, origin);
      return json({ url: supa.storage.from("images").getPublicUrl(path).data.publicUrl }, 200, origin);
    } catch (e) {
      return json({ error: "fetch", detail: String(e) }, 502, origin);
    }
  }

  // ---- búsqueda ----
  const q = String(body?.q || "").trim().slice(0, 120);
  if (q.length < 2) return json({ error: "q" }, 400, origin);
  const count = Math.max(6, Math.min(Number(body?.count) || 30, 60));
  try {
    const brave = Deno.env.get("BRAVE_API_KEY"), serp = Deno.env.get("SERPAPI_KEY");
    const results = brave ? await searchBrave(q, count, brave) : serp ? await searchSerpApi(q, count, serp) : null;
    if (!results) return json({ error: "no_provider" }, 503, origin);
    return json({ results: results.filter(r => r.url && r.thumb) }, 200, origin);
  } catch (e) {
    return json({ error: "provider", detail: String(e) }, 502, origin);
  }
});
