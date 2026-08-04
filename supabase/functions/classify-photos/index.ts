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
// v4 (2026-08-04): a SECOND pass itemizes confirmed receipts. Until now we
// only ever asked "who and how much" and stopped, so every receipt still had
// to be opened by a human to learn what was actually bought — the 8/3 Home
// Depot and Tasty Goody receipts were priced by hand for exactly that reason.
// Pass B asks the same photo for its line items and writes field_line_items
// directly, which also seeds the UPC→catalog mapping the SM-11 barcode
// scanner has never had. Money data, so it runs on Opus rather than Haiku and
// only writes when the arithmetic reconciles (see RECONCILE_TOLERANCE).
// v3 (2026-08-02): photos tagged 'work' get ONE vision pass too. The app's
// batch form DEFAULTS the whole batch to 'work', so a receipt shot without
// flipping the toggle synced as 'work' and was permanently invisible here —
// 2 of 2 real receipts on pilot day 2 (Home Depot $223.97, Jollibee $49.37)
// fell into exactly that hole. A 'work' photo the model confidently reads as
// a receipt flips to receipt + extraction; otherwise receipt_scanned_at is
// stamped as "checked" so every photo leaves the queue after one pass.
// A crew-set 'receipt' tag is still never overwritten.
//
// Body: { limit?: number (default 10, max 25), itemize_limit?: number (default 5, max 10) }
// Response: { classified: [{photo_id, photo_kind, vendor?, total?, invoice?}],
//             itemized: [{photo_id, status, lines?, total?}],
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
  // Receipts are a small fraction of photos and each itemization is an Opus
  // vision call of roughly a minute, so pass B gets its own small budget —
  // three keeps one invocation inside the cron's 240s wait. Anything left over
  // is picked up by the next hourly run.
  const itemizeLimit = Math.min(Math.max(Number(body.itemize_limit) || 3, 1), 10);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const anthropic = new Anthropic({ apiKey });

  const QUEUE = "photo_kind.is.null,and(photo_kind.eq.receipt,receipt_scanned_at.is.null),and(photo_kind.eq.work,receipt_scanned_at.is.null)";
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
      // A crew-set 'receipt' keeps its kind. A 'work' tag is usually just the
      // batch default, so a confident receipt read FLIPS it (v3) — a receipt
      // recorded as jobsite evidence is silent cost loss. Every scanned photo
      // gets receipt_scanned_at stamped so it exits the queue after one pass.
      const kind = p.photo_kind === "receipt" ? "receipt" : out.kind;
      const patch: Record<string, unknown> = { receipt_scanned_at: new Date().toISOString() };
      if (p.photo_kind === null || (p.photo_kind === "work" && out.kind === "receipt")) {
        patch.photo_kind = out.kind;
      }
      if (kind === "receipt") {
        patch.receipt_vendor = out.vendor.trim() || null;
        patch.receipt_total = out.total > 0 ? out.total : null;
        patch.receipt_invoice = out.invoice.trim() || null;
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

  // ── PASS B: itemize confirmed receipts ────────────────────────────────────
  // Runs after pass A, so a photo that just flipped to 'receipt' is itemized in
  // the same invocation. receipt_items_at is the queue stamp: set on every
  // outcome (including failures) so a photo is attempted once, not forever.
  //
  // Pass B is awaited, so the request stays open for the whole vision call.
  // That matters: returning early closes the connection and the isolate is
  // torn down mid-call, losing the work silently (learned the hard way —
  // EdgeRuntime.waitUntil did not keep it alive). The cron's pg_net call
  // therefore needs a timeout well above the default 5s; it is set to 240s on
  // the classify-photos-hourly job. Keep itemize_limit small so one invocation
  // stays comfortably inside that budget.
  const itemized = await itemizeReceipts(supabase, anthropic, itemizeLimit, skipped)
    .catch((e) => {
      console.error(`[itemize] failed: ${e instanceof Error ? e.message : String(e)}`);
      return [] as Record<string, unknown>[];
    });

  return json({ classified, itemized, skipped, remaining: count ?? 0 });
});

// Items must sum (plus tax, less discounts) to the receipt total within this
// many dollars or nothing is written. Thermal receipts misread in ways that
// look plausible line by line; the arithmetic is what catches it. A couple of
// cents of rounding slack, nothing more.
const RECONCILE_TOLERANCE = 0.02;

// Receipts print local wall-clock with no zone. Every Kaicon job is in
// California, so Pacific is the correct reading (PDT here; a winter receipt
// lands an hour off, which is harmless for a date-level cost record).
const RECEIPT_TZ_OFFSET = "-07:00";

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    purchased_at: { type: "string", description: "Date and time PRINTED on the receipt as YYYY-MM-DDTHH:MM (24h). Empty string if unreadable." },
    po_job: { type: "string", description: "PO / JOB NAME / job-reference field, often a project number. Empty string if absent." },
    store: { type: "string", description: "Store number or branch address." },
    purchaser: { type: "string", description: "Name printed on the receipt or loyalty account." },
    subtotal: { type: "number", description: "Pre-tax subtotal. 0 if unreadable." },
    tax: { type: "number", description: "Sales tax charged. 0 if none or tax exempt." },
    tax_exempt: { type: "boolean", description: "True if the receipt is marked tax exempt / resale." },
    total: { type: "number", description: "Final amount paid." },
    payment_method: { type: "string", enum: ["debit", "credit", "cash", "check", "account", "other", ""] },
    payment_last4: { type: "string", description: "Last 4 digits of the card. Empty string if none." },
    return_by: { type: "string", description: "Return-policy expiry as YYYY-MM-DD. Empty string if absent." },
    items: {
      type: "array",
      description: "Every priced line on the receipt IN PRINTED ORDER, including deposits, environmental/lumber fees, and per-item discounts as their own lines. Exclude the subtotal, tax, and total lines.",
      items: {
        type: "object",
        properties: {
          description: { type: "string", description: "The item as printed, expanded to readable words where the receipt abbreviates." },
          upc: { type: "string", description: "The item's UPC/SKU number as printed. Empty string if absent." },
          qty: { type: "number", description: "Quantity. 1 when the receipt shows no explicit count." },
          unit: { type: "string", description: "Unit of measure: EA, BAG, BOX, SHT, ROLL, SET, LS, LF, SF." },
          unit_price: { type: "number", description: "Price per unit before tax. Negative for a discount line." },
          extended: { type: "number", description: "qty x unit_price as printed on the line." },
          cost_class: { type: "string", enum: ["M", "F", "L", "E", "S"], description: "M=material consumed in the work, E=tool/equipment kept, F=fixture, L=labor, S=subcontract. Crew food and drink are M." },
        },
        required: ["description", "upc", "qty", "unit", "unit_price", "extended", "cost_class"],
        additionalProperties: false,
      },
    },
  },
  required: ["purchased_at", "po_job", "store", "purchaser", "subtotal", "tax", "tax_exempt", "total", "payment_method", "payment_last4", "return_by", "items"],
  additionalProperties: false,
} as const;

type ReceiptItem = {
  description: string;
  upc: string;
  qty: number;
  unit: string;
  unit_price: number;
  extended: number;
  cost_class: string;
};

async function itemizeReceipts(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  // deno-lint-ignore no-explicit-any
  anthropic: any,
  limit: number,
  skipped: { photo_id: string; reason: string }[],
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];

  const { data: photos, error } = await supabase
    .from("field_photos")
    .select("photo_id, storage_path, log_id, project_id, work_date, recorded_by, phase, area, receipt_vendor, receipt_invoice")
    .eq("photo_kind", "receipt")
    .is("receipt_items_at", null)
    .is("deleted_at", null)
    .not("storage_path", "is", null)
    .limit(limit);
  if (error) {
    skipped.push({ photo_id: "-", reason: `itemize queue: ${error.message}` });
    return out;
  }

  for (const p of photos ?? []) {
    const stamp = async (status: string, extra: Record<string, unknown> = {}) => {
      await supabase
        .from("field_photos")
        .update({ receipt_items_at: new Date().toISOString(), receipt_items_status: status, ...extra })
        .eq("photo_id", p.photo_id);
    };

    try {
      // Someone already priced this receipt by hand — never write over that.
      const { count: existing } = await supabase
        .from("field_line_items")
        .select("line_id", { count: "exact", head: true })
        .eq("receipt_photo_id", p.photo_id);
      if ((existing ?? 0) > 0) {
        await stamp("exists");
        out.push({ photo_id: p.photo_id, status: "exists" });
        continue;
      }

      const { data: file, error: dlErr } = await supabase.storage
        .from("field-photos")
        .download(p.storage_path);
      if (dlErr || !file) {
        skipped.push({ photo_id: p.photo_id, reason: `itemize download: ${dlErr?.message ?? "no file"}` });
        continue;
      }
      const b64 = encodeBase64(await file.arrayBuffer());

      // Opus, not Haiku: these numbers become cost of record, and reading a
      // 12-digit UPC off crumpled thermal paper is where a cheap model slips.
      // Thinking is on by default on Opus 5 and shares max_tokens with the
      // answer, hence the generous ceiling.
      const response = await anthropic.messages.create({
        model: "claude-opus-5",
        max_tokens: 16000,
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: ITEM_SCHEMA },
        },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
            {
              type: "text",
              text: "This is a purchase receipt photographed by a construction crew. " +
                "Transcribe it exactly as printed — do not infer, round, or tidy prices. " +
                "Read every priced line in order, including bottle deposits, lumber and " +
                "environmental fees, and discounts (as negative lines). Where a line's " +
                "amount is ambiguous because of print alignment, choose the reading that " +
                "makes the line amounts sum to the printed subtotal. Use empty string or 0 " +
                "for any field you cannot read confidently.",
            },
          ],
        }],
      });

      if (response.stop_reason === "refusal") {
        await stamp("refused");
        skipped.push({ photo_id: p.photo_id, reason: "itemize: model declined" });
        continue;
      }
      if (response.stop_reason !== "end_turn") {
        skipped.push({ photo_id: p.photo_id, reason: `itemize stop_reason: ${response.stop_reason}` });
        continue;
      }
      // Structured outputs guarantee the first text block is schema-valid JSON;
      // thinking blocks precede it, so find rather than index.
      // deno-lint-ignore no-explicit-any
      const textBlock = response.content.find((b: any) => b.type === "text");
      if (!textBlock) {
        skipped.push({ photo_id: p.photo_id, reason: "itemize: no text block" });
        continue;
      }
      const r = JSON.parse(textBlock.text);
      const items: ReceiptItem[] = Array.isArray(r.items) ? r.items : [];

      const header: Record<string, unknown> = {
        receipt_purchased_at: r.purchased_at ? `${r.purchased_at}:00${RECEIPT_TZ_OFFSET}` : null,
        receipt_po_job: r.po_job?.trim() || null,
        receipt_store: r.store?.trim() || null,
        receipt_purchaser: r.purchaser?.trim() || null,
        receipt_subtotal: r.subtotal > 0 ? r.subtotal : null,
        receipt_tax: r.tax > 0 ? r.tax : null,
        receipt_tax_exempt: typeof r.tax_exempt === "boolean" ? r.tax_exempt : null,
        receipt_payment_method: r.payment_method?.trim() || null,
        receipt_payment_last4: r.payment_last4?.trim() || null,
        receipt_return_by: r.return_by?.trim() || null,
      };
      // A fuller invoice number than pass A's glance is worth keeping.
      if (r.total > 0) header.receipt_total = r.total;

      if (items.length === 0) {
        await stamp("no_items", header);
        out.push({ photo_id: p.photo_id, status: "no_items" });
        continue;
      }

      // The guard: transcribed lines plus tax must land on the printed total.
      const lineSum = items.reduce((s, it) => s + (Number(it.extended) || 0), 0);
      const expected = Number(r.total) || 0;
      const delta = Math.abs(lineSum + (Number(r.tax) || 0) - expected);
      if (expected <= 0 || delta > RECONCILE_TOLERANCE) {
        await stamp("unreconciled", header);
        out.push({ photo_id: p.photo_id, status: "unreconciled", line_sum: lineSum, receipt_total: expected });
        continue;
      }

      const now = new Date().toISOString();
      const rows = items.map((it) => ({
        // line_id, phase and area are NOT NULL with no database default — the
        // client supplies all three or the insert is rejected.
        line_id: crypto.randomUUID(),
        log_id: p.log_id,
        project_id: p.project_id,
        work_date: p.work_date,
        cost_class: it.cost_class || "M",
        description: it.description,
        upc: it.upc?.trim() || null,
        // The receipt photo rarely carries a phase/area; fall back to the same
        // default the hand-entered receipt lines have used since 7/31.
        phase: p.phase || "mobilization",
        area: p.area || "Sitework",
        qty: it.qty,
        unit: it.unit || "EA",
        unit_cost: it.unit_price,
        qty_is_estimated: false,
        vendor: p.receipt_vendor ?? null,
        invoice_ref: p.receipt_invoice ?? null,
        recorded_by: p.recorded_by,
        recorded_at: now,
        captured_offline: false,
        synced_at: now,
        version: 1,
        receipt_photo_id: p.photo_id,
        auto_entered: true,
        note: `Auto-itemized from the receipt photo ${now.slice(0, 10)} (classify-photos v4). Line totals reconcile to the receipt total; cost class and phase are the model's read — SM may reclassify.`,
      }));

      const { error: insErr } = await supabase.from("field_line_items").insert(rows);
      if (insErr) {
        skipped.push({ photo_id: p.photo_id, reason: `itemize insert: ${insErr.message}` });
        continue;
      }
      // Cost arriving after the crew submitted means the day genuinely changed;
      // 'amended' is how every hand-entered receipt has been recorded so far.
      if (p.log_id) {
        await supabase
          .from("field_daily_logs")
          .update({ status: "amended" })
          .eq("log_id", p.log_id)
          .eq("status", "submitted");
      }
      await stamp("ok", header);
      out.push({ photo_id: p.photo_id, status: "ok", lines: rows.length, total: expected });
    } catch (e) {
      // Pass B usually runs detached (waitUntil), so a thrown error would
      // otherwise vanish with the response — record it where it can be read.
      const msg = e instanceof Error ? e.message : String(e);
      await stamp(`error: ${msg}`.slice(0, 200));
      skipped.push({ photo_id: p.photo_id, reason: msg });
      out.push({ photo_id: p.photo_id, status: "error", reason: msg });
    }
  }

  return out;
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}
