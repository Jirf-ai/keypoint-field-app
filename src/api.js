// Engine calls — the Field app computes nothing; Records owns the projects.
const BASE = "https://bbkeogzyqwszmijmvlmj.supabase.co/functions/v1";
// Publishable anon key — safe in the client (RLS + guest gates server-side).
const ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJia2VvZ3p5cXdzem1pam12bG1qIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2MDgzMjYsImV4cCI6MjA5ODE4NDMyNn0.hfaZ4zhZbUAKvN9KKmSRCrts1H-atv1Yg1CTEpcSeh4";

// timeoutMs: a site-cellular request that hangs (no response, no error) used
// to wedge the single-flight sync queue FOREVER — every later trigger no-oped
// until the app was killed. Abort instead; the caller treats it like any
// network failure and the rows ride the next sync.
export async function call(fn, body, { timeoutMs = 25_000 } = {}) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  try {
    const res = await fetch(`${BASE}/${fn}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ANON}`,
        apikey: ANON,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      ...(ctl ? { signal: ctl.signal } : {}),
    });
    const json = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, ...json };
  } finally {
    if (timer) clearTimeout(timer);
  }
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
