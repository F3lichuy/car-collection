// Extractores de datos estructurados, independientes de cada sitio:
// JSON-LD (schema.org), __NEXT_DATA__, datos RSC de Next.js App Router
// (self.__next_f), sitemaps y objetos JSON incrustados en texto.

// &#036; (WordPress escribe así el "$"), &#8220;, &nbsp;, &eacute;…
const NAMED = { quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', hellip: '…', ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’', ndash: '–', mdash: '—',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', deg: '°', middot: '·', reg: '®', copy: '©' };
const decodeEntities = s => s
  .replace(/&#(\d+);/g, (m, n) => { const c = Number(n); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; })
  .replace(/&#x([0-9a-f]+);/gi, (m, h) => { const c = parseInt(h, 16); return c > 0 && c < 0x110000 ? String.fromCodePoint(c) : m; })
  .replace(/&([a-z]+);/gi, (m, k) => NAMED[k] ?? m)
  .replace(/&amp;/g, '&');

// Todos los bloques <script type="application/ld+json"> parseados (los inválidos se omiten).
export function jsonLdBlocks(html) {
  const out = [];
  for (const m of String(html).matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { out.push(JSON.parse(m[1].trim())); } catch { try { out.push(JSON.parse(decodeEntities(m[1].trim()))); } catch { /* bloque roto */ } }
  }
  return out;
}

// Texto del payload RSC de Next.js App Router (concatenado y des-escapado).
export function nextFlight(html) {
  let s = '';
  for (const m of String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { s += JSON.parse('"' + m[1] + '"'); } catch { /* fragmento roto */ }
  }
  return s;
}

export function nextData(html) {
  const m = String(html).match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

// Lee un valor JSON completo (objeto o arreglo) que empieza en text[start].
export function readJsonAt(text, start) {
  const open = text[start], close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) return undefined;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') { depth--; if (depth === 0) { try { return JSON.parse(text.slice(start, i + 1)); } catch { return undefined; } } }
  }
  return undefined;
}

// Todos los valores JSON que siguen a "clave": en un texto (p. ej. "vehicle":{...}).
export function jsonValuesAfterKey(text, key) {
  const out = [], needle = `"${key}":`;
  let i = 0;
  while ((i = text.indexOf(needle, i)) !== -1) {
    const j = i + needle.length;
    if (text[j] === '{' || text[j] === '[') { const v = readJsonAt(text, j); if (v !== undefined) out.push(v); }
    i = j;
  }
  return out;
}

// Objetos JSON-LD (incluso dentro de RSC o @graph) cuyo @type incluye alguno de `types`.
export function findSchemaObjects(roots, types) {
  const want = new Set([].concat(types));
  const out = [];
  const visit = o => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(visit); return; }
    const t = [].concat(o['@type'] ?? []);
    if (t.some(x => want.has(x))) out.push(o);
    for (const v of Object.values(o)) if (v && typeof v === 'object') visit(v);
  };
  visit(roots);
  return out;
}

// Busca bloques JSON-LD con @context schema.org dentro de un texto cualquiera (p. ej. RSC).
export function schemaInText(text) {
  const out = [];
  let i = 0;
  while ((i = text.indexOf('{"@context":"https://schema.org"', i)) !== -1) {
    const v = readJsonAt(text, i);
    if (v !== undefined) out.push(v);
    i++;
  }
  return out;
}

// <loc> de un sitemap (urlset o sitemapindex).
export function sitemapLocs(xml) {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decodeEntities(m[1]));
}

export const stripHtml = s => s == null ? '' : decodeEntities(String(s).replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();

// URL canónica: sin fragmento, sin parámetros de rastreo, host en minúsculas, sin "/" final.
const TRACKING = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|igshid$|si$|_ga$|mibextid$|__tn__$)/i;
export function canonicalUrl(url) {
  const u = new URL(url);
  u.hash = ''; u.hostname = u.hostname.toLowerCase();
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  u.searchParams.sort();
  let s = u.toString();
  if (u.pathname.length > 1 && s.endsWith('/') && !u.search) s = s.slice(0, -1);
  return s;
}
