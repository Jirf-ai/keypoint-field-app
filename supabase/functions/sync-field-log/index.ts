import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// sync-field-log — Operations engine sync endpoint for the Kaicon Field app.
// The app's offline store pushes its unsynced rows here; everything lands on
// the one spine (field_daily_logs / field_line_items / field_labor_entries /
// field_photos / field_change_orders — note the daily-log table is
// field_daily_logs; plain field_logs is the legacy video-log table).
//
// Idempotent by construction: PKs are client-generated UUIDs and rows are
// append-only, so re-sending is a no-op (ignoreDuplicates). Rows are written
// one at a time on purpose — a bad row (CHECK/FK violation) fails alone and
// is reported back; the rest of the batch still lands. The client marks
// synced_at only for ids echoed in `synced` and retries the rest later.
//
// Body: {
//   project_id: uuid (Records project — REQUIRED),
//   days?:   [{ work_date, status?, submitted_at?, submitted_by?, note? }],
//   items?:  [line rows, client shape from store.js (kind stripped ok)],
//   labor?:  [labor rows; client `line_id` becomes labor_id, `worker` → worker_name],
//   incidents?: [incident/near-miss rows (SF-02); written BEFORE photos so a
//            photo's incident_id FK resolves in the same round],
//   clock_events?: [day-clock start/end stamps; client `worker` → worker_name],
//   photos?: [{ ...meta, b64? }] — b64 (data URI or raw base64) uploads to the
//            'field-photos' bucket at {project_id}/{photo_id}-{filename};
//            metadata-only rows sync with storage_path null and can re-send
//            b64 later,
//   change_orders?: [co rows]
// }
// Response: { synced: {days,items,labor,incidents,photos,change_orders}, failed: [{kind,id,error}] }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const project_id = typeof body.project_id === "string" ? body.project_id : "";
  if (!project_id) return json({ error: "project_id required" }, 400);

  const days = arr(body.days), items = arr(body.items), labor = arr(body.labor);
  const photos = arr(body.photos), change_orders = arr(body.change_orders);
  const incidents = arr(body.incidents);
  const clock_events = arr(body.clock_events);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const now = new Date().toISOString();
  const synced = { days: [] as string[], items: [] as string[], labor: [] as string[], incidents: [] as string[], photos: [] as string[], change_orders: [] as string[], clock_events: [] as string[] };
  const failed: { kind: string; id: string; error: string }[] = [];

  // 1. Daily logs — one row per (project, work_date) for every date seen in the
  //    payload, so line/photo FKs always have a log to point at. Explicit `days`
  //    entries also carry submit status (upsert merges — status transitions
  //    draft→submitted→amended come from the client, the single writer per day).
  const dates = new Set<string>();
  for (const r of [...items, ...labor, ...incidents, ...photos, ...clock_events]) if (typeof r.work_date === "string") dates.add(r.work_date);
  const dayByDate = new Map<string, Record<string, unknown>>();
  for (const d of days) if (typeof d.work_date === "string") { dates.add(d.work_date); dayByDate.set(d.work_date, d); }

  const logIds = new Map<string, string>(); // work_date -> log_id
  for (const work_date of dates) {
    const d = dayByDate.get(work_date) ?? {};
    const row: Record<string, unknown> = { project_id, work_date, synced_at: now };
    if (d.status != null) row.status = d.status;
    if (d.submitted_at != null) row.submitted_at = d.submitted_at;
    if (d.submitted_by != null) row.submitted_by = d.submitted_by;
    if (d.note != null) row.note = d.note;
    const { data, error } = await supabase
      .from("field_daily_logs")
      .upsert(row, { onConflict: "project_id,work_date" })
      .select("log_id")
      .single();
    if (error || !data) {
      failed.push({ kind: "day", id: work_date, error: error?.message ?? "no row" });
      continue;
    }
    logIds.set(work_date, data.log_id as string);
    if (dayByDate.has(work_date)) synced.days.push(work_date);
  }

  // 2. Line items (M/F/E/S).
  for (const r of items) {
    const id = str(r.line_id);
    if (!id) { failed.push({ kind: "item", id: "?", error: "line_id missing" }); continue; }
    const row = {
      line_id: id,
      log_id: logIds.get(str(r.work_date)) ?? null,
      project_id,
      ...pick(r, ["work_date", "cost_class", "sku_code", "description", "phase", "area",
        "qty", "unit", "unit_cost", "qty_is_estimated", "vendor", "invoice_ref", "co_ref",
        "waste_qty", "gps_lat", "gps_lng", "recorded_by", "recorded_at", "captured_offline",
        "version", "supersedes", "note"]),
      synced_at: now,
    };
    const { error } = await supabase.from("field_line_items").upsert(row, { onConflict: "line_id", ignoreDuplicates: true });
    if (error) failed.push({ kind: "item", id, error: error.message });
    else synced.items.push(id);
  }

  // 3. Labor. The client stores labor in the same `lines` array with line_id;
  //    that uuid IS labor_id here (supersedes chains stay consistent).
  for (const r of labor) {
    const id = str(r.labor_id) || str(r.line_id);
    if (!id) { failed.push({ kind: "labor", id: "?", error: "labor_id missing" }); continue; }
    const row = {
      labor_id: id,
      log_id: logIds.get(str(r.work_date)) ?? null,
      project_id,
      worker_name: r.worker_name ?? r.worker ?? null,
      ...pick(r, ["work_date", "trade", "worker_id", "phase", "area", "hours", "hour_type",
        "hourly_rate", "co_ref", "recorded_by", "recorded_at", "captured_offline",
        "version", "supersedes", "note"]),
      synced_at: now,
    };
    const { error } = await supabase.from("field_labor_entries").upsert(row, { onConflict: "labor_id", ignoreDuplicates: true });
    if (error) failed.push({ kind: "labor", id, error: error.message });
    else synced.labor.push(id);
  }

  // 4. Incidents / near-misses (SF-02). Any role can file one, so these are not
  //    gated on the site manager's day. Written before photos so an incident's
  //    photo can carry its incident_id on the very next chunk. Append-only like
  //    every other row: a correction arrives as a new id with `supersedes` set.
  for (const r of incidents) {
    const id = str(r.incident_id);
    if (!id) { failed.push({ kind: "incident", id: "?", error: "incident_id missing" }); continue; }
    const row = {
      incident_id: id,
      log_id: logIds.get(str(r.work_date)) ?? null,
      project_id,
      ...pick(r, ["work_date", "incident_type", "description", "occurred_at", "gps_lat",
        "gps_lng", "phase", "area", "reported_by", "reporter_worker_id", "recorded_by",
        "recorded_at", "captured_offline", "version", "supersedes", "note"]),
      synced_at: now,
    };
    // .select() distinguishes a fresh insert (row echoed) from an ignored
    // duplicate (empty) — a re-synced incident must never re-ping the SMs.
    const { data: inserted, error } = await supabase.from("field_incidents")
      .upsert(row, { onConflict: "incident_id", ignoreDuplicates: true })
      .select("incident_id");
    if (error) failed.push({ kind: "incident", id, error: error.message });
    else {
      synced.incidents.push(id);
      if (inserted?.length) await pushIncidentAlert(supabase, r);
    }
  }

  // 4b. Day-clock stamps (start/end) — the attendance evidence behind
  //     clock-sourced hours. Append-only; a start stamp survives even if the
  //     day is never confirmed into labor lines.
  for (const r of clock_events) {
    const id = str(r.clock_id);
    if (!id) { failed.push({ kind: "clock_event", id: "?", error: "clock_id missing" }); continue; }
    const row = {
      clock_id: id,
      log_id: logIds.get(str(r.work_date)) ?? null,
      project_id,
      worker_name: r.worker_name ?? r.worker ?? null,
      ...pick(r, ["work_date", "event", "starts", "worker_id", "at", "gps_lat", "gps_lng",
        "recorded_by", "recorded_at", "captured_offline", "version", "supersedes"]),
      synced_at: now,
    };
    const { error } = await supabase.from("field_clock_events").upsert(row, { onConflict: "clock_id", ignoreDuplicates: true });
    if (error) failed.push({ kind: "clock_event", id, error: error.message });
    else synced.clock_events.push(id);
  }

  // 5. Photos — binary (when sent) goes to storage first; the row then carries
  //    storage_path. Metadata rows are merge-upserted (NOT ignoreDuplicates) so
  //    a later re-send with b64 fills storage_path on the existing row.
  for (const r of photos) {
    const id = str(r.photo_id);
    if (!id) { failed.push({ kind: "photo", id: "?", error: "photo_id missing" }); continue; }
    // Tombstone (v5, additive): the worker deleted a mistake shot. The pixels
    // go — storage object removed, row keeps its stamps with deleted_at set
    // (append-only audit trail, but the photo leaves every surface). A photo
    // that never synced has no row here; ack it so the client stops sending.
    if (r.deleted) {
      const { data: ex } = await supabase.from("field_photos")
        .select("storage_path").eq("photo_id", id).maybeSingle();
      if (ex) {
        if (ex.storage_path) {
          await supabase.storage.from("field-photos").remove([ex.storage_path]).catch(() => {});
        }
        const { error } = await supabase.from("field_photos")
          .update({ deleted_at: now, storage_path: null, line_id: null, incident_id: null })
          .eq("photo_id", id);
        if (error) { failed.push({ kind: "photo", id, error: error.message }); continue; }
      }
      synced.photos.push(id);
      continue;
    }
    let storage_path: string | null = null;
    let uploaded_at: string | null = null;
    let file_size_bytes: number | null = null;
    const b64raw = str(r.b64);
    if (b64raw) {
      try {
        const b64 = b64raw.includes(",") ? b64raw.slice(b64raw.indexOf(",") + 1) : b64raw;
        if (b64.length > 16_000_000) throw new Error("photo over ~12MB — recapture at lower quality");
        const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        // Path is keyed on photo_id: filenames are per-device sequential
        // (1257-INS-20260731-001.jpg), so two phones on the same project/day
        // generate identical names and upsert would overwrite each other's
        // pixels (lost the 07-31 pilot receipts). photo_id is client-unique
        // and stable across re-sends, so retries still land on their own path.
        const path = `${project_id}/${id}-${str(r.filename) || "photo.jpg"}`;
        const { error: upErr } = await supabase.storage
          .from("field-photos")
          .upload(path, bin, { contentType: "image/jpeg", upsert: true });
        if (upErr) throw new Error(upErr.message);
        storage_path = path;
        uploaded_at = now;
        file_size_bytes = bin.byteLength;
      } catch (e) {
        failed.push({ kind: "photo", id, error: `upload: ${e instanceof Error ? e.message : String(e)}` });
        continue; // don't mark synced — client re-sends binary next round
      }
    }
    const row: Record<string, unknown> = {
      photo_id: id,
      log_id: logIds.get(str(r.work_date)) ?? null,
      project_id,
      // photo_kind (v6, additive): 'work' | 'receipt' — the crew's one-tap
      // separation of jobsite evidence from the paper trail.
      ...pick(r, ["work_date", "line_id", "incident_id", "filename", "captured_at", "gps_lat",
        "gps_lng", "phase", "area", "caption", "photo_kind", "recorded_by"]),
    };
    if (storage_path) {
      row.storage_path = storage_path;
      row.uploaded_at = uploaded_at;
      row.file_size_bytes = file_size_bytes;
    }
    let { error } = await supabase.from("field_photos").upsert(row, { onConflict: "photo_id" });
    // line_id points at field_line_items only; a photo attached to a LABOR line
    // (or a line that hasn't synced yet) fails that FK. Sync it unlinked rather
    // than strand it — if the line lands later, the client's re-send after
    // linkPhoto() merge-updates line_id.
    if (error && error.message.includes("line_id_fkey")) {
      row.line_id = null;
      ({ error } = await supabase.from("field_photos").upsert(row, { onConflict: "photo_id" }));
    }
    // Same rescue for an incident photo whose incident hasn't landed yet (the
    // incident failed this round, or the photo chunk raced ahead of it): sync
    // the pixels unlinked rather than strand them, and let the client's next
    // send merge incident_id in.
    if (error && error.message.includes("incident_id_fkey")) {
      row.incident_id = null;
      ({ error } = await supabase.from("field_photos").upsert(row, { onConflict: "photo_id" }));
    }
    if (error) failed.push({ kind: "photo", id, error: error.message });
    else synced.photos.push(id);
  }

  // 6. Change orders. unique(project_id, co_no) means two devices minting the
  //    same CO number collide — that row fails and stays pending client-side
  //    (pilot has one site manager; revisit numbering for multi-SM).
  for (const r of change_orders) {
    const id = str(r.co_id);
    if (!id) { failed.push({ kind: "change_order", id: "?", error: "co_id missing" }); continue; }
    const row = {
      co_id: id,
      project_id,
      ...pick(r, ["co_no", "date", "description", "reason", "cost_class", "amount",
        "schedule_impact_days", "approved_by", "status", "recorded_by", "note"]),
      synced_at: now,
    };
    const { error } = await supabase.from("field_change_orders").upsert(row, { onConflict: "co_id", ignoreDuplicates: true });
    if (error) failed.push({ kind: "change_order", id, error: error.message });
    else synced.change_orders.push(id);
  }

  return json({ synced, failed, synced_at: now });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function arr(v: unknown): Record<string, unknown>[] {
  return Array.isArray(v) ? v.filter((x) => x && typeof x === "object") : [];
}

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

// Whitelist copy — client rows carry local-only fields (kind, project_name,
// superseded_by, uri…) that must not reach the insert.
function pick(r: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (r[k] !== undefined) out[k] = r[k];
  return out;
}

// Incident push (v8): a safety report should ping the reporter's team site
// managers the moment it lands — not wait for them to open the app. Tokens
// come from worker_registrations.expo_push_token (native installs only).
// Fire-and-forget in spirit: any failure here must never fail the sync.
// deno-lint-ignore no-explicit-any
async function pushIncidentAlert(supabase: any, r: Record<string, unknown>) {
  try {
    const reporterId = str(r.reporter_worker_id);
    if (!reporterId) return;
    const { data: reporter } = await supabase.from("worker_registrations")
      .select("gc_account_id").eq("worker_id", reporterId).maybeSingle();
    if (!reporter?.gc_account_id) return;
    const { data: sms } = await supabase.from("worker_registrations")
      .select("expo_push_token")
      .eq("gc_account_id", reporter.gc_account_id)
      .eq("role", "site_manager")
      .neq("worker_id", reporterId)
      .not("expo_push_token", "is", null);
    const tokens = (sms ?? []).map((w: { expo_push_token: string | null }) => w.expo_push_token).filter(Boolean);
    if (!tokens.length) return;
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(tokens.map((to: string) => ({
        to,
        title: "Incident reported",
        body: `${str(r.reported_by) || "A worker"}: ${str(r.description).slice(0, 120)}`,
        priority: "high",
      }))),
    });
  } catch { /* push problems never fail a sync */ }
}
