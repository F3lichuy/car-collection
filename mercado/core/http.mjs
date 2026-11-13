// Cliente HTTP educado: user-agent honesto, espera mínima por sitio, respeta
// robots.txt (Disallow y Crawl-delay), reintentos con espera creciente y
// registro de cada petición. Un sitio lento o caído no afecta a los demás.

export const DEFAULT_UA = 'MercadoMX/0.1 (+https://carcollection.app; contacto por el sitio)';
const sleep = ms => new Promise(r => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, url) { super(`HTTP ${status} en ${url}`); this.status = status; this.url = url; }
}
// El sitio dejó de responder en esta corrida: no se insiste más (freno).
export class HostUnavailable extends Error {
  constructor(host, n) { super(`${host} no responde (${n} fallas de red seguidas): se detiene esta fuente por hoy`); this.host = host; }
}
export class RobotsDenied extends Error {
  constructor(url) { super(`robots.txt no permite ${url}`); this.url = url; }
}

// ── robots.txt ──────────────────────────────────────────────────────────
// Implementa lo necesario de RFC 9309: grupos por user-agent, Allow/Disallow
// con * y $, la regla más específica gana; Crawl-delay.
export function parseRobots(text, agent = 'mercadomx') {
  const groups = []; let cur = null, lastWasUA = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === 'user-agent') {
      if (!lastWasUA) { cur = { agents: [], rules: [], delay: null }; groups.push(cur); }
      cur.agents.push(v.toLowerCase()); lastWasUA = true; continue;
    }
    lastWasUA = false;
    if (!cur) continue;
    if (k === 'allow' || k === 'disallow') { if (v || k === 'allow') cur.rules.push({ allow: k === 'allow', path: v }); }
    else if (k === 'crawl-delay') cur.delay = Number(v) || null;
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && agent.toLowerCase().includes(a)));
  const chosen = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  const rules = chosen.flatMap(g => g.rules).filter(r => r.path);
  const delay = chosen.map(g => g.delay).find(d => d != null) ?? null;
  const toRe = p => new RegExp('^' + p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\\\$$/, '$'));
  const compiled = rules.map(r => ({ ...r, re: toRe(r.path), len: r.path.length }));
  return {
    delay,
    allowed(pathAndQuery) {
      let best = null;
      for (const r of compiled) if (r.re.test(pathAndQuery) && (!best || r.len > best.len || (r.len === best.len && r.allow))) best = r;
      return !best || best.allow;
    },
  };
}

export class PoliteFetcher {
  constructor({ userAgent = DEFAULT_UA, minDelayMs = 3000, retries = 2, timeoutMs = 25000, breakerAfter = 5, log = () => {}, fetchImpl = globalThis.fetch } = {}) {
    Object.assign(this, { userAgent, minDelayMs, retries, timeoutMs, breakerAfter, log, fetchImpl });
    this.lastByHost = new Map(); this.robots = new Map(); this.requests = 0; this.netFails = new Map();
  }

  // Freno por sitio: N fallas de red seguidas (sin ninguna respuesta) → no más peticiones a ese host.
  noteNet(host, ok) {
    const n = ok ? 0 : (this.netFails.get(host) ?? 0) + 1;
    this.netFails.set(host, n);
    return n;
  }

  async robotsFor(origin) {
    if (this.robots.has(origin)) return this.robots.get(origin);
    let r = parseRobots('');
    try {
      const res = await this.fetchImpl(origin + '/robots.txt', { headers: { 'user-agent': this.userAgent }, signal: AbortSignal.timeout(this.timeoutMs) });
      if (res.ok) r = parseRobots(await res.text(), 'mercadomx');
      else if (res.status >= 500) r = { delay: null, allowed: () => false };   // RFC 9309: 5xx = no rastrear
    } catch { /* sin robots.txt accesible: se permite, con la espera mínima */ }
    this.robots.set(origin, r);
    return r;
  }

  async wait(host, delayMs) {
    const last = this.lastByHost.get(host) ?? 0;
    const jitter = Math.floor(Math.random() * 800);
    const ms = last + delayMs + jitter - Date.now();
    if (ms > 0) await sleep(ms);
    this.lastByHost.set(host, Date.now());
  }

  // Devuelve { status, url, text | buffer, headers }
  async get(url, { as = 'text', minDelayMs, accept = 'text/html,application/json;q=0.9,*/*;q=0.8', checkRobots = true, timeoutMs = this.timeoutMs } = {}) {
    const u = new URL(url);
    const robots = checkRobots ? await this.robotsFor(u.origin) : { delay: null, allowed: () => true };
    if (!robots.allowed(u.pathname + u.search)) throw new RobotsDenied(url);
    const delay = Math.max(minDelayMs ?? this.minDelayMs, (robots.delay ?? 0) * 1000);
    if ((this.netFails.get(u.host) ?? 0) >= this.breakerAfter) throw new HostUnavailable(u.host, this.netFails.get(u.host));
    let lastErr;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      await this.wait(u.host, attempt === 0 ? delay : delay * 2 ** attempt);
      const t0 = Date.now();
      try {
        this.requests++;
        const res = await this.fetchImpl(url, { headers: { 'user-agent': this.userAgent, accept, 'accept-language': 'es-MX,es;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
        this.log({ url, status: res.status, ms: Date.now() - t0, attempt });
        this.noteNet(u.host, true);
        if (res.status === 429 || res.status >= 500) { lastErr = new HttpError(res.status, url); continue; }
        if (!res.ok) throw new HttpError(res.status, url);
        const body = as === 'buffer' ? Buffer.from(await res.arrayBuffer()) : await res.text();
        return { status: res.status, url: res.url, headers: res.headers, [as]: body };
      } catch (e) {
        if (e instanceof HttpError && e.status < 500 && e.status !== 429) throw e;
        lastErr = e;
        this.log({ url, error: e.message, attempt });
        if (!(e instanceof HttpError) && this.noteNet(u.host, false) >= this.breakerAfter) throw new HostUnavailable(u.host, this.netFails.get(u.host));
      }
    }
    throw lastErr;
  }
}
