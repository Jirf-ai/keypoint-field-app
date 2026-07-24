# Kaicon Field — Reviewer Decisions

Answers from review of the 2026-07-24 draft docs (PRD v0.1, Schema v0.1, Tech
Evaluation v0.1). Reviewer: Jeffrey Liao. Recorded as they land; Franc's docs
stay authoritative for everything not answered here.

---

## D-J1 — SKU catalog (answers PRD Q3 / Schema S1)

**Decision (Jeffrey, 2026-07-24):** the SKU database is organized exactly as
the existing BOBAI catalog — **2,478 web-verified items + 437 labor standards
is THE catalog, single source of truth**. The 178-SKU Fremont library is not a
separate v1 catalog and is never maintained separately.

**But the catalog must be project-aware.** The system must know instantly what
the 734 Fremont Villas library contains (membership and count) — a pool of
materials that can be isolated/picked at once, because the model on record
remembers **what project had what SKU**.

**What this means structurally** (one catalog + project pools, not two truths):

1. `items` (BOBAI) stays the only place SKUs live. Fremont's 178 get mapped
   into it — matched to existing items where they exist, added (with
   provenance) where they don't.
2. A **project↔item pool** association is the new piece: for every project,
   the set of catalog items it used, with observed qty/unit-cost and where the
   fact came from (bill, field capture, import). BOBAI-native projects derive
   their pool from bills automatically; imported histories (734 Fremont) get
   their pool seeded on import; Field app daily logs grow the pool live.
3. Queries this must answer instantly: "show 734 Fremont's library" (the 178,
   isolatable as a pick-pool), "which projects used this SKU," "observed unit
   cost of this SKU on that project vs. catalog typical."
4. This REPLACES the schema's `sku.org_scope = global | project` fork: scope
   is not a property of the SKU (that would fork the catalog); it is
   membership in a project pool. The Field app's SKU picker shows the current
   project's pool first, full catalog behind it.

Feeds Franc's flywheel directly: per-project observed costs are exactly the
`typical_unit_cost` / `observation_count` / `cost_confidence` inputs in
Schema §4.7 and §10 — the pool is where observations attach.

**Implementation home:** BOBAI engine work (migration on the existing Supabase
spine), per the house rule that engine capability lands in BOBAI first and
apps consume it. Not yet built; blocked on nothing but sequencing.

---

## D-J2 — Interim spreadsheet closes two "known gaps" (Schema §9)

`Kaicon_Field_1257.xlsx` (built 2026-07-24, in this repo) upgrades the interim
capture beyond the schema doc's expectations: **`hour_type`
(regular/overtime/rework) and `qty_is_estimated` are real validated columns**,
not `[rework]`/`[est]` note tags — the schema itself calls rework "the one
worth working around manually," so the instrument captures it first-class from
day one. Sheets: READ ME (project block + crew instructions incl. M-vs-F
boundary rule and photo naming), Daily Items (M/F/E/S line items, auto
line_total), Labor (always-L, hour_type dropdown), Change Orders (reason/status
enums), Photos (naming convention log), Lists (validation sources). All enum
columns are dropdown-constrained per Schema §5-§7 so pilot rows import without
cleanup. Still absent (accepted): versioning/amendment trail — spreadsheet
reality; the READ ME instructs "don't delete rows, add corrected ones."

---

## D-J3 — One Supabase, the existing spine (answers Tech Eval D2 ambiguity)

**Decision (Jeffrey, 2026-07-24):** "We're doing one Supabase, the Supabase
doesn't change. We're still using BOBAI and the rest." Field tables live on the
existing spine (project `bbkeogzyqwszmijmvlmj`), keyed to the existing
`projects` and `items` tables — no second instance, no parallel data store.

Motivation includes the Record app: clients must be able to pull up past
projects' data and material lists, which only works if field capture files
into the same project-keyed store the Records engine reads.

Implementation: `BOBAI/engines/operations/FIELD_CAPTURE_MIGRATION.sql` —
field_logs / field_line_items / field_labor_entries / field_photos /
field_change_orders (append-only, client-generated UUIDs for idempotent sync,
RLS with no anon access), the D-J1 `project_items` pool seeded from bills, and
the schema §10 ingest views for the Cost engine. Written, pending apply via
Supabase MCP.

---

## D-J4 — Photo-first capture is the expected dominant path

**Observation (Jeffrey, 2026-07-24):** "on-site workers will be too busy/lazy
to type all the info in — image taking will probably be the most used resource
to record materials." Treat the camera as the front door, typing as the site
manager's end-of-day step (the PRD already makes the site manager own data
quality in their 3-5 minutes).

**Implemented (v0):** photos attach to specific line items (schema §4.5
line_id); unlinked photos form a "N photos need details" inbox strip on Today
— snap all day with zero typing, tap a photo later and the material form opens
with the photo attached, linking on save. Linked lines show a camera marker.

**Roadmap consequence:** this raises the priority of (a) barcode/QR scan
(PRD should-have — needs a UPC column + mapping on the items catalog; the
pilot's photo-line pairs effectively build that map), and (b) vision AI
drafting lines from photos/receipts (platform already runs vision in
understand-input; paid call, post-pilot). Principle: the camera accelerates
entry, never gates it — and a photo alone is evidence, not cost data; the
numbers always get confirmed by a human (or AI-drafted then confirmed).
