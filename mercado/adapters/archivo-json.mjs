// Adaptador · archivo JSON local (capturas hechas en TU computadora: API de
// Mercado Libre con tu app, script de Marketplace, bookmarklet). El archivo
// trae anuncios ya en el formato crudo del pipeline; aquí solo se completan
// los datos de la fuente. Solo entran los anuncios activos.
import { readFileSync } from 'node:fs';

export class ArchivoJsonAdapter {
  constructor(source) { this.source = source; this.partial = false; }
  async *listings(ctx) {
    const file = this.source.config?.file;
    if (!file) throw new Error('Falta el archivo (--archivo ruta.json)');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    const list = Array.isArray(data) ? data : data.anuncios ?? [];
    ctx.log(`  · ${list.length} anuncios en ${file}`);
    for (const a of list) {
      if (a.status && a.status !== 'active') continue;
      yield { seller_type: 'broker', seller_name: this.source.name, ...a, capture_method: 'script_local', extra: { capturado: data.capturado ?? null, origen: 'archivo' } };
    }
  }
}

export default source => new ArchivoJsonAdapter(source);
