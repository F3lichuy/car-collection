/* ════════════════════════════════════════════════════════════════════════
   Precio de Calle — inteligencia de mercado de autos de entusiasta en México
   Se carga solo al abrir la pestaña. Lee Supabase con la llave pública
   (tablas mx_*, lectura pública por RLS). Reglas de la sección:
   · cuenta VEHÍCULOS, no anuncios (un auto en 3 agencias es 1 auto);
   · todo número se puede rastrear a sus anuncios (la ficha los lista);
   · con n bajo dice "datos insuficientes", nunca inventa una mediana;
   · los datos demo se marcan DEMO.
   ════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";
  const PC = (window.PrecioCalle = {});
  const S = {
    loaded: false, loading: null, error: null, vehicles: [], listings: 0, sources: {}, settings: {}, fx: null,
    f: { q: "", make: "", model: "", variant: "", tx: "", seg: "", sort: "recientes" }, usd: false, limit: 48,
  };
  const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const client = () => (typeof supa !== "undefined" ? supa : null);
  const nf = new Intl.NumberFormat("es-MX");

  const TX = { manual: "Manual", pdk: "PDK", dct: "Doble embrague", f1: "F1", automatizada: "Automatizada", automatica: "Automática" };
  const SEG = { clasico: "Clásicos", moderno: "Modernos", exotico: "Exóticos", gran_turismo: "Gran Turismo", ultra_lujo: "Ultra-lujo" };
  const INVOICE = { agencia: "De agencia", aseguradora: "De aseguradora", refacturado: "Refacturado", otra: "Otra" };
  const ORIGIN = { nacional: "Nacional", importado: "Importado", fronterizo: "Fronterizo", legalizado: "Legalizado" };
  const SERVICE = { agencia_completo: "En agencia, completos", agencia_parcial: "En agencia, parciales", taller_externo: "Taller externo", sin_historial: "Sin historial" };
  const BODY = { coupe: "Coupé", targa: "Targa", cabriolet: "Convertible", roadster: "Roadster", speedster: "Speedster", suv: "SUV", sedan: "Sedán", shooting_brake: "Shooting brake" };
  const EXT_FAM = ["negro", "blanco", "gris", "plata", "rojo", "azul", "verde", "amarillo", "naranja", "morado", "cafe", "beige", "dorado", "rosa", "otro"];
  const INT_FAM = ["negro", "gris", "beige", "cafe", "rojo", "azul", "verde", "blanco", "amarillo", "naranja", "otro"];
  const STATUS = { activo: "Activo", desaparecido: "Ya no aparece", vendido_confirmado: "Vendido (confirmado)", vendido_inferido: "Vendido (inferido)", republicado: "Republicado" };

  // ── datos ──────────────────────────────────────────────────────────────
  const SPEC_COLS = "year,km,transmission,body,exterior_color,exterior_color_family,exterior_color_raw,interior_color,interior_color_family,interior_color_raw,invoice_type,origin,owners,service_history,antique_plates";
  // v: 7 = con migración 007 (borrado y precio anterior), 5 = con published_on, 0 = lo más viejo
  const listingSelect = v => `id,title,url,city,state,source_id,status,first_seen,last_seen,is_demo${v >= 5 ? ",published_on" : ""},
        vehicle:mx_vehicles(id,vin,version_id,is_demo${v >= 7 ? ",deleted_at,delete_reason" : ""},
          version:mx_versions(name), generation:mx_generations(name), model:mx_models(name,segment,make:mx_makes(name))),
        specs:mx_specs(${SPEC_COLS},parse_confidence),
        prices:mx_price_snapshots(price,currency,negotiable,observed_from,observed_to${v >= 7 ? ",list_price" : ""}),
        photos:mx_photos(url,position)`;

  async function load() {
    const c = client();
    if (!c) throw new Error("Sin conexión con la base");
    const signedIn = typeof session !== "undefined" && !!session;
    // Supabase entrega máximo 1,000 filas por consulta: se piden por páginas hasta traer todas
    const listingsAll = async v => {
      const out = [];
      for (let from = 0; from < 20000; from += 1000) {
        const r = await c.from("mx_listings").select(listingSelect(v)).order("id").range(from, from + 999);
        if (r.error) return r;
        out.push(...(r.data || []));
        if ((r.data || []).length < 1000) break;
      }
      return { data: out, error: null };
    };
    const [ls0, manual, src, st, fx, own] = await Promise.all([
      listingsAll(7),
      // fichas capturadas a mano (sin anuncio): mandan sobre lo que dijo el anuncio
      c.from("mx_specs").select(`vehicle_id,${SPEC_COLS},notes,updated_at`).is("listing_id", null).order("updated_at", { ascending: false }),
      c.from("mx_sources_public").select("id,name,kind,base_url"),
      c.from("mx_settings").select("key,value"),
      c.from("mx_fx_rates").select("day,usd_mxn").order("day", { ascending: false }).limit(1),
      // ¿esta cuenta es la dueña? (solo ella borra y restaura autos; la base lo vuelve a revisar)
      signedIn ? c.rpc("mx_is_owner") : Promise.resolve({ data: false }),
    ]);
    let ls = ls0;
    // columnas que llegan con las migraciones 007 y 005: sin ellas, todo lo demás funciona igual
    if (ls.error && /deleted_at|list_price|delete_reason/.test(ls.error.message || "")) ls = await listingsAll(5);
    if (ls.error && /published_on/.test(ls.error.message || "")) ls = await listingsAll(0);
    if (ls.error) throw ls.error;
    S.owner = !own.error && own.data === true;
    S.manual = {};
    for (const m of manual.data || []) if (!S.manual[m.vehicle_id]) S.manual[m.vehicle_id] = m;   // la más reciente
    S.sources = Object.fromEntries((src.data || []).map(s => [s.id, s]));
    S.settings = Object.fromEntries((st.data || []).map(r => [r.key, r.value]));
    S.fx = fx.data && fx.data[0] ? fx.data[0] : null;
    const all = groupVehicles(ls.data || []);
    S.deleted = all.filter(x => x.deleted);    // solo los ve la dueña (RLS), para restaurarlos
    S.vehicles = all.filter(x => !x.deleted);
    S.listings = S.vehicles.reduce((n, x) => n + x.listings.length, 0);
    S.loaded = true;
  }

  const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Mexico_City" });
  const daysBetween = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 864e5)) : null);
  // Cambios de precio de un anuncio: cada vez que el tramo siguiente pide otra cifra.
  // Además, la rebaja que la propia fuente anuncia con el precio anterior tachado (list_price):
  // no sabemos cuándo bajó; la fecha es el primer día que la vimos así.
  function priceChanges(l) {
    const pr = (l.prices || []).filter(p => p.price != null).sort((a, b) => String(a.observed_from).localeCompare(String(b.observed_from)));
    const out = [];
    for (let i = 0; i < pr.length; i++) {
      const prevList = i ? pr[i - 1].list_price : null;
      if (pr[i].list_price != null && Number(pr[i].list_price) > Number(pr[i].price) && Number(prevList) !== Number(pr[i].list_price)
          && !(i && Number(pr[i - 1].price) === Number(pr[i].list_price)))
        out.push({ day: pr[i].observed_from, from: Number(pr[i].list_price), to: Number(pr[i].price), currency: pr[i].currency, source_id: l.source_id, url: l.url, announced: true });
      if (i && Number(pr[i].price) !== Number(pr[i - 1].price) && pr[i].currency === pr[i - 1].currency)
        out.push({ day: pr[i].observed_from, from: Number(pr[i - 1].price), to: Number(pr[i].price), currency: pr[i].currency, source_id: l.source_id, url: l.url });
    }
    return out;
  }

  function lastPrice(l) {
    const p = (l.prices || []).slice().sort((a, b) => String(b.observed_to).localeCompare(String(a.observed_to)))[0];
    return p || null;
  }

  // Un vehículo = todos sus anuncios. El anuncio visto más recientemente manda en precio y fotos.
  function groupVehicles(rows) {
    const by = new Map();
    for (const l of rows) {
      if (!l.vehicle) continue;
      if (!by.has(l.vehicle.id)) by.set(l.vehicle.id, { id: l.vehicle.id, v: l.vehicle, listings: [] });
      by.get(l.vehicle.id).listings.push(l);
    }
    const classicAge = Number(S.settings.classic_age_years ?? 30), now = new Date().getFullYear();
    return [...by.values()].map(x => {
      x.listings.sort((a, b) => String(b.last_seen).localeCompare(String(a.last_seen)));
      const main = x.listings[0], specs = x.listings.map(l => l.specs).filter(Boolean);
      const sp = specs.find(s => s.year != null) || specs[0] || {};
      const m = x.v.model || {};
      x.make = (m.make && m.make.name) || ""; x.model = m.name || ""; x.gen = (x.v.generation && x.v.generation.name) || "";
      x.version = (x.v.version && x.v.version.name) || "";
      x.deleted = !!x.v.deleted_at; x.deleteReason = x.v.delete_reason || null; x.deletedAt = x.v.deleted_at || null;
      // Lo capturado a mano manda campo por campo; lo demás sale de los anuncios.
      const man = (S.manual || {})[x.id] || null, merged = { ...sp };
      x.manualFields = new Set(); x.manualAt = man ? man.updated_at : null; x.notes = man ? man.notes : null;
      if (man) for (const k of SPEC_COLS.split(",")) if (man[k] != null) { merged[k] = man[k]; x.manualFields.add(k); }
      // lo que dicen los anuncios, sin la captura manual (para saber qué corrigió la persona)
      x.parsed = { ...sp, km: specs.map(s => s.km).filter(k => k != null).sort((a, b) => b - a)[0] ?? null, transmission: specs.map(s => s.transmission).find(Boolean) || null };
      x.year = merged.year ?? null;
      x.km = man && man.km != null ? man.km : x.parsed.km;
      x.tx = (man && man.transmission) || x.parsed.transmission;
      x.specs = merged; x.confidence = Math.max(...specs.map(s => Number(s.parse_confidence ?? 0)), man ? 1 : 0, 0);
      // Tiempo publicado: la fecha que declara la fuente; si ninguna la da, desde que lo vimos.
      const pub = x.listings.filter(l => l.published_on).sort((a, b) => String(a.published_on).localeCompare(String(b.published_on)))[0];
      x.publishedOn = pub ? pub.published_on : null; x.publishedBy = pub ? pub.source_id : null;
      x.changes = x.listings.flatMap(priceChanges).sort((a, b) => String(b.day).localeCompare(String(a.day)));
      x.price = lastPrice(main);
      x.active = x.listings.some(l => l.status === "activo");
      x.lastSeen = main.last_seen; x.firstSeen = x.listings.map(l => l.first_seen).sort()[0];
      x.days = daysBetween(x.publishedOn || x.firstSeen, today()); x.daysKnown = !!x.publishedOn;
      x.city = main.city || main.state || "";
      x.demo = !!(x.v.is_demo || main.is_demo);
      x.photo = x.listings.flatMap(l => (l.photos || []).slice().sort((a, b) => (a.position ?? 99) - (b.position ?? 99))).map(p => p.url)[0] || null;
      x.sourceIds = [...new Set(x.listings.map(l => l.source_id))];
      x.seg = x.year && x.year <= now - classicAge ? "clasico" : (m.segment || "");
      // "Ferrari 328 GTB / GTS", no "Ferrari 308 / 328 328 GTB / GTS": si la versión ya trae el código del modelo, no se repite.
      const modelTok = x.model.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const versionHasModel = x.version && x.version.toLowerCase().split(/[^a-z0-9]+/).some(t => modelTok.includes(t));
      x.name = [modelLabel(x.make, versionHasModel ? "" : x.model), x.version].filter(Boolean).join(" ");
      // Variante para comparar precios: la versión; en Porsche la carrocería es aparte (un Carrera 4S
      // Cabriolet no pide lo mismo que el coupé) y sin versión, al menos la carrocería ("Targa").
      x.body = merged.body || null;
      const bodyTxt = x.body && x.body !== "coupe" ? BODY[x.body] || x.body : "";
      x.variant = x.version
        ? (x.make === "Porsche" && bodyTxt && !new RegExp(bodyTxt.split(" ")[0], "i").test(x.version) ? `${x.version} ${bodyTxt}` : x.version)
        : bodyTxt ? `${bodyTxt} (versión por confirmar)` : "Versión por confirmar";
      x.search = `${x.name} ${x.gen} ${main.title || ""} ${x.city}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      return x;
    });
  }

  // ── formato ────────────────────────────────────────────────────────────
  function money(p, { usd = S.usd } = {}) {
    if (!p || p.price == null) return p && p.negotiable ? "Precio a tratar" : "Sin precio";
    let v = Number(p.price), cur = p.currency;
    if (usd && S.fx && cur === "MXN") { v = v / Number(S.fx.usd_mxn); cur = "USD"; }
    else if (!usd && S.fx && cur === "USD") { v = v * Number(S.fx.usd_mxn); cur = "MXN"; }
    return `$${nf.format(Math.round(v))} ${cur}`;
  }
  const km = v => (v == null ? "— km" : `${nf.format(v)} km`);
  const thumb = u => { if (!u) return ""; try { const x = new URL(u); if (/cdn\.shopify\.com|\.myshopify\.com/.test(x.host) || /\/cdn\/shop\//.test(x.pathname)) { x.searchParams.set("width", "640"); return x.toString(); } } catch (e) {} return u; };
  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
  // "Mini clásico", no "Mini Mini clásico": si el modelo ya empieza con la marca, no se repite.
  const modelLabel = (make, model) => (model && make && model.toLowerCase().startsWith(make.toLowerCase()) ? model : [make, model].filter(Boolean).join(" "));
  // Fuentes que aún no están activas no salen en la vista pública: nombre legible desde su id.
  const sourceName = id => String(id || "").replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const fmtDate = d => { if (!d) return "—"; const [y, m, dd] = String(d).split("-"); return `${dd}/${m}/${y}`; };

  // ── vista ──────────────────────────────────────────────────────────────
  PC.render = async function (root) {
    if (!root) return;
    injectCss();
    if (!S.loaded) {
      root.innerHTML = `<div class="pc"><header class="pc-head"><div><h2 class="tab-title">Precio de Calle</h2>
        <p class="pc-lead">Lo que de verdad piden por autos de entusiasta en México.</p></div></header>
        <div class="grid">${'<div class="skel" style="aspect-ratio:4/3"></div>'.repeat(6)}</div></div>`;
      try { S.loading = S.loading || load(); await S.loading; S.error = null; }
      catch (e) { S.error = e; S.loading = null; }
    }
    draw(root);
    if (location.hash === "#capturar") PC.openCaptura();
  };

  function filtered() {
    const f = S.f, q = f.q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    let a = S.vehicles.filter(x => x.active
      && (!f.make || x.make === f.make) && (!f.model || x.model === f.model) && (!f.variant || x.variant === f.variant)
      && (!f.tx || x.tx === f.tx) && (!f.seg || x.seg === f.seg) && (!q || q.split(/\s+/).every(w => x.search.includes(w))));
    const pv = x => (x.price && x.price.price != null ? Number(x.price.price) * (x.price.currency === "USD" && S.fx ? Number(S.fx.usd_mxn) : 1) : null);
    const by = {
      recientes: (a, b) => String(b.firstSeen).localeCompare(String(a.firstSeen)),
      precio_asc: (a, b) => (pv(a) ?? 1e15) - (pv(b) ?? 1e15),
      precio_desc: (a, b) => (pv(b) ?? -1) - (pv(a) ?? -1),
      anio_asc: (a, b) => (a.year ?? 9999) - (b.year ?? 9999),
      anio_desc: (a, b) => (b.year ?? 0) - (a.year ?? 0),
      km_asc: (a, b) => (a.km ?? 1e9) - (b.km ?? 1e9),
    };
    return a.sort(by[f.sort] || by.recientes);
  }

  function draw(root) {
    if (S.error) {
      root.innerHTML = `<div class="pc"><header class="pc-head"><div><h2 class="tab-title">Precio de Calle</h2></div></header>
        <div class="empty"><h2>No se pudo cargar el mercado</h2><p>${h(S.error.message || S.error)}</p>
        <button class="btn" onclick="PrecioCalle.reload()">Reintentar</button></div></div>`;
      return;
    }
    const act = S.vehicles.filter(x => x.active);
    const makes = [...new Set(act.map(x => x.make))].sort();
    const models = [...new Set(act.filter(x => !S.f.make || x.make === S.f.make).map(x => x.model))].sort();
    const variants = S.f.model ? [...new Set(act.filter(x => x.model === S.f.model && (!S.f.make || x.make === S.f.make)).map(x => x.variant))].sort((a, b) => (/por confirmar/.test(a) - /por confirmar/.test(b)) || a.localeCompare(b, "es")) : [];
    const txs = [...new Set(act.map(x => x.tx).filter(Boolean))];
    const segs = [...new Set(act.map(x => x.seg).filter(Boolean))];
    const srcN = new Set(act.flatMap(x => x.sourceIds)).size;
    const last = act.map(x => x.lastSeen).sort().pop();
    const list = filtered(), shown = list.slice(0, S.limit);
    const opt = (v, cur, label) => `<option value="${h(v)}"${v === cur ? " selected" : ""}>${h(label)}</option>`;

    root.innerHTML = `<div class="pc">
      <header class="pc-head">
        <div><h2 class="tab-title">Precio de Calle</h2>
          <p class="pc-lead">Lo que de verdad piden por autos de entusiasta en México. Contamos autos, no anuncios: si el mismo coche está en tres agencias, cuenta una vez.</p></div>
        <div class="pc-cur" role="group" aria-label="Moneda">
          <button class="${S.usd ? "" : "on"}" aria-pressed="${!S.usd}" onclick="PrecioCalle.setUsd(false)">MXN</button>
          <button class="${S.usd ? "on" : ""}" aria-pressed="${S.usd}" ${S.fx ? "" : "disabled"} title="${S.fx ? `FIX Banxico ${h(S.fx.day)}: ${h(S.fx.usd_mxn)}` : "Falta el tipo de cambio FIX de Banxico"}" onclick="PrecioCalle.setUsd(true)">USD</button>
        </div>
      </header>
      <dl class="pc-stats">
        <div><dt>Autos en venta</dt><dd>${nf.format(act.length)}</dd></div>
        <div><dt>Anuncios</dt><dd>${nf.format(S.listings)}</dd></div>
        <div><dt>Fuentes</dt><dd>${nf.format(srcN)}</dd></div>
        <div><dt>Actualizado</dt><dd>${h(fmtDate(last))}</dd></div>
      </dl>
      ${adminPanel()}
      ${act.length ? `
      <div class="toolbar pc-filters">
        <input class="ctrl grow" placeholder="Buscar: 993, GT3, Testarossa…" value="${h(S.f.q)}" oninput="PrecioCalle.set('q', this.value)">
        <select class="ctrl" aria-label="Marca" onchange="PrecioCalle.set('make', this.value)">${opt("", S.f.make, "Todas las marcas")}${makes.map(m => opt(m, S.f.make, m)).join("")}</select>
        <select class="ctrl" aria-label="Modelo" onchange="PrecioCalle.set('model', this.value)">${opt("", S.f.model, "Todos los modelos")}${models.map(m => opt(m, S.f.model, m)).join("")}</select>
        ${variants.length > 1 ? `<select class="ctrl" aria-label="Versión" onchange="PrecioCalle.set('variant', this.value)">${opt("", S.f.variant, "Todas las versiones")}${variants.map(v => opt(v, S.f.variant, v)).join("")}</select>` : ""}
        <select class="ctrl" aria-label="Transmisión" onchange="PrecioCalle.set('tx', this.value)">${opt("", S.f.tx, "Cualquier caja")}${txs.map(t => opt(t, S.f.tx, TX[t] || t)).join("")}</select>
        <select class="ctrl" aria-label="Segmento" onchange="PrecioCalle.set('seg', this.value)">${opt("", S.f.seg, "Todos los segmentos")}${segs.map(t => opt(t, S.f.seg, SEG[t] || t)).join("")}</select>
        <select class="ctrl" aria-label="Orden" onchange="PrecioCalle.set('sort', this.value)">
          ${opt("recientes", S.f.sort, "Más recientes")}${opt("precio_asc", S.f.sort, "Precio: menor a mayor")}${opt("precio_desc", S.f.sort, "Precio: mayor a menor")}
          ${opt("anio_asc", S.f.sort, "Año: más antiguos")}${opt("anio_desc", S.f.sort, "Año: más nuevos")}${opt("km_asc", S.f.sort, "Menos km")}</select>
      </div>
      <p class="pc-count">${list.length === 1 ? "1 auto" : `${nf.format(list.length)} autos`}${list.length !== act.length ? ` de ${nf.format(act.length)}` : ""}</p>
      <div class="grid pc-grid">${shown.map(card).join("") || `<p class="pc-none">Nada con esos filtros.</p>`}</div>
      ${list.length > shown.length ? `<div class="mk-more"><button class="btn" onclick="PrecioCalle.more()">Cargar más</button></div>` : ""}
      ${analysis(act)}
      ${byModel(act)}` : `
      <div class="empty"><h2>Todavía no hay autos</h2><p>En cuanto corra la primera captura de las fuentes, aquí aparece el mercado.</p></div>`}
      <p class="pc-foot">Precios <b>pedidos</b> en anuncios públicos, no precios de venta. Cada auto muestra de qué anuncios sale su información.</p>
    </div>`;
    wireTips(root.querySelector("#pcAnalisis"));
    if (canEdit()) PC.loadCapturas();
  }

  function card(x) {
    const p = x.price, low = x.confidence < 0.7;
    return `<article class="car pc-card" onclick="PrecioCalle.open('${x.id}')" tabindex="0" onkeydown="if(event.key==='Enter')PrecioCalle.open('${x.id}')">
      <div class="ph">${x.photo ? `<img src="${h(thumb(x.photo))}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<div class="noimg"></div>`}
        ${x.demo ? `<span class="pc-badge pc-demo">DEMO</span>` : ""}
        ${x.sourceIds.length > 1 ? `<span class="pc-badge">En ${x.sourceIds.length} fuentes</span>` : ""}</div>
      <div class="body">
        <div class="nm">${h(x.name || x.listings[0].title)}</div>
        <div class="meta"><b>${h(x.year ?? "—")}</b><span>${h(km(x.km))}</span>${x.tx ? `<span>${h(TX[x.tx] || x.tx)}</span>` : ""}${x.city ? `<span>${h(x.city)}</span>` : ""}</div>
        <div class="pc-price">${h(money(p))}${p && p.negotiable && p.price != null ? ` <small>· negociable</small>` : ""}</div>
        ${low ? `<div class="pc-note">Datos por confirmar</div>` : ""}
      </div></article>`;
  }

  // ── análisis del mercado: cuándo se publicaron, cuánto llevan, qué precios se movieron ──
  function analysis(act) {
    const dated = act.filter(x => x.daysKnown);
    // publicaciones por mes (fecha que declara la fuente), últimos 18 meses + "antes"
    const now = new Date(today()), months = [];
    for (let i = 17; i >= 0; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`); }
    const cnt = Object.fromEntries(months.map(m => [m, 0])); let before = 0;
    for (const x of dated) { const m = String(x.publishedOn).slice(0, 7); if (m in cnt) cnt[m]++; else if (m < months[0]) before++; }
    const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
    const bars = [...(before ? [["antes", before, `Antes de ${MES[Number(months[0].slice(5)) - 1]} ${months[0].slice(0, 4)}`]] : []),
      ...months.map(m => [m, cnt[m], `${MES[Number(m.slice(5)) - 1]} ${m.slice(0, 4)}`])];
    let chart = `<p class="pc-foot">Ninguna fuente activa dice cuándo publicó sus autos todavía.</p>`;
    if (dated.length) {
      const W = 640, H = 200, L = 28, R = 8, T = 14, B = 30, max = Math.max(...bars.map(b => b[1]), 1), bw = (W - L - R) / bars.length;
      const yt = ticks(0, max, Math.min(4, max)).filter(v => Number.isInteger(v)), Y = v => T + (1 - v / yt[yt.length - 1]) * (H - T - B);
      chart = `<svg class="pc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Autos publicados por mes">
        ${yt.map(v => `<line class="pc-grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="pc-ax" x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`).join("")}
        ${bars.map(([k, v, lab], i) => { const x0 = L + i * bw, y = Y(v), hgt = Y(0) - y;
          return `${v ? `<path class="pc-bar" d="M${(x0 + 1).toFixed(1)},${Y(0).toFixed(1)}V${(y + Math.min(4, hgt)).toFixed(1)}q0,-${Math.min(4, hgt).toFixed(1)} ${Math.min(4, hgt).toFixed(1)},-${Math.min(4, hgt).toFixed(1)}H${(x0 + bw - 1 - Math.min(4, hgt)).toFixed(1)}q${Math.min(4, hgt).toFixed(1)},0 ${Math.min(4, hgt).toFixed(1)},${Math.min(4, hgt).toFixed(1)}V${Y(0).toFixed(1)}Z"/>` : ""}
            <rect class="pc-hit" x="${x0.toFixed(1)}" y="${T}" width="${bw.toFixed(1)}" height="${H - T - B}" data-tip="${tip(`${lab}\n${v === 1 ? "1 auto" : `${v} autos`}`)}"/>
            ${i % 3 === (bars.length - 1) % 3 ? `<text class="pc-ax" x="${(x0 + bw / 2).toFixed(1)}" y="${H - 10}" text-anchor="middle">${k === "antes" ? "antes" : `${MES[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`}</text>` : ""}`; }).join("")}
        <line class="pc-base" x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/></svg>`;
    }
    // más tiempo en venta
    const longest = act.slice().sort((a, b) => (b.days ?? 0) - (a.days ?? 0) || (b.daysKnown - a.daysKnown)).slice(0, 8);
    // cambios de precio
    const changes = act.flatMap(x => x.changes.map(c => ({ ...c, x }))).sort((a, b) => String(b.day).localeCompare(String(a.day))).slice(0, 12);
    return `<section class="pc-section" id="pcAnalisis"><div class="home-sechead"><h2>Tiempo en el mercado</h2></div>
      <div class="pc-split">
        <div><h4 class="pc-h4">Cuándo se publicaron</h4>${chart}
          <p class="pc-foot">${dated.length} de ${act.length} autos traen la fecha de publicación de su fuente. Los demás se cuentan desde que los vimos por primera vez.</p></div>
        <div><h4 class="pc-h4">Más tiempo a la venta</h4>
          <table class="pc-table"><tbody>${longest.map(x => `<tr onclick="PrecioCalle.open('${x.id}')" class="pc-rowlink"><th scope="row">${h(x.name)}${x.year ? ` · ${x.year}` : ""}</th>
            <td class="num">${h(dayTxt(x.days))}${x.daysKnown ? "" : ` <span class="pc-insuf" title="La fuente no da la fecha: desde que lo vimos">*</span>`}</td></tr>`).join("")}</tbody></table>
          ${longest.some(x => !x.daysKnown) ? `<p class="pc-foot">* Desde que lo vimos; la fuente no dice cuándo lo publicó.</p>` : ""}</div>
      </div>
      <div class="pc-sub"><h4 class="pc-h4">Cambios de precio</h4>
        ${changes.length ? `<table class="pc-table"><thead><tr><th>Auto</th><th>Fecha</th><th class="num">Antes</th><th class="num">Ahora</th><th class="num">Cambio</th></tr></thead><tbody>
          ${changes.map(c => { const p = pct(c.from, c.to); return `<tr class="pc-rowlink" onclick="PrecioCalle.open('${c.x.id}')"><th scope="row">${h(c.x.name)}${c.x.year ? ` · ${c.x.year}` : ""}</th><td>${c.announced ? `<span title="La fuente muestra el precio anterior tachado; no dice cuándo bajó">Rebaja anunciada*</span>` : h(fmtDate(c.day))}</td>
            <td class="num">${h(money({ price: c.from, currency: c.currency }))}</td><td class="num">${h(money({ price: c.to, currency: c.currency }))}</td><td class="num">${p < 0 ? "↓" : "↑"} ${Math.abs(p)}%</td></tr>`; }).join("")}</tbody></table>`
        : `<p class="pc-foot">Todavía ningún auto ha cambiado de precio desde que los vemos. La captura diaria compara cada día el precio de cada anuncio y aquí aparece cuando alguno sube o baja.</p>`}
        ${changes.some(c => c.announced) ? `<p class="pc-foot">* La fuente muestra el precio anterior tachado junto al actual. No dice cuándo bajó, así que no lleva fecha.</p>` : ""}
      </div>
      <div class="pc-tip" role="tooltip" hidden></div></section>`;
  }

  // Mediana pedida por modelo: solo con n suficiente; si no, "datos insuficientes".
  function byModel(act) {
    const minN = Number(S.settings.min_n_for_stats ?? 5);
    // Un GT3 no pide lo mismo que un Carrera o un Targa: cada versión es su propio mercado.
    const groups = new Map(), byModelN = new Map();
    for (const x of act) {
      const m = modelLabel(x.make, x.model), k = `${m} · ${x.variant}`;
      if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); byModelN.set(m, (byModelN.get(m) || 0) + 1);
    }
    const modelOf = k => k.split(" · ")[0];
    const rows = [...groups.entries()].sort((a, b) => (byModelN.get(modelOf(b[0])) - byModelN.get(modelOf(a[0]))) || modelOf(a[0]).localeCompare(modelOf(b[0]), "es")
        || (/por confirmar/.test(a[0]) - /por confirmar/.test(b[0])) || b[1].length - a[1].length).map(([k, xs]) => {
      const yrs = xs.map(x => x.year).filter(Boolean), yTxt = yrs.length ? (Math.min(...yrs) === Math.max(...yrs) ? String(yrs[0]) : `${Math.min(...yrs)}–${Math.max(...yrs)}`) : "—";
      const mx = xs.map(x => x.price).filter(p => p && p.price != null && (p.currency === "MXN" || S.fx))
        .map(p => Number(p.price) * (p.currency === "USD" ? Number(S.fx.usd_mxn) : 1));
      const med = mx.length >= minN ? money({ price: median(mx), currency: "MXN" }) : null;
      const dk = xs.filter(x => x.daysKnown).map(x => x.days);
      const dmed = dk.length >= minN ? `${nf.format(Math.round(median(dk)))} días` : null;
      const falta = Math.max(0, minN - mx.length);
      return `<tr><th scope="row">${h(k)}</th><td class="num">${h(yTxt)}</td><td class="num">${xs.length}</td><td class="num">${med ? h(med) : `<span class="pc-insuf">Faltan ${falta} con precio</span>`}</td>
        <td class="num">${dmed ? h(dmed) : `<span class="pc-insuf">${dk.length} con fecha</span>`}</td></tr>`;
    }).join("");
    const covered = [...groups.values()].filter(xs => xs.filter(x => x.price && x.price.price != null).length >= minN).length;
    return `<section class="pc-section"><div class="home-sechead"><h2>Por modelo y versión</h2></div>
      <p class="pc-foot" style="margin:0 0 12px">${covered} de ${groups.size} versiones tienen ya ${minN} o más autos con precio para comparar.</p>
      <div class="pc-tablewrap"><table class="pc-table"><thead><tr><th>Modelo · versión</th><th class="num">Años</th><th class="num">Autos (n)</th><th class="num">Mediana pedida</th><th class="num">Tiempo publicado (mediana)</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="pc-foot">La mediana aparece cuando hay al menos ${minN} autos con precio de la misma versión; el tiempo publicado, cuando ${minN} de ellos traen la fecha de publicación de su fuente. El año pesa mucho: abre un auto para verlo contra los demás por año.</p></section>`;
  }

  // ── ficha de un auto ───────────────────────────────────────────────────
  PC.open = function (id, opts = {}) {
    const x = S.vehicles.find(v => v.id === id);
    if (!x) return;
    let scrim = document.getElementById("pcScrim");
    if (!scrim) {
      scrim = document.createElement("div"); scrim.className = "scrim"; scrim.id = "pcScrim";
      scrim.innerHTML = `<div class="modal wide" id="pcModal" role="dialog" aria-modal="true" aria-labelledby="pcTitle"></div>`;
      scrim.addEventListener("click", e => { if (e.target === scrim) scrim.classList.remove("show"); });
      document.body.appendChild(scrim);
    }
    const s = x.specs || {};
    const photos = [...new Set(x.listings.flatMap(l => (l.photos || []).slice().sort((a, b) => (a.position ?? 99) - (b.position ?? 99)).map(p => p.url)))].slice(0, 12);
    const color = (n, fam, raw) => n || raw || (fam ? fam[0].toUpperCase() + fam.slice(1) : null);
    const mark = f => (f && x.manualFields.has(f) ? ` <span class="pc-man" title="Capturado a mano, no sale del anuncio">a mano</span>` : "");
    const row = (k, v, f) => `<tr><th scope="row">${h(k)}</th><td>${v == null || v === "" ? `<span class="pc-unk">Sin dato</span>` : h(v)}${mark(f)}</td></tr>`;
    const path = [x.make, x.model, x.gen, x.version].filter(Boolean).map(h).join(" › ");
    const missing = [x.year, x.km, x.tx, s.exterior_color || s.exterior_color_family, s.invoice_type, s.origin, s.owners, s.service_history].filter(v => v == null || v === "").length;
    document.getElementById("pcModal").innerHTML = `
      <div class="mh"><h3 id="pcTitle">${h(x.name || x.listings[0].title)}${x.year ? ` · ${h(x.year)}` : ""}</h3>
        <button class="iconbtn" onclick="document.getElementById('pcScrim').classList.remove('show')" aria-label="Cerrar">×</button></div>
      <div class="mb">
        ${photos.length ? `<div class="pc-photos">${photos.map((u, i) => `<img src="${h(thumb(u))}" alt="" ${i < 3 ? "" : 'loading="lazy"'} referrerpolicy="no-referrer" onerror="this.remove()">`).join("")}</div>` : ""}
        <p class="pc-path">${path || "Versión por confirmar"}${x.version ? "" : ` <span class="pc-note">versión por confirmar</span>`}</p>
        <div class="pc-ficha">
          <div>
            <div class="pc-price big">${h(money(x.price))}</div>
            <p class="pc-foot">Último precio pedido · visto el ${h(fmtDate(x.lastSeen))}</p>
            ${timeTiles(x)}
            ${opts.edit && canEdit() ? specForm(x) : `
            <table class="pc-table pc-specs"><tbody>
              ${row("Año", x.year, "year")}${row("Kilometraje", x.km == null ? null : km(x.km), "km")}${row("Transmisión", x.tx ? TX[x.tx] || x.tx : null, "transmission")}
              ${row("Carrocería", s.body ? BODY[s.body] || s.body : null, "body")}
              ${row("Color exterior", color(s.exterior_color, s.exterior_color_family, s.exterior_color_raw), x.manualFields.has("exterior_color") ? "exterior_color" : "exterior_color_family")}
              ${row("Interior", color(s.interior_color, s.interior_color_family, s.interior_color_raw), x.manualFields.has("interior_color") ? "interior_color" : "interior_color_family")}
              ${row("Factura", s.invoice_type ? INVOICE[s.invoice_type] : null, "invoice_type")}${row("Origen", s.origin ? ORIGIN[s.origin] : null, "origin")}
              ${row("Dueños", s.owners, "owners")}${row("Servicios", s.service_history ? SERVICE[s.service_history] : null, "service_history")}
              ${row("Placas de auto antiguo", s.antique_plates == null ? null : s.antique_plates ? "Sí" : "No", "antique_plates")}${row("VIN", x.v.vin ? "Registrado" : null)}
            </tbody></table>
            ${x.notes ? `<p class="pc-notes">${h(x.notes)}</p>` : ""}
            ${x.manualAt ? `<p class="pc-foot">Lo marcado <span class="pc-man">a mano</span> se capturó el ${h(fmtDate(String(x.manualAt).slice(0, 10)))}; lo demás sale de los anuncios.</p>` : ""}
            ${canEdit() ? `<button class="btn sm pc-editbtn" onclick="PrecioCalle.open('${x.id}',{edit:true})">${missing ? `Completar datos (${missing} sin dato)` : "Corregir datos"}</button>` : ""}
            ${S.owner ? `<button class="btn ghost sm pc-delbtn" onclick="PrecioCalle.deleteCar('${x.id}')">Borrar este auto</button>` : ""}`}
          </div>
          <div>
            <h4 class="pc-h4">De dónde sale esta información</h4>
            ${x.listings.map(l => {
              const src = S.sources[l.source_id], pr = (l.prices || []).slice().sort((a, b) => String(a.observed_from).localeCompare(String(b.observed_from)));
              return `<div class="pc-listing">
                <div class="pc-l1"><b>${h(src ? src.name : sourceName(l.source_id))}</b><span class="pc-st pc-st-${h(l.status)}">${h(STATUS[l.status] || l.status)}</span></div>
                <div class="pc-l2">${h(l.city || l.state || "")}${l.city || l.state ? " · " : ""}visto del ${h(fmtDate(l.first_seen))} al ${h(fmtDate(l.last_seen))}</div>
                ${pr.length ? `<ul class="pc-hist">${pr.map(p => `<li><span>${h(fmtDate(p.observed_from))}${p.observed_to !== p.observed_from ? ` – ${h(fmtDate(p.observed_to))}` : ""}</span><b>${p.list_price != null ? `<s class="pc-was" title="Precio anterior que muestra la fuente, tachado">${h(money({ price: p.list_price, currency: p.currency }))}</s> ` : ""}${h(money(p))}</b></li>`).join("")}</ul>` : ""}
                ${l.url ? `<a class="link" href="${h(l.url)}" target="_blank" rel="noopener noreferrer nofollow">Ver anuncio original ↗</a>` : ""}
              </div>`;
            }).join("")}
          </div>
        </div>
        ${historyChart(x)}
        ${compareChart(x)}
        <p class="pc-foot">Precio pedido en anuncios públicos, no precio de venta.${x.confidence < 0.7 ? " Algunos datos de este auto están por confirmar." : ""}</p>
      </div>
      <div class="pc-tip" role="tooltip" hidden></div>`;
    wireTips(document.getElementById("pcModal"));
    scrim.classList.add("show");
  };

  // ── tiempo publicado y cambios de precio ───────────────────────────────
  const dayTxt = d => (d == null ? "—" : d === 0 ? "Menos de 1 día" : d === 1 ? "1 día" : `${nf.format(d)} días`);
  const pct = (a, b) => Math.round(((b - a) / a) * 1000) / 10;
  function timeTiles(x) {
    const src = x.publishedBy ? (S.sources[x.publishedBy] ? S.sources[x.publishedBy].name : sourceName(x.publishedBy)) : "";
    const pub = x.daysKnown
      ? `<div><dt>Tiempo publicado</dt><dd>${h(dayTxt(x.days))}</dd><p>Desde el ${h(fmtDate(x.publishedOn))}, según ${h(src)}</p></div>`
      : `<div><dt>Lo vemos desde hace</dt><dd>${h(dayTxt(x.days))}</dd><p>La fuente no dice cuándo lo publicó; contamos desde el ${h(fmtDate(x.firstSeen))}</p></div>`;
    let pr;
    if (x.changes.length) {
      const oldest = x.changes[x.changes.length - 1], newest = x.changes[0], p = pct(oldest.from, newest.to);
      const what = p < 0 ? `Bajó ${Math.abs(p)}%` : p > 0 ? `Subió ${p}%` : "Volvió al mismo precio";
      const onlyAnnounced = x.changes.every(c => c.announced);
      const src = S.sources[newest.source_id] ? S.sources[newest.source_id].name : sourceName(newest.source_id);
      pr = onlyAnnounced
        ? `<div><dt>Precio</dt><dd>${h(what)}</dd><p>${h(src)} lo anuncia rebajado: antes ${h(money({ price: oldest.from, currency: oldest.currency }))}, ahora ${h(money({ price: newest.to, currency: newest.currency }))}. No dice cuándo bajó; lo vemos así desde el ${h(fmtDate(newest.day))}</p></div>`
        : `<div><dt>Precio</dt><dd>${h(what)}</dd><p>${x.changes.length === 1 ? "1 cambio" : `${x.changes.length} cambios`}: de ${h(money({ price: oldest.from, currency: oldest.currency }))} a ${h(money({ price: newest.to, currency: newest.currency }))} (último el ${h(fmtDate(newest.day))})${x.changes.some(c => c.announced) ? "; incluye la rebaja que anuncia la fuente con el precio tachado" : ""}</p></div>`;
    } else if (!x.price || x.price.price == null) {
      pr = `<div><dt>Precio</dt><dd>Sin cifra</dd><p>El anuncio no publica precio${x.price && x.price.negotiable ? " (a tratar)" : ""}</p></div>`;
    } else {
      pr = `<div><dt>Precio</dt><dd>Sin cambios</dd><p>Mismo precio desde el ${h(fmtDate(x.firstSeen))}, el primer día que lo vimos</p></div>`;
    }
    return `<dl class="pc-tiles">${pub}${pr}</dl>`;
  }

  // ── captura manual (solo admin; la base lo vuelve a revisar con RLS) ───
  const canEdit = () => { try { return typeof isAdmin === "function" && isAdmin() && typeof session !== "undefined" && !!session; } catch (e) { return false; } };
  function specForm(x) {
    const s = x.specs || {};
    const sel = (k, map, val) => `<select class="ctrl" name="${k}"><option value="">Sin dato</option>${Object.entries(map).map(([v, l]) => `<option value="${h(v)}"${String(val ?? "") === v ? " selected" : ""}>${h(l)}</option>`).join("")}</select>`;
    const fam = (k, list, val) => sel(k, Object.fromEntries(list.map(f => [f, f[0].toUpperCase() + f.slice(1)])), val);
    const f = (label, input) => `<label class="pc-field"><span>${h(label)}</span>${input}</label>`;
    const num = (k, val, attrs) => `<input class="ctrl" name="${k}" inputmode="numeric" value="${h(val ?? "")}" ${attrs || ""}>`;
    return `<form class="pc-form" onsubmit="event.preventDefault();PrecioCalle.saveSpecs('${x.id}', this)">
      <p class="pc-foot" style="margin-top:0">Lo que captures aquí manda sobre lo que dice el anuncio y queda marcado <span class="pc-man">a mano</span> con la fecha. Deja en "Sin dato" lo que no sepas.</p>
      <div class="pc-formgrid">
        ${f("Año", num("year", x.year, 'maxlength="4" placeholder="1989"'))}
        ${f("Kilometraje", num("km", x.km, 'placeholder="45000"'))}
        ${f("Transmisión", sel("transmission", TX, x.tx))}
        ${f("Carrocería", sel("body", BODY, s.body))}
        ${f("Color exterior (nombre)", `<input class="ctrl" name="exterior_color" value="${h(s.exterior_color ?? "")}" placeholder="Guards Red">`)}
        ${f("Familia de color exterior", fam("exterior_color_family", EXT_FAM, s.exterior_color_family))}
        ${f("Interior (nombre)", `<input class="ctrl" name="interior_color" value="${h(s.interior_color ?? "")}" placeholder="Piel negra">`)}
        ${f("Familia de color interior", fam("interior_color_family", INT_FAM, s.interior_color_family))}
        ${f("Factura", sel("invoice_type", INVOICE, s.invoice_type))}
        ${f("Origen", sel("origin", ORIGIN, s.origin))}
        ${f("Dueños", num("owners", s.owners, 'maxlength="2"'))}
        ${f("Servicios", sel("service_history", SERVICE, s.service_history))}
        ${f("Placas de auto antiguo", sel("antique_plates", { true: "Sí", false: "No" }, s.antique_plates == null ? "" : String(s.antique_plates)))}
      </div>
      ${f("Notas (de dónde sale el dato: llamada, visita, Instagram…)", `<textarea class="ctrl" name="notes" rows="2" maxlength="500">${h(x.notes ?? "")}</textarea>`)}
      <p class="pc-formmsg" role="status"></p>
      <div class="pc-formbtns"><button class="btn primary sm" type="submit">Guardar</button>
        <button class="btn ghost sm" type="button" onclick="PrecioCalle.open('${x.id}')">Cancelar</button></div>
    </form>`;
  }
  // Borrar = ocultar para todos, con deshacer (solo la cuenta dueña; la base lo vuelve a revisar)
  PC.deleteCar = async function (id) {
    const x = S.vehicles.find(v => v.id === id);
    if (!x || !S.owner) return;
    const reason = prompt(`¿Por qué borras ${x.name}${x.year ? ` ${x.year}` : ""}? (opcional, p. ej. "réplica", "precio equivocado", "no está en México")`, "");
    if (reason === null) return;
    if (!confirm("Se deja de ver para todos. Si su anuncio vuelve a salir, sigue oculto. Lo puedes restaurar en Agregar autos › Borrados. ¿Borrar?")) return;
    const { error } = await client().rpc("mx_delete_vehicle", { p_vehicle: id, p_reason: reason });
    if (error) { alert(`No se borró: ${error.message}`); return; }
    document.getElementById("pcScrim")?.classList.remove("show");
    S.loaded = false; S.loading = load(); await S.loading; draw(root());
    if (typeof toast === "function") toast("Auto borrado. Lo puedes restaurar en Agregar autos › Borrados");
  };
  PC.restoreCar = async function (id) {
    const { error } = await client().rpc("mx_restore_vehicle", { p_vehicle: id });
    if (error) { alert(`No se restauró: ${error.message}`); return; }
    S.loaded = false; S.loading = load(); await S.loading; draw(root());
    if (typeof toast === "function") toast("Auto restaurado");
  };

  PC.saveSpecs = async function (id, form) {
    const x = S.vehicles.find(v => v.id === id), msg = form.querySelector(".pc-formmsg"), btn = form.querySelector('[type="submit"]');
    const NUM = new Set(["year", "km", "owners"]), data = {};
    for (const [k, raw] of new FormData(form)) {
      const v = String(raw).trim();
      if (v === "") continue;
      const val = NUM.has(k) ? Number(v.replace(/[^\d]/g, "")) : k === "antique_plates" ? v === "true" : v;
      if (NUM.has(k) && !Number.isFinite(val)) { msg.textContent = "Revisa los números."; return; }
      // igual a lo que ya dice el anuncio y no estaba capturado a mano: no se guarda como captura
      const base = x.parsed[k];
      if (!x.manualFields.has(k) && base != null && String(base) === String(val)) continue;
      data[k] = val;
    }
    if (data.year != null && (data.year < 1900 || data.year > new Date().getFullYear() + 1)) { msg.textContent = "El año no parece correcto."; return; }
    btn.disabled = true; msg.textContent = "Guardando…";
    const { error } = await client().rpc("mx_save_manual_specs", { p_vehicle: id, p_data: data });
    if (error) { btn.disabled = false; msg.textContent = `No se guardó: ${error.message}`; return; }
    S.loaded = false; S.loading = load(); await S.loading;
    draw(root()); PC.open(id);
    if (typeof toast === "function") toast("Datos guardados");
  };

  // ── gráficas (SVG en línea, colores del tema) ──────────────────────────
  const toMxn = p => (p && p.price != null ? (p.currency === "USD" ? (S.fx ? Number(p.price) * Number(S.fx.usd_mxn) : null) : Number(p.price)) : null);
  const short = v => (v <= 0 ? "$0" : v >= 1e6 ? `$${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} M` : `$${nf.format(Math.round(v / 1e3))} k`);
  function ticks(lo, hi, n = 4) {
    const span = hi - lo || Math.abs(hi) || 1, step0 = span / n, mag = Math.pow(10, Math.floor(Math.log10(step0)));
    const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= step0) || 10 * mag;
    const out = []; for (let v = Math.floor(lo / step) * step; v <= hi + step * 0.001; v += step) out.push(v);
    return out;
  }
  const tip = s => h(s).replace(/\n/g, "&#10;");

  function historyChart(x) {
    const series = x.listings.map(l => ({ l, pts: (l.prices || []).filter(p => toMxn(p) != null).sort((a, b) => String(a.observed_from).localeCompare(String(b.observed_from))) })).filter(s => s.pts.length);
    const all = series.flatMap(s => s.pts);
    const head = `<section class="pc-sub"><h4 class="pc-h4">Historial de precio</h4>`;
    if (!all.length) return `${head}<p class="pc-foot">Este auto no tiene precio publicado.</p></section>`;
    const d0 = all.map(p => p.observed_from).sort()[0], d1 = all.map(p => p.observed_to).sort().pop();
    const spanDays = daysBetween(d0, d1);
    if (spanDays < 7 && !x.changes.length)
      return `${head}<p class="pc-foot">Lo vemos desde el ${h(fmtDate(d0))}. La gráfica aparece con una semana de historial: la captura diaria registra cada día si el precio sigue igual, sube o baja.</p></section>`;
    const W = 640, H = 220, L = 64, R = 96, T = 12, B = 28, t0 = Date.parse(d0), t1 = Date.parse(d1) + 864e5;
    const vals = all.map(toMxn), lo = Math.min(...vals), hi = Math.max(...vals), pad = (hi - lo) * 0.15 || hi * 0.05;
    const yt = ticks(lo - pad, hi + pad), y0 = yt[0], y1 = yt[yt.length - 1];
    const X = t => L + ((t - t0) / (t1 - t0)) * (W - L - R), Y = v => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
    const xt = [t0, (t0 + t1) / 2, t1 - 864e5];
    const lines = series.map((s, i) => {
      let d = "";
      s.pts.forEach((p, j) => { const a = X(Date.parse(p.observed_from)), b = X(Date.parse(p.observed_to) + 864e5), y = Y(toMxn(p)); d += `${j ? "L" : "M"}${a.toFixed(1)},${y.toFixed(1)}H${b.toFixed(1)}`; });
      const last = s.pts[s.pts.length - 1], name = S.sources[s.l.source_id] ? S.sources[s.l.source_id].name : sourceName(s.l.source_id);
      const dots = s.pts.map(p => { const cx = X(Date.parse(p.observed_from)), cy = Y(toMxn(p));
        return `<circle class="pc-dot ${i ? "alt" : ""}" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4"/><circle class="pc-hit" cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="12" data-tip="${tip(`${name}\n${fmtDate(p.observed_from)} – ${fmtDate(p.observed_to)}\n${money(p)}`)}"/>`; }).join("");
      return `<path class="pc-line ${i ? "alt" : ""}" d="${d}"/>${dots}<text class="pc-lab" x="${(W - R + 6).toFixed(1)}" y="${(Y(toMxn(last)) + 4).toFixed(1)}">${h(name)}</text>`;
    }).join("");
    return `${head}<svg class="pc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Precio pedido por día de ${h(x.name)}">
      ${yt.map(v => `<line class="pc-grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="pc-ax" x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join("")}
      ${xt.map((t, i) => `<text class="pc-ax" x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="${["start", "middle", "end"][i]}">${fmtDate(new Date(t).toISOString().slice(0, 10))}</text>`).join("")}
      ${lines}</svg>
      <p class="pc-foot">Cada tramo es un precio que se mantuvo esos días. Pasa el cursor por los puntos para ver fechas y cifra.</p></section>`;
  }

  // El auto contra los demás del mismo modelo: año contra precio pedido, separados por versión.
  // Arriba, un botón por versión (GT3, GT3 RS, Carrera S, Targa 4S…): se prenden y apagan las que quieras ver.
  // Arranca con la versión de este auto si hay al menos otro igual; si no, con todas.
  function compareChart(x) {
    const label = modelLabel(x.make, x.model);
    return `<section class="pc-sub" id="pcCompare"><h4 class="pc-h4">Contra otros ${h(label)} a la venta</h4>${compareInner(x)}</section>`;
  }
  PC.cmpToggle = function (key) {
    const x = S.vehicles.find(v => v.id === S.cmp.id); if (!x) return;
    if (key === "*") S.cmp.sel = null;
    else { const sel = new Set(S.cmp.sel || []); sel.has(key) ? sel.delete(key) : sel.add(key); S.cmp.sel = sel.size ? sel : null; }
    const box = document.getElementById("pcCompare");
    if (box) box.innerHTML = `<h4 class="pc-h4">Contra otros ${h(modelLabel(x.make, x.model))} a la venta</h4>${compareInner(x)}`;
  };
  function compareInner(x) {
    const minN = Number(S.settings.min_n_for_stats ?? 5);
    const all = S.vehicles.filter(v => v.active && v.make === x.make && v.model === x.model && v.year && toMxn(v.price) != null);
    const label = modelLabel(x.make, x.model);
    if (!S.cmp || S.cmp.id !== x.id) {
      const same = all.filter(v => v.variant === x.variant).length;
      S.cmp = { id: x.id, sel: x.version && same >= 2 ? new Set([x.variant]) : null };
    }
    const counts = new Map(); for (const v of all) counts.set(v.variant, (counts.get(v.variant) || 0) + 1);
    const keys = [...counts.keys()].sort((a, b) => (/por confirmar/.test(a) - /por confirmar/.test(b)) || counts.get(b) - counts.get(a) || a.localeCompare(b, "es"));
    const sel = S.cmp.sel;
    const chips = keys.length > 1 ? `<div class="pc-chips" role="group" aria-label="Versiones a comparar">
      <button class="pc-chip ${sel ? "" : "on"}" aria-pressed="${!sel}" onclick="PrecioCalle.cmpToggle('*')">Todas <span class="pc-chipn">${all.length}</span></button>
      ${keys.map(k => `<button class="pc-chip ${sel && sel.has(k) ? "on" : ""}" aria-pressed="${!!(sel && sel.has(k))}" onclick="PrecioCalle.cmpToggle(${h(JSON.stringify(k))})"${k === x.variant ? ' title="La versión de este auto"' : ""}>${h(k)}${k === x.variant ? " (este)" : ""} <span class="pc-chipn">${counts.get(k)}</span></button>`).join("")}</div>` : "";
    const peers = all.filter(v => !sel || sel.has(v.variant) || v.id === x.id);
    const what = sel ? [...sel].join(", ") : "todas las versiones";
    const n = peers.length, falta = Math.max(0, minN - n);
    const others = peers.filter(v => v.id !== x.id);
    if (!others.length) return `${chips}<p class="pc-foot">${all.length > 1 ? `No hay otros ${h(label)} de ${h(what)} con año y precio. Prende más versiones arriba.` : `Es el único ${h(label)} con año y precio que tenemos. Con ${minN} o más se calcula la mediana.`}</p>`;
    const prices = peers.map(v => toMxn(v.price)), med = n >= minN ? median(prices) : null;
    const W = 640, H = 240, L = 64, R = 16, T = 14, B = 28;
    const years = peers.map(v => v.year); let ya = Math.min(...years), yb = Math.max(...years); if (ya === yb) { ya -= 2; yb += 2; } else { ya -= 1; yb += 1; }
    const lo = Math.min(...prices), hi = Math.max(...prices), pad = (hi - lo) * 0.15 || hi * 0.1, yt = ticks(lo - pad, hi + pad), p0 = yt[0], p1 = yt[yt.length - 1];
    const X = yr => L + ((yr - ya) / (yb - ya)) * (W - L - R), Y = v => T + (1 - (v - p0) / (p1 - p0 || 1)) * (H - T - B);
    const xt = ticks(ya, yb, Math.min(6, yb - ya)).filter(t => t >= ya && t <= yb && Number.isInteger(t));
    const dot = v => { const me = v.id === x.id, cx = X(v.year).toFixed(1), cy = Y(toMxn(v.price)).toFixed(1);
      return `<circle class="pc-dot ${me ? "" : "peer"}" cx="${cx}" cy="${cy}" r="${me ? 6 : 5}"/><circle class="pc-hit" cx="${cx}" cy="${cy}" r="12" ${me ? "" : `onclick="PrecioCalle.open('${v.id}')"`} data-tip="${tip(`${me ? "Este auto" : v.name}\n${v.variant !== v.version ? `${v.variant}\n` : ""}${v.year} · ${km(v.km)}${v.city ? ` · ${v.city}` : ""}\n${money(v.price)}`)}"${v.photo ? ` data-tip-img="${h(thumb(v.photo))}"` : ""}/>`; };
    const mine = toMxn(x.price), vsMed = med && mine != null ? pct(med, mine) : null;
    return `${chips}
      <svg class="pc-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Año contra precio pedido de ${n} ${h(label)} (${h(what)})">
        ${yt.map(v => `<line class="pc-grid" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="pc-ax" x="${L - 8}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join("")}
        ${xt.map(t => `<text class="pc-ax" x="${X(t).toFixed(1)}" y="${H - 8}" text-anchor="middle">${t}</text>`).join("")}
        ${med ? `<line class="pc-med" x1="${L}" x2="${W - R}" y1="${Y(med).toFixed(1)}" y2="${Y(med).toFixed(1)}"/><text class="pc-ax" x="${W - R}" y="${(Y(med) - 6).toFixed(1)}" text-anchor="end">mediana ${short(med)}</text>` : ""}
        ${others.map(dot).join("")}${peers.some(v => v.id === x.id) ? dot(x) : ""}
      </svg>
      <p class="pc-legend"><span class="pc-key"></span> Este auto <span class="pc-key peer"></span> Otros ${h(label)} · ${h(what)} (pasa el cursor para ver la foto; toca uno para abrirlo)</p>
      <p class="pc-foot">${n} ${h(label)} de ${h(what)} con año y precio.${mine == null ? " Este auto no publica precio, así que no aparece en la gráfica." : ""}${
        vsMed != null ? ` Este auto pide ${vsMed === 0 ? "lo mismo que la mediana" : `${Math.abs(vsMed)}% ${vsMed > 0 ? "más" : "menos"} que la mediana`}.`
        : med ? "" : ` Faltan ${falta} para calcular la mediana; mientras, compáralo punto por punto.`}</p>
      <details class="pc-details"><summary>Ver como tabla</summary><table class="pc-table"><thead><tr><th>Auto</th><th>Versión</th><th class="num">Año</th><th class="num">Km</th><th class="num">Precio</th></tr></thead><tbody>
        ${peers.slice().sort((a, b) => a.year - b.year).map(v => `<tr><th scope="row">${v.id === x.id ? "<b>Este auto</b>" : h(v.name)}</th><td>${h(v.variant)}</td><td class="num">${v.year}</td><td class="num">${h(km(v.km))}</td><td class="num">${h(money(v.price))}</td></tr>`).join("")}
      </tbody></table></details>`;
  }

  // Tooltip: un solo globo que sigue al cursor o al foco; el dato siempre está también en texto o tabla.
  function wireTips(box) {
    if (!box || box.dataset.tips) return;   // el modal se reutiliza: se conecta una vez y el globo se busca en cada movimiento
    box.dataset.tips = "1";
    box.addEventListener("pointermove", e => {
      const t = box.querySelector(".pc-tip"), el = e.target.closest && e.target.closest("[data-tip]");
      if (!t) return;
      if (!el) { t.hidden = true; return; }
      // con foto (comparativa): la imagen arriba y el texto abajo; el texto siempre como texto, nunca HTML
      const img = el.getAttribute("data-tip-img"), key = `${img || ""}|${el.getAttribute("data-tip")}`;
      if (t.dataset.key !== key) {
        t.dataset.key = key; t.textContent = "";
        if (img) { const i = document.createElement("img"); i.src = img; i.alt = ""; i.referrerPolicy = "no-referrer"; i.onerror = () => i.remove(); t.appendChild(i); }
        const s = document.createElement("span"); s.textContent = el.getAttribute("data-tip"); t.appendChild(s);
      }
      t.hidden = false;
      const r = box.getBoundingClientRect();
      t.style.left = `${Math.max(8, Math.min(e.clientX - r.left + 14, r.width - t.offsetWidth - 8))}px`;
      t.style.top = `${e.clientY - r.top + box.scrollTop + 14}px`;
    });
    box.addEventListener("pointerleave", () => { const t = box.querySelector(".pc-tip"); if (t) t.hidden = true; });
  }

  // ── botón "Guardar en Precio de Calle" (capturas desde tu navegador) ───
  // Los autos llegan de la pestaña donde le diste clic (window.pcCaptura, lo pone index.html),
  // se revisan aquí y se guardan como pendientes en mx_capturas. La corrida diaria los pasa
  // por el normalizador y el anti-duplicados; nada entra directo a los anuncios.
  const CAP_SOURCE = { facebook: "facebook-marketplace", mercadolibre: "mercadolibre-autos" };
  const CAP_FIELDS = ["external_id", "url", "title", "make", "model", "version", "year", "km", "km_unit", "transmission", "color_ext", "vin",
    "price", "list_price", "body", "currency", "city", "description", "photos", "published_on", "extra"];
  function capSource(d) {
    if (CAP_SOURCE[d.site]) return CAP_SOURCE[d.site];
    let host = ""; try { host = new URL(d.page_url).hostname.replace(/^www\./, ""); } catch (e) {}
    const hit = Object.values(S.sources).find(s => { try { return new URL(s.base_url).hostname.replace(/^www\./, "") === host; } catch (e) { return false; } });
    return hit ? hit.id : "contacto-directo";
  }
  function capClean(it) {
    const o = {};
    for (const k of CAP_FIELDS) if (it[k] != null && it[k] !== "") o[k] = it[k];
    for (const k of ["title", "make", "model", "version", "city", "transmission", "color_ext"]) if (o[k]) o[k] = String(o[k]).slice(0, 300);
    if (o.description) o.description = String(o.description).slice(0, 4000);
    if (Array.isArray(o.photos)) o.photos = o.photos.filter(u => /^https:\/\//.test(u)).slice(0, 30); else delete o.photos;
    if (o.price != null && !(Number(o.price) > 0)) { delete o.price; delete o.currency; }
    return o;
  }
  function capModal(html) {
    let scrim = document.getElementById("pcScrim");
    if (!scrim) {
      scrim = document.createElement("div"); scrim.className = "scrim"; scrim.id = "pcScrim";
      scrim.innerHTML = `<div class="modal wide" id="pcModal" role="dialog" aria-modal="true" aria-labelledby="pcTitle"></div>`;
      scrim.addEventListener("click", e => { if (e.target === scrim) scrim.classList.remove("show"); });
      document.body.appendChild(scrim);
    }
    document.getElementById("pcModal").innerHTML = `<div class="mh"><h3 id="pcTitle">Guardar en Precio de Calle</h3>
      <button class="iconbtn" onclick="document.getElementById('pcScrim').classList.remove('show')" aria-label="Cerrar">×</button></div><div class="mb">${html}</div>`;
    scrim.classList.add("show");
  }
  let capWait = null;
  PC.openCaptura = function () {
    const d = window.pcCaptura;
    if (!canEdit()) { capModal(`<p>Para guardar autos inicia sesión con tu cuenta de admin en esta ventana y vuelve a darle clic al botón.</p>`); return; }
    if (!d) {
      capModal(`<p>Esperando los autos de la otra pestaña…</p><div id="pcPaste" hidden>
        <p class="pc-foot">¿No llegan? El botón también los copió. Haz clic en el cuadro y pega (Ctrl + V).</p>
        <textarea class="ctrl" rows="3" style="width:100%" placeholder="Pega aquí" oninput="PrecioCalle.pasteCaptura(this.value)"></textarea></div>`);
      clearTimeout(capWait); capWait = setTimeout(() => { const p = document.getElementById("pcPaste"); if (p) p.hidden = false; }, 5000);
      return;
    }
    clearTimeout(capWait);
    const src = capSource(d), name = S.sources[src] ? S.sources[src].name : sourceName(src);
    const items = d.items.slice(0, 200);
    const ambiguous = items.some(x => x.currency_ambiguous);
    const row = (x, i) => {
      const usd = x.currency === "USD";
      return `<label class="pc-caprow${usd ? " off" : ""}">
        <input type="checkbox" data-i="${i}" ${usd ? "disabled" : "checked"}>
        ${x.photos && x.photos[0] ? `<img src="${h(x.photos[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : `<span class="pc-capimg"></span>`}
        <span class="pc-captxt"><b>${h(x.title || "Sin título")}</b>
          <span>${[x.year, x.km ? `${nf.format(Number(x.km))} ${x.km_unit === "mi" ? "millas" : "km"}` : null, x.city].filter(Boolean).map(h).join(" · ") || "Sin año ni km en la página"}</span></span>
        <span class="pc-capprice">${x.price ? h(money({ price: x.price, currency: x.currency || "MXN" })) : "Sin precio"}${usd ? `<small>En dólares: no se guarda</small>` : ""}</span>
      </label>`;
    };
    capModal(`<p class="pc-foot" style="margin-top:0">De <b>${h(name)}</b> · ${items.length === 1 ? "1 auto" : `${items.length} autos`} en la página que estabas viendo. Quita la palomita a los que no quieras.</p>
      ${ambiguous ? `<p class="pc-foot">Los precios que solo dicen "$" se guardan como pesos mexicanos.</p>` : ""}
      <div class="pc-caplist">${items.map(row).join("")}</div>
      <p class="pc-formmsg" id="pcCapMsg" role="status"></p>
      <div class="pc-formbtns"><button class="btn primary sm" id="pcCapSave" onclick="PrecioCalle.saveCaptura()">Guardar</button>
        <button class="btn ghost sm" onclick="document.getElementById('pcScrim').classList.remove('show')">Cancelar</button></div>
      <p class="pc-foot">No entran al instante: la actualización diaria (6:17 am) revisa duplicados contra todo lo que ya tenemos, deja fuera los modelos que no seguimos y los suma a Precio de Calle.</p>`);
  };
  PC.pasteCaptura = function (v) {
    try { const d = JSON.parse(v); if (d && d.type === "pc-captura" && Array.isArray(d.items)) { window.pcCaptura = d; PC.openCaptura(); } } catch (e) { /* aún no es el texto completo */ }
  };
  PC.saveCaptura = async function () {
    const d = window.pcCaptura, msg = document.getElementById("pcCapMsg"), btn = document.getElementById("pcCapSave");
    const pick = [...document.querySelectorAll(".pc-caplist input:checked")].map(i => d.items[Number(i.dataset.i)])
      .filter(x => x && x.currency !== "USD").map(capClean).filter(x => x.url && x.title);
    if (!pick.length) { msg.textContent = "No hay autos marcados."; return; }
    btn.disabled = true; msg.textContent = "Guardando…";
    const { error } = await client().from("mx_capturas").insert({ source_id: capSource(d), page_url: String(d.page_url || "").slice(0, 2000), items: pick });
    if (error) { btn.disabled = false; msg.textContent = `No se guardó: ${error.message}`; return; }
    window.pcCaptura = null;
    capModal(`<p><b>Listo: ${pick.length === 1 ? "1 auto guardado" : `${pick.length} autos guardados`}.</b></p>
      <p class="pc-foot" style="margin-top:0">Mañana a las 6:17 am se procesan y aparecen en Precio de Calle (los repetidos se juntan con el que ya teníamos). Puedes cerrar esta ventana y seguir navegando.</p>`);
    PC.loadCapturas();
  };

  // Panel de admin: instalar el botón y ver cómo quedaron las capturas.
  let marcadorHref = null;
  async function ensureMarcador() {
    if (marcadorHref) return marcadorHref;
    try { const r = await fetch("captura-marcador.js?v=2", { cache: "no-cache" }); if (r.ok) marcadorHref = "javascript:" + encodeURIComponent(await r.text()); } catch (e) {}
    return marcadorHref;
  }
  function adminPanel() {
    if (!canEdit()) return "";
    return `<section class="pc-section pc-admin"><div class="home-sechead"><h2>Agregar autos</h2></div>
      <div class="pc-split"><div>
        <p class="pc-foot" style="margin-top:0">Arrastra este botón a tu barra de favoritos (si no la ves: Ctrl + Shift + B). Luego, en una página de Facebook Marketplace o Mercado Libre con autos, dale clic.</p>
        <p><a class="btn primary sm pc-marcador" id="pcMarcador" href="#" onclick="event.preventDefault();alert('Arrástralo a tu barra de favoritos; no se usa aquí.')">Guardar en Precio de Calle</a></p>
        <p class="pc-foot">En una página de resultados guarda todos los autos que se ven; dentro de un anuncio, ese auto con fotos y descripción.</p>
        <p class="pc-foot"><b>¿Ya lo tenías en tu barra?</b> Bórralo de la barra y vuelve a arrastrar este: cada versión nueva del botón se instala así.</p>
      </div><div><h4 class="pc-h4">Últimas capturas</h4><div id="pcCapturas"><p class="pc-foot">Cargando…</p></div></div></div>
      <div class="pc-sub"><h4 class="pc-h4">Buscar más autos por ciudad</h4>
        <p class="pc-foot" style="margin-top:0">Elige un modelo: se abre la búsqueda en cada ciudad. Ahí da clic en el botón de tu barra para guardar lo que veas. Arriba van los modelos con menos autos para comparar.</p>
        <div class="toolbar"><select class="ctrl grow" id="pcBuscaModelo" aria-label="Modelo a buscar" onchange="PrecioCalle.renderBusqueda()"><option>Cargando modelos…</option></select></div>
        <div id="pcBuscaLigas"></div></div>
      ${S.owner ? `<div class="pc-sub"><h4 class="pc-h4">Borrados (${(S.deleted || []).length})</h4>
        ${(S.deleted || []).length ? `<table class="pc-table"><tbody>${S.deleted.slice().sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt))).map(x => `<tr>
          <th scope="row">${h(x.name || x.listings[0].title)}${x.year ? ` · ${x.year}` : ""}<br><span class="pc-foot">${h(fmtDate(String(x.deletedAt).slice(0, 10)))}${x.deleteReason ? ` · ${h(x.deleteReason)}` : ""}</span></th>
          <td class="num"><button class="btn sm" onclick="PrecioCalle.restoreCar('${x.id}')">Restaurar</button></td></tr>`).join("")}</tbody></table>`
        : `<p class="pc-foot">No has borrado ningún auto. Para borrar uno, ábrelo y usa "Borrar este auto" (solo tu cuenta lo ve).</p>`}</div>` : ""}
      </section>`;
  }
  // Búsquedas listas para abrir (las abre la persona; nosotros no entramos a Facebook ni a Mercado Libre).
  // Ciudades con el nombre que Facebook usa en sus direcciones (verificadas 2026-11-12).
  const FB_CITIES = [["mexicocity", "CDMX"], ["guadalajara", "Guadalajara"], ["monterrey", "Monterrey"], ["queretaro", "Querétaro"],
    ["puebla", "Puebla"], ["merida", "Mérida"], ["cancun", "Cancún"]];
  const slugify = s => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  // minPrice: fuera los anuncios gancho de "$1"
  const fbSearch = (q, city) => `https://www.facebook.com/marketplace/${city ? city + "/" : ""}search?query=${encodeURIComponent(q)}&minPrice=100000&exact=false`;
  const mlSearch = q => `https://autos.mercadolibre.com.mx/${slugify(q)}/`;
  let busqModels = null;
  PC.loadBusqueda = async function () {
    const sel = document.getElementById("pcBuscaModelo");
    if (!sel) return;
    if (!busqModels) {
      const { data, error } = await client().from("mx_models").select("name,make:mx_makes(name)");
      if (error) { sel.innerHTML = `<option>No se pudieron leer los modelos</option>`; return; }
      busqModels = (data || []).map(m => modelLabel(m.make && m.make.name, m.name));
    }
    const priced = new Map();
    for (const x of S.vehicles.filter(v => v.active && v.price && v.price.price != null)) {
      const k = modelLabel(x.make, x.model); priced.set(k, (priced.get(k) || 0) + 1);
    }
    const minN = Number(S.settings.min_n_for_stats ?? 5);
    const prev = sel.value;
    const rows = [...new Set(busqModels)].map(k => [k, priced.get(k) || 0]).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0], "es"));
    sel.innerHTML = `<option value="">Elige un modelo…</option>` + rows.map(([k, n]) =>
      `<option value="${h(k)}"${k === prev ? " selected" : ""}>${h(k)} · ${n >= minN ? `${n} con precio` : `faltan ${minN - n}`}</option>`).join("");
    PC.renderBusqueda();
  };
  PC.renderBusqueda = function () {
    const sel = document.getElementById("pcBuscaModelo"), box = document.getElementById("pcBuscaLigas");
    if (!sel || !box) return;
    const q = sel.value;
    if (!q) { box.innerHTML = ""; return; }
    const link = (href, label) => `<a class="btn sm" href="${h(href)}" target="_blank" rel="noopener">${h(label)}</a>`;
    box.innerHTML = `<p class="pc-foot">Facebook Marketplace (desde $100,000):</p>
      <div class="pc-ligas">${FB_CITIES.map(([slug, name]) => link(fbSearch(q, slug), name)).join("")}${link(fbSearch(q, ""), "Cerca de mí")}</div>
      <p class="pc-foot">Mercado Libre, todo el país (ahí puedes filtrar por estado): ${link(mlSearch(q), q)}</p>`;
  };
  PC.loadCapturas = async function () {
    const box = document.getElementById("pcCapturas");
    const a = document.getElementById("pcMarcador");
    if (a) ensureMarcador().then(href => { if (href) a.href = href; });
    PC.loadBusqueda();
    if (!box) return;
    const { data, error } = await client().from("mx_capturas").select("id,captured_at,source_id,items,status,result").order("id", { ascending: false }).limit(8);
    if (error) { box.innerHTML = `<p class="pc-foot">No se pudieron leer las capturas (${h(error.message)}).</p>`; return; }
    if (!data.length) { box.innerHTML = `<p class="pc-foot">Todavía no guardas ninguna.</p>`; return; }
    const ST = { pendiente: "Se procesa mañana 6:17", procesada: "Procesada", error: "Con error" };
    box.innerHTML = `<table class="pc-table"><tbody>${data.map(c => { const r = c.result || {};
      const res = c.status === "procesada" ? `${r.nuevos ?? 0} nuevos · ${(r.sin_cambio ?? 0) + (r.actualizados ?? 0)} ya estaban · ${r.fuera_de_taxonomia ?? 0} fuera de los modelos` : c.status === "error" ? h(r.error || "") : "";
      return `<tr><th scope="row">${h(S.sources[c.source_id] ? S.sources[c.source_id].name : sourceName(c.source_id))}<br><span class="pc-foot">${h(fmtDate(String(c.captured_at).slice(0, 10)))} · ${c.items.length} autos</span></th>
        <td><span class="pc-st">${h(ST[c.status] || c.status)}</span><br><span class="pc-foot">${res}</span></td></tr>`; }).join("")}</tbody></table>`;
  };

  // ── acciones ───────────────────────────────────────────────────────────
  const root = () => document.getElementById("tab-calle");
  let qTimer = null;
  PC.set = (k, v) => {
    S.f[k] = v; if (k === "make") S.f.model = ""; if (k === "make" || k === "model") S.f.variant = ""; S.limit = 48;
    if (k === "q") { clearTimeout(qTimer); qTimer = setTimeout(() => { draw(root()); const i = root().querySelector(".pc-filters input"); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 220); return; }
    draw(root());
  };
  PC.setUsd = on => { S.usd = !!on && !!S.fx; draw(root()); };
  PC.more = () => { S.limit += 48; draw(root()); };
  PC.reload = () => { S.loaded = false; S.loading = null; PC.render(root()); };

  // ── estilos (solo tokens del tema: funciona en los 5 temas) ────────────
  function injectCss() {
    if (document.getElementById("pc-css")) return;
    const st = document.createElement("style"); st.id = "pc-css";
    st.textContent = `
    .pc-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;flex-wrap:wrap;margin:28px 0 22px}
    .pc-lead{color:var(--ink-dim);margin:8px 0 0;max-width:60ch}
    .pc-cur{display:inline-flex;border:1px solid var(--line);border-radius:var(--radius,2px);overflow:hidden}
    .pc-cur button{background:transparent;border:0;color:var(--ink-dim);font-family:var(--mono);font-size:12px;letter-spacing:.08em;padding:8px 14px;cursor:pointer}
    .pc-cur button.on{background:var(--accent);color:var(--on-accent)}
    .pc-cur button:disabled{opacity:.45;cursor:not-allowed}
    .pc-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0;margin:0 0 26px;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
    .pc-stats div{padding:14px 16px 14px 0}
    .pc-stats dt{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint)}
    .pc-stats dd{margin:4px 0 0;font-family:var(--display);font-size:clamp(24px,3vw,34px);color:var(--ink)}
    .pc-filters select.ctrl{max-width:220px}
    .pc-count{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-faint);margin:0 0 14px}
    .pc-card{cursor:pointer}
    .pc-card:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
    .pc-card .ph img{width:100%;height:100%;object-fit:cover}
    .pc-badge{position:absolute;left:10px;top:10px;background:rgba(var(--shade),.78);color:var(--ink);font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;padding:4px 8px}
    .pc-badge+.pc-badge{top:38px}
    .pc-demo{background:var(--accent);color:var(--on-accent)}
    .pc-price{font-family:var(--display);font-size:22px;color:var(--ink);margin-top:6px}
    .pc-price small{font-family:var(--mono);font-size:11px;color:var(--ink-faint)}
    .pc-price.big{font-size:clamp(28px,4vw,40px);margin:0}
    .pc-note{display:inline-block;font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);margin-top:6px}
    .pc-none{color:var(--ink-faint)}
    .pc-section{margin-top:56px}
    .pc-tablewrap{overflow-x:auto}
    .pc-table{width:100%;border-collapse:collapse;font-size:14px}
    .pc-table th,.pc-table td{text-align:left;padding:10px 12px 10px 0;border-bottom:1px solid var(--line);vertical-align:top}
    .pc-table thead th{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);font-weight:500}
    .pc-table tbody th{font-weight:500;color:var(--ink)}
    .pc-table .num{text-align:right}
    .pc-insuf,.pc-unk{color:var(--ink-faint);font-style:italic}
    .pc-foot{color:var(--ink-faint);font-size:12px;margin:12px 0 0;max-width:70ch}
    .pc-foot b{color:var(--ink-dim)}
    .pc-photos{display:flex;gap:8px;overflow-x:auto;scroll-snap-type:x mandatory;margin:0 0 14px;-webkit-overflow-scrolling:touch}
    .pc-photos{min-height:min(42vh,320px)}
    .pc-photos img{height:min(42vh,320px);width:auto;min-width:min(60vw,420px);max-width:88%;object-fit:cover;scroll-snap-align:start;background:var(--card2);flex:0 0 auto;opacity:1!important}
    .pc-path{font-family:var(--mono);font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-dim);margin:0 0 16px}
    .pc-ficha{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:28px}
    .pc-specs{margin-top:14px}
    .pc-specs tbody th{color:var(--ink-dim);font-weight:400;width:46%}
    .pc-ligas{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}
    .pc-h4{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);font-weight:500;margin:0 0 10px}
    .pc-listing{border-top:1px solid var(--line);padding:12px 0}
    .pc-l1{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
    .pc-l2{color:var(--ink-faint);font-size:12px;margin:4px 0 8px}
    .pc-st{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-dim)}
    .pc-st-activo{color:var(--good)}
    .pc-hist{list-style:none;margin:0 0 8px;padding:0;font-size:13px}
    .pc-hist li{display:flex;justify-content:space-between;gap:10px;padding:3px 0;color:var(--ink-dim)}
    .pc-hist b{color:var(--ink);font-weight:500}
    .pc-tiles{display:grid;grid-template-columns:1fr 1fr;gap:0 18px;margin:16px 0 0;border-top:1px solid var(--line)}
    .pc-tiles div{padding:12px 0 0}
    .pc-tiles dt{font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint)}
    .pc-tiles dd{margin:4px 0 2px;font-size:20px;color:var(--ink)}
    .pc-tiles p{margin:0;font-size:12px;color:var(--ink-faint)}
    .pc-man{display:inline-block;font-family:var(--mono);font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);border:1px solid var(--accent);padding:0 4px;vertical-align:1px;margin-left:4px}
    .pc-notes{font-size:13px;color:var(--ink-dim);margin:10px 0 0;white-space:pre-wrap}
    .pc-editbtn{margin-top:14px}
    .pc-form{margin-top:16px}
    .pc-formgrid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}
    .pc-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--ink-dim);margin-top:10px}
    .pc-formgrid .pc-field{margin-top:0}
    .pc-field .ctrl{width:100%;max-width:none;box-sizing:border-box}
    .pc-formmsg{font-size:12px;color:var(--ink-dim);min-height:1em;margin:8px 0}
    .pc-formbtns{display:flex;gap:8px}
    .pc-sub{margin-top:28px;position:relative}
    .pc-section{position:relative}
    .pc-split{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:28px}
    .pc-chart{width:100%;height:auto;display:block;overflow:visible}
    .pc-chart text{font-family:var(--mono);font-size:10px}
    .pc-ax{fill:var(--ink-faint);font-variant-numeric:tabular-nums}
    .pc-lab{fill:var(--ink-dim)}
    .pc-grid{stroke:var(--line);stroke-width:1}
    .pc-base{stroke:var(--ink-faint);stroke-width:1}
    .pc-med{stroke:var(--ink-dim);stroke-width:1}
    .pc-line{fill:none;stroke:var(--accent);stroke-width:2;stroke-linejoin:round}
    .pc-line.alt{stroke:var(--ink-dim)}
    .pc-dot{fill:var(--accent);stroke:var(--bg2,var(--bg));stroke-width:2}
    .pc-dot.alt,.pc-dot.peer{fill:var(--ink-faint)}
    .pc-bar{fill:var(--accent)}
    .pc-hit{fill:transparent;cursor:pointer}
    .pc-tip{position:absolute;z-index:5;pointer-events:none;background:var(--ink);color:var(--bg);font-size:12px;line-height:1.4;padding:6px 9px;white-space:pre;max-width:260px;box-shadow:0 4px 14px rgba(0,0,0,.25)}
    .pc-tip img{display:block;width:220px;max-width:100%;aspect-ratio:4/3;object-fit:cover;margin:-2px 0 6px;background:var(--bg2)}
    .pc-chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
    .pc-chip{font:inherit;font-size:12px;padding:5px 10px;border:1px solid var(--line);background:transparent;color:var(--ink-dim);cursor:pointer;border-radius:999px}
    .pc-chip:hover{color:var(--ink);border-color:var(--ink-faint)}
    .pc-chip.on{background:var(--ink);color:var(--bg);border-color:var(--ink)}
    .pc-chipn{opacity:.6;margin-left:2px;font-variant-numeric:tabular-nums}
    .pc-chip:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
    .pc-was{color:var(--ink-faint);font-weight:400;margin-right:4px}
    .pc-delbtn{margin-left:8px;color:var(--ink-dim)}
    .pc-legend{font-size:12px;color:var(--ink-dim);margin:8px 0 0;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .pc-key{display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--accent)}
    .pc-key.peer{background:var(--ink-faint);margin-left:10px}
    .pc-details{margin-top:10px;font-size:13px}
    .pc-details summary{cursor:pointer;color:var(--ink-dim);font-family:var(--mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
    .pc-rowlink{cursor:pointer}
    .pc-rowlink:hover th{color:var(--accent)}
    #pcModal{position:relative}
    .pc-admin{margin-top:8px;margin-bottom:36px}
    .pc-marcador{cursor:grab}
    .pc-caplist{max-height:min(52vh,460px);overflow:auto;border-top:1px solid var(--line);margin:10px 0}
    .pc-caprow{display:grid;grid-template-columns:20px 64px minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line);cursor:pointer}
    .pc-caprow.off{opacity:.5;cursor:default}
    .pc-caprow img,.pc-capimg{width:64px;height:48px;object-fit:cover;background:var(--card2);display:block}
    .pc-captxt{display:flex;flex-direction:column;gap:2px;min-width:0}
    .pc-captxt b{font-weight:500;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .pc-captxt span{font-size:12px;color:var(--ink-faint)}
    .pc-capprice{text-align:right;font-size:14px;color:var(--ink);white-space:nowrap}
    .pc-capprice small{display:block;font-size:11px;color:var(--ink-faint)}
    @media (max-width:720px){
      .pc-split,.pc-formgrid,.pc-tiles{grid-template-columns:1fr}
      .pc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
      .pc-filters select.ctrl{max-width:none;flex:1 1 45%}
      .pc-ficha{grid-template-columns:1fr;gap:18px}
    }`;
    document.head.appendChild(st);
  }
})();
