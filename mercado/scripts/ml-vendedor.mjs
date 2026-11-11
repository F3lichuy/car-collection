// ════════════════════════════════════════════════════════════════════════
// Mercado MX · Traer los anuncios de un vendedor de Mercado Libre por la API
// oficial (con TU app de desarrollador). Se corre en TU terminal: las llaves
// se escriben aquí, no se guardan en ningún archivo y no se muestran.
//
//   cd mercado
//   node scripts/ml-vendedor.mjs 3163409841
//
// Pide: App ID, clave secreta y el código (TG-…) que aparece en la barra de
// direcciones después de autorizar. Escribe .capturas/mercadolibre-<id>.json
// (carpeta ignorada por git) con los anuncios, sin tokens.
// ════════════════════════════════════════════════════════════════════════
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync } from 'node:fs';

const SELLER = process.argv[2];
if (!/^\d+$/.test(SELLER ?? '')) { console.error('Uso: node scripts/ml-vendedor.mjs <id del vendedor>   (p. ej. 3163409841)'); process.exit(2); }
const REDIRECT = process.env.ML_REDIRECT_URI ?? 'https://carcollection.app/';
const API = 'https://api.mercadolibre.com';
const UA = 'MercadoMX/0.1 (+https://carcollection.app)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ask(question, { hidden = false } = {}) {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    rl.question(question, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
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

const clientId = process.env.ML_CLIENT_ID || await ask('App ID (client_id): ');
const clientSecret = process.env.ML_CLIENT_SECRET || await ask('Clave secreta (no se muestra): ', { hidden: true });
console.log(`\nAbre esta dirección, inicia sesión con tu cuenta y autoriza la app:\n\n  https://auth.mercadolibre.com.mx/authorization?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(REDIRECT)}\n`);
console.log('Te va a llevar a carcollection.app con "?code=TG-..." en la barra de direcciones. Copia ese código (vence en minutos).');
const code = (process.env.ML_CODE || await ask('Código (TG-…): ')).replace(/^.*[?&]code=/, '').replace(/&.*$/, '');

// 1) código → token (no se guarda en ningún lado)
const tr = await fetch(`${API}/oauth/token`, {
  method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': UA },
  body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, client_secret: clientSecret, code, redirect_uri: REDIRECT }),
});
const tok = await tr.json().catch(() => ({}));
if (!tr.ok || !tok.access_token) {
  console.error(`\nNo se pudo obtener el token: ${tr.status} ${tok.message || tok.error || ''}`);
  console.error('Revisa que la URI de redirección de tu app sea exactamente', REDIRECT, 'y que el código sea nuevo (sirve una sola vez).');
  process.exit(1);
}
const token = tok.access_token;
console.log('✓ Conectado a Mercado Libre');

// 2) anuncios del vendedor (búsqueda oficial por seller_id)
let ids = [], total = Infinity;
try {
  for (let offset = 0; offset < total && offset < 1000; offset += 50) {
    const r = await api(`/sites/MLM/search?seller_id=${SELLER}&offset=${offset}&limit=50`, token);
    total = r.paging?.total ?? 0;
    ids.push(...(r.results ?? []).map(x => x.id));
    if (!(r.results ?? []).length) break;
    await sleep(1000);
  }
} catch (e) {
  console.error(`\n✗ La búsqueda por vendedor no está disponible para esta app: ${e.message}`);
  console.error('  Mercado Libre restringió esta búsqueda para apps nuevas. Avísale a Claude: hay que usar el plan B (capturar desde tu navegador).');
  process.exit(1);
}
console.log(`✓ ${ids.length} anuncios encontrados`);

// 3) detalle en lotes de 20 (atributos: año, km, transmisión, color, versión…)
const items = [];
for (let i = 0; i < ids.length; i += 20) {
  const batch = await api(`/items?ids=${ids.slice(i, i + 20).join(',')}`, token);
  for (const b of batch) if (b.code === 200 && b.body) items.push(b.body);
  await sleep(1000);
}

const attr = (it, id) => (it.attributes ?? []).find(a => a.id === id)?.value_name ?? null;
const out = items.map(it => ({
  external_id: it.id, url: it.permalink, title: it.title, status: it.status,
  make: attr(it, 'BRAND'), model: attr(it, 'MODEL'), version: attr(it, 'TRIM'), year: attr(it, 'VEHICLE_YEAR'),
  km: attr(it, 'KILOMETERS'), transmission: attr(it, 'TRANSMISSION'), color_ext: attr(it, 'COLOR'), body: attr(it, 'VEHICLE_BODY_TYPE'),
  price: it.price, currency: it.currency_id,
  city: it.location?.city?.name ?? it.seller_address?.city?.name ?? null, state: it.location?.state?.name ?? it.seller_address?.state?.name ?? null,
  photos: (it.pictures ?? []).map(p => p.secure_url || p.url).filter(Boolean),
  date_created: it.date_created,
}));
mkdirSync(new URL('../.capturas/', import.meta.url), { recursive: true });
const file = new URL(`../.capturas/mercadolibre-${SELLER}.json`, import.meta.url);
writeFileSync(file, JSON.stringify({ vendedor: SELLER, capturado: new Date().toISOString(), anuncios: out }, null, 2));
console.log(`✓ ${out.length} anuncios guardados en mercado/.capturas/mercadolibre-${SELLER}.json (sin tokens).`);
console.log('Listo. Avísale a Claude para cargarlos.');
