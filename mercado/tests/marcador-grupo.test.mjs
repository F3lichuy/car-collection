// Modo grupo del botón (captura-marcador.js) en un navegador de verdad, sobre una página que
// imita un grupo de Facebook (tests/fixtures/captura/fb-grupo.html). Necesita Playwright; si
// no está instalado (GitHub Actions), se omite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

let chromium = null;
try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* sin Playwright */ }

test('modo grupo: lee las publicaciones de venta, sin vendedor ni teléfonos, con fecha y rebaja', { skip: !chromium && 'Playwright no está instalado', timeout: 120000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('./fixtures/captura/fb-grupo.html', import.meta.url).href);
    await page.evaluate(() => {
      window.__sent = [];
      window.open = () => ({ closed: false, postMessage: m => window.__sent.push(JSON.parse(JSON.stringify(m))) });
    });
    await page.evaluate(readFileSync(new URL('../../captura-marcador.js', import.meta.url), 'utf8'));
    await page.waitForFunction(() => /7 publicaciones/.test(document.querySelector('[data-s]')?.textContent || ''), null, { timeout: 90000 });
    assert.match(await page.textContent('[data-s]'), /4 autos · 1 sin precio/);
    await page.click('[data-x]');
    await page.waitForFunction(() => window.__sent.length > 0);
    const [batch] = await page.evaluate(() => window.__sent);
    assert.equal(batch.mode, 'grupo');
    assert.equal(batch.site, 'facebook-grupos');
    const items = batch.items;
    assert.equal(items.length, 4, JSON.stringify(items.map(i => i.title)));

    const p911 = items.find(i => /911/.test(i.title));
    assert.equal(p911.external_id, 'gautosmty_987654321');
    assert.equal(p911.url, 'https://www.facebook.com/groups/autosmty/posts/987654321/');
    assert.equal(p911.price, 1650000);
    assert.equal(p911.year, 2013);
    assert.equal(p911.km, '38000');
    assert.equal(p911.published_on, '2023-10-12');
    assert.equal(p911.observed_on, '2023-10-12');
    // fotos completas (sin el recorte de la cuadrícula) de los datos de la página; sin la de perfil
    assert.deepEqual(p911.photos, ['https://scontent.fmty1-1.fna.fbcdn.net/v/t39.30808-6/111_222_333_n.jpg?full', 'https://scontent.fmty1-1.fna.fbcdn.net/v/t39.30808-6/444_555_666_n.jpg?full']);
    assert.equal(p911.extra.fecha_exacta, true);
    assert.ok(!/1234 5678|wa\.me/.test(p911.description), p911.description);
    assert.ok(!/Carlos/.test(JSON.stringify(p911)));

    // cualquier marca entra a la lista (tú decides en carcollection.app)
    assert.equal(items.find(i => /Versa/.test(i.title)).price, 210000);
    const f458 = items.find(i => /458/.test(i.title));
    assert.equal(f458.title, 'Ferrari 458 Italia 2012 REBAJADO');
    assert.equal(f458.price, 4200000);
    assert.equal(f458.list_price, 4500000);
    assert.equal(f458.km, '18000');
    assert.equal(f458.city, 'San Pedro Garza García, NL');
    // del visor (completas, todas), sin la del comentario ni la vista previa de una liga; el visor queda cerrado
    assert.deepEqual(f458.photos, [1, 2, 3].map(n => `https://scontent.fmty1-1.fna.fbcdn.net/v/t39/458-completa-${n}.jpg`));   // todas, con "Foto siguiente"
    // la hora no daba la liga: el número de la publicación sale de la liga de su foto (set=pcb.<número>)
    assert.equal(f458.url, 'https://www.facebook.com/groups/autosmty/posts/4580001/');
    assert.equal(f458.external_id, 'gautosmty_4580001');
    assert.equal(await page.evaluate(() => document.querySelectorAll('[role=dialog]').length), 0);
    assert.equal(await page.evaluate(() => !!window.__salioDelGrupo), false);
    assert.ok(!/Juan|Ana|interesa/.test(JSON.stringify(f458)), JSON.stringify(f458));
    const yesterday = new Date(Date.now() - 864e5);
    assert.equal(f458.published_on, `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`);

    // "Ver más": el precio y los km estaban escondidos
    const hur = items.find(i => /Hurac/.test(i.title));
    assert.equal(hur.price, 5900000);
    assert.equal(hur.km, '9500');
    assert.equal(hur.year, 2021);
    assert.equal(hur.published_on, '2025-11-02');
    assert.ok(!/9876/.test(hur.description), hur.description);
  } finally { await browser.close(); }
});

test('modo grupo: lee los datos que Facebook manda al bajar (fetch y XHR, con "for (;;);" y varias partes)', { skip: !chromium && 'Playwright no está instalado', timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const part = (id, t, w) => JSON.stringify({ data: { node: { post_id: id, comet_sections: { content: { story: { message: { text: `Vendo Ferrari F8 Tributo 2020 ${id}` } } },
      metadata: [{ story: { creation_time: t } }] }, attachments: [{ media: { viewer_image: { uri: `https://scontent.x.fbcdn.net/v/t39.30808-6/${id}_1_2_n.jpg?full`, width: w } } }] } } });
    await page.route('https://www.facebook.com/api/graphql/**', r => r.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' },
      body: 'for (;;);' + part('7777777', 1730000000, 2048) + '\n' + part('8888888', 1731000000, 1080) }));
    await page.goto(new URL('./fixtures/captura/fb-grupo.html', import.meta.url).href);
    await page.evaluate(() => { window.open = () => ({ closed: false, postMessage: () => {} }); });
    await page.evaluate(readFileSync(new URL('../../captura-marcador.js', import.meta.url), 'utf8'));
    await page.evaluate(async () => {
      await (await fetch('https://www.facebook.com/api/graphql/')).text();
      await new Promise(ok => { const x = new XMLHttpRequest(); x.open('POST', 'https://www.facebook.com/api/graphql/?b=1'); x.onload = ok; x.send(); });
      await new Promise(ok => setTimeout(ok, 300));
    });
    const fb = await page.evaluate(() => JSON.parse(JSON.stringify(window.__pcGrupo.fb)));
    assert.equal(fb['7777777'].t, 1730000000);
    assert.equal(fb['8888888'].text, 'Vendo Ferrari F8 Tributo 2020 8888888');
    assert.equal(fb['7777777'].photos[fb['7777777'].order[0]].u, 'https://scontent.x.fbcdn.net/v/t39.30808-6/7777777_1_2_n.jpg?full');
    assert.equal(fb['987654321'].t, 1697127300);   // y los datos con que arrancó la página
    await page.click('[data-x]');
  } finally { await browser.close(); }
});


test('búsqueda de Facebook: mismo recorrido, ligas de páginas (pfbid) y de grupos', { skip: !chromium && 'Playwright no está instalado', timeout: 180000 }, async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(new URL('./fixtures/captura/fb-busqueda.html', import.meta.url).href);
    await page.evaluate(() => { window.__sent = []; window.open = () => ({ closed: false, postMessage: m => window.__sent.push(JSON.parse(JSON.stringify(m))) }); });
    await page.evaluate(readFileSync(new URL('../../captura-marcador.js', import.meta.url), 'utf8'));
    assert.match(await page.textContent('body'), /Precio de Calle · búsqueda/);
    // (el contador sube al empezar a leer cada publicación: se espera a que la quinta termine)
    await page.waitForFunction(() => /7 publicaciones.*4 no son autos/.test(document.querySelector('[data-s]')?.textContent || ''), null, { timeout: 150000 });
    assert.match(await page.textContent('[data-s]'), /3 autos · 4 no son autos/);   // casa, Rolex, rines y el de escala; el bloque de Reels ni se cuenta
    assert.equal(await page.evaluate(() => !!window.__entroAReels), false);
    await page.click('[data-x]');
    await page.waitForFunction(() => window.__sent.length > 0);
    const items = (await page.evaluate(() => window.__sent))[0].items;
    assert.equal(items.length, 3, JSON.stringify(items.map(i => i.title)));
    // la que Facebook dibujó tarde se leyó completa, y sin emojis
    assert.equal(items.find(i => /M4/.test(i.title))?.title, 'BMW M4 Competition 2022');
    const puro = items.find(i => /purosangue/i.test(i.title));
    assert.equal(puro.price, 14399000);
    assert.equal(puro.year, 2026);
    assert.equal(puro.km, '1200');                       // estaba detrás de "Ver más"
    assert.equal(puro.url, 'https://www.facebook.com/luxurycarspv/posts/pfbid02AbCdEf123/');
    assert.equal(puro.external_id, 'gluxurycarspv_pfbid02AbCdEf123');
    assert.equal(puro.published_on, '2025-11-07');
    const g63 = items.find(i => /G 63/.test(i.title));
    assert.equal(g63.url, 'https://www.facebook.com/groups/seminuevosgdl/posts/5551234/');
    assert.equal(g63.price, 3350000);
    assert.ok(!/[\u{1F1E6}-\u{1F1FF}✅]/u.test(g63.title + g63.description), g63.title);
  } finally { await browser.close(); }
});

test('se activa solo con la dirección real: búsqueda dentro de un grupo y búsqueda general', { skip: !chromium && 'Playwright no está instalado', timeout: 60000 }, async () => {
  const browser = await chromium.launch();
  try {
    const html = readFileSync(new URL('./fixtures/captura/fb-busqueda.html', import.meta.url), 'utf8').replace(/<script>window\.__pc[^<]*<\/script>/, '');
    for (const path of ['/groups/2653795214672713/search/?q=ferrari', '/search/posts/?q=ferrari%20en%20venta%20mexico', '/groups/2653795214672713/']) {
      const page = await browser.newPage();
      await page.route('https://www.facebook.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
      await page.goto('https://www.facebook.com' + path);
      await page.evaluate(() => { window.open = () => ({ closed: false, postMessage: () => {} }); window.alert = m => { window.__alerta = m; }; });
      await page.evaluate(readFileSync(new URL('../../captura-marcador.js', import.meta.url), 'utf8'));
      assert.equal(await page.evaluate(() => window.__alerta || null), null, path);
      assert.match(await page.textContent('body'), path.includes('search') ? /Precio de Calle · búsqueda/ : /Precio de Calle · modo grupo/, path);
      await page.click('[data-x]');
      await page.close();
    }
  } finally { await browser.close(); }
});

test('si algo saca la página a Reels, regresa solo y sigue', { skip: !chromium && 'Playwright no está instalado', timeout: 180000 }, async () => {
  const browser = await chromium.launch();
  try {
    const html = readFileSync(new URL('./fixtures/captura/fb-busqueda.html', import.meta.url), 'utf8')
      .replace(/<script>window\.__pc[^<]*<\/script>/, '<script>window.__pcTrampa = true;</script>');
    const page = await browser.newPage();
    await page.route('https://www.facebook.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto('https://www.facebook.com/search/top/?q=ferrari');
    await page.evaluate(() => { window.__sent = []; window.open = () => ({ closed: false, postMessage: m => window.__sent.push(JSON.parse(JSON.stringify(m))) }); });
    await page.evaluate(readFileSync(new URL('../../captura-marcador.js', import.meta.url), 'utf8'));
    await page.waitForFunction(() => /7 publicaciones.*4 no son autos/.test(document.querySelector('[data-s]')?.textContent || ''), null, { timeout: 150000 });
    assert.equal(new URL(page.url()).pathname, '/search/top/');   // regresó de /reel/999
    await page.click('[data-x]');
    await page.waitForFunction(() => window.__sent.length > 0);
    assert.equal((await page.evaluate(() => window.__sent))[0].items.length, 3);
  } finally { await browser.close(); }
});

