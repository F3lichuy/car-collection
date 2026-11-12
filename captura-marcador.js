/* ════════════════════════════════════════════════════════════════════════
   Botón "Guardar en Precio de Calle" (marcador del navegador)

   Lo usas TÚ mientras navegas: al darle clic, lee los autos de la página que
   estás viendo (resultados o un anuncio de Mercado Libre o Facebook
   Marketplace, o la ficha de una agencia con datos estructurados) y los manda
   a carcollection.app, donde los revisas antes de guardar. No navega solo, no
   abre otras páginas y no lee nombres ni teléfonos de vendedores.

   carcollection.app lo convierte en marcador: javascript: + este archivo.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  var APP = "https://carcollection.app/#capturar";
  var host = location.hostname;
  // window.__pcSite: solo para las páginas de prueba (mercado/tests/fixtures/captura)
  var site = /^(facebook|mercadolibre)$/.test(window.__pcSite || "") ? window.__pcSite : /(^|\.)facebook\.com$/.test(host) ? "facebook" : /(^|\.)mercadolibre\.com\.mx$/.test(host) ? "mercadolibre" : "otro";
  var MAX = 200;

  function txt(el) { return el ? String(el.innerText || el.textContent || "").replace(/\s+\n/g, "\n").trim() : ""; }
  function abs(u) { try { return new URL(u, location.href).href; } catch (e) { return null; } }
  function q(root, sel) { try { return root.querySelector(sel); } catch (e) { return null; } }
  function qa(root, sel) { try { return Array.prototype.slice.call(root.querySelectorAll(sel)); } catch (e) { return []; } }
  // "MX$450,000" · "$ 1,250,000" · "US$45,000" → { price, currency, ambiguous }
  function money(s) {
    var m = String(s || "").replace(/\s/g, "").match(/(US\$|USD|MX\$|MXN|\$)(\d{1,3}(?:[.,]\d{3})+|\d{4,})/i);
    if (!m) return null;
    var n = Number(m[2].replace(/[.,]/g, ""));
    if (!(n > 0)) return null;
    return { price: n, currency: /^(US\$|USD)$/i.test(m[1]) ? "USD" : "MXN", ambiguous: m[1] === "$" };
  }
  // "45K km" · "45 mil km" · "45,000 Km" · "30,000 millas"
  function kmOf(s) {
    var m = String(s || "").match(/(\d{1,3}(?:[.,]\d{3})+|\d+(?:[.,]\d+)?)\s*(k|mil)?\s*(km|kms|kilómetros|kilometros|millas|mi)\b/i);
    if (!m) return null;
    var n = Number(m[1].replace(/[.,](?=\d{3}\b)/g, "").replace(",", "."));
    if (m[2]) n = n * 1000;
    return { km: String(Math.round(n)), km_unit: /^(millas|mi)$/i.test(m[3]) ? "mi" : "km" };
  }
  function yearOf(s) { var a = String(s || "").match(/\b(19[4-9]\d|20[0-3]\d)\b/g); return a ? Number(a[a.length - 1]) : null; }
  // "Publicado hace 3 semanas" / "Listed 2 weeks ago" → fecha aproximada (se guarda también el texto)
  function agoDate(s) {
    var m = String(s || "").match(/hace\s+(un|una|\d+)\s+(días|dias|día|semanas|semana|meses|mes|años|año)|(\d+|a|an)\s+(days|day|weeks|week|months|month|years|year)\s+ago/i);
    if (!m) return null;
    var n = m[1] || m[3]; n = /^(un|una|a|an)$/i.test(n) ? 1 : Number(n);
    var u = (m[2] || m[4]).toLowerCase(), d = /^d/.test(u) ? 1 : /^(sem|wee)/.test(u) ? 7 : /^(mes|mon)/.test(u) ? 30 : 365;
    var t = new Date(Date.now() - n * d * 864e5);
    return { date: t.toISOString().slice(0, 10), text: m[0] };
  }
  function labelValue(lines, labels) {
    for (var i = 0; i < lines.length; i++) {
      for (var j = 0; j < labels.length; j++) {
        var re = new RegExp("^" + labels[j] + "\\s*:?\\s*(.*)$", "i"), m = lines[i].match(re);
        if (m) return m[1] || lines[i + 1] || null;
      }
    }
    return null;
  }

  // ── JSON-LD (agencias y Mercado Libre) ───────────────────────────────
  function jsonLd() {
    var out = [];
    qa(document, 'script[type="application/ld+json"]').forEach(function (s) {
      try {
        var j = JSON.parse(s.textContent);
        (function walk(x) {
          if (!x || typeof x !== "object") return;
          if (Array.isArray(x)) return x.forEach(walk);
          out.push(x);
          ["@graph", "itemListElement", "item", "mainEntity"].forEach(function (k) { if (x[k]) walk(x[k]); });
        })(j);
      } catch (e) { /* bloque roto */ }
    });
    return out.filter(function (o) { return /^(Product|Car|Vehicle|IndividualProduct)$/.test([].concat(o["@type"])[0]); });
  }
  function fromLd(o) {
    var off = [].concat(o.offers || [])[0] || {};
    if (/(OutOfStock|SoldOut)/i.test(String(off.availability || ""))) return null;
    var price = Number(off.price || (off.priceSpecification && off.priceSpecification.price));
    var img = [].concat(o.image || []).map(function (i) { return typeof i === "string" ? i : i && i.url; }).filter(Boolean);
    var km = o.mileageFromOdometer ? String(o.mileageFromOdometer.value || o.mileageFromOdometer) : null;
    var url = abs(off.url || o.url || location.href);
    return {
      external_id: o.sku || o.productID || null, url: url, title: o.name || null,
      make: (o.brand && (o.brand.name || o.brand)) || null, model: o.model ? String(o.model.name || o.model) : null,
      year: yearOf(o.vehicleModelDate || o.modelDate || o.productionDate) || yearOf(o.name), km: km,
      transmission: o.vehicleTransmission || null, color_ext: o.color || null, vin: o.vehicleIdentificationNumber || null,
      price: price > 0 ? price : null, currency: /^(MXN|USD)$/.test(off.priceCurrency || "") ? off.priceCurrency : null,
      description: o.description ? String(o.description).slice(0, 4000) : null, photos: img.slice(0, 30),
    };
  }

  // ── Mercado Libre ────────────────────────────────────────────────────
  function mlId(u) { var m = String(u || "").match(/MLM-?(\d{6,})/i); return m ? "MLM" + m[1] : null; }
  function mlCards() {
    var cards = qa(document, "li.ui-search-layout__item, div.poly-card, div.ui-search-result__wrapper");
    var seen = {}, out = [];
    cards.forEach(function (c) {
      var a = q(c, 'a[href*="MLM"]'); if (!a) return;
      var url = abs(a.href.split("#")[0]), id = mlId(url); if (!id || seen[id]) return; seen[id] = 1;
      var cur = q(c, ".poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount") || q(c, ".andes-money-amount:not(.andes-money-amount--previous)");
      var sym = txt(q(cur || c, ".andes-money-amount__currency-symbol")), fr = txt(q(cur || c, ".andes-money-amount__fraction"));
      var p = money((sym || "$") + fr);
      var prev = q(c, ".andes-money-amount--previous"), lp = prev ? money((txt(q(prev, ".andes-money-amount__currency-symbol")) || "$") + txt(q(prev, ".andes-money-amount__fraction"))) : null;
      var attrs = qa(c, ".poly-attributes_list__item, .poly-attributes-list__item, .ui-search-card-attributes__attribute").map(txt).join(" · ");
      // todas las fotos que ya trae la tarjeta (algunas traen carrusel), una por imagen
      var seenImg = {}, imgs = qa(c, "img").map(function (i) { return i.getAttribute("data-src") || i.src; })
        .filter(function (u) { return /^https:\/\/http2\.mlstatic\.com\//.test(u || ""); })
        .filter(function (u) { var m = u.match(/(\d{5,}-MLM\d+_\d+)/), key = m ? m[1] : u; if (seenImg[key]) return false; seenImg[key] = 1; return true; });
      var k = kmOf(attrs);
      out.push({
        external_id: id, url: url, title: txt(q(c, ".poly-component__title, .ui-search-item__title, h2, h3")) || txt(a),
        year: yearOf(attrs), km: k && k.km, km_unit: k && k.km_unit,
        price: p && p.price, currency: p && p.currency, currency_ambiguous: p ? p.ambiguous && !sym : false,
        list_price: lp && p && lp.currency === p.currency && lp.price > p.price ? lp.price : null,   // precio tachado
        city: txt(q(c, ".poly-component__location, .ui-search-item__location")) || null,
        photos: imgs.slice(0, 12),
      });
    });
    return out;
  }
  function mlItem() {
    var title = txt(q(document, "h1.ui-pdp-title, h1"));
    if (!title) return [];
    var cur = q(document, ".ui-pdp-price__second-line .andes-money-amount") || q(document, ".andes-money-amount:not(.andes-money-amount--previous)");
    var p = money(txt(q(cur, ".andes-money-amount__currency-symbol")) + txt(q(cur, ".andes-money-amount__fraction")));
    var prev = q(document, ".ui-pdp-price__original-value, .ui-pdp-price .andes-money-amount--previous");
    var lp = prev ? money((txt(q(prev, ".andes-money-amount__currency-symbol")) || "$") + txt(q(prev, ".andes-money-amount__fraction"))) : null;
    var rows = {};
    qa(document, "tr").forEach(function (tr) { var th = txt(q(tr, "th")), td = txt(q(tr, "td")); if (th && td) rows[th.toLowerCase()] = td; });
    var sub = txt(q(document, ".ui-pdp-subtitle, .ui-pdp-header__subtitle"));
    var k = kmOf(rows["kilómetros"] || rows.kilometros || sub), ago = agoDate(sub);
    // una foto por imagen: ML repite cada una en miniatura (-R) y grande (-F / 2X); se queda la grande
    var byId = {}, order = [];
    qa(document, ".ui-pdp-gallery img, figure img").map(function (i) { return i.getAttribute("data-zoom") || i.getAttribute("data-src") || i.src; })
      .filter(function (u) { return /^https:\/\/http2\.mlstatic\.com\//.test(u || ""); })
      .forEach(function (u) {
        var m = u.match(/(\d{5,}-MLM\d+_\d+)/), key = m ? m[1] : u, big = /-F[.-]|_2X_/.test(u);
        if (!(key in byId)) { order.push(key); byId[key] = u; } else if (big && !/-F[.-]|_2X_/.test(byId[key])) byId[key] = u;
      });
    var imgs = order.map(function (k) { return byId[k]; });
    return [{
      external_id: mlId(location.href), url: abs(location.href.split("#")[0].split("?")[0]), title: title,
      make: rows.marca || null, model: [rows.modelo, rows["versión"] || rows.version].filter(Boolean).join(" ") || null,
      version: rows["versión"] || rows.version || null, year: yearOf(rows["año"] || rows.ano || sub || title),
      km: k && k.km, km_unit: k && k.km_unit, transmission: rows["transmisión"] || rows.transmision || null,
      color_ext: rows.color || rows["color exterior"] || null, color_int: rows["color interior"] || rows["color de interiores"] || rows.interior || null,
      price: p && p.price, currency: p && p.currency, currency_ambiguous: false,
      list_price: lp && p && lp.currency === p.currency && lp.price > p.price ? lp.price : null,
      body: rows["tipo de carrocería"] || rows["tipo de carroceria"] || null,
      city: txt(q(document, ".ui-vip-location__subtitle, .ui-seller-info__status-info__subtitle")) || null,
      description: txt(q(document, ".ui-pdp-description__content")).slice(0, 4000) || null,
      photos: Array.from(new Set(imgs)).slice(0, 30), published_on: ago && ago.date, extra: ago ? { publicado_texto: ago.text } : undefined,
    }];
  }

  // ── Facebook Marketplace ─────────────────────────────────────────────
  function fbId(u) { var m = String(u || "").match(/\/marketplace\/item\/(\d+)/); return m ? m[1] : null; }
  function fbCards() {
    var seen = {}, out = [];
    qa(document, 'a[href*="/marketplace/item/"]').forEach(function (a) {
      var id = fbId(a.href); if (!id || seen[id]) return;
      var lines = txt(a).split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
      if (!lines.length) return;
      seen[id] = 1;
      var priceLine = lines.filter(function (l) { return money(l); })[0], p = money(priceLine);
      var kmLine = lines.filter(function (l) { return kmOf(l); })[0], k = kmOf(kmLine);
      var rest = lines.filter(function (l) { return l !== priceLine && l !== kmLine && !money(l); });
      var title = rest.filter(function (l) { return yearOf(l); })[0] || rest[0] || null;
      var city = rest.filter(function (l) { return l !== title && /,/.test(l); })[0] || null;
      var img = q(a, "img");
      out.push({
        external_id: id, url: "https://www.facebook.com/marketplace/item/" + id + "/", title: title,
        year: yearOf(title), km: k && k.km, km_unit: k && k.km_unit,
        price: p && p.price, currency: p && p.currency, currency_ambiguous: !!(p && p.ambiguous),
        city: city, photos: img && /^https:/.test(img.src) ? [img.src] : [],
      });
    });
    return out;
  }
  function fbItem() {
    var id = fbId(location.href); if (!id) return [];
    var main = q(document, '[role="main"]') || document.body;
    var lines = txt(main).split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    var title = txt(q(main, "h1")) || lines[0];
    var ti = lines.indexOf(title), after = lines.slice(Math.max(0, ti), ti + 8);
    var p = money(after.filter(function (l) { return money(l); })[0]);
    var k = kmOf(labelValue(lines, ["Recorrido", "Driven", "Kilometraje"]) || lines.filter(function (l) { return /recorrid|driven|kilometraje/i.test(l); })[0]);
    var tx = lines.filter(function (l) { return /transmisi[oó]n (manual|autom[aá]tica)|(manual|automatic) transmission/i.test(l); })[0] || null;
    var color = lines.filter(function (l) { return /color exterior|exterior color/i.test(l); })[0] || null;
    var placeLine = lines.filter(function (l) { return /(publicado|listed).*(en|in)\s+/i.test(l); })[0] || "";
    var ago = agoDate(placeLine), city = (placeLine.match(/\s(?:en|in)\s+(.+)$/i) || [])[1] || null;
    var di = lines.findIndex(function (l) { return /descripci[oó]n del vendedor|seller.s description/i.test(l); });
    var desc = di >= 0 ? lines.slice(di + 1, di + 40).join("\n") : null;
    var imgs = qa(main, "img").filter(function (i) { return /scontent|fbcdn/.test(i.src) && (i.naturalWidth || i.width) >= 300; }).map(function (i) { return i.src; });
    return [{
      external_id: id, url: "https://www.facebook.com/marketplace/item/" + id + "/", title: title,
      year: yearOf(title), km: k && k.km, km_unit: k && k.km_unit, transmission: tx,
      color_ext: color ? color.replace(/^.*?(color exterior|exterior color)\s*:?\s*/i, "").split("·")[0].trim() : null,
      price: p && p.price, currency: p && p.currency, currency_ambiguous: !!(p && p.ambiguous),
      city: city, description: desc ? desc.slice(0, 4000) : null, photos: Array.from(new Set(imgs)).slice(0, 30),
      published_on: ago && ago.date, extra: ago ? { publicado_texto: ago.text } : undefined,
    }];
  }

  // ── juntar ───────────────────────────────────────────────────────────
  var items = [];
  if (site === "mercadolibre") items = mlId(location.pathname) && q(document, "h1") ? mlItem() : mlCards();
  else if (site === "facebook") items = fbId(location.href) ? fbItem() : fbCards();
  if (!items.length) items = jsonLd().map(fromLd).filter(Boolean);
  items = items.filter(function (x) { return x && x.url && x.title; }).slice(0, MAX);

  if (!items.length) {
    alert("Precio de Calle: no encontré autos en esta página.\n\nAbre una página de resultados o un anuncio de un auto y vuelve a darle clic.");
    return;
  }
  var payload = { type: "pc-captura", v: 1, site: site, page_url: location.href.split("#")[0], title: document.title, items: items };
  // respaldo: si el sitio corta la comunicación entre pestañas, en carcollection.app se puede pegar
  try { if (navigator.clipboard) navigator.clipboard.writeText(JSON.stringify(payload)).catch(function () {}); } catch (e) { /* sin portapapeles */ }
  var w = window.open(APP, "precio-calle-captura");
  if (!w) { alert("Precio de Calle: tu navegador bloqueó la ventana. Permite ventanas emergentes para este sitio y vuelve a intentarlo."); return; }
  // reenvía hasta que carcollection.app confirme que lo recibió (máx. 30 s)
  var tries = 0, done = false;
  window.addEventListener("message", function (e) { if (e.origin === "https://carcollection.app" && e.data === "pc-captura-recibida") done = true; });
  (function send() {
    if (done || tries++ > 60) return;
    try { w.postMessage(payload, "https://carcollection.app"); } catch (e) { /* aún cargando */ }
    setTimeout(send, 500);
  })();
})();
