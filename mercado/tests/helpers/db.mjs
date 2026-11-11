// Postgres real (PGlite, WebAssembly) con lo mínimo de Supabase para probar
// el esquema sin tocar producción: roles anon/authenticated/service_role,
// auth.uid(), profiles e iguales privilegios por defecto que Supabase.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

const sqlFile = name => readFileSync(new URL(`../../../supabase/mercado/${name}`, import.meta.url), 'utf8');

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

export async function freshDb({ seed = true } = {}) {
  const db = new PGlite({ extensions: { btree_gist, pg_trgm } });
  await db.exec(SUPABASE_STUB);
  await db.exec(sqlFile('001_esquema.sql'));
  if (seed) await db.exec(sqlFile('002_taxonomia.sql'));
  await db.exec(sqlFile('003_antiduplicados.sql'));
  return db;
}

export const applySchema = async db => { await db.exec(sqlFile('001_esquema.sql')); await db.exec(sqlFile('003_antiduplicados.sql')); };
export const applySeed = db => db.exec(sqlFile('002_taxonomia.sql'));

// Corre fn dentro de una transacción con el rol indicado; siempre revierte
// salvo { commit: true }.
export async function as(db, who, fn, { commit = false } = {}) {
  return db.transaction(async tx => {
    const role = who === 'anon' ? 'anon' : who === 'service' ? 'service_role' : 'authenticated';
    const uid = who === 'admin' ? ADMIN : who === 'user' ? USER : '';
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    const r = await fn(tx);
    if (!commit) await tx.rollback();
    return r;
  });
}

// Inserta un vehículo + listing reales mínimos (como superusuario).
export async function vehicleWithListing(db, { demo = false, version = 'porsche-911-992-1-gt3-rs', url, ext } = {}) {
  const { rows: [v] } = await db.query(
    `insert into mx_vehicles (model_id, version_id, is_demo) values ('porsche-911', $1, $2) returning id`, [version, demo]);
  const u = url ?? `https://ejemplo.mx/auto/${Math.random().toString(36).slice(2)}`;
  const { rows: [l] } = await db.query(
    `insert into mx_listings (vehicle_id, source_id, capture_method, external_id, url, url_canonical, first_seen, last_seen, is_demo)
     values ($1, 'contacto-directo', 'link', $2, $3, $3, '2026-11-01', '2026-11-01', $4) returning id`,
    [v.id, ext ?? null, u, demo]);
  return { vehicle: v.id, listing: l.id };
}
