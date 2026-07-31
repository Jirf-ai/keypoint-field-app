import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// photo-extract — what the classifier read off one receipt photo, for the
// SM's item form to prefill vendor / invoice / cost. Gate: knowledge of the
// photo_id (client-generated uuid held by the capturing team's devices) —
// pilot-grade, and the payload is a receipt's own fields, nothing more.
//
// Body: { photo_id: uuid }
// Response: { photo_kind, vendor, total, invoice, scanned: bool }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, 400);
  }
  const photo_id = typeof body.photo_id === "string" ? body.photo_id : "";
  if (!photo_id) return json({ error: "photo_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("field_photos")
    .select("photo_kind, receipt_vendor, receipt_total, receipt_invoice, receipt_scanned_at")
    .eq("photo_id", photo_id)
    .maybeSingle();
  if (error) return json({ error: error.message }, 500);
  if (!data) return json({ error: "unknown photo_id" }, 404);

  return json({
    photo_kind: data.photo_kind,
    vendor: data.receipt_vendor,
    total: data.receipt_total,
    invoice: data.receipt_invoice,
    scanned: data.receipt_scanned_at != null,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
