-- Returns and credits on field line items (2026-08-04).
--
-- Jeffrey: "if the receipt is identified as a return, do option 1 for me
-- always. Automated." Option 1 = the credit is its OWN append-only line, not
-- an amendment that erases the purchase — the crew really did buy the thing
-- and really did take it back, and the cost record should say so.
--
-- Found live: Robert bought a $109 floor scraper at 8:40am and returned it at
-- 9:49am (same Home Depot invoice 8463). The auto-itemizer priced the purchase
-- correctly and then REFUSED the return receipt (receipt_items_status =
-- 'unreconciled') because its arithmetic assumed a purchase — leaving the
-- project carrying $357 when Robert's real net spend was $248.
--
-- THE ENCODING: a credit is NEGATIVE QTY at a POSITIVE unit price.
-- line_total is generated as (qty * unit_cost), so the amount comes out
-- negative and every rollup — field_dc_actuals, field_dc_by_phase — nets on
-- its own with no special-casing.
--
-- Negative qty rather than negative unit_cost, deliberately:
-- field_unit_cost_observed computes sum(line_total) / sum(qty). With negative
-- qty a purchase and its return cancel to "no units, no observation", which is
-- the truth. With a negative unit_cost instead, the same pair would report a
-- $0/unit street price and poison the SKU flywheel. unit_cost stays >= 0.
--
-- This also unblocks per-item DISCOUNT lines on ordinary purchase receipts,
-- which the old qty > 0 / unit_cost >= 0 pair silently made impossible to
-- insert: the model was already told to transcribe them as negative lines, so
-- any discounted receipt would have failed its whole insert.
alter table public.field_line_items
  drop constraint if exists field_line_items_qty_check;

alter table public.field_line_items
  add constraint field_line_items_qty_check check (qty <> 0);

comment on column public.field_line_items.qty is
  'Quantity. NEGATIVE for a credit — a returned item or a per-item discount — '
  'at the original positive unit_cost, so the generated line_total nets the '
  'refund. Never zero.';
