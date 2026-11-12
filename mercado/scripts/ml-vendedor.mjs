// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Mercado Libre por la API oficial (con TU app de desarrollador).
// Se corre en TU terminal: las llaves se escriben aquí, no se guardan en
// ningún archivo y no se muestran. (Su robots.txt no permite que un agente
// lea las páginas: la API es el camino permitido.)
//
//   cd mercado
//   node scripts/ml-vendedor.mjs 3163409841     un vendedor (Motorstalgia)
//   node scripts/ml-vendedor.mjs --modelos      todos los modelos de la taxonomía,
//                                               para llegar a 5+ comparables por modelo
//   (--por-modelo 100: máximo de anuncios por modelo; --sin-descripcion)
//
// Pide: App ID, clave secreta y el código (TG-…) que aparece en la barra de
// direcciones después de autorizar. Escribe .capturas/mercadolibre-<…>.json
// (carpeta ignorada por git) con los anuncios, sin tokens. Solo autos con
// precio en MXN (regla: nada de precios de otros mercados).
// ════════════════════════════════════════════════════════════════════════
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';
import { makes, models } from '../data/taxonomia.mjs';
import { normalizeListing } from '../core/normalize.mjs';

const args = process.argv.slice(2);
const opt = n => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const BY_MODEL = args.includes('--modelos');
const SELLER = args.find(a => /^\d+$/.test(a));
if (!BY_MODEL && !SELLER) { console.error('Uso: node scripts/ml-vendedor.mjs <id del vendedor>   |   node scripts/ml-vendedor.mjs --modelos'); process.exit(2); }
const PER_MODEL = Number(opt('por-modelo') ?? 100);
const WITH_DESC = !args.includes('--sin-descripcion');
// Categoría "Autos y Camionetas" de Mercado Libre México.
// TODO verificar en la primera corrida: si /categories/MLM1744 no es esa, el script avisa.
const CARS_CATEGORY = 'MLM1744';

const REDIRECT = process.env.ML_REDIRECT_URI ?? 'https://carcollection.app/';
const API = 'https://api.mercadolibre.com';
const UA = 'MercadoMX/0.1 (+https://carcollection.app)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Entrada oculta: después de la pregunta no se escribe NADA en pantalla (ni asteriscos).
// Antes se re-dibujaba la línea con la pregunta y lo pegado quedaba a la vista.
function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    if (hidden) rl._writeToOutput = s => { if (!muted) rl.output.write(s); };
    rl.question(question, a => { rl.close(); if (hidden) process.stdout.write('  (recibida)\n'); resolve(a.trim()); });
    if (hidden) muted = true;
  });
}

async function api(path, token) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(API + path, { headers: { authorization: `Bearer ${token}`, 'user-agent': UA, accept: 'application/json' } });
    if (r.status === 429 || r.status >= 500) { await sleep(2000 * (i + 1)); continue; }
    const body = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(`${r.status} ${body.message || body.error || ''} en ${path.split('?')[0]}`); e.status = r.status; throw e; }
    return body;
  }
  throw new Error(`Mercado Libre no respondió en ${path.split('?')[0]}`);
}

const clientId = (process.env.ML_CLIENT_ID || await ask('App ID (client_id): ')).trim();
let clientSecret = (process.env.ML_CLIENT_SECRET || await ask('Clave secreta / Secret Key (al pegarla no se ve nada; pega y presiona Enter): ', { hidden: true })).trim();
// Como al pegar no se ve nada, es fácil pegarla dos veces: si las dos mitades son idénticas, va una.
if (clientSecret.length % 2 === 0 && clientSecret.slice(0, clientSecret.length / 2) === clientSecret.slice(clientSecret.length / 2)) {
  clientSecret = clientSecret.slice(0, clientSecret.length / 2);
  console.log('  (la clave venía pegada dos veces; uso una)');
}
console.log(`  clave de ${clientSecret.length} caracteres`);

async function oauth(params) {
  const r = await fetch(`${API}/oauth/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': UA },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !!j.access_token, status: r.status, token: j.access_token, why: j.message || j.error || '' };
}
// ¿Deja buscar? (prueba con un vendedor conocido)
async function canSearch(token) {
  const r = await fetch(`${API}/sites/MLM/search?seller_id=3163409841&limit=1`, { headers: { authorization: `Bearer ${token}`, 'user-agent': UA, accept: 'application/json' } });
  return { ok: r.ok, status: r.status };
}

// 1) Primero la llave de la app sola (client_credentials): si sirve, la captura diaria
//    puede correr sin que autorices nada cada vez.
let token = null;
const cc = await oauth({ grant_type: 'client_credentials' });
if (cc.ok) {
  const s = await canSearch(cc.token);
  console.log(`· Llave de la app: ${s.ok ? 'SÍ deja buscar' : `no deja buscar (${s.status})`}  [RESULTADO_CLIENT_CREDENTIALS=${s.ok ? 'ok' : s.status}]`);
  if (s.ok) token = cc.token;
} else {
  console.log(`· Llave de la app: no dio token (${cc.status} ${cc.why})  [RESULTADO_CLIENT_CREDENTIALS=sin_token]`);
  // App ID o clave equivocadas: la autorización con tu cuenta fallaría igual.
  if (/invalid client/i.test(cc.why)) {
    console.error(`\n✗ La App ID o la clave secreta no coinciden (la App ID que llegó termina en ${clientId.slice(-4)}, la clave tiene ${clientSecret.length} caracteres).`);
    console.error('  Copia otra vez la clave con el botón de copiar de tu app y vuelve a correr el programa.');
    process.exit(1);
  }
}
if (args.includes('--solo-probar')) process.exit(token ? 0 : 1);

// 2) Si no, autorización con tu cuenta (código TG-…, sirve una sola vez)
if (!token) {
  console.log(`\nAbre esta dirección, inicia sesión con tu cuenta y autoriza la app:\n\n  https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT)}\n`);
  console.log('Te va a llevar a carcollection.app con "?code=TG-..." en la barra de direcciones. Copia esa dirección completa (vence en minutos).');
  const code = (process.env.ML_CODE || await ask('Pega aquí la dirección o el código (TG-…): ')).replace(/^.*[?&]code=/, '').replace(/&.*$/, '');
  const ac = await oauth({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT });
  if (!ac.ok) {
    console.error(`\nNo se pudo obtener el token: ${ac.status} ${ac.why}`);
    console.error('Revisa que la URI de redirección de tu app sea exactamente', REDIRECT, 'y que el código sea nuevo (sirve una sola vez).');
    process.exit(1);
  }
  const s = await canSearch(ac.token);
  console.log(`· Con tu cuenta: ${s.ok ? 'SÍ deja buscar' : `no deja buscar (${s.status})`}  [RESULTADO_AUTH_CODE=${s.ok ? 'ok' : s.status}]`);
  token = ac.token;
}
console.log('✓ Conectado a Mercado Libre');

// 2) ids: del vendedor, o de cada modelo de la taxonomía
async function searchIds(query, max) {
  const ids = [];
  let total = Infinity;
  for (let offset = 0; offset < total && offset < max; offset += 50) {
    const r = await api(`/sites/MLM/search?${query}&offset=${offset}&limit=${Math.min(50, max - offset)}`, token);
    total = r.paging?.total ?? 0;
    ids.push(...(r.results ?? []).map(x => x.id));
    if (!(r.results ?? []).length) break;
    await sleep(800);
  }
  return { ids, total };
}

const ids = new Set();
try {
  if (SELLER) {
    const { ids: found, total } = await searchIds(`seller_id=${SELLER}`, 1000);
    found.forEach(i => ids.add(i));
    console.log(`  vendedor ${SELLER}: ${found.length} de ${total}`);
  }
  if (BY_MODEL) {
    try { const c = await api(`/categories/${CARS_CATEGORY}`, token); console.log(`  categoría ${CARS_CATEGORY}: ${c.name}`); }
    catch (e) { console.error(`  ⚠ no pude confirmar la categoría ${CARS_CATEGORY} (${e.message}). Avísale a Claude.`); }
    const makeName = Object.fromEntries(makes.map(m => [m.id, m.name]));
    for (const m of models) {
      const q = `${makeName[m.make] ?? m.make} ${m.name}`;
      const { ids: found, total } = await searchIds(`category=${CARS_CATEGORY}&q=${encodeURIComponent(q)}`, PER_MODEL);
      found.forEach(i => ids.add(i));
      console.log(`  ${q}: ${found.length} de ${total}`);
    }
  }
} catch (e) {
  console.error(`\n✗ La búsqueda no está disponible para esta app: ${e.message}`);
  console.error('  Mercado Libre restringe la búsqueda para algunas apps. Avísale a Claude con este mensaje.');
  process.exit(1);
}
console.log(`✓ ${ids.size} anuncios encontrados`);

// 3) detalle en lotes de 20 (atributos: año, km, transmisión, color, versión…)
const all = [...ids], items = [];
for (let i = 0; i < all.length; i += 20) {
  const batch = await api(`/items?ids=${all.slice(i, i + 20).join(',')}`, token);
  for (const b of batch) if (b.code === 200 && b.body) items.push(b.body);
  await sleep(800);
}

const attr = (it, id) => (it.attributes ?? []).find(a => a.id === id)?.value_name ?? null;
let out = items.filter(it => it.status === 'active' && it.currency_id === 'MXN').map(it => ({
  external_id: it.id, url: it.permalink, title: it.title, status: it.status,
  make: attr(it, 'BRAND'), model: attr(it, 'MODEL'), version: attr(it, 'TRIM'), year: attr(it, 'VEHICLE_YEAR'),
  km: attr(it, 'KILOMETERS'), transmission: attr(it, 'TRANSMISSION'), color_ext: attr(it, 'COLOR'), body: attr(it, 'VEHICLE_BODY_TYPE'),
  price: it.price, currency: it.currency_id,
  city: it.location?.city?.name ?? it.seller_address?.city?.name ?? null, state: it.location?.state?.name ?? it.seller_address?.state?.name ?? null,
  photos: (it.pictures ?? []).map(p => p.secure_url || p.url).filter(Boolean),
  published_on: it.start_time ?? it.date_created ?? null,
  seller_type: SELLER && String(it.seller_id) === SELLER ? 'broker' : 'desconocido',
  extra: { ml_seller_id: it.seller_id ?? null, precio_anterior_declarado: it.original_price ?? null, ml_ultima_modificacion: it.last_updated ?? null },
}));
const skipped = items.length - out.length;
// solo lo que entra a la taxonomía (no se piden descripciones de autos que no interesan)
out = out.filter(a => normalizeListing({ source_id: 'mercadolibre', ...a }).inScope);
console.log(`✓ ${out.length} dentro de la taxonomía (${skipped} sin precio en MXN o no activos se omitieron)`);

// 4) descripción: ahí suelen estar factura, dueños, servicios
if (WITH_DESC) {
  for (const a of out) {
    try { a.description = (await api(`/items/${a.external_id}/description`, token)).plain_text ?? null; } catch { /* sin descripción */ }
    await sleep(500);
  }
}

mkdirSync(new URL('../.capturas/', import.meta.url), { recursive: true });
const name = ['mercadolibre', SELLER, BY_MODEL ? 'modelos' : null].filter(Boolean).join('-');
writeFileSync(new URL(`../.capturas/${name}.json`, import.meta.url), JSON.stringify({ vendedor: SELLER ?? null, capturado: new Date().toISOString(), anuncios: out }, null, 2));
console.log(`✓ ${out.length} anuncios guardados en mercado/.capturas/${name}.json (sin tokens).`);
console.log('Listo. Avísale a Claude para cargarlos.');
