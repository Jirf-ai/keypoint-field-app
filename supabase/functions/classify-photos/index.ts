import { createClient } from "jsr:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding/base64";
import Anthropic from "npm:@anthropic-ai/sdk";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// classify-photos — one vision pass per photo does two jobs:
//   1. back-fill field_photos.photo_kind where the crew didn't tag (NULL),
//   2. read receipts — vendor, total, invoice # — into the receipt_* columns
//      (v2), so the SM's item form can prefill the paper trail.
// Crew-set photo_kind is never overwritten; crew-tagged receipts still get
// the extraction pass (queued until receipt_scanned_at is stamped — stamped
// even when nothing was readable, so unreadable receipts leave the queue).
//
// Body: { limit?: number (default 10, max 25) }
// Response: { classified: [{photo_id, photo_kind, vendor?, total?, invoice?}],
//             skipped: [{photo_id, reason}], remaining: number }
//
// Needs the ANTHROPIC_API_KEY secret; errors clearly when missing. Invoked
// hourly by pg_cron (job classify-photos-hourly) — idempotent.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return new Response("POST only", { status: 405, headers: CORS_HEADERS });

  // `claude` is the name the Anthropic key has carried on this project since
  // before this function existed; accept it so the classifier runs either way.
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY") ?? Deno.env.get("claude");
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

  const QUEUE = "photo_kind.is.null,and(photo_kind.eq.receipt,receipt_scanned_at.is.null)";
  const { data: photos, error: qErr } = await supabase
    .from("field_photos")
    .select("photo_id, storage_path, photo_kind")
    .or(QUEUE)
    .is("deleted_at", null)
    .not("storage_path", "is", null)
    .limit(limit);
  if (qErr) return json({ error: qErr.message }, 500);

  const classified: Record<string, unknown>[] = [];
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
      // Haiku: classify + read in one call — receipt-vs-jobsite is trivial,
      // and receipt text extraction is well within its vision range.
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 256,
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            {
              type: "text",
              text: "This photo was taken by a construction crew. Classify it: " +
                "'receipt' if it shows a purchase receipt, invoice, or similar paper record " +
                "(store receipt, delivery ticket, packing slip); 'work' for anything else " +
                "(jobsite conditions, work in progress, materials in place, people, equipment). " +
                "If it is a receipt, also read off it: the vendor/store name, the final total " +
                "amount, and the invoice/receipt number. Use an empty string (or 0 for the " +
                "total) for anything you cannot read confidently.",
            },
          ],
        }],
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                kind: { type: "string", enum: ["work", "receipt"] },
                vendor: { type: "string" },
                total: { type: "number" },
                invoice: { type: "string" },
              },
              required: ["kind", "vendor", "total", "invoice"],
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
      const out = text ? JSON.parse(text.text) as { kind: string; vendor: string; total: number; invoice: string } : null;
      if (!out || (out.kind !== "work" && out.kind !== "receipt")) {
        skipped.push({ photo_id: p.photo_id, reason: "no classification in response" });
        continue;
      }
      // Crew tag wins: an already-tagged receipt keeps its kind; extraction
      // uses the crew's tag, not the model's, to decide what to write.
      const kind = p.photo_kind ?? out.kind;
      const patch: Record<string, unknown> = {};
      if (p.photo_kind === null) patch.photo_kind = out.kind;
      if (kind === "receipt") {
        patch.receipt_vendor = out.vendor.trim() || null;
        patch.receipt_total = out.total > 0 ? out.total : null;
        patch.receipt_invoice = out.invoice.trim() || null;
        patch.receipt_scanned_at = new Date().toISOString();
      }
      let q = supabase.from("field_photos").update(patch).eq("photo_id", p.photo_id);
      // Never overwrite a crew tag that raced in while we were classifying.
      if (p.photo_kind === null) q = q.is("photo_kind", null);
      const { error: upErr } = await q;
      if (upErr) skipped.push({ photo_id: p.photo_id, reason: upErr.message });
      else classified.push({ photo_id: p.photo_id, photo_kind: kind, ...(kind === "receipt" ? { vendor: patch.receipt_vendor, total: patch.receipt_total, invoice: patch.receipt_invoice } : {}) });
    } catch (e) {
      skipped.push({ photo_id: p.photo_id, reason: e instanceof Error ? e.message : String(e) });
    }
  }

  const { count } = await supabase
    .from("field_photos")
    .select("photo_id", { count: "exact", head: true })
    .or(QUEUE)
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
