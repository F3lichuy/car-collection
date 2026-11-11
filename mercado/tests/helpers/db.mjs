// Helpers de pruebas sobre la base local (ver core/local-db.mjs).
import { freshLocalDb, sqlFile, migrationFiles, ADMIN, USER } from '../../core/local-db.mjs';
export { ADMIN, USER };

export const freshDb = freshLocalDb;

// Re-aplica todas las migraciones excepto la semilla (para probar idempotencia).
export const applySchema = async db => { for (const f of migrationFiles()) if (!f.startsWith('002_')) await db.exec(sqlFile(f)); };
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
