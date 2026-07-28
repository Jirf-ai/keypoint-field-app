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

    return json({ ok: true, verified: true, phone, accounts });
  }

  return json({ error: "action must be send-otp | verify-otp" }, 400);
});
