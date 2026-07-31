import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// classify-photos — back-fills field_photos.photo_kind on photos the crew
// didn't tag (NULL = pre-feature rows and skipped toggles). A receipt is
// visually unmistakable, so a single cheap vision call per photo settles it;
// crew-set values are never touched (query filters photo_kind IS NULL).
//
// Body: { limit?: number (default 10, max 25) }
// Response: { classified: [{photo_id, photo_kind}], skipped: [{photo_id, reason}],
//             remaining: number }
//
// Needs the ANTHROPIC_API_KEY secret on the project; returns a clear error
// when it's missing. Designed to be invoked on a schedule (pg_cron) or
// manually — idempotent either way, since classified rows leave the queue.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY secret not set on this project" }, 500);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch { /* empty body is fine */ }
  const limit = Math.min(Math.max(Number(body.limit) || 10, 1), 25);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const anthropic = new Anthropic({ apiKey });

  const { data: photos, error: qErr } = await supabase
    .from("field_photos")
    .select("photo_id, storage_path")
    .is("photo_kind", null)
    .is("deleted_at", null)
    .not("storage_path", "is", null)
    .limit(limit);
  if (qErr) return json({ error: qErr.message }, 500);

  const classified: { photo_id: string; photo_kind: string }[] = [];
  const skipped: { photo_id: string; reason: string }[] = [];

  for (const p of photos ?? []) {
    const { data: file, error: dlErr } = await supabase.storage
      .from("field-photos")
      .download(p.storage_path);
    if (dlErr || !file) {
      skipped.push({ photo_id: p.photo_id, reason: `download: ${dlErr?.message ?? "no file"}` });
      continue;
    }
    const b64 = encodeBase64(await file.arrayBuffer());

    try {
      // Haiku: a receipt-vs-jobsite call is trivial classification — the cheap
      // tier is the deliberate choice here, per the feature plan.
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 128,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            {
              type: "text",
              text: "This photo was taken by a construction crew. Classify it: " +
                "'receipt' if it shows a purchase receipt, invoice, or similar paper record " +
                "(store receipt, delivery ticket, packing slip); 'work' for anything else " +
                "(jobsite conditions, work in progress, materials in place, people, equipment).",
            },
          ],
        }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { kind: { type: "string", enum: ["work", "receipt"] } },
              required: ["kind"],
              additionalProperties: false,
            },
          },
        },
      });
      if (response.stop_reason !== "end_turn") {
        skipped.push({ photo_id: p.photo_id, reason: `stop_reason: ${response.stop_reason}` });
        continue;
      }
      const text = response.content.find((b) => b.type === "text");
      const kind = text ? (JSON.parse(text.text) as { kind: string }).kind : null;
      if (kind !== "work" && kind !== "receipt") {
        skipped.push({ photo_id: p.photo_id, reason: "no classification in response" });
        continue;
      }
      const { error: upErr } = await supabase
        .from("field_photos")
        .update({ photo_kind: kind })
        .eq("photo_id", p.photo_id)
        .is("photo_kind", null); // never overwrite a crew tag that raced in
      if (upErr) skipped.push({ photo_id: p.photo_id, reason: upErr.message });
      else classified.push({ photo_id: p.photo_id, photo_kind: kind });
    } catch (e) {
      skipped.push({ photo_id: p.photo_id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  const { count } = await supabase
    .from("field_photos")
    .select("photo_id", { count: "exact", head: true })
    .is("photo_kind", null)
    .is("deleted_at", null)
    .not("storage_path", "is", null);

  return json({ classified, skipped, remaining: count ?? 0 });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
