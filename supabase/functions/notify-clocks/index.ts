// notify-clocks — the server-side clock watcher (2026-08-03). pg_cron invokes
// this every minute; it reads field_clock_events (server truth — synced by
// the app) and pushes the two time-critical nudges the web PWA cannot
// schedule locally:
//
//   ot8     8h00–8h05, overtime NOT confirmed → "confirm in the app within
//           5 minutes or your day will be closed" (the client caps the
//           payable span at 8h05 — store.clockCap — this is the warning,
//           the cap is the teeth)
//   still12 12h, overtime confirmed → "still working?" (only a confirmed-OT
//           clock can legitimately still be running at 12h)
//
// Confirmations arrive as append-only 'ot_confirm' clock events riding the
// normal sync spine (starts = the start stamp's clock_id). Delivery fans out
// to BOTH channels a worker may have: Web Push subscriptions (PWA, VAPID —
// see ./webpush.js, RFC-vector-tested) and Expo push tokens (native builds).
// One-shot per (clock_id, kind): field_push_log's primary key is the dedupe —
// the row is claimed BEFORE sending, so a crashed run never double-notifies.
//
// Gate: x-cron-key header must equal the CRON_KEY secret (the cron SQL and
// the function share it; the anon key alone must not be able to spam crews).
import { createClient } from "jsr:@supabase/supabase-js@2";
import { sendWebPush } from "./webpush.js";

const OT_AFTER_MIN = 8 * 60;   // CLOCK_POLICY.overtimeAfterHours
const OT_GRACE_MIN = 5;        // CLOCK_POLICY.otConfirmGraceMinutes
const STILL_AT_MIN = 12 * 60;  // CLOCK_POLICY.stillWorkingCheckHours
const STILL_WINDOW_MIN = 15;   // one-shot anyway; window only bounds catch-up

// Crew is en/es mixed and the registration row carries no language — one
// bilingual line beats guessing (matches the printed install card style).
const MESSAGES = {
  ot8: {
    title: "Confirm overtime · Confirme horas extra",
    body: "8 hours on the clock. Confirm overtime in the app within 5 minutes or your day will be closed. · Lleva 8 horas en turno. Confirme en la app en 5 minutos o su día se cerrará.",
    ttl: 5 * 60, // stale after the grace window — never deliver it late
  },
  still12: {
    title: "Still working? · ¿Sigue trabajando?",
    body: "You have been on the clock for 12 hours. End your day in the app if you are done. · Lleva 12 horas en turno. Si ya terminó, termine su día en la app.",
    ttl: 60 * 60,
  },
};

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const cronKey = Deno.env.get("CRON_KEY") ?? "";
  if (!cronKey || req.headers.get("x-cron-key") !== cronKey) {
    return json({ error: "forbidden" }, 403);
  }
  const vapid = loadVapid();
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Two work-dates of events covers any overnight clock still in play.
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const { data: evs, error } = await supabase.from("field_clock_events")
    .select("clock_id, event, starts, worker_id, at")
    .gte("work_date", since);
  if (error) return json({ error: error.message }, 500);

  const ended = new Set<string>();
  const confirmed = new Set<string>();
  for (const e of evs ?? []) {
    if (e.event === "end" && e.starts) ended.add(e.starts);
    if (e.event === "ot_confirm" && e.starts) confirmed.add(e.starts);
  }

  const due: { clock_id: string; worker_id: string; kind: "ot8" | "still12" }[] = [];
  for (const e of evs ?? []) {
    if (e.event !== "start" || ended.has(e.clock_id) || !e.worker_id) continue;
    const mins = (Date.now() - new Date(e.at).getTime()) / 60_000;
    if (!confirmed.has(e.clock_id)) {
      // Past the grace the client has already capped the day — a late
      // "5 minutes" warning would be a lie, so the window is hard.
      if (mins >= OT_AFTER_MIN && mins < OT_AFTER_MIN + OT_GRACE_MIN) {
        due.push({ clock_id: e.clock_id, worker_id: e.worker_id, kind: "ot8" });
      }
    } else if (mins >= STILL_AT_MIN && mins < STILL_AT_MIN + STILL_WINDOW_MIN) {
      due.push({ clock_id: e.clock_id, worker_id: e.worker_id, kind: "still12" });
    }
  }
  if (!due.length) return json({ ok: true, sent: 0 });

  let sent = 0;
  const results: Record<string, unknown>[] = [];
  for (const d of due) {
    // Claim before send: the PK is the one-shot guarantee.
    const { data: claim, error: claimErr } = await supabase.from("field_push_log")
      .upsert(
        { clock_id: d.clock_id, kind: d.kind, sent_at: new Date().toISOString() },
        { onConflict: "clock_id,kind", ignoreDuplicates: true },
      )
      .select("clock_id");
    if (claimErr || !claim?.length) continue; // already sent (or race lost)

    const msg = MESSAGES[d.kind];
    const delivered: string[] = [];

    // Channel 1 — Web Push (the PWA). Dead subscriptions are pruned.
    if (vapid) {
      const { data: subs } = await supabase.from("worker_push_subscriptions")
        .select("endpoint, p256dh, auth")
        .eq("worker_id", d.worker_id);
      for (const s of subs ?? []) {
        try {
          const status = await sendWebPush(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            { title: msg.title, body: msg.body, tag: `kaicon-${d.kind}` },
            vapid,
            { ttl: msg.ttl },
          );
          if (status === 404 || status === 410) {
            await supabase.from("worker_push_subscriptions").delete().eq("endpoint", s.endpoint);
          } else if (status >= 200 && status < 300) {
            delivered.push("webpush");
          }
        } catch { /* push service unreachable — expo may still land */ }
      }
    }

    // Channel 2 — Expo push (native installs; same shape sync-field-log v8 sends).
    const { data: reg } = await supabase.from("worker_registrations")
      .select("expo_push_token")
      .eq("worker_id", d.worker_id)
      .maybeSingle();
    if (reg?.expo_push_token) {
      try {
        const r = await fetch("https://exp.host/--/api/v2/push/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: reg.expo_push_token,
            title: msg.title,
            body: msg.body,
            priority: "high",
          }),
        });
        await r.arrayBuffer().catch(() => {});
        if (r.ok) delivered.push("expo");
      } catch { /* best-effort */ }
    }

    sent++;
    results.push({ clock_id: d.clock_id, kind: d.kind, delivered });
  }
  return json({ ok: true, sent, results });
});

function loadVapid() {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateRaw = Deno.env.get("VAPID_PRIVATE_JWK");
  const subject = Deno.env.get("VAPID_SUBJECT") ?? "mailto:ops@jirf.ai";
  if (!publicKey || !privateRaw) return null; // web push silently off until keys land
  try {
    return { subject, publicKey, privateJwk: JSON.parse(privateRaw) };
  } catch {
    return null;
  }
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
