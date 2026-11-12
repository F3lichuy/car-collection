// VIN / número de chasis: mismas reglas que el trigger mx_vehicles_before.
// No se exige dígito verificador: los autos fuera de Norteamérica no siempre lo traen.

const VIN17 = /^[A-HJ-NPR-Z0-9]{17}$/;

// Devuelve { vin, kind } o null. Lanza si el formato es imposible.
export function normalizeVin(raw) {
  if (raw == null) return null;
  const v = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!v) return null;
  if (v.length === 17) {
    if (!VIN17.test(v)) throw new Error(`VIN inválido (contiene I, O o Q): ${v}`);
    return { vin: v, kind: 'vin17' };
  }
  if (v.length >= 4 && v.length <= 16) return { vin: v, kind: 'chasis' };
  throw new Error(`VIN/chasis con longitud inválida: ${v}`);
}

// Busca VINs de 17 caracteres en texto libre, aunque vengan partidos con
// espacios o guiones ("VIN: WP0-AF2A9 9PS270001"). Prueba combinaciones de
// grupos contiguos que sumen 17. Exige letras y ≥5 dígitos para no confundir
// teléfonos, folios o palabras. Si el candidato se armó juntando VARIOS grupos,
// además debe cuadrar su dígito verificador: "911 Carrera GTS 2024" junta 17
// caracteres válidos y no es un VIN (pasó en una ficha de Miura).
export function findVins(text) {
  if (!text) return [];
  const out = new Set();
  const runs = String(text).toUpperCase().match(/[A-Z0-9]+(?:[ \-][A-Z0-9]+)*/g) || [];
  for (const run of runs) {
    const groups = run.split(/[ \-]/);
    for (let i = 0; i < groups.length; i++) {
      let s = '';
      for (let j = i; j < groups.length && s.length < 17; j++) {
        s += groups[j];
        if (s.length === 17 && VIN17.test(s) && /[A-Z]/.test(s) && (s.match(/\d/g) || []).length >= 5 && (j === i || vinCheckDigitOk(s))) out.add(s);
      }
    }
  }
  return [...out];
}

// Dígito verificador (posición 9) del estándar norteamericano: 0-9 o X.
const TRANSLIT = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
export function vinCheckDigitOk(vin) {
  if (!VIN17.test(vin)) return false;
  let sum = 0;
  for (let k = 0; k < 17; k++) { const c = vin[k]; sum += (/\d/.test(c) ? Number(c) : TRANSLIT[c]) * WEIGHTS[k]; }
  const r = sum % 11;
  return vin[8] === (r === 10 ? 'X' : String(r));
}
