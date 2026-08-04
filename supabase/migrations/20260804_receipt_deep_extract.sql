-- RECEIPT DEEP-EXTRACT MIGRATION (2026-08-04)
-- Widens what one vision pass records off a receipt photo: header facts that
-- were being thrown away (purchase time, PO/JOB, tax, payment, return window)
-- and, for the first time, the per-item lines themselves.
-- Additive only — every column is nullable, nothing renamed or dropped.

-- ── header facts, on the receipt photo ──────────────────────────────────────
alter table field_photos
  add column if not exists receipt_purchased_at   timestamptz,  -- time PRINTED on the receipt (not when photographed)
  add column if not exists receipt_po_job         text,         -- HD "PO/JOB NAME" etc — project attribution from the paper
  add column if not exists receipt_subtotal       numeric(12,2),
  add column if not exists receipt_tax            numeric(12,2),
  add column if not exists receipt_tax_exempt     boolean,      -- resale cert used
  add column if not exists receipt_payment_method text,         -- debit | credit | cash | check | account | other
  add column if not exists receipt_payment_last4  text,         -- card tail, for reimbursement vs company card
  add column if not exists receipt_purchaser      text,         -- name printed on the receipt / loyalty account
  add column if not exists receipt_store          text,         -- store number or branch address
  add column if not exists receipt_return_by      date,         -- return-policy expiry — unused tools are real money
  add column if not exists receipt_items_at       timestamptz,  -- when line extraction last ran
  add column if not exists receipt_items_status   text;         -- ok | unreconciled | no_items | exists

-- ── line-level provenance + the barcode ─────────────────────────────────────
alter table field_line_items
  add column if not exists upc              text,   -- per-item barcode off the receipt; seeds catalog UPC mapping
  add column if not exists receipt_photo_id uuid,   -- which receipt photo produced this line
  add column if not exists auto_entered     boolean not null default false;  -- machine-written, pending SM review

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_name = 'field_line_items_receipt_photo_id_fkey'
  ) then
    alter table field_line_items
      add constraint field_line_items_receipt_photo_id_fkey
      foreign key (receipt_photo_id) references field_photos(photo_id) on delete set null;
  end if;
end $$;

create index if not exists field_line_items_receipt_photo_idx
  on field_line_items (receipt_photo_id) where receipt_photo_id is not null;
create index if not exists field_line_items_upc_idx
  on field_line_items (upc) where upc is not null;

-- ── backfill: tie tonight's hand-entered 8/3 lines to their source photos ───
-- Without this the extractor would see "no lines yet" and duplicate them.
update field_line_items
set receipt_photo_id = 'd4699ea3-9086-4c68-81bb-a01cfd9c94d7'
where work_date = '2026-08-03' and vendor = 'Home Depot'
  and project_id = '45849853-a3fe-40cd-ad24-62fc669d9bef'
  and receipt_photo_id is null;

update field_line_items
set receipt_photo_id = '38dcae26-98d8-42e4-a1a9-aba426773acc'
where work_date = '2026-08-03' and vendor = 'Tasty Goody'
  and project_id = '45849853-a3fe-40cd-ad24-62fc669d9bef'
  and receipt_photo_id is null;
