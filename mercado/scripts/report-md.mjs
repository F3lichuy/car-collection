// Convierte el reporte de una corrida (JSON) en Markdown para el resumen de GitHub Actions.
import { readFileSync } from 'node:fs';

const rep = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const L = [`## Mercado MX · ingesta ${rep.fecha}${rep.seco ? ' (seco)' : ''}`, '',
  '| Fuente | Estado | Nuevos | Unidos a auto conocido | Actualizados | Sin cambio | Fuera de taxonomía | Revisión dup. | Revisión norm. | No vistos hoy | Errores |',
  '|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|'];
for (const r of rep.fuentes) {
  L.push(`| ${r.fuente} | ${r.ok ? '✅' : '❌ ' + (r.fatal ?? '')} | ${r.nuevos} | ${r.unidos_a_auto_existente} | ${r.actualizados} | ${r.sin_cambio} | ${r.fuera_de_taxonomia} | ${r.a_revision_duplicado} | ${r.a_revision_normalizacion} | ${r.completa ? r.no_vistos : 'parcial'} | ${r.errores.length} |`);
}
const b = rep.barrido;
if (b) {
  L.push('', '### Barrido de repetidos', '',
    `${b.ok ? '✅' : '❌ ' + (b.fatal ?? '')} · unidos automáticamente: **${b.fusionados}** · nuevos a revisión: **${b.a_revision}** · revisiones descartadas: ${b.revisiones_descartadas} · fotos con hash nuevo: ${b.fotos_hasheadas} · fotos con color revisado: ${b.fotos_color ?? 0}`);
  for (const u of (b.uniones ?? []).slice(0, 30)) L.push(`- ${u.motivo}: ${u.se_une} → ${u.queda}`);
  for (const e of (b.errores ?? []).slice(0, 5)) L.push(`- ⚠️ ${e.error}`);
}
const errs = rep.fuentes.flatMap(r => r.errores.slice(0, 5).map(e => `- **${r.fuente}**: ${e.error}${e.url ? ` (${e.url})` : ''}`));
if (errs.length) L.push('', '### Errores (primeros 5 por fuente)', ...errs);
console.log(L.join('\n'));
