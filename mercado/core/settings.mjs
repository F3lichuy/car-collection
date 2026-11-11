// Ajustes del motor. Los valores reales viven en mx_settings; estos son los
// mismos valores por defecto que siembra 002_taxonomia.sql.
import { settings as seed } from '../data/taxonomia.mjs';

export const DEFAULTS = Object.freeze(Object.fromEntries(seed.map(([k, v]) => [k, v])));

// rows: [{ key, value }] tal como vienen de mx_settings
export function loadSettings(rows = []) {
  const s = { ...DEFAULTS };
  for (const r of rows) s[r.key] = typeof r.value === 'string' ? JSON.parse(r.value) : r.value;
  return s;
}
