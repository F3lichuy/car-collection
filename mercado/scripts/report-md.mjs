// Convierte el reporte de una corrida (JSON) en Markdown para el resumen de GitHub Actions.
import { readFileSync } from 'node:fs';

const rep = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const L = [`## Mercado MX · ingesta ${rep.fecha}${rep.seco ? ' (seco)' : ''}`, '',
  '| Fuente | Estado | Nuevos | Unidos a auto conocido | Actualizados | Sin cambio | Fuera de taxonomía | Revisión dup. | Revisión norm. | No vistos hoy | Errores |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
for (const r of rep.fuentes) {
  L.push(`| ${r.fuente} | ${r.ok ? '✅' : '❌ ' + (r.fatal ?? '')} | ${r.nuevos} | ${r.unidos_a_auto_existente} | ${r.actualizados} | ${r.sin_cambio} | ${r.fuera_de_taxonomia} | ${r.a_revision_duplicado} | ${r.a_revision_normalizacion} | ${r.completa ? r.no_vistos : 'parcial'} | ${r.errores.length} |`);
}
const errs = rep.fuentes.flatMap(r => r.errores.slice(0, 5).map(e => `- **${r.fuente}**: ${e.error}${e.url ? ` (${e.url})` : ''}`));
if (errs.length) L.push('', '### Errores (primeros 5 por fuente)', ...errs);
console.log(L.join('\n'));
