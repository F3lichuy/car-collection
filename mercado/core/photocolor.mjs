// Color del auto estimado por la foto (solo colores vivos).
//
// Se mira el centro de la foto (donde casi siempre está el auto), se pasa cada pixel a HSV y se cuentan
// los pixeles con color "vivo" (saturados y ni muy oscuros ni muy claros) por familia: rojo, naranja,
// amarillo, verde, azul, morado, rosa. Si una familia domina con claridad, ese es el color estimado.
// Blanco, negro, gris y plata NO se estiman: el fondo del estudio, el piso y el cielo son de esos tonos
// y no se pueden separar del auto con confianza. Mejor "sin dato" que un dato inventado.
import sharp from 'sharp';

const W = 48, H = 36;
// tono (grados) → familia
const HUE = [[15, 'rojo'], [40, 'naranja'], [68, 'amarillo'], [165, 'verde'], [255, 'azul'], [290, 'morado'], [340, 'rosa'], [361, 'rojo']];
const famOfHue = h => HUE.find(([max]) => h < max)[1];

function hsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx ? d / mx : 0, mx];
}

// pixeles RGB (Uint8, 3 canales) del centro → { family, share, second } o null
export function colorFromPixels(px, w = W, h = H, debug = false) {
  const n = w * h, count = {};
  for (let i = 0; i < n; i++) {
    const [hh, s, v] = hsv(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]);
    // vivo: saturado y con luz suficiente; el café/madera (naranja oscuro y poco saturado) no cuenta
    if (s < 0.42 || v < 0.28) continue;
    const f = famOfHue(hh);
    if ((f === 'naranja' || f === 'amarillo') && (s < 0.55 || v < 0.45)) continue;
    count[f] = (count[f] ?? 0) + 1;
  }
  const ranked = Object.entries(count).sort((a, b) => b[1] - a[1]);
  if (!ranked.length) return null;
  const [[family, c1], [, c2 = 0] = []] = ranked;
  const share = c1 / n;
  // que domine de verdad: al menos 12 % del centro (20 % el azul: cielo, reflejos y luces de estudio
  // pintan de azul a autos negros y grises) y el doble que el siguiente color vivo
  if (share < (family === 'azul' ? 0.2 : 0.12) || c1 < 2 * c2) return debug ? { why: `${family}:${Math.round(share * 100) / 100}?` } : null;
  return { family, share: Math.round(share * 100) / 100 };
}

// buffer de imagen → { family, share } o null
export async function photoColor(buffer, { debug = false } = {}) {
  const img = sharp(buffer).flatten({ background: '#808080' });
  const { width, height } = await img.metadata();
  if (!width || !height) return null;
  // centro: 60 % del ancho y 50 % del alto, un poco abajo del medio (el auto suele ir abajo del cielo)
  const cw = Math.round(width * 0.6), ch = Math.round(height * 0.5);
  const left = Math.round((width - cw) / 2), top = Math.min(height - ch, Math.round(height * 0.3));
  const px = await sharp(buffer).flatten({ background: '#808080' }).extract({ left, top, width: cw, height: ch })
    .resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  return colorFromPixels(px, W, H, debug);
}

// Fotos del mismo auto, en orden (la primera es la portada) → una familia o null.
// Manda la portada (casi siempre el auto completo; las demás suelen ser interior o detalles);
// si otras dos fotos muestran OTRO color vivo, no se sabe y queda sin dato.
// Medido con 104 autos de agencia con color en el anuncio (2026-11-12): acierta la mayoría de los colores
// vivos y se equivoca en ~3 % de los negros/grises/blancos. Por eso siempre se muestra como "estimado".
export function carColor(list) {
  const cover = list[0];
  if (!cover?.family) return null;
  const other = {};
  for (const x of list.slice(1)) if (x?.family && x.family !== cover.family) other[x.family] = (other[x.family] ?? 0) + 1;
  return Object.values(other).some(n => n >= 2) ? null : cover.family;
}
