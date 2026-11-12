// SUPABASE_DB_URL con contraseña "rara" (/, #, ?, @ sin codificar): debe leerse igual.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dbOptions } from '../core/dburl.mjs';

const POOL = 'aws-0-us-east-1.pooler.supabase.com';

test('contraseña con / # ? @ sin codificar', () => {
  for (const pw of ['abc/def', 'a#b', 'a?b=c', 'p@ss/w#rd?x', 'simple123']) {
    const o = dbOptions(`postgresql://postgres.tayybbmbhsqxocugwzji:${pw}@${POOL}:6543/postgres`);
    assert.deepEqual(o, { host: POOL, port: 6543, database: 'postgres', username: 'postgres.tayybbmbhsqxocugwzji', password: pw, ssl: 'require' });
  }
});

test('contraseña ya codificada, sslmode y puerto por omisión', () => {
  const o = dbOptions(`postgres://postgres.x:a%2Fb%23c@${POOL}/postgres?sslmode=require`);
  assert.equal(o.password, 'a/b#c');
  assert.equal(o.port, 5432);
  assert.equal(o.ssl, 'require');
  assert.equal(dbOptions('postgresql://u:p@localhost:5432/db').ssl, undefined);
});

test('errores claros y sin la contraseña', () => {
  assert.throws(() => dbOptions('https://x'), /postgresql:\/\//);
  assert.throws(() => dbOptions(''), /postgresql:\/\//);
  try { dbOptions('postgresql://user:secreto123/host'); } catch (e) { assert.doesNotMatch(e.message, /secreto123/); }
});
