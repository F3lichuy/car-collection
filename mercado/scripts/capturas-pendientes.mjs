// Imprime "n=<capturas pendientes>" (formato de $GITHUB_OUTPUT). Lo usa la corrida de cada ~10 minutos
// para no gastar nada si no guardaste autos nuevos. Requiere SUPABASE_DB_URL (secret de GitHub).
import postgres from 'postgres';
import { dbOptions } from '../core/dburl.mjs';
import { fromPostgres } from '../core/store.mjs';
import { pendingCapturas } from '../core/capturas.mjs';

if (!process.env.SUPABASE_DB_URL) { console.error('Falta SUPABASE_DB_URL (secret de GitHub).'); process.exit(2); }
const sql = postgres({ ...dbOptions(process.env.SUPABASE_DB_URL), max: 1, prepare: false, idle_timeout: 5 });
try {
  console.log(`n=${await pendingCapturas(fromPostgres(sql))}`);
} finally {
  await sql.end({ timeout: 5 });
}
