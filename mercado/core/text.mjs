// Normalización de texto común a todo Mercado MX (sin dependencias: corre en
// Node, Deno y navegador).
export const norm = s => s == null ? '' : String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/\s+/g, ' ').trim();
