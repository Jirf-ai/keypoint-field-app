// Engine calls — the Field app computes nothing; Records owns the projects.
const BASE = "https://bbkeogzyqwszmijmvlmj.supabase.co/functions/v1";
// Publishable anon key — safe in the client (RLS + guest gates server-side).
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJia2VvZ3p5cXdzem1pam12bG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDgzMjYsImV4cCI6MjA5ODE4NDMyNn0.hfaZ4zhZbUAKvN9KKmSRCrts1H-atv1Yg1CTEpcSeh4";

export async function call(fn, body) {
  const res = await fetch(`${BASE}/${fn}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ANON}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, ...json };
}

// Project typeahead against the Records engine. Primary: search-projects
// (list, more letters → tighter matches). Until that function deploys, fall
// back to get-project-record's single best match so search still works.
export async function searchProjects(q) {
  try {
    const r = await call("search-projects", { q });
    if (r.ok && Array.isArray(r.matches)) return r.matches;
  } catch {}
  try {
    const one = await call("get-project-record", { project: q, limit: 1 });
    if (one?.project?.id) return [one.project];
  } catch {}
  return [];
}
