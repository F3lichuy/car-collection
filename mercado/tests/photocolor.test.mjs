// Color estimado por la foto: imágenes sintéticas (un "auto" de color en medio de un fondo de estudio).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { photoColor, carColor } from '../core/photocolor.mjs';

// fondo gris con un rectángulo (el auto) de color en el centro; frac = qué tanto del centro ocupa
const scene = async (car, { bg = '#7a7a7a', frac = 0.5 } = {}) => {
  const W = 800, H = 600, cw = Math.round(W * 0.6 * frac), ch = Math.round(H * 0.5 * frac);
  const carBuf = await sharp({ create: { width: cw, height: ch, channels: 3, background: car } }).png().toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: bg } })
    .composite([{ input: carBuf, left: Math.round((W - cw) / 2), top: Math.round(H * 0.3 + (H * 0.5 - ch) / 2) }]).jpeg().toBuffer();
};

describe('color por foto', () => {
  test('autos de color vivo en un estudio gris', async () => {
    assert.equal((await photoColor(await scene('#2f9e44')))?.family, 'verde');      // Python Green
    assert.equal((await photoColor(await scene('#c92a2a')))?.family, 'rojo');
    assert.equal((await photoColor(await scene('#f5c400')))?.family, 'amarillo');
    assert.equal((await photoColor(await scene('#1c4fd8')))?.family, 'azul');
    assert.equal((await photoColor(await scene('#f76707')))?.family, 'naranja');
  });

  test('blanco, negro, gris y plata no se adivinan (el fondo se confunde)', async () => {
    for (const c of ['#f8f9fa', '#111111', '#555555', '#c0c0c0']) assert.equal(await photoColor(await scene(c)), null);
  });

  test('un poco de color (calipers, un letrero) no basta; el azul pide más (cielo y reflejos)', async () => {
    assert.equal(await photoColor(await scene('#c92a2a', { frac: 0.2 })), null);
    assert.equal(await photoColor(await scene('#1c4fd8', { frac: 0.38 })), null);
  });

  test('manda la portada; dos fotos de otro color vivo lo anulan', () => {
    assert.equal(carColor([{ family: 'verde' }, null, null]), 'verde');
    assert.equal(carColor([{ family: 'verde' }, { family: 'verde' }, { family: 'rojo' }]), 'verde');
    assert.equal(carColor([{ family: 'azul' }, { family: 'rojo' }, { family: 'rojo' }]), null);
    assert.equal(carColor([null, { family: 'rojo' }, { family: 'rojo' }]), null);
  });
});
