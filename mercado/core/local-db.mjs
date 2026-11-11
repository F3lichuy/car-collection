// Base local (PGlite: Postgres real en WebAssembly) con lo mínimo de Supabase:
// roles anon/authenticated/service_role, auth.uid(), profiles y los mismos
// privilegios por defecto. La usan las pruebas y `ingest --seco` para correr
// todo sin tocar producción ni necesitar secrets.
import { readFileSync, readdirSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const DIR = new URL('../../supabase/mercado/', import.meta.url);
export const sqlFile = name => readFileSync(new URL(name, DIR), 'utf8');
// 001, 002, 003… en orden; la semilla (002) es opcional.
export const migrationFiles = () => readdirSync(DIR).filter(f => /^\d{3}_.*\.sql$/.test(f)).sort();

export const ADMIN = '00000000-0000-4000-8000-00000000a001';
export const USER = '00000000-0000-4000-8000-00000000b002';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables    to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  create table public.profiles (user_id uuid primary key, username text, is_admin boolean default false);
  insert into public.profiles values ('${ADMIN}', 'feli_chuy', true), ('${USER}', 'otro', false);
`;

export async function freshLocalDb({ seed = true } = {}) {
  const db = new PGlite({ extensions: { btree_gist, pg_trgm } });
  await db.exec(SUPABASE_STUB);
  for (const f of migrationFiles()) if (seed || !f.startsWith('002_')) await db.exec(sqlFile(f));
  return db;
}
