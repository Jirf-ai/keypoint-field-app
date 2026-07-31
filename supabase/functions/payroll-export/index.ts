import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// payroll-export — the GC's weekly hours sheet, straight off the labor spine.
//
// Body: { gc_code: string, week_of?: "YYYY-MM-DD" (any date in the target
//         week; defaults to today) }
// Response: { week_start, week_end, workers: [{ worker, trade, days[7],
//             regular, overtime, rework, total_hours, pay }], csv }
//
// Gate: the GC team code — the same trust level as the roster fetch the app
// already does (pilot-grade; tighten to real auth post-pilot). Scope: labor
// entries for the GC's REGISTERED workers only (typed-name day labor has no
// worker_id to anchor on). Active versions only — append-only corrections
// mean a superseded row must never be paid twice.
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
  if (!gc_code) return json({ error: "gc_code required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: gc } = await supabase.from("gc_accounts").select("id").eq("gc_code", gc_code).maybeSingle();
  if (!gc) return json({ error: "unknown gc_code" }, 403);

  // Mon–Sun week containing week_of (default today).
  const ref = new Date(`${String(body.week_of ?? "").match(/^\d{4}-\d{2}-\d{2}$/) ? body.week_of : new Date().toISOString().slice(0, 10)}T12:00:00Z`);
  const monday = new Date(ref);
  monday.setUTCDate(ref.getUTCDate() - ((ref.getUTCDay() + 6) % 7));
  const day = (i: number) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    return d.toISOString().slice(0, 10);
  };
  const week_start = day(0), week_end = day(6);

  const { data: roster, error: rosterErr } = await supabase
    .from("worker_registrations")
    .select("worker_id, display_name, trade")
    .eq("gc_account_id", gc.id);
  if (rosterErr) return json({ error: rosterErr.message }, 500);
  if (!roster?.length) return json({ week_start, week_end, workers: [], csv: "" });

  const ids = roster.map((w) => String(w.worker_id));
  const { data: entries, error: entErr } = await supabase
    .from("field_labor_entries")
    .select("labor_id, worker_id, worker_name, work_date, hours, hour_type, hourly_rate, supersedes")
    .gte("work_date", week_start)
    .lte("work_date", week_end)
    .in("worker_id", ids);
  if (entErr) return json({ error: entErr.message }, 500);

  // Active versions only: drop any row another fetched row supersedes.
  const superseded = new Set((entries ?? []).map((e) => e.supersedes).filter(Boolean));
  const active = (entries ?? []).filter((e) => !superseded.has(e.labor_id));

  const dayIdx = new Map(Array.from({ length: 7 }, (_, i) => [day(i), i]));
  const byWorker = new Map<string, {
    worker: string; trade: string | null; days: number[];
    regular: number; overtime: number; rework: number; pay: number;
  }>();
  for (const w of roster) {
    byWorker.set(String(w.worker_id), {
      worker: w.display_name, trade: w.trade ?? null, days: [0, 0, 0, 0, 0, 0, 0],
      regular: 0, overtime: 0, rework: 0, pay: 0,
    });
  }
  for (const e of active) {
    const row = byWorker.get(String(e.worker_id));
    if (!row) continue;
    const h = Number(e.hours) || 0;
    const idx = dayIdx.get(String(e.work_date));
    if (idx !== undefined) row.days[idx] += h;
    if (e.hour_type === "overtime") row.overtime += h;
    else if (e.hour_type === "rework") row.rework += h;
    else row.regular += h;
    row.pay += h * (Number(e.hourly_rate) || 0);
  }

  const workers = [...byWorker.values()]
    .filter((w) => w.regular + w.overtime + w.rework > 0)
    .sort((a, b) => a.worker.localeCompare(b.worker))
    .map((w) => ({ ...w, total_hours: r2(w.regular + w.overtime + w.rework), pay: r2(w.pay) }));

  const header = ["Worker", "Trade", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "Regular", "Overtime", "Rework", "Total Hrs", "Pay"];
  const lines = workers.map((w) => [
    csvCell(w.worker), csvCell(w.trade ?? ""),
    ...w.days.map((h) => n(h)),
    n(w.regular), n(w.overtime), n(w.rework), n(w.total_hours), w.pay.toFixed(2),
  ].join(","));
  const csv = [`Week ${week_start} to ${week_end}`, header.join(","), ...lines].join("\n");

  return json({ week_start, week_end, workers, csv });
});

const r2 = (x: number) => Math.round(x * 100) / 100;
const n = (x: number) => String(r2(x));
const csvCell = (s: string) => (/[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
