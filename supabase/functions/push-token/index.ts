import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// push-token — a native Field app instance registers (or clears) its Expo push
// token so incident alerts can reach site managers' phones. Gate: the caller
// must know their own worker_id (a client-generated uuid that only that
// worker's devices hold) — pilot-grade, same trust level as the rest of the
// worker surface.
//
// Body: { worker_id: uuid, token: string | null }
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
  const token = typeof body.token === "string" && body.token ? body.token : null;
  if (!worker_id) return json({ error: "worker_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("worker_registrations")
    .update({ expo_push_token: token })
    .eq("worker_id", worker_id)
    .select("worker_id")
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "unknown worker_id" }, 404);
  return json({ ok: true });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
