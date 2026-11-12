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

  // ── Grupos de Facebook (modo grupo) ──────────────────────────────────
  // En un grupo, el botón no lee una sola vez: baja solo por el grupo, en ESTA pestaña y a
  // ritmo pausado, mientras tú estás en la computadora. De cada publicación de venta lee la
  // fecha, el texto, el precio, el año, el kilometraje y las fotos; no lee quién la publicó,
  // y quita teléfonos y correos del texto. Manda los autos por tandas a carcollection.app
  // (la ventana que abre al empezar), que los guarda como capturas pendientes.
  var MESES = { enero: 1, ene: 1, january: 1, jan: 1, febrero: 2, feb: 2, february: 2, marzo: 3, mar: 3, march: 3, abril: 4, abr: 4, april: 4, apr: 4,
    mayo: 5, may: 5, junio: 6, jun: 6, june: 6, julio: 7, jul: 7, july: 7, agosto: 8, ago: 8, august: 8, aug: 8, septiembre: 9, setiembre: 9, sep: 9, sept: 9,
    september: 9, octubre: 10, oct: 10, october: 10, noviembre: 11, nov: 11, november: 11, diciembre: 12, dic: 12, december: 12, dec: 12 };
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // "martes, 12 de octubre de 2023 a las 10:15" · "12 de octubre a las 10:15" · "Ayer a las 9:00" · "3 h" · "2 d" · "1 sem" · "October 12, 2023"
  function fbDate(s, now) {
    now = now || new Date();
    var t = String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim(), m, d;
    if (!t || t.length > 120) return null;
    var back = function (days) { var x = new Date(now.getTime() - days * 864e5); return { date: iso(x), text: s, exact: days < 7 }; };
    if ((m = t.match(/\b(\d{1,2})\s+de\s+([a-z]+)(?:\s+de\s+(\d{4}))?/)) || (m = t.match(/\b(\d{1,2})\s+([a-z]{3,10})\.?(?:\s+(\d{4}))?\b/))) {
      if (MESES[m[2]]) {
        d = new Date(m[3] ? Number(m[3]) : now.getFullYear(), MESES[m[2]] - 1, Number(m[1]), 12);
        if (!m[3] && d > now) d.setFullYear(d.getFullYear() - 1);
        return { date: iso(d), text: s, exact: true };
      }
    }
    if ((m = t.match(/\b([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/)) && MESES[m[1]]) {
      d = new Date(m[3] ? Number(m[3]) : now.getFullYear(), MESES[m[1]] - 1, Number(m[2]), 12);
      if (!m[3] && d > now) d.setFullYear(d.getFullYear() - 1);
      return { date: iso(d), text: s, exact: true };
    }
    if ((m = t.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/))) return { date: m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0"), text: s, exact: true };
    if (/^(ayer|yesterday)\b/.test(t)) return back(1);
    if (/^(justo ahora|ahora|just now)$/.test(t)) return back(0);
    if ((m = t.match(/^(?:hace\s+)?(\d+|un|una|a|an)\s*(min|minutos?|minutes?|m|h|hr|hrs|horas?|hours?|d|dias?|days?|sem|semanas?|w|wk|weeks?|a|anos?|y|yr|years?)\b(?:\s+ago)?$/))) {
      var n = /^(un|una|a|an)$/.test(m[1]) ? 1 : Number(m[1]), u = m[2];
      if (/^(min|m$|h|hr|hora|hour)/.test(u)) return back(0);
      if (/^(d|dia|day)/.test(u)) return back(n);
      if (/^(sem|w)/.test(u)) return back(7 * n);
      return back(365 * n);
    }
    return null;
  }
  // Precio escrito a mano: "$4,200,000" · "4.2 mdp" · "2'500,000 pesos" · "850 mil" · "$850k" · "precio 3.5 millones".
  // No cuenta enganches, mensualidades ni apartados. Con "antes … ahora", el de ahora es el precio y el de antes, el tachado.
  function priceFree(s) {
    var text = String(s || ""), out = [], re = /(US\$|USD|U\$S|MX\$|\$)?\s*(\d{1,3}(?:[.,'’]\d{3})+(?:\.\d{2})?|\d+(?:[.,]\d+)?)\s*(mdp|millones?(?:\s+de\s+pesos)?|mill?o?n?\b|mil\b|k\b|mxn|pesos|usd|d[oó]lares|dlls?)?/gi, m;
    while ((m = re.exec(text))) {
      var sym = m[1] || "", raw = m[2], mult = (m[3] || "").toLowerCase();
      if (!sym && !mult) continue;   // un número suelto (año, km, teléfono) no es precio
      var before = text.slice(Math.max(0, m.index - 30), m.index).toLowerCase();
      if (/(enganche|mensualidad|mensuales|pagos? de|apart|tenencia|seguro|servicio|refrendo|verificaci|km|kil[oó]metros|millas)\s*:?\s*(de\s*)?$/.test(before)) continue;
      if (/^\s*(km|kms|kil|millas|mi\b|hp|cv|cc|l\b)/i.test(text.slice(re.lastIndex, re.lastIndex + 6))) continue;
      var n;
      if (/^(mdp|mill|mil?l?o?n)/.test(mult) && !/^mil$/.test(mult)) n = Number(raw.replace(/[,'’](?=\d{3}\b)/g, "").replace(",", ".")) * (Number(raw.replace(",", ".")) < 1000 ? 1e6 : 1);
      else if (/^(mil|k)$/.test(mult)) n = Number(raw.replace(",", ".")) * 1000;
      else n = Number(raw.replace(/[.,'’](?=\d{3}(\D|$))/g, "").replace(/\.\d{2}$/, ""));
      if (!(n >= 50000 && n <= 300000000)) continue;
      out.push({ price: Math.round(n), currency: /US|U\$S|usd|d[oó]lares|dll/i.test(sym + mult) ? "USD" : "MXN", at: m.index });
    }
    if (!out.length) return null;
    if (out.length > 1 && /\b(antes|rebaj|remat|baj[eéoó]|ahora|nuevo precio|ultimo precio|último precio)/i.test(text)) {
      var last = out[out.length - 1], prev = out.slice(0, -1).filter(function (x) { return x.currency === last.currency && x.price > last.price; })[0];
      return { price: last.price, currency: last.currency, list_price: prev ? prev.price : null };
    }
    return { price: out[0].price, currency: out[0].currency, list_price: null };
  }
  var BRAND_RE = /\b(porsche|ferrari|lamborghini|lambo|mclaren|aston\s*martin|bentley|rolls[\s-]*royce|maserati|mercedes|benz|amg|bmw|audi|gt-?r|corvette|mustang|shelby|camaro|viper|jaguar|alfa\s*romeo|lotus|land\s*rover|defender|karmann|karman|mini\s*cooper|volvo|peugeot|bugatti|pagani|koenigsegg|lexus|nsx|g\s*63|g\s*wagon|e30|e-?type|911|cayman|boxster|carrera|huracan|hurac[aá]n|aventador|urus|gallardo|murcielago)\b/i;
  var WANTED_RE = /^\s*(busco|compro|se busca|ando buscando|quien venda|alguien (que )?venda|cambio mi|wtb\b)/i;
  var NOISE_RE = /^(me gusta|like|comentar|comment|compartir|share|responder|reply|enviar|send|ver m[aá]s|see more|ver traducci[oó]n|see translation|todas las reacciones|all reactions|escribe un comentario|write a comment|\d+\s*(comentarios?|comments?|veces compartido|shares?)|[\d.,]+\s*(mil|k)?$|·|seguir|follow|unirte|join|miembro|admin|moderador)/i;
  function stripContact(s) {
    return String(s || "").replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[correo]").replace(/(?:wa\.me|api\.whatsapp\.com)\/\S+/gi, "[whatsapp]")
      .replace(/(\+?52[\s.-]?)?(\(?\d{2,3}\)?[\s.-]?)\d{3,4}[\s.-]?\d{4}\b/g, function (x) { return /\d{2,3}[\s.-]?\d{3,4}[\s.-]?\d{4}/.test(x) && !/^\d{1,3}([.,]\d{3})+$/.test(x.trim()) ? "[tel]" : x; });
  }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  function topPosts() {
    var feed = q(document, '[role="feed"]');
    if (feed) return Array.prototype.slice.call(feed.children);
    return qa(document, '[role="article"]').filter(function (el) {
      return !(el.parentElement && el.parentElement.closest('[role="article"]')) && !/coment|comment/i.test(el.getAttribute("aria-label") || "");
    });
  }
  function sleep(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  var POST_HREF = /\/groups\/([^/?#]+)\/(?:posts|permalink)\/(\d+)|[?&](?:story_fbid|multi_permalinks)=(\d+)|\/(?:commerce\/listing|marketplace\/item)\/(\d+)/;
  // Facebook llena la liga y la fecha completa de una publicación solo cuando pasas el mouse sobre la hora:
  // se simula ese paso del mouse y se lee el globo ("martes, 12 de octubre de 2023 a las 10:15").
  async function postMeta(post) {
    var as = qa(post, "a[href]").slice(0, 30), timeA = null, link = null, date = null;
    for (var i = 0; i < as.length && !timeA; i++) {
      var a = as[i];
      if (POST_HREF.test(a.getAttribute("href") || "") || (fbDate(txt(a)) && txt(a).length < 40)) timeA = a;
    }
    if (timeA) {
      ["pointerover", "mouseover", "pointerenter", "mouseenter", "focus"].forEach(function (ev) { try { timeA.dispatchEvent(new MouseEvent(ev, { bubbles: true })); } catch (e) {} });
      await sleep(700);
      var tip = qa(document, '[role="tooltip"]').map(txt).filter(Boolean).pop();
      date = fbDate(tip) || fbDate(timeA.getAttribute("aria-label")) || fbDate(txt(timeA));
      ["pointerout", "mouseout", "pointerleave", "mouseleave", "blur"].forEach(function (ev) { try { timeA.dispatchEvent(new MouseEvent(ev, { bubbles: true })); } catch (e) {} });
    }
    as = qa(post, "a[href]");
    for (var j = 0; j < as.length && !link; j++) { var m = (as[j].href || "").match(POST_HREF); if (m) link = m; }
    return { date: date, link: link };
  }
  function groupId() {
    var m = location.pathname.match(/\/groups\/([^/?#]+)/);
    return window.__pcGroup || (m ? m[1] : "grupo");
  }
  async function readPost(post) {
    // "Ver más": el texto completo
    qa(post, '[role="button"]').filter(function (b) { return /^(ver m[aá]s|see more)$/i.test(txt(b)); }).slice(0, 2).forEach(function (b) { try { b.click(); } catch (e) {} });
    var meta = await postMeta(post);
    var msgEl = q(post, '[data-ad-preview="message"], [data-ad-comet-preview="message"]');
    var head = txt(post).split("\n").map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8), headDate = null;
    for (var h = 0; h < head.length && !headDate; h++) headDate = fbDate(head[h]);
    var lines = txt(msgEl || post).split("\n").map(function (s) { return s.trim(); }).filter(Boolean);
    if (!msgEl) {
      // sin el bloque del mensaje: se brinca el encabezado (quién publicó y cuándo) y se corta en la barra de reacciones
      var hi = -1;
      for (var i = 0; i < Math.min(lines.length, 8); i++) if (fbDate(lines[i])) { hi = i; break; }
      lines = lines.slice(hi >= 0 ? hi + 1 : 1);   // sin fecha visible: el primer renglón es el nombre de quien publicó
      var end = lines.findIndex(function (l) { return /^(me gusta|like|comentar|comment|todas las reacciones|all reactions)$/i.test(l); });
      if (end >= 0) lines = lines.slice(0, end);
    }
    lines = lines.filter(function (l) { return !NOISE_RE.test(l) && l.length > 1; });
    var text = lines.join("\n");
    if (!text || WANTED_RE.test(text) || !BRAND_RE.test(text)) return null;
    if (/^\s*(vendido|sold)\b/i.test(text)) return null;
    var p = priceFree(text), k = kmOf(text);
    var titleLine = lines.filter(function (l) { return BRAND_RE.test(l) && l.length <= 140; })[0] || lines[0];
    var nowY = new Date().getFullYear() + 1, years = (titleLine.match(/\b(19[5-9]\d|20[0-3]\d)\b/g) || []).concat((lines.slice(0, 4).join(" ").match(/\b(19[5-9]\d|20[0-3]\d)\b/g) || []))
      .map(Number).filter(function (y) { return y <= nowY; });
    if (!p && !years.length) return null;   // ni precio ni año: plática, no anuncio
    var gid = meta.link && meta.link[1] || groupId(), pid = meta.link ? (meta.link[2] || meta.link[3] || meta.link[4]) : null;
    var key = pid ? "g" + gid + "_" + pid : "g" + gid + "_t" + hash(text.slice(0, 400));
    var url = pid ? (meta.link[4] ? "https://www.facebook.com/marketplace/item/" + pid + "/" : "https://www.facebook.com/groups/" + gid + "/posts/" + pid + "/")
      : "https://www.facebook.com/groups/" + gid + "/?pc_post=" + key;
    var city = lines.filter(function (l) { return l.length < 45 && /^[A-ZÁÉÍÓÚÑ][\wáéíóúñ .]+,\s*[A-Z][\w. ]{1,25}$/.test(l) && !BRAND_RE.test(l); })[0] || null;
    var imgs = qa(post, "img").filter(function (i) { return /scontent|fbcdn/.test(i.src) && (i.naturalWidth || i.width || 0) >= 150 && !i.closest('[role="article"] [role="article"]'); })
      .map(function (i) { return i.src; });
    var date = meta.date || headDate;
    return {
      external_id: key, url: url, title: titleLine.slice(0, 140) + (years.length && !/\b(19|20)\d{2}\b/.test(titleLine) ? " " + years[0] : ""),
      year: years.length ? years[0] : null, km: k && k.km, km_unit: k && k.km_unit,
      price: p && p.price, currency: p && p.currency, currency_ambiguous: false, list_price: p && p.list_price,
      city: city, description: stripContact(text).slice(0, 4000), photos: Array.from(new Set(imgs)).slice(0, 12),
      published_on: date && date.date, observed_on: date && date.date,
      extra: { grupo: gid, publicado_texto: date ? String(date.text).slice(0, 80) : null, fecha_exacta: date ? !!date.exact : false },
    };
  }

  function grupoMode() {
    if (window.__pcGrupo) { window.__pcGrupo.panel.style.display = ""; return; }
    var w = window.open(APP, "precio-calle-captura");
    if (!w) { alert("Precio de Calle: tu navegador bloqueó la ventana. Permite ventanas emergentes para este sitio y vuelve a intentarlo."); return; }
    var S = window.__pcGrupo = { w: w, running: true, done: {}, queue: [], pending: {}, posts: 0, cars: 0, sent: 0, idle: 0, start: Date.now(),
      minutes: 30, oldest: null, msg: "", batchN: 0, stopped: false };
    var panel = S.panel = document.createElement("div");
    panel.setAttribute("style", "position:fixed;right:16px;bottom:16px;z-index:2147483647;background:#111;color:#fff;font:13px/1.4 system-ui,sans-serif;" +
      "padding:12px 14px;border-radius:12px;box-shadow:0 6px 24px rgba(0,0,0,.35);width:270px");
    panel.innerHTML = '<b>Precio de Calle · modo grupo</b><div data-s style="margin:6px 0 8px;opacity:.9"></div>' +
      '<label style="display:block;margin-bottom:8px;opacity:.8">Detener a los <input data-min type="number" min="5" max="120" value="30" style="width:48px"> min</label>' +
      '<button data-p style="margin-right:6px">Pausar</button><button data-x>Terminar y enviar</button>';
    document.body.appendChild(panel);
    var st = q(panel, "[data-s]"), bp = q(panel, "[data-p]");
    q(panel, "[data-min]").addEventListener("change", function (e) { S.minutes = Math.max(5, Number(e.target.value) || 30); });
    bp.addEventListener("click", function () { S.running = !S.running; bp.textContent = S.running ? "Pausar" : "Seguir"; if (S.running) loop(); });
    q(panel, "[data-x]").addEventListener("click", function () { finish("Terminado."); });
    function show() {
      var left = Object.keys(S.pending).length;
      st.innerHTML = S.posts + " publicaciones leídas · <b>" + S.cars + " autos</b><br>" + S.sent + " enviados" + (left ? " · " + left + " tanda(s) esperando a carcollection.app" : "") +
        (S.oldest ? "<br>Llegó hasta el " + S.oldest : "") + (S.msg ? "<br><span style='color:#ffcf6b'>" + S.msg + "</span>" : "");
    }
    // tandas de hasta 25 autos; se reenvían hasta que carcollection.app confirma que las guardó
    function flush(force) {
      while (S.queue.length >= 25 || (force && S.queue.length)) {
        var id = Date.now().toString(36) + "-" + (++S.batchN);
        S.pending[id] = { type: "pc-captura", v: 1, mode: "grupo", batch: id, site: "facebook-grupos", page_url: location.href.split("#")[0].split("?")[0], title: document.title, items: S.queue.splice(0, 25) };
      }
      Object.keys(S.pending).forEach(function (id) { try { S.w.postMessage(S.pending[id], "https://carcollection.app"); } catch (e) {} });
      show();
    }
    window.addEventListener("message", function (e) {
      if (e.origin !== "https://carcollection.app" || !e.data || e.data.type !== "pc-captura-guardada") return;
      var b = S.pending[e.data.batch];
      if (e.data.ok && b) { S.sent += b.items.length; delete S.pending[e.data.batch]; S.msg = ""; }
      else if (!e.data.ok) S.msg = e.data.error || "carcollection.app no pudo guardar: ¿iniciaste sesión ahí?";
      show();
    });
    var resend = setInterval(function () {
      if (S.w.closed && Object.keys(S.pending).length) S.msg = "Cerraste la ventana de carcollection.app: dale clic otra vez al botón para reabrirla.";
      flush(false);
      if (S.stopped && !Object.keys(S.pending).length) clearInterval(resend);
    }, 4000);
    function finish(why) {
      S.running = false; S.stopped = true; bp.disabled = true; S.msg = why; flush(true);
    }
    async function loop() {
      while (S.running) {
        if (Date.now() - S.start > S.minutes * 60000) return finish("Se cumplió el tiempo de la sesión.");
        var fresh = 0, posts = topPosts();
        for (var i = 0; i < posts.length && S.running; i++) {
          var el = posts[i];
          if (el.__pcLeido) continue;
          el.__pcLeido = true; fresh++; S.posts++;
          var it = null;
          try { it = await readPost(el); } catch (e) { /* publicación rara: se brinca */ }
          if (it && !S.done[it.external_id]) {
            S.done[it.external_id] = 1; S.cars++;
            if (it.currency !== "USD") S.queue.push(it);
          }
          if (it && it.published_on && (!S.oldest || it.published_on < S.oldest)) S.oldest = it.published_on;
          show();
        }
        flush(false);
        S.idle = fresh ? 0 : S.idle + 1;
        if (S.idle >= 8) return finish("Llegó al final del grupo (o Facebook dejó de cargar más).");
        window.scrollBy(0, Math.round(window.innerHeight * 0.8));
        await sleep(4000);   // que Facebook alcance a cargar las siguientes
      }
    }
    show();
    loop();
  }
  if (site === "facebook" && (window.__pcGroup || /^\/groups\/[^/]+\/?$|^\/groups\/[^/]+\/(buy_sell_discussion|for_sale|discussion)/.test(location.pathname))) { grupoMode(); return; }

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
