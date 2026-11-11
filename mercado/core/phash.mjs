// Hash perceptual (pHash) de 64 bits: dos fotos "iguales" (misma toma,
// aunque esté recomprimida, reducida, con marca de agua o leve recorte)
// dan hashes a pocos bits de distancia. Mismo algoritmo que imagehash.phash:
// gris 32×32 → DCT 2D → bloque 8×8 de baja frecuencia → bit = coef > mediana.
import sharp from 'sharp';

const N = 32, K = 8;
const COS = Array.from({ length: K }, (_, u) =>
  Float64Array.from({ length: N }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))));

export function phashFromGray32(px) {
  // DCT separable: filas y luego columnas, solo los K coeficientes bajos.
  const rows = Array.from({ length: N }, (_, y) => {
    const r = new Float64Array(K);
    for (let u = 0; u < K; u++) { let s = 0; for (let x = 0; x < N; x++) s += px[y * N + x] * COS[u][x]; r[u] = s; }
    return r;
  });
  const coef = new Float64Array(K * K);
  for (let v = 0; v < K; v++) for (let u = 0; u < K; u++) {
    let s = 0; for (let y = 0; y < N; y++) s += rows[y][u] * COS[v][y]; coef[v * K + u] = s;
  }
  const med = [...coef].sort((a, b) => a - b)[(K * K) / 2];
  let h = 0n;
  for (let i = 0; i < K * K; i++) h = (h << 1n) | (coef[i] > med ? 1n : 0n);
  // varianza de la imagen: una foto lisa (placeholder) no sirve para identificar
  let mean = 0; for (const p of px) mean += p; mean /= px.length;
  let variance = 0; for (const p of px) variance += (p - mean) ** 2; variance /= px.length;
  return { hash: h, variance };
}

const gray32 = img => img.flatten({ background: '#808080' }).grayscale()
  .resize(N, N, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer();

// Margen del hash "centro": 6% por lado. Compararlo contra el hash completo de
// otra foto absorbe los recortes típicos de un broker (calibrado en Fase 2).
export const CENTER_MARGIN = 0.06;

// buffer (jpg/png/webp/svg) → { hash, center (BigInt sin signo), signed/centerSigned
// (string para Postgres bigint), variance, lowInfo }
export async function phash(buffer) {
  const meta = await sharp(buffer).metadata();
  const full = phashFromGray32(await gray32(sharp(buffer)));
  const dx = Math.round(meta.width * CENTER_MARGIN), dy = Math.round(meta.height * CENTER_MARGIN);
  const center = phashFromGray32(await gray32(sharp(buffer).extract({
    left: dx, top: dy, width: meta.width - 2 * dx, height: meta.height - 2 * dy })));
  return {
    hash: full.hash, center: center.hash, variance: full.variance, lowInfo: isLowInformation(full.variance),
    signed: toSigned(full.hash).toString(), centerSigned: toSigned(center.hash).toString(),
  };
}

// Distancia entre dos fotos {hash, center?}: la menor entre completa↔completa y
// completa↔centro en ambos sentidos.
export function photoDistance(a, b) {
  let d = hamming(a.hash, b.hash);
  if (b.center != null) d = Math.min(d, hamming(a.hash, b.center));
  if (a.center != null) d = Math.min(d, hamming(a.center, b.hash));
  return d;
}

export const toSigned = h => BigInt.asIntN(64, BigInt(h));
export const toUnsigned = h => BigInt.asUintN(64, BigInt(h));

export function hamming(a, b) {
  let x = toUnsigned(a) ^ toUnsigned(b), n = 0;
  while (x) { x &= x - 1n; n++; }
  return n;
}

// Una imagen casi lisa (placeholder "foto próximamente", fondo de logo) da un
// hash arbitrario que puede chocar con cualquiera: no se usa para identificar.
// Escala de grises 0–255; una foto real de un auto suele pasar de 400.
export const LOW_INFO_VARIANCE = 60;
export const isLowInformation = variance => variance < LOW_INFO_VARIANCE;
