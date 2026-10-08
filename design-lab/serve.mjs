// Servidor estático mínimo para previsualizar en local: node design-lab/serve.mjs
// Incluye, solo para desarrollo, la misma búsqueda gratuita de imágenes que hace la función image-search.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json", ".svg": "image/svg+xml", ".glb": "model/gltf-binary" };
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

async function bingImages(q, count) {
  const u = new URL("https://www.bing.com/images/async");
  u.searchParams.set("q", q); u.searchParams.set("first", "0"); u.searchParams.set("count", String(Math.min(count, 60)));
  u.searchParams.set("adlt", "strict"); u.searchParams.set("mmasync", "1");
  const html = await (await fetch(u, { headers: { "User-Agent": UA, "Accept-Language": "es-MX,es;q=0.9,en;q=0.8" } })).text();
  const out = [];
  for (const m of html.matchAll(/ m="(\{[^"]+\})"/g)) {
    try {
      const j = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
      if (!j.murl) continue;
      let source = ""; try { source = new URL(j.purl || j.murl).hostname.replace(/^www\./, ""); } catch {}
      out.push({ url: j.murl, thumb: j.turl || j.murl, title: [j.t, j.desc].filter(Boolean).join(" · "), page: j.purl || "", source, w: 0, h: 0 });
    } catch {}
  }
  return out.slice(0, count);
}

const readBody = req => new Promise(r => { let b = ""; req.on("data", d => b += d); req.on("end", () => r(b)); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  // --- solo desarrollo: búsqueda de imágenes y descarga de la foto elegida ---
  if (url.pathname === "/dev/image-search" && req.method === "POST") {
    try { const { q = "", count = 30 } = JSON.parse(await readBody(req) || "{}");
      res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ results: await bingImages(String(q).slice(0, 120), count) }));
    } catch (e) { res.writeHead(502).end(JSON.stringify({ error: String(e) })); }
    return;
  }
  if (url.pathname === "/dev/image") {
    try {
      const target = new URL(url.searchParams.get("url") || "");
      if (!/^https?:$/.test(target.protocol)) throw new Error("url");
      const r = await fetch(target, { headers: { "User-Agent": UA, "Accept": "image/*" } });
      const type = (r.headers.get("content-type") || "").split(";")[0];
      if (!r.ok || !/^image\/(jpeg|png|webp|avif)$/.test(type)) throw new Error("not image");
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) throw new Error("too big");
      res.writeHead(200, { "Content-Type": type }).end(buf);
    } catch (e) { res.writeHead(422).end(String(e)); }
    return;
  }
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = normalize(join(root, p));
  if (!file.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try { const body = await readFile(file); res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream" }).end(body); }
  catch { res.writeHead(404).end("not found"); }
}).listen(5500, () => console.log("http://localhost:5500"));
