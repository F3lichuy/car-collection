// Adaptador · capturas hechas con el botón "Guardar en Precio de Calle" (mx_capturas).
// Los autos ya vienen leídos de la página que la persona estaba viendo; aquí solo
// se pasan al pipeline (normalizador + anti-duplicados). Una captura es parcial:
// que un auto no venga en ella no significa que se vendió.
export class CapturasAdapter {
  constructor(source) { this.source = source; this.partial = true; }
  async *listings() {
    const { items = [], captura_id, page_url } = this.source.config ?? {};
    for (const it of items) {
      if (it.currency === 'USD') continue;   // regla: solo precios en pesos
      yield {
        seller_type: 'desconocido', ...it, capture_method: 'bookmarklet',
        extra: { ...(it.extra ?? {}), captura_id, pagina: page_url },
      };
    }
  }
}

export default source => new CapturasAdapter(source);
