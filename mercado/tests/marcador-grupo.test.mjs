// Modo grupo del botón (captura-marcador.js) en un navegador de verdad, sobre una página que
// imita un grupo de Facebook (tests/fixtures/captura/fb-grupo.html). Necesita Playwright; si
// no está instalado (GitHub Actions), se omite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* sin Playwright */ }

test('modo grupo: lee las publicaciones de venta, sin vendedor ni teléfonos, con fecha y rebaja', { skip: !chromium && 'Playwright no está instalado', timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('./fixtures/captura/fb-grupo.html', import.meta.url).href);
    await page.evaluate(() => {
      window.__sent = [];
      window.open = () => ({ closed: false, postMessage: m => window.__sent.push(JSON.parse(JSON.stringify(m))) });
    });
    await page.evaluate(readFileSync(new URL('../../captura-marcador.js', import.meta.url), 'utf8'));
    await page.waitForFunction(() => /5 publicaciones/.test(document.querySelector('[data-s]')?.textContent || ''), null, { timeout: 30000 });
    await page.click('[data-x]');
    await page.waitForFunction(() => window.__sent.length > 0);
    const [batch] = await page.evaluate(() => window.__sent);
    assert.equal(batch.mode, 'grupo');
    assert.equal(batch.site, 'facebook-grupos');
    const items = batch.items;
    assert.equal(items.length, 2, JSON.stringify(items.map(i => i.title)));

    const p911 = items.find(i => /911/.test(i.title));
    assert.equal(p911.external_id, 'gautosmty_987654321');
    assert.equal(p911.url, 'https://www.facebook.com/groups/autosmty/posts/987654321/');
    assert.equal(p911.price, 1650000);
    assert.equal(p911.year, 2013);
    assert.equal(p911.km, '38000');
    assert.equal(p911.published_on, '2023-10-12');
    assert.equal(p911.observed_on, '2023-10-12');
    assert.deepEqual(p911.photos, ['https://scontent.fmty1-1.fna.fbcdn.net/v/t39/911-a.jpg', 'https://scontent.fmty1-1.fna.fbcdn.net/v/t39/911-b.jpg']);
    assert.ok(!/1234 5678|wa\.me/.test(p911.description), p911.description);
    assert.ok(!/Carlos/.test(JSON.stringify(p911)));

    const f458 = items.find(i => /458/.test(i.title));
    assert.equal(f458.title, 'Ferrari 458 Italia 2012 REBAJADO');
    assert.equal(f458.price, 4200000);
    assert.equal(f458.list_price, 4500000);
    assert.equal(f458.km, '18000');
    assert.equal(f458.city, 'San Pedro Garza García, NL');
    assert.deepEqual(f458.photos, ['https://scontent.fmty1-1.fna.fbcdn.net/v/t39/458.jpg']);   // sin la foto del comentario
    assert.ok(!/Juan|Ana|interesa/.test(JSON.stringify(f458)), JSON.stringify(f458));
    const yesterday = new Date(Date.now() - 864e5);
    assert.equal(f458.published_on, `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`);
  } finally { await browser.close(); }
});
