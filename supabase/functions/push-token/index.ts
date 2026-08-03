import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// push-token — a Field app instance registers (or clears) its push channel so
// alerts can reach the worker's phone. Gate: the caller must know their own
// worker_id (a client-generated uuid that only that worker's devices hold) —
// pilot-grade, same trust level as the rest of the worker surface.
//
// v2 (2026-08-03) adds the web-PWA channel alongside the native Expo one:
//   { worker_id, token: string | null }                → Expo token (native, v1 shape)
//   { worker_id, web_push: { endpoint, keys: { p256dh, auth } } }
//                                                      → subscribe this browser
//   { worker_id, web_push_remove: endpoint }           → unsubscribe it
// A worker may hold several web subscriptions (their phone + a spare) — rows
// key on the endpoint, which is unique per browser+site by construction.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const worker_id = typeof body.worker_id === "string" ? body.worker_id : "";
  if (!worker_id) return json({ error: "worker_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // The worker must exist regardless of channel — same 404 the v1 shape gave.
  const { data: reg, error: regErr } = await supabase
    .from("worker_registrations")
    .select("worker_id")
    .eq("worker_id", worker_id)
    .maybeSingle();
  if (regErr) return json({ error: regErr.message }, 500);
  if (!reg) return json({ error: "unknown worker_id" }, 404);

  // -- web push subscribe -----------------------------------------------
  const wp = body.web_push as Record<string, unknown> | undefined;
  if (wp && typeof wp === "object") {
    const endpoint = str(wp.endpoint);
    const keys = wp.keys as Record<string, unknown> | undefined;
    const p256dh = str(keys?.p256dh);
    const auth = str(keys?.auth);
    if (!endpoint?.startsWith("https://") || !p256dh || !auth) {
      return json({ error: "web_push needs { endpoint(https), keys: { p256dh, auth } }" }, 400);
    }
    const { error } = await supabase.from("worker_push_subscriptions").upsert(
      { endpoint, worker_id, p256dh, auth, updated_at: new Date().toISOString() },
      { onConflict: "endpoint" },
    );
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, channel: "webpush" });
  }

  // -- web push unsubscribe ---------------------------------------------
  const remove = str(body.web_push_remove);
  if (remove) {
    const { error } = await supabase.from("worker_push_subscriptions")
      .delete()
      .eq("endpoint", remove)
      .eq("worker_id", worker_id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true, channel: "webpush", removed: true });
  }

  // -- Expo token (v1 shape, unchanged) ---------------------------------
  const token = typeof body.token === "string" && body.token ? body.token : null;
  const { error } = await supabase
    .from("worker_registrations")
    .update({ expo_push_token: token })
    .eq("worker_id", worker_id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, channel: "expo" });
});

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
