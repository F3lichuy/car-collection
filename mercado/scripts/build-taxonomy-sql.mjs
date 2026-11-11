// Genera supabase/mercado/002_taxonomia.sql a partir de data/taxonomia.mjs.
// Uso: npm run build:taxonomia      (desde mercado/)
// Idempotente: usa ON CONFLICT … DO UPDATE, se puede volver a aplicar.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makes, makeAliases, models, options, sources, settings } from '../data/taxonomia.mjs';

export const slug = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/²/g, '2').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const aliasKey = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/²/g, '2').replace(/[^a-z0-9.\/+&]+/g, ' ').trim();

const q = v => v === null || v === undefined ? 'null'
  : typeof v === 'number' ? String(v)
  : typeof v === 'boolean' ? String(v)
  : `'${String(v).replace(/'/g, "''")}'`;
const arr = a => `array[${a.map(q).join(',')}]::text[]`;

// Expande la taxonomía a filas planas, validando todo.
export function expand() {
  const errors = [];
  const out = { makes: [], models: [], gens: [], versions: [], aliases: new Set() };
  const ids = new Set();
  const addId = (id, what) => { if (ids.has(id)) errors.push(`id repetido: ${id} (${what})`); ids.add(id); };
  const makeIds = new Set(makes.map(m => m.id));
  const addAlias = (alias, level, target) => { const a = aliasKey(alias); if (a) out.aliases.add(`${a}\u0000${level}\u0000${target}`); };

  for (const mk of makes) {
    out.makes.push(mk);
    for (const a of makeAliases[mk.id] || []) addAlias(a, 'make', mk.id);
    addAlias(mk.name, 'make', mk.id);
  }
  models.forEach((m, mi) => {
    if (!makeIds.has(m.make)) errors.push(`marca desconocida ${m.make} en ${m.name}`);
    const modelId = `${m.make}-${slug(m.name)}`;
    addId(modelId, 'modelo');
    out.models.push({ id: modelId, make_id: m.make, name: m.name, segment: m.segment, notes: m.notes ?? null, sort: mi + 1 });
    addAlias(m.name, 'model', modelId);
    for (const a of m.aliases || []) addAlias(a, 'model', modelId);
    m.gens.forEach((g, gi) => {
      const genId = `${modelId}-${slug(g.code)}`;
      addId(genId, 'generación');
      if (g.to !== null && g.to < g.from) errors.push(`${genId}: año final < inicial`);
      out.gens.push({ id: genId, model_id: modelId, code: g.code, name: g.name, year_from: g.from, year_to: g.to, sort: gi + 1 });
      addAlias(g.code, 'generation', genId);
      if (g.code.includes('.')) addAlias(g.code.split('.')[0], 'generation', genId);  // "992" → 992.1 y 992.2
      const names = new Set();
      g.v.forEach(([name, from, to, tx, notes], vi) => {
        const id = `${genId}-${slug(name)}`;
        addId(id, 'versión');
        if (names.has(name)) errors.push(`${genId}: versión repetida ${name}`);
        names.add(name);
        if (to !== null && to < from) errors.push(`${id}: año final < inicial`);
        if (from < g.from - 1 || (g.to !== null && from > g.to + 1)) errors.push(`${id}: año ${from} fuera de la generación ${g.from}–${g.to ?? 'hoy'}`);
        const t = tx ?? g.tx ?? [];
        out.versions.push({ id, generation_id: genId, name, year_from: from, year_to: to, transmissions: t,
          notes: [notes, vi === 0 ? g.notes : null].filter(Boolean).join(' · ') || null, sort: vi + 1 });
        addAlias(name, 'version', id);
        addAlias(name.replace(/\s+/g, ''), 'version', id);       // "GT3RS"
      });
    });
  });
  return { ...out, aliases: [...out.aliases].map(s => s.split('\u0000')), errors };
}

export function buildSql() {
  const t = expand();
  if (t.errors.length) throw new Error('Taxonomía inválida:\n  ' + t.errors.join('\n  '));
  const L = [];
  L.push('-- GENERADO por mercado/scripts/build-taxonomy-sql.mjs desde mercado/data/taxonomia.mjs.');
  L.push('-- No lo edites a mano: edita el .mjs y corre `npm run build:taxonomia`.');
  L.push(`-- ${t.makes.length} marcas · ${t.models.length} modelos · ${t.gens.length} generaciones · ${t.versions.length} versiones · ${t.aliases.length} alias`);
  L.push('begin;');
  const up = (table, cols, rows, conflict = 'id') => {
    if (!rows.length) return;
    const set = cols.filter(c => !conflict.split(',').includes(c)).map(c => `${c} = excluded.${c}`).join(', ');
    L.push(`insert into public.${table} (${cols.join(', ')}) values`);
    L.push(rows.map(r => '  (' + r.join(', ') + ')').join(',\n'));
    L.push(set ? `on conflict (${conflict}) do update set ${set};` : `on conflict (${conflict}) do nothing;`);
  };
  up('mx_makes', ['id', 'name', 'country', 'sort'], t.makes.map(m => [q(m.id), q(m.name), q(m.country), q(m.sort)]));
  up('mx_models', ['id', 'make_id', 'name', 'segment', 'notes', 'sort'],
    t.models.map(m => [q(m.id), q(m.make_id), q(m.name), q(m.segment), q(m.notes), q(m.sort)]));
  up('mx_generations', ['id', 'model_id', 'code', 'name', 'year_from', 'year_to', 'sort'],
    t.gens.map(g => [q(g.id), q(g.model_id), q(g.code), q(g.name), q(g.year_from), q(g.year_to), q(g.sort)]));
  // verified no se toca en conflicto: lo que confirmaste en el admin se respeta.
  up('mx_versions', ['id', 'generation_id', 'name', 'year_from', 'year_to', 'transmissions', 'notes', 'sort'],
    t.versions.map(v => [q(v.id), q(v.generation_id), q(v.name), q(v.year_from), q(v.year_to), arr(v.transmissions), q(v.notes), q(v.sort)]));
  up('mx_aliases', ['alias', 'level', 'target_id'], t.aliases.map(a => a.map(q)), 'alias,level,target_id');
  up('mx_option_catalog', ['code', 'label', 'make_id', 'aliases'],
    options.map(([code, label, make, al]) => [q(code), q(label), q(make), arr(al)]), 'code');
  up('mx_sources', ['id', 'name', 'kind', 'base_url', 'capture_mode', 'status'],
    sources.map(s => [q(s.id), q(s.name), q(s.kind), q(s.base_url ?? null), q(s.capture_mode), q(s.status)]));
  // settings: solo se insertan si no existen (no pisar lo que cambies después).
  L.push('insert into public.mx_settings (key, value, description) values');
  L.push(settings.map(([k, v, d]) => `  (${q(k)}, ${q(JSON.stringify(v))}::jsonb, ${q(d)})`).join(',\n'));
  L.push('on conflict (key) do update set description = excluded.description;');
  L.push('commit;');
  return L.join('\n') + '\n';
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = new URL('../../supabase/mercado/002_taxonomia.sql', import.meta.url);
  const sql = buildSql();
  writeFileSync(target, sql);
  console.log(sql.split('\n')[2]);
}
