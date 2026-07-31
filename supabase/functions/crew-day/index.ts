import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// crew-day — the site manager's server-truth crew view for one project day.
// The SM's device only holds what was recorded ON that device; crew who
// self-log on their own phones sync here, so this is where "who's on the
// clock right now" and "who has logged" actually live.
//
// Body: { gc_code: string, project_id: uuid, work_date: "YYYY-MM-DD" }
// Response: { work_date, workers: [{ worker_id, name, trade, role,
//             clock_in, clock_out, on_clock, hours }] }
//
// Gate: the GC team code — same pilot-grade trust as roster fetch and
// payroll-export. Clock pairs resolve by the `starts` link; a start with no
// end is on_clock. Hours are active labor versions only (superseded
// corrections never count).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const gc_code = String(body.gc_code ?? "").trim().toUpperCase();
  const project_id = typeof body.project_id === "string" ? body.project_id : "";
  const work_date = String(body.work_date ?? "");
  if (!gc_code || !project_id || !/^\d{4}-\d{2}-\d{2}$/.test(work_date)) {
    return json({ error: "gc_code, project_id, work_date required" }, 400);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: gc } = await supabase.from("gc_accounts").select("id").eq("gc_code", gc_code).maybeSingle();
  if (!gc) return json({ error: "unknown gc_code" }, 403);

  const { data: roster, error: rosterErr } = await supabase
    .from("worker_registrations")
    .select("worker_id, display_name, trade, role")
    .eq("gc_account_id", gc.id);
  if (rosterErr) return json({ error: rosterErr.message }, 500);
  if (!roster?.length) return json({ work_date, workers: [] });
  const ids = roster.map((w) => String(w.worker_id));

  const [{ data: clocks, error: cErr }, { data: labor, error: lErr }] = await Promise.all([
    supabase.from("field_clock_events")
      .select("clock_id, worker_id, event, starts, at")
      .eq("project_id", project_id).eq("work_date", work_date)
      .in("worker_id", ids).order("at", { ascending: true }),
    supabase.from("field_labor_entries")
      .select("labor_id, worker_id, hours, supersedes")
      .eq("project_id", project_id).eq("work_date", work_date)
      .in("worker_id", ids),
  ]);
  if (cErr) return json({ error: cErr.message }, 500);
  if (lErr) return json({ error: lErr.message }, 500);

  // Latest clock pair per worker: walk starts in time order, keep the last;
  // an end whose `starts` matches an open start closes it.
  const clockByWorker = new Map<string, { clock_in: string; clock_out: string | null; start_id: string }>();
  for (const e of clocks ?? []) {
    const wid = String(e.worker_id);
    if (e.event === "start") {
      clockByWorker.set(wid, { clock_in: e.at, clock_out: null, start_id: e.clock_id });
    } else if (e.event === "end") {
      const cur = clockByWorker.get(wid);
      if (cur && cur.start_id === e.starts) cur.clock_out = e.at;
    }
  }

  const superseded = new Set((labor ?? []).map((l) => l.supersedes).filter(Boolean));
  const hoursByWorker = new Map<string, number>();
  for (const l of labor ?? []) {
    if (superseded.has(l.labor_id)) continue;
    const wid = String(l.worker_id);
    hoursByWorker.set(wid, (hoursByWorker.get(wid) ?? 0) + (Number(l.hours) || 0));
  }

  const workers = roster.map((w) => {
    const wid = String(w.worker_id);
    const clock = clockByWorker.get(wid) ?? null;
    return {
      worker_id: wid,
      name: w.display_name,
      trade: w.trade ?? null,
      role: w.role ?? null,
      clock_in: clock?.clock_in ?? null,
      clock_out: clock?.clock_out ?? null,
      on_clock: !!clock && clock.clock_out === null,
      hours: Math.round((hoursByWorker.get(wid) ?? 0) * 100) / 100,
    };
  });

  return json({ work_date, workers });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
