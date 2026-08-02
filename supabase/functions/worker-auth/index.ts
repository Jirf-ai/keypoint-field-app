import { createClient } from "jsr:@supabase/supabase-js@2";

// worker-auth — phone OTP verification + cross-device account login for the
// Field app. Companion to gc-account: workers register under a GC team code,
// and this function proves ownership of a phone number so a worker can restore
// their account on any device.
//
// Actions (body.action):
//   send-otp   { phone }
//     → { ok, sent, dev?, dev_code? }   (dev_code only when no SMS provider is
//       configured — internal/pilot mode, "bypass on our terms")
//   verify-otp { phone, code, worker?: { worker_id, display_name, role?,
//                trade?, gc_account_id?, device_id? } }
//     → { ok, verified, phone, accounts: [ { worker_id, display_name, role,
//        trade, gc_account_id, gc_code, gc_business } ] }
//       When `worker` is present (signup) the worker is registered/attached to
//       the phone as verified. `accounts` are the verified worker profiles on
//       this phone — the client restores one to log in on a new device.
//   roster     { gc_code }
//     → { ok, workers: [ { worker_id, display_name, role, trade } ] }
//       Everyone registered under the team code — the SM's pick-a-crew-member
//       list for record-for-someone-else (SM-14/SM-15: hard identity, no
//       spelling drift). Keyed to the semi-secret gc_code, the same
//       consent-bearing credential registration itself requires; phones are
//       never returned.
//   remember-project { worker_id, project_id }
//     → { ok }   Upserts field_worker_projects (last_used = now). The client
//       fires this on every project pick so the server remembers which
//       projects a worker is on — the drawer list used to be device-local
//       and vanished on wipe + phone restore (Jeffrey 2026-07-31).
//   my-projects { worker_id }
//     → { ok, projects: [ { id, name, status, last_used } ] }
//       Most-recent first. The restore path reseeds the drawer from this.
//   my-clock-events { worker_id }
//     → { ok, events: [ { clock_id, project_id, project_name, work_date,
//        event, starts, worker_id, worker_name, at, recorded_by, recorded_at } ] }
//       The worker's day-clock stamps from the last 7 days (server truth,
//       field_clock_events). The client merges these on launch and after a
//       phone restore so a wiped device does NOT reset a running punch-in —
//       the timer resumes from the original start stamp (Jeffrey 2026-08-01).
//   my-labor { worker_id }
//     → { ok, labor: [ { labor_id, project_id, project_name, work_date, trade,
//        worker_id, worker_name, hours, hour_type, hourly_rate, phase, area,
//        note, clock_id, recorded_by, recorded_at, version, supersedes } ] }
//       The worker's own labor lines from the last 14 days — "My hours" read
//       only device-local rows, so a wiped device (or hours recorded for the
//       worker elsewhere: SM device, manual re-entry) showed a 0.0 week while
//       the server held every row (Jeffrey 2026-08-02).
//
// Real SMS is a flip: set TWILIO_ACCOUNT_SID/AUTH_TOKEN/FROM secrets and the
// code is texted instead of returned. Codes are hashed at rest and expire.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OTP_TTL_MIN = 10;
const MAX_ATTEMPTS = 5;
const RESEND_GAP_SEC = 30;
const MAX_SENDS_PER_HOUR = 6;

const digits = (s: unknown) => String(s ?? "").replace(/\D/g, "");
function code6(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
}
async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sendSms(phone: string, code: string): Promise<void> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  const from = Deno.env.get("TWILIO_FROM");
  if (!sid || !token || !from) throw new Error("sms not configured");
  const body = new URLSearchParams({
    To: phone.startsWith("+") ? phone : `+1${phone}`,
    From: from,
    Body: `Your Kaicon Field code is ${code}`,
  });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${sid}:${token}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  if (!res.ok) throw new Error(`twilio ${res.status}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: "invalid JSON" }), { status: 400, headers: CORS });
  }
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const json = (o: unknown, status = 200) =>
    new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });

  const action = String(body.action ?? "");

  if (action === "send-otp") {
    const phone = digits(body.phone);
    if (phone.length < 10) return json({ ok: false, error: "a valid phone number is required" }, 400);

    const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
    const { data: recent } = await supabase.from("phone_otps")
      .select("created_at").eq("phone", phone).gte("created_at", hourAgo)
      .order("created_at", { ascending: false });
    if (recent && recent.length >= MAX_SENDS_PER_HOUR) {
      return json({ ok: false, error: "too many codes requested — wait a while and try again" }, 429);
    }
    if (recent && recent[0] && Date.now() - new Date(recent[0].created_at).getTime() < RESEND_GAP_SEC * 1000) {
      return json({ ok: false, error: "please wait a moment before requesting another code" }, 429);
    }

    const code = code6();
    const code_hash = await sha256(`${phone}:${code}`);
    const expires_at = new Date(Date.now() + OTP_TTL_MIN * 60_000).toISOString();
    const { error } = await supabase.from("phone_otps").insert({ phone, code_hash, expires_at });
    if (error) return json({ ok: false, error: `could not create code: ${error.message}` }, 500);

    const smsConfigured = !!Deno.env.get("TWILIO_ACCOUNT_SID");
    if (smsConfigured) {
      try { await sendSms(phone, code); } catch { return json({ ok: false, error: "could not send the text — try again" }, 502); }
      return json({ ok: true, sent: true });
    }
    // Dev / pilot: no SMS provider — hand the code back so the flow is testable.
    return json({ ok: true, sent: true, dev: true, dev_code: code });
  }

  if (action === "verify-otp") {
    const phone = digits(body.phone);
    const code = digits(body.code);
    if (phone.length < 10 || code.length !== 6) {
      return json({ ok: false, verified: false, error: "phone and a 6-digit code are required" }, 400);
    }
    const { data: rows } = await supabase.from("phone_otps")
      .select("*").eq("phone", phone).is("consumed_at", null)
      .order("created_at", { ascending: false }).limit(1);
    const otp = rows?.[0];
    if (!otp) return json({ ok: false, verified: false, error: "no active code — request a new one" }, 400);
    if (new Date(otp.expires_at).getTime() < Date.now()) {
      return json({ ok: false, verified: false, error: "that code expired — request a new one" }, 400);
    }
    if (otp.attempts >= MAX_ATTEMPTS) {
      return json({ ok: false, verified: false, error: "too many tries — request a new code" }, 429);
    }
    const code_hash = await sha256(`${phone}:${code}`);
    if (otp.code_hash !== code_hash) {
      await supabase.from("phone_otps").update({ attempts: otp.attempts + 1 }).eq("id", otp.id);
      return json({ ok: false, verified: false, error: "that code doesn't match — check it and try again" }, 400);
    }
    await supabase.from("phone_otps").update({ consumed_at: new Date().toISOString() }).eq("id", otp.id);

    // Signup: register/attach the worker to this (now verified) phone.
    const w = body.worker as Record<string, unknown> | undefined;
    if (w && w.worker_id && w.display_name) {
      await supabase.from("worker_registrations").upsert({
        worker_id: String(w.worker_id),
        display_name: String(w.display_name),
        phone,
        role: w.role ? String(w.role) : null,
        trade: w.trade ? String(w.trade) : null,
        device_id: w.device_id ? String(w.device_id) : null,
        gc_account_id: w.gc_account_id ? String(w.gc_account_id) : null,
        phone_verified: true,
      }, { onConflict: "worker_id" });
    }

    // Verified accounts on this phone → the client restores one to log in.
    const { data: regs } = await supabase.from("worker_registrations")
      .select("worker_id, display_name, role, trade, gc_account_id")
      .eq("phone", phone).eq("phone_verified", true);
    const gcIds = [...new Set((regs ?? []).map((r) => r.gc_account_id).filter(Boolean))];
    const gcMap: Record<string, { gc_code: string; business_name: string }> = {};
    if (gcIds.length) {
      const { data: gcs } = await supabase.from("gc_accounts")
        .select("id, gc_code, business_name").in("id", gcIds);
      for (const g of gcs ?? []) gcMap[g.id] = { gc_code: g.gc_code, business_name: g.business_name };
    }
    const accounts = (regs ?? []).map((r) => ({
      worker_id: r.worker_id,
      display_name: r.display_name,
      role: r.role,
      trade: r.trade,
      gc_account_id: r.gc_account_id,
      gc_code: r.gc_account_id ? gcMap[r.gc_account_id]?.gc_code ?? null : null,
      gc_business: r.gc_account_id ? gcMap[r.gc_account_id]?.business_name ?? null : null,
    }));

    // GC owner? If this phone is a registered GC's business phone, hand back the
    // contractor account so one phone login restores the GC session too — no
    // separate "GC log in". (Pilot-scale scan + digit match; gc_accounts.phone
    // may be formatted, so it's compared on digits.)
    let gc = null;
    const { data: gcs } = await supabase.from("gc_accounts")
      .select("id, gc_code, business_name, contact_name, phone, email")
      .eq("status", "active");
    const gcMatch = (gcs ?? []).find((g) => digits(g.phone) === phone);
    if (gcMatch) {
      gc = {
        gc_account_id: gcMatch.id,
        gc_code: gcMatch.gc_code,
        business_name: gcMatch.business_name,
        phone: gcMatch.phone,
        email: gcMatch.email,
      };
    }

    return json({ ok: true, verified: true, phone, accounts, gc });
  }

  if (action === "roster") {
    // Punctuation-blind: crew-facing codes are typed letters/numbers only —
    // "GAUYGK6" and "GAU-YGK6" both resolve (pilot-scale scan).
    const bare = String(body.gc_code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!bare) return json({ ok: false, error: "gc_code is required" }, 400);
    const { data: gcs } = await supabase.from("gc_accounts")
      .select("id, gc_code").eq("status", "active");
    const gc = (gcs ?? []).find((g) => String(g.gc_code).toUpperCase().replace(/[^A-Z0-9]/g, "") === bare);
    if (!gc) return json({ ok: false, error: "unknown team code" }, 404);
    const { data: regs } = await supabase.from("worker_registrations")
      .select("worker_id, display_name, role, trade")
      .eq("gc_account_id", gc.id).eq("phone_verified", true)
      .order("display_name");
    return json({ ok: true, workers: regs ?? [] });
  }

  if (action === "remember-project") {
    const worker_id = String(body.worker_id ?? "").trim();
    const project_id = String(body.project_id ?? "").trim();
    if (!worker_id || !/^[0-9a-f-]{36}$/i.test(project_id)) {
      return json({ ok: false, error: "worker_id and a project uuid are required" }, 400);
    }
    const { error } = await supabase.from("field_worker_projects").upsert(
      { worker_id, project_id, last_used: new Date().toISOString() },
      { onConflict: "worker_id,project_id" },
    );
    // A bad project_id (not in Records) just doesn't stick — the client
    // fires-and-forgets, so surface nothing scary.
    if (error) return json({ ok: false, error: error.message }, 400);
    return json({ ok: true });
  }

  if (action === "my-projects") {
    const worker_id = String(body.worker_id ?? "").trim();
    if (!worker_id) return json({ ok: false, error: "worker_id is required" }, 400);
    const { data: rows } = await supabase.from("field_worker_projects")
      .select("project_id, last_used, projects ( id, name, status )")
      .eq("worker_id", worker_id)
      .order("last_used", { ascending: false })
      .limit(20);
    const projects = (rows ?? [])
      .map((r) => {
        const p = r.projects as { id: string; name: string; status: string | null } | null;
        return p ? { id: p.id, name: p.name, status: p.status ?? null, last_used: r.last_used } : null;
      })
      .filter(Boolean);
    return json({ ok: true, projects });
  }

  if (action === "my-clock-events") {
    const worker_id = String(body.worker_id ?? "").trim();
    if (!worker_id) return json({ ok: false, error: "worker_id is required" }, 400);
    // 7-day window: covers any storage-loss + restore gap; a start left open
    // longer than that is the overdue flow's problem, not rehydration's.
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    const { data: evs, error } = await supabase.from("field_clock_events")
      .select("clock_id, project_id, work_date, event, starts, worker_id, worker_name, at, recorded_by, recorded_at")
      .eq("worker_id", worker_id)
      .gte("work_date", since)
      .order("at", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    const pids = [...new Set((evs ?? []).map((e) => e.project_id).filter(Boolean))];
    const names: Record<string, string> = {};
    if (pids.length) {
      const { data: ps } = await supabase.from("projects").select("id, name").in("id", pids);
      for (const p of ps ?? []) names[p.id] = p.name;
    }
    const events = (evs ?? []).map((e) => ({ ...e, project_name: e.project_id ? names[e.project_id] ?? null : null }));
    return json({ ok: true, events });
  }

  if (action === "my-labor") {
    const worker_id = String(body.worker_id ?? "").trim();
    if (!worker_id) return json({ ok: false, error: "worker_id is required" }, 400);
    // 14-day window: covers the current + previous pay week.
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
    const { data: rows, error } = await supabase.from("field_labor_entries")
      .select("labor_id, project_id, work_date, trade, worker_id, worker_name, hours, hour_type, hourly_rate, phase, area, note, clock_id, recorded_by, recorded_at, version, supersedes")
      .eq("worker_id", worker_id)
      .gte("work_date", since)
      .order("recorded_at", { ascending: true });
    if (error) return json({ ok: false, error: error.message }, 500);
    const pids = [...new Set((rows ?? []).map((r) => r.project_id).filter(Boolean))];
    const names: Record<string, string> = {};
    if (pids.length) {
      const { data: ps } = await supabase.from("projects").select("id, name").in("id", pids);
      for (const p of ps ?? []) names[p.id] = p.name;
    }
    const labor = (rows ?? []).map((r) => ({ ...r, project_name: r.project_id ? names[r.project_id] ?? null : null }));
    return json({ ok: true, labor });
  }

  return json({ error: "action must be send-otp | verify-otp | roster | remember-project | my-projects | my-clock-events | my-labor" }, 400);
});
