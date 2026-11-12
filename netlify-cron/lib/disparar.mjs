// Lo común de los disparadores: pedirle a GitHub que corra un workflow de Mercado MX.
// El permiso (token de GitHub con "Actions: lectura y escritura" SOLO para este repositorio) vive en
// Netlify como variable de entorno GITHUB_ACTIONS_TOKEN; nunca en el código.
export const REPO = 'F3lichuy/car-collection';
const UA = 'MercadoMX-disparador/0.1 (+https://carcollection.app)';

export async function gh(path, { method = 'GET', body, token = process.env.GITHUB_ACTIONS_TOKEN, fetchImpl = fetch } = {}) {
  if (!token) throw new Error('Falta la variable GITHUB_ACTIONS_TOKEN en Netlify');
  const r = await fetchImpl(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': UA,
      ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) throw new Error(`GitHub respondió ${r.status} en ${path}: ${(await r.text()).slice(0, 200)}`);
  return r.status === 204 ? null : r.json();
}

// Corre el workflow en main. GitHub responde 204 sin cuerpo.
export const dispatch = (workflow, inputs, opts) => gh(`/actions/workflows/${workflow}/dispatches`, { method: 'POST', body: { ref: 'main', ...(inputs ? { inputs } : {}) }, ...opts });

// ¿Ya hay una corrida de este workflow desde `since` (ISO)? (para no repetir la carga diaria si el
// horario de GitHub sí funcionó ese día)
export async function ranSince(workflow, since, opts) {
  const j = await gh(`/actions/workflows/${workflow}/runs?per_page=10&created=%3E%3D${encodeURIComponent(since)}`, opts);
  return (j.workflow_runs ?? []).length > 0;
}
