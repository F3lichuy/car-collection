// Imágenes sintéticas para probar el pHash sin usar fotos con derechos de
// terceros: escenas tipo "auto en exhibición" generadas con semilla, y las
// transformaciones típicas de un broker que reutiliza fotos de una agencia.
import sharp from 'sharp';

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Escena: piso, pared, luces, un auto (carrocería + ventanas + ruedas) y objetos.
// carColor fijo permite crear "otro auto del mismo color" (caso difícil).
export function sceneSvg(seed, { carColor } = {}) {
  const r = rng(seed), W = 800, H = 533;
  const pick = a => a[Math.floor(r() * a.length)];
  const color = carColor ?? pick(['#c8c8c8', '#1d1d1f', '#b3261e', '#f2f2f2', '#2f5fb3', '#e8b923', '#3c6e47']);
  const wall = pick(['#e9e6df', '#2a2d33', '#9aa3ad', '#d7cbb8']);
  const floor = pick(['#6b6b6b', '#bdb8ad', '#3a3a3a']);
  const cx = 180 + r() * 160, cy = 250 + r() * 60, cw = 380 + r() * 120, ch = 90 + r() * 30;
  const objs = Array.from({ length: 4 + Math.floor(r() * 5) }, () => {
    const x = r() * W, y = r() * 240, w = 30 + r() * 160, h = 20 + r() * 140;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${pick(['#ffffff', '#111111', '#7a5c3c', '#4d6b8a', '#c9a227'])}" opacity="${0.5 + r() * 0.5}"/>`;
  }).join('');
  const lights = Array.from({ length: 3 }, () => `<circle cx="${r() * W}" cy="${20 + r() * 60}" r="${8 + r() * 14}" fill="#fffbe6"/>`).join('');
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${wall}"/><stop offset="1" stop-color="${floor}"/></linearGradient></defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>${objs}${lights}
    <rect x="0" y="${cy + ch}" width="${W}" height="${H - cy - ch}" fill="${floor}"/>
    <ellipse cx="${cx + cw / 2}" cy="${cy + ch + 18}" rx="${cw / 1.8}" ry="16" fill="#000" opacity=".35"/>
    <rect x="${cx}" y="${cy}" width="${cw}" height="${ch}" rx="40" fill="${color}"/>
    <path d="M${cx + cw * 0.22} ${cy + 4} Q${cx + cw * 0.42} ${cy - ch * 0.75} ${cx + cw * 0.7} ${cy + 4} Z" fill="${color}"/>
    <path d="M${cx + cw * 0.3} ${cy} Q${cx + cw * 0.45} ${cy - ch * 0.55} ${cx + cw * 0.62} ${cy} Z" fill="#1b2430" opacity=".85"/>
    <circle cx="${cx + cw * 0.2}" cy="${cy + ch}" r="${ch * 0.42}" fill="#151515"/><circle cx="${cx + cw * 0.2}" cy="${cy + ch}" r="${ch * 0.22}" fill="#9a9a9a"/>
    <circle cx="${cx + cw * 0.8}" cy="${cy + ch}" r="${ch * 0.42}" fill="#151515"/><circle cx="${cx + cw * 0.8}" cy="${cy + ch}" r="${ch * 0.22}" fill="#9a9a9a"/>
  </svg>`);
}

export const original = seed => sharp(sceneSvg(seed)).jpeg({ quality: 90 }).toBuffer();

const watermark = (w, h, text) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <rect x="${w - 230}" y="${h - 60}" width="210" height="40" rx="6" fill="#000" opacity=".55"/>
  <text x="${w - 125}" y="${h - 33}" font-family="Arial" font-size="20" fill="#fff" text-anchor="middle">${text}</text>
  <text x="${w / 2}" y="${h / 2}" font-family="Arial" font-size="46" fill="#fff" opacity=".18" text-anchor="middle">${text}</text></svg>`);

// Lo que hace un broker o un repost de Marketplace con la foto de la agencia.
export const transforms = {
  recomprimida: b => sharp(b).jpeg({ quality: 35 }).toBuffer(),
  reducida: b => sharp(b).resize(400).jpeg({ quality: 70 }).toBuffer(),
  marca_de_agua: async b => { const m = await sharp(b).metadata(); return sharp(b).composite([{ input: watermark(m.width, m.height, 'BROKER MX') }]).jpeg({ quality: 80 }).toBuffer(); },
  recorte_5: async b => { const m = await sharp(b).metadata(); const dx = Math.round(m.width * 0.05), dy = Math.round(m.height * 0.05);
    return sharp(b).extract({ left: dx, top: dy, width: m.width - 2 * dx, height: m.height - 2 * dy }).jpeg({ quality: 80 }).toBuffer(); },
  mas_brillo: b => sharp(b).modulate({ brightness: 1.15 }).jpeg({ quality: 80 }).toBuffer(),
  // Marketplace: reducida + marca de agua + recompresión fuerte
  marketplace: async b => transforms.recomprimida(await transforms.marca_de_agua(await transforms.reducida(b))),
};

// Imagen casi lisa: "foto próximamente".
export const placeholder = () => sharp({ create: { width: 800, height: 533, channels: 3, background: '#dcdcdc' } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="533"><text x="400" y="270" font-family="Arial" font-size="28" fill="#c8c8c8" text-anchor="middle">Foto próximamente</text></svg>') }])
  .jpeg().toBuffer();
