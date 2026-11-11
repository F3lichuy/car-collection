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
// teléfonos, folios o palabras.
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
        if (s.length === 17 && VIN17.test(s) && /[A-Z]/.test(s) && (s.match(/\d/g) || []).length >= 5) out.add(s);
      }
    }
  }
  return [...out];
}
