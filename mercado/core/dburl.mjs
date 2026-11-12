// Convierte SUPABASE_DB_URL en opciones explícitas para postgres.js.
// Supabase da la cadena con la contraseña tal cual; si trae / # ? @ sin codificar, el parser de
// URL corta mal y "postgres.<proyecto>" termina como nombre del servidor. Aquí se separa por el
// ÚLTIMO "@" (el servidor y la base nunca llevan @), así la contraseña puede traer lo que sea.
// Nunca se imprime la cadena: los errores no incluyen la contraseña.
export function dbOptions(url) {
  const m = /^postgres(?:ql)?:\/\//i.exec(String(url ?? '').trim());
  if (!m) throw new Error('SUPABASE_DB_URL no empieza con postgresql://');
  const s = String(url).trim().slice(m[0].length);
  const at = s.lastIndexOf('@');
  if (at < 0) throw new Error('SUPABASE_DB_URL no trae usuario y contraseña (falta "@")');
  const userinfo = s.slice(0, at), rest = s.slice(at + 1);
  const colon = userinfo.indexOf(':');
  const dec = v => { if (!/%[0-9a-f]{2}/i.test(v)) return v; try { return decodeURIComponent(v); } catch { return v; } };
  const username = dec(colon < 0 ? userinfo : userinfo.slice(0, colon));
  const password = colon < 0 ? undefined : dec(userinfo.slice(colon + 1));
  const [hostport, ...tail] = rest.split('/');
  const [database, query = ''] = tail.join('/').split('?');
  const pc = hostport.lastIndexOf(':');
  const host = pc > 0 && !hostport.endsWith(']') ? hostport.slice(0, pc) : hostport;
  const port = pc > 0 && !hostport.endsWith(']') ? Number(hostport.slice(pc + 1)) : 5432;
  if (!host || !Number.isInteger(port)) throw new Error('SUPABASE_DB_URL: no se entiende el servidor o el puerto');
  const opts = { host, port, database: decodeURIComponent(database || 'postgres'), username, password };
  const sslmode = new URLSearchParams(query).get('sslmode');
  if (sslmode === 'verify-full') opts.ssl = 'verify-full';
  else if (sslmode ? sslmode !== 'disable' : /\.supabase\.(co|com)$/i.test(host)) opts.ssl = 'require';   // Supabase: siempre cifrado
  return opts;
}
