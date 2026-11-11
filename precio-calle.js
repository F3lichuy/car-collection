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
    f: { q: "", make: "", model: "", tx: "", seg: "", sort: "recientes" }, usd: false, limit: 48,
  };
  const h = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const client = () => (typeof supa !== "undefined" ? supa : null);
  const nf = new Intl.NumberFormat("es-MX");

  const TX = { manual: "Manual", pdk: "PDK", dct: "Doble embrague", f1: "F1", automatizada: "Automatizada", automatica: "Automática" };
  const SEG = { clasico: "Clásicos", moderno: "Modernos", exotico: "Exóticos", gran_turismo: "Gran Turismo", ultra_lujo: "Ultra-lujo" };
  const INVOICE = { agencia: "De agencia", aseguradora: "De aseguradora", refacturado: "Refacturado", otra: "Otra" };
  const ORIGIN = { nacional: "Nacional", importado: "Importado", fronterizo: "Fronterizo", legalizado: "Legalizado" };
  const SERVICE = { agencia_completo: "En agencia, completos", agencia_parcial: "En agencia, parciales", taller_externo: "Taller externo", sin_historial: "Sin historial" };
  const STATUS = { activo: "Activo", desaparecido: "Ya no aparece", vendido_confirmado: "Vendido (confirmado)", vendido_inferido: "Vendido (inferido)", republicado: "Republicado" };

  // ── datos ──────────────────────────────────────────────────────────────
  async function load() {
    const c = client();
    if (!c) throw new Error("Sin conexión con la base");
    const [ls, src, st, fx] = await Promise.all([
      c.from("mx_listings").select(`id,title,url,city,state,source_id,status,first_seen,last_seen,is_demo,
        vehicle:mx_vehicles(id,vin,version_id,is_demo,
          version:mx_versions(name), generation:mx_generations(name), model:mx_models(name,segment,make:mx_makes(name))),
        specs:mx_specs(year,km,transmission,body,exterior_color,exterior_color_family,exterior_color_raw,interior_color,interior_color_family,interior_color_raw,
          invoice_type,origin,owners,service_history,antique_plates,parse_confidence),
        prices:mx_price_snapshots(price,currency,negotiable,observed_from,observed_to),
        photos:mx_photos(url,position)`).limit(2000),
      c.from("mx_sources_public").select("id,name,kind,base_url"),
      c.from("mx_settings").select("key,value"),
      c.from("mx_fx_rates").select("day,usd_mxn").order("day", { ascending: false }).limit(1),
    ]);
    if (ls.error) throw ls.error;
    S.sources = Object.fromEntries((src.data || []).map(s => [s.id, s]));
    S.settings = Object.fromEntries((st.data || []).map(r => [r.key, r.value]));
    S.fx = fx.data && fx.data[0] ? fx.data[0] : null;
    S.listings = (ls.data || []).length;
    S.vehicles = groupVehicles(ls.data || []);
    S.loaded = true;
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
      x.year = sp.year ?? null; x.km = specs.map(s => s.km).filter(k => k != null).sort((a, b) => b - a)[0] ?? null;
      x.tx = specs.map(s => s.transmission).find(Boolean) || null;
      x.specs = sp; x.confidence = Math.max(...specs.map(s => Number(s.parse_confidence ?? 0)), 0);
      x.price = lastPrice(main);
      x.active = x.listings.some(l => l.status === "activo");
      x.lastSeen = main.last_seen; x.firstSeen = x.listings.map(l => l.first_seen).sort()[0];
      x.city = main.city || main.state || "";
      x.demo = !!(x.v.is_demo || main.is_demo);
      x.photo = x.listings.flatMap(l => (l.photos || []).slice().sort((a, b) => (a.position ?? 99) - (b.position ?? 99))).map(p => p.url)[0] || null;
      x.sourceIds = [...new Set(x.listings.map(l => l.source_id))];
      x.seg = x.year && x.year <= now - classicAge ? "clasico" : (m.segment || "");
      // "Ferrari 328 GTB / GTS", no "Ferrari 308 / 328 328 GTB / GTS": si la versión ya trae el código del modelo, no se repite.
      const modelTok = x.model.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
      const versionHasModel = x.version && x.version.toLowerCase().split(/[^a-z0-9]+/).some(t => modelTok.includes(t));
      x.name = [modelLabel(x.make, versionHasModel ? "" : x.model), x.version].filter(Boolean).join(" ");
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
  };

  function filtered() {
    const f = S.f, q = f.q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
    let a = S.vehicles.filter(x => x.active
      && (!f.make || x.make === f.make) && (!f.model || x.model === f.model)
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
      ${act.length ? `
      <div class="toolbar pc-filters">
        <input class="ctrl grow" placeholder="Buscar: 993, GT3, Testarossa…" value="${h(S.f.q)}" oninput="PrecioCalle.set('q', this.value)">
        <select class="ctrl" aria-label="Marca" onchange="PrecioCalle.set('make', this.value)">${opt("", S.f.make, "Todas las marcas")}${makes.map(m => opt(m, S.f.make, m)).join("")}</select>
        <select class="ctrl" aria-label="Modelo" onchange="PrecioCalle.set('model', this.value)">${opt("", S.f.model, "Todos los modelos")}${models.map(m => opt(m, S.f.model, m)).join("")}</select>
        <select class="ctrl" aria-label="Transmisión" onchange="PrecioCalle.set('tx', this.value)">${opt("", S.f.tx, "Cualquier caja")}${txs.map(t => opt(t, S.f.tx, TX[t] || t)).join("")}</select>
        <select class="ctrl" aria-label="Segmento" onchange="PrecioCalle.set('seg', this.value)">${opt("", S.f.seg, "Todos los segmentos")}${segs.map(t => opt(t, S.f.seg, SEG[t] || t)).join("")}</select>
        <select class="ctrl" aria-label="Orden" onchange="PrecioCalle.set('sort', this.value)">
          ${opt("recientes", S.f.sort, "Más recientes")}${opt("precio_asc", S.f.sort, "Precio: menor a mayor")}${opt("precio_desc", S.f.sort, "Precio: mayor a menor")}
          ${opt("anio_asc", S.f.sort, "Año: más antiguos")}${opt("anio_desc", S.f.sort, "Año: más nuevos")}${opt("km_asc", S.f.sort, "Menos km")}</select>
      </div>
      <p class="pc-count">${list.length === 1 ? "1 auto" : `${nf.format(list.length)} autos`}${list.length !== act.length ? ` de ${nf.format(act.length)}` : ""}</p>
      <div class="grid pc-grid">${shown.map(card).join("") || `<p class="pc-none">Nada con esos filtros.</p>`}</div>
      ${list.length > shown.length ? `<div class="mk-more"><button class="btn" onclick="PrecioCalle.more()">Cargar más</button></div>` : ""}
      ${byModel(act)}` : `
      <div class="empty"><h2>Todavía no hay autos</h2><p>En cuanto corra la primera captura de las fuentes, aquí aparece el mercado.</p></div>`}
      <p class="pc-foot">Precios <b>pedidos</b> en anuncios públicos, no precios de venta. Cada auto muestra de qué anuncios sale su información.</p>
    </div>`;
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

  // Mediana pedida por modelo: solo con n suficiente; si no, "datos insuficientes".
  function byModel(act) {
    const minN = Number(S.settings.min_n_for_stats ?? 5);
    const groups = new Map();
    for (const x of act) { const k = modelLabel(x.make, x.model); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
    const rows = [...groups.entries()].sort((a, b) => b[1].length - a[1].length).map(([k, xs]) => {
      const mx = xs.map(x => x.price).filter(p => p && p.price != null && (p.currency === "MXN" || S.fx))
        .map(p => Number(p.price) * (p.currency === "USD" ? Number(S.fx.usd_mxn) : 1));
      const med = mx.length >= minN ? money({ price: median(mx), currency: "MXN" }) : null;
      return `<tr><th scope="row">${h(k)}</th><td class="num">${xs.length}</td><td class="num">${med ? h(med) : `<span class="pc-insuf">Datos insuficientes</span>`}</td></tr>`;
    }).join("");
    return `<section class="pc-section"><div class="home-sechead"><h2>Por modelo</h2></div>
      <div class="pc-tablewrap"><table class="pc-table"><thead><tr><th>Modelo</th><th class="num">Autos (n)</th><th class="num">Mediana pedida</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="pc-foot">La mediana aparece cuando hay al menos ${minN} autos con precio del mismo modelo. Las tendencias y el "¿está caro?" llegan cuando haya historial suficiente.</p></section>`;
  }

  // ── ficha de un auto ───────────────────────────────────────────────────
  PC.open = function (id) {
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
    const row = (k, v) => `<tr><th scope="row">${h(k)}</th><td>${v == null || v === "" ? `<span class="pc-unk">Sin dato</span>` : h(v)}</td></tr>`;
    const path = [x.make, x.model, x.gen, x.version].filter(Boolean).map(h).join(" › ");
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
            <table class="pc-table pc-specs"><tbody>
              ${row("Año", x.year)}${row("Kilometraje", x.km == null ? null : km(x.km))}${row("Transmisión", x.tx ? TX[x.tx] || x.tx : null)}
              ${row("Color exterior", color(s.exterior_color, s.exterior_color_family, s.exterior_color_raw))}
              ${row("Interior", color(s.interior_color, s.interior_color_family, s.interior_color_raw))}
              ${row("Factura", s.invoice_type ? INVOICE[s.invoice_type] : null)}${row("Origen", s.origin ? ORIGIN[s.origin] : null)}
              ${row("Dueños", s.owners)}${row("Servicios", s.service_history ? SERVICE[s.service_history] : null)}
              ${row("Placas de auto antiguo", s.antique_plates ? "Sí" : null)}${row("VIN", x.v.vin ? "Registrado" : null)}
            </tbody></table>
          </div>
          <div>
            <h4 class="pc-h4">De dónde sale esta información</h4>
            ${x.listings.map(l => {
              const src = S.sources[l.source_id], pr = (l.prices || []).slice().sort((a, b) => String(a.observed_from).localeCompare(String(b.observed_from)));
              return `<div class="pc-listing">
                <div class="pc-l1"><b>${h(src ? src.name : sourceName(l.source_id))}</b><span class="pc-st pc-st-${h(l.status)}">${h(STATUS[l.status] || l.status)}</span></div>
                <div class="pc-l2">${h(l.city || l.state || "")}${l.city || l.state ? " · " : ""}visto del ${h(fmtDate(l.first_seen))} al ${h(fmtDate(l.last_seen))}</div>
                ${pr.length ? `<ul class="pc-hist">${pr.map(p => `<li><span>${h(fmtDate(p.observed_from))}${p.observed_to !== p.observed_from ? ` – ${h(fmtDate(p.observed_to))}` : ""}</span><b>${h(money(p))}</b></li>`).join("")}</ul>` : ""}
                ${l.url ? `<a class="link" href="${h(l.url)}" target="_blank" rel="noopener noreferrer nofollow">Ver anuncio original ↗</a>` : ""}
              </div>`;
            }).join("")}
          </div>
        </div>
        <p class="pc-foot">Precio pedido en anuncios públicos, no precio de venta.${x.confidence < 0.7 ? " Algunos datos de este auto están por confirmar." : ""}</p>
      </div>`;
    scrim.classList.add("show");
  };

  // ── acciones ───────────────────────────────────────────────────────────
  const root = () => document.getElementById("tab-calle");
  let qTimer = null;
  PC.set = (k, v) => {
    S.f[k] = v; if (k === "make") S.f.model = ""; S.limit = 48;
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
    .pc-h4{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--ink-faint);font-weight:500;margin:0 0 10px}
    .pc-listing{border-top:1px solid var(--line);padding:12px 0}
    .pc-l1{display:flex;justify-content:space-between;gap:10px;align-items:baseline}
    .pc-l2{color:var(--ink-faint);font-size:12px;margin:4px 0 8px}
    .pc-st{font-family:var(--mono);font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-dim)}
    .pc-st-activo{color:var(--good)}
    .pc-hist{list-style:none;margin:0 0 8px;padding:0;font-size:13px}
    .pc-hist li{display:flex;justify-content:space-between;gap:10px;padding:3px 0;color:var(--ink-dim)}
    .pc-hist b{color:var(--ink);font-weight:500}
    @media (max-width:720px){
      .pc-stats{grid-template-columns:repeat(2,minmax(0,1fr))}
      .pc-filters select.ctrl{max-width:none;flex:1 1 45%}
      .pc-ficha{grid-template-columns:1fr;gap:18px}
    }`;
    document.head.appendChild(st);
  }
})();
