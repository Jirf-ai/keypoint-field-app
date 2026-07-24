# Kaicon Field — Data Schema

**Version** 0.1 (Draft for review)
**Owner** Franc Huang
**Reviewers** Jeffrey Liao, Raymond Huang
**Date** July 24, 2026
**Applies to** Kaicon Field app, `Kaicon_Field_1257.xlsx` interim capture, and the Kaicon Cost ingest pipeline

---

## 1. Purpose and principles

This schema defines what field capture produces and what the Kaicon Cost engine consumes. It is deliberately fixed early, because a schema decided after data exists means re-labeling every record by hand.

**Principles**

1. **`cost_class` on every cost-bearing row.** A row without it cannot be aggregated into the DC model and is effectively lost.
2. **Append-only.** Corrections write a new version. Nothing is destroyed; the audit trail is part of the data's value.
3. **Provenance travels with the row.** Who, when, where, which device, online or offline.
4. **Captured time ≠ work date.** Both are stored. The gap between them is a data-quality signal.
5. **Units are constrained per SKU.** Free-text units make downstream aggregation impossible.
6. **Estimates are labeled.** A quantity someone guessed must be distinguishable from one they measured.

---

## 2. Cost classification — DC = M + F + L + E + S

The direct cost model that everything rolls up to.

| Code | Class | Definition | Examples |
|---|---|---|---|
| `M` | Materials | Consumable building materials incorporated into the work | Lumber, concrete, rebar, drywall, roofing, insulation, paint |
| `F` | Fixtures | Manufactured items installed and becoming part of the structure | Windows, doors, cabinets, plumbing fixtures, lighting, hardware, countertops |
| `L` | Labor | On-site trade hours | All trades, including rework and overtime |
| `E` | Equipment | Machinery, rental, temporary facilities, tool consumption | Excavator rental, scaffolding, lifts, temp power, portable toilets |
| `S` | Sourcing | Cost of getting materials to site | Freight, delivery, procurement fees, storage, restocking |

**Waterfall above DC** (computed by Kaicon Cost, not captured in the field):

```
DC   = M + F + L + E + S
PM   = 2–5%   × DC
OH   = 10–15% × (DC + PM)
Profit = 8–15% × (DC + PM + OH)
Dev. Cost = DC + PM + OH + Profit
```

Field captures DC components only. The markup tiers are modeled, not observed.

**M vs F boundary rule.** If it arrives as bulk stock and is cut or consumed to fit, it is `M`. If it arrives as a discrete manufactured unit with a model number and is installed as-is, it is `F`. A sheet of plywood is `M`; a pre-hung door is `F`.

---

## 3. Entities

```
project
  └── daily_log            (one per site per work date)
        ├── line_item      (materials, fixtures, equipment, sourcing)
        ├── labor_entry    (trade hours)
        └── photo
  ├── change_order
  ├── sku                  (catalog, project- or org-scoped)
  └── worker
```

---

## 4. Table definitions

### 4.1 `project`

| Field | Type | Req | Notes |
|---|---|---|---|
| `project_id` | string PK | ✓ | Stable code, e.g. `1257-INSP` |
| `name` | string | ✓ | `Bao Residence — 1257 Inspiration Point` |
| `address` | string | ✓ | |
| `apn` | string | | `8493-056-020` |
| `permits` | string[] | | `["B25-1199", "B25-1200"]` |
| `gc_of_record` | string | ✓ | `L'Or Constructions Inc.` |
| `gc_license` | string | | `CSLB #1156094` |
| `pm_entity` | string | ✓ | `KPKB OC LLC` |
| `scope_summary` | string | | |
| `areas` | string[] | ✓ | Configured pick list — `["Main 1F","Main 2F","Gazebo","Sitework"]` |
| `phases` | string[] | ✓ | Configured pick list, ordered |
| `start_date` | date | ✓ | `2026-07-30` |
| `budget_by_class` | map | | `{M: 55734.88, F: 0, L: 133006.00, E: 0, S: 4550.00}` |
| `data_use_consent` | enum | ✓ | `granted` / `pending` / `denied` — see PRD §9.3 |
| `created_at` | timestamp | ✓ | |

> `data_use_consent` is a schema-level field on purpose. If a project's data cannot be used for model training, that constraint must live with the data, not in someone's memory.

---

### 4.2 `daily_log`

One record per project per work date.

| Field | Type | Req | Notes |
|---|---|---|---|
| `log_id` | uuid PK | ✓ | |
| `project_id` | FK | ✓ | |
| `work_date` | date | ✓ | The date work was performed |
| `submitted_at` | timestamp | | Null until submitted |
| `submitted_by` | FK worker | | |
| `status` | enum | ✓ | `draft` / `submitted` / `amended` |
| `weather` | string | | Auto-captured if available |
| `crew_count` | int | | |
| `note` | text | | |
| `device_id` | string | ✓ | |
| `captured_offline` | bool | ✓ | |
| `synced_at` | timestamp | | Null while pending |

**Constraint:** unique on (`project_id`, `work_date`). A second submission for the same date creates an amendment, not a duplicate.

---

### 4.3 `line_item` — materials, fixtures, equipment, sourcing

The core cost record. Labor lives in its own table (§4.4).

| Field | Type | Req | Notes |
|---|---|---|---|
| `line_id` | uuid PK | ✓ | |
| `log_id` | FK | ✓ | |
| `project_id` | FK | ✓ | Denormalized for query performance |
| `work_date` | date | ✓ | Denormalized |
| **`cost_class`** | enum | **✓** | **`M` / `F` / `E` / `S`** — never `L` here |
| `sku_code` | FK sku | | Null for free-text entries |
| `description` | string | ✓ | Required when `sku_code` is null |
| `phase` | enum | ✓ | From `project.phases` |
| `area` | enum | ✓ | From `project.areas` |
| `qty` | decimal(12,3) | ✓ | |
| `unit` | enum | ✓ | Constrained per SKU — see §5 |
| `unit_cost` | decimal(12,2) | ✓ | Actual, not budgeted |
| `line_total` | decimal(14,2) | ✓ | Computed = `qty × unit_cost` |
| `qty_is_estimated` | bool | ✓ | Default false — see §1 principle 6 |
| `vendor` | string | | |
| `invoice_ref` | string | | |
| `co_ref` | FK change_order | | Null if base scope |
| `waste_qty` | decimal(12,3) | | Ordered minus installed, when known |
| `recorded_by` | FK worker | ✓ | |
| `recorded_at` | timestamp | ✓ | Device time of entry |
| `gps_lat` / `gps_lng` | decimal | | Captured if permitted |
| `version` | int | ✓ | Increments on amendment |
| `supersedes` | FK line_item | | Prior version, if amended |
| `note` | text | | |

> `waste_qty` is optional but valuable. The gap between ordered and installed is a real cost driver that almost no estimating system models, and capturing it is a differentiator for the Cost engine.

---

### 4.4 `labor_entry`

Separate from `line_item` because labor has a different shape — hours, trades, and a rework flag that materials don't have.

| Field | Type | Req | Notes |
|---|---|---|---|
| `labor_id` | uuid PK | ✓ | |
| `log_id` | FK | ✓ | |
| `project_id` | FK | ✓ | Denormalized |
| `work_date` | date | ✓ | Denormalized |
| `cost_class` | const | ✓ | Always `L` |
| `trade` | enum | ✓ | See §6 |
| `worker_id` | FK worker | | Nullable — see PRD Q4 |
| `phase` | enum | ✓ | |
| `area` | enum | ✓ | |
| `hours` | decimal(6,2) | ✓ | |
| `hour_type` | enum | ✓ | `regular` / `overtime` / **`rework`** |
| `hourly_rate` | decimal(10,2) | ✓ | |
| `line_total` | decimal(14,2) | ✓ | Computed = `hours × hourly_rate` |
| `co_ref` | FK change_order | | |
| `recorded_by` | FK worker | ✓ | |
| `recorded_at` | timestamp | ✓ | |
| `version` | int | ✓ | |
| `supersedes` | FK labor_entry | | |
| `note` | text | | |

> **`hour_type = rework` is the single most valuable field in this schema.** Rework hours are where estimates diverge from reality, and no commercial estimating database captures them. Making rework easy and blame-free to record is a product requirement, not just a schema one — if recording rework gets someone in trouble, it will never be recorded.

---

### 4.5 `photo`

| Field | Type | Req | Notes |
|---|---|---|---|
| `photo_id` | uuid PK | ✓ | |
| `log_id` | FK | ✓ | |
| `line_id` | FK | | Null if attached to the day rather than a line |
| `project_id` | FK | ✓ | |
| `storage_url` | string | ✓ | |
| `thumb_url` | string | | |
| `captured_at` | timestamp | ✓ | EXIF, not upload time |
| `gps_lat` / `gps_lng` | decimal | | |
| `phase` | enum | | |
| `area` | enum | | |
| `caption` | string | | |
| `file_size_bytes` | int | ✓ | |
| `uploaded_at` | timestamp | | Null while pending |

Naming convention for the interim spreadsheet and for exports: `{project_id}-{YYYYMMDD}-{seq}.jpg` — e.g. `1257-20260730-001.jpg`.

---

### 4.6 `change_order`

| Field | Type | Req | Notes |
|---|---|---|---|
| `co_id` | uuid PK | ✓ | |
| `co_no` | string | ✓ | Human-readable: `CO-001` |
| `project_id` | FK | ✓ | |
| `date` | date | ✓ | |
| `description` | text | ✓ | |
| `reason` | enum | ✓ | `owner_request` / `unforeseen_condition` / `design_change` / `code_requirement` / `error_omission` |
| `cost_class` | enum | | Primary class if single-class |
| `amount` | decimal(14,2) | ✓ | |
| `schedule_impact_days` | int | | |
| `approved_by` | string | | |
| `status` | enum | ✓ | `pending` / `approved` / `rejected` / `completed` |
| `note` | text | | |

> `reason` is an enum rather than free text deliberately. Aggregated across projects it tells you which CO categories are systematically under-estimated — which feeds directly back into the Cost engine's contingency modeling.

---

### 4.7 `sku`

| Field | Type | Req | Notes |
|---|---|---|---|
| `sku_code` | string PK | ✓ | e.g. `CONC-3000` |
| `description` | string | ✓ | |
| `description_es` / `description_zh` | string | | Localized |
| `default_cost_class` | enum | ✓ | |
| `allowed_units` | enum[] | ✓ | Constrains entry — see §5 |
| `default_unit` | enum | ✓ | |
| `csi_division` | string | | Optional CSI MasterFormat mapping |
| `typical_unit_cost` | decimal(12,2) | | Rolling average from actuals |
| `cost_confidence` | enum | | `observed` / `estimated` / `unknown` |
| `observation_count` | int | | How many real data points back it |
| `org_scope` | enum | ✓ | `global` / `project` |

> `cost_confidence` and `observation_count` are what let Kaicon Cost report *how much it knows*, rather than presenting an estimate with false precision. An estimate backed by 40 observations and one backed by zero should not look identical to the user.

---

### 4.8 `worker`

| Field | Type | Req | Notes |
|---|---|---|---|
| `worker_id` | uuid PK | ✓ | |
| `display_name` | string | ✓ | |
| `role` | enum | ✓ | `site_manager` / `journeyman` / `pm` / `office` |
| `default_trade` | enum | | |
| `preferred_language` | enum | ✓ | `en` / `es` / `zh` |
| `employer` | string | | GC or sub entity |
| `active` | bool | ✓ | |

Personal data is minimized deliberately. No addresses, no personal identifiers beyond what operations require.

---

## 5. Units

Constrained set. Free text is not accepted.

| Category | Units |
|---|---|
| Count | `EA`, `PC`, `SET`, `PR` |
| Length | `LF`, `FT`, `IN` |
| Area | `SF`, `SQ` (100 SF roofing) |
| Volume | `CY`, `CF`, `GAL` |
| Weight | `LB`, `TON` |
| Time | `HR`, `DAY`, `WK`, `MO` |
| Packaged | `BOX`, `BDL`, `ROLL`, `SHT`, `BAG`, `TUBE` |
| Lump | `LS` |

Each SKU declares its `allowed_units`. Entry outside that set is rejected at capture, not cleaned up later.

---

## 6. Trades

| Code | English | Español | 中文 |
|---|---|---|---|
| `laborer` | Laborer | Peón | 小工 |
| `carpenter` | Carpenter | Carpintero | 木工 |
| `concrete` | Concrete | Concretero | 混凝土工 |
| `framer` | Framer | Enmarcador | 框架工 |
| `roofer` | Roofer | Techador | 屋面工 |
| `electrician` | Electrician | Electricista | 电工 |
| `plumber` | Plumber | Plomero | 水管工 |
| `hvac` | HVAC | HVAC | 暖通工 |
| `drywaller` | Drywaller | Yesero | 石膏板工 |
| `painter` | Painter | Pintor | 油漆工 |
| `tile` | Tile Setter | Azulejero | 瓷砖工 |
| `flooring` | Flooring | Instalador de pisos | 地板工 |
| `finish_carp` | Finish Carpenter | Carpintero de acabados | 细木工 |
| `foreman` | Foreman | Capataz | 工头 |

---

## 7. Phases

Ordered, project-configurable. Default residential sequence:

`mobilization` → `demo` → `foundation` → `framing` → `roofing` → `rough_electrical` → `rough_plumbing` → `hvac` → `inspection_rough` → `insulation` → `drywall` → `exterior` → `windows_doors` → `finish_carpentry` → `painting` → `flooring` → `fixtures` → `sitework` → `inspection_final` → `punch_list`

The 1257 pilot adds `gazebo` as a parallel phase track.

---

## 8. Validation rules

Enforced at capture, not in cleanup.

| # | Rule | Severity |
|---|---|---|
| V1 | `cost_class` present on every line and labor entry | **Block** |
| V2 | `unit` ∈ SKU's `allowed_units` | **Block** |
| V3 | `qty` > 0 | **Block** |
| V4 | `unit_cost` ≥ 0 | **Block** |
| V5 | `work_date` not in the future | **Block** |
| V6 | `work_date` more than 3 days before `recorded_at` | Warn + flag |
| V7 | `unit_cost` deviates > 50% from SKU rolling average | Warn |
| V8 | Duplicate SKU + qty + phase on same day | Warn |
| V9 | Daily labor hours > 16 for one worker | Warn |
| V10 | `hour_type = rework` without a note | Warn |
| V11 | Line references a `co_ref` whose status is `rejected` | Warn |

Blocks stop submission. Warnings flag for PM review but never prevent capture — **a warning must never be a reason someone abandons the entry**.

---

## 9. Interim spreadsheet mapping

`Kaicon_Field_1257.xlsx` maps to this schema so pilot records import without transformation.

| Spreadsheet column | Schema field | Table |
|---|---|---|
| `date` | `work_date` | line_item / labor_entry |
| `phase` | `phase` | line_item |
| `area` | `area` | line_item |
| `sku_code` | `sku_code` | line_item |
| `description` | `description` | line_item |
| `cost_class` | `cost_class` | line_item |
| `qty` | `qty` | line_item |
| `unit` | `unit` | line_item |
| `unit_cost` | `unit_cost` | line_item |
| `line_total` | `line_total` | computed |
| `trade` | `trade` | labor_entry |
| `labor_hours` | `hours` | labor_entry |
| `vendor` | `vendor` | line_item |
| `invoice_ref` | `invoice_ref` | line_item |
| `photo_ref` | `storage_url` | photo |
| `co_ref` | `co_ref` | line_item |
| `recorded_by` | `recorded_by` | line_item |
| `note` | `note` | line_item |

**Known gaps in the interim capture** — acceptable for the pilot, but they are real losses:

- `hour_type` (regular / overtime / **rework**) is not captured. Recommend recording it in `note` as `[rework]` until the app ships.
- `qty_is_estimated` is not captured. Recommend `[est]` in `note`.
- `waste_qty` is not captured.
- Versioning is absent — the spreadsheet is edited in place, so the amendment trail is lost.

Of these, **rework is the one worth working around manually**, because it is the highest-value signal and cannot be reconstructed later.

---

## 10. Cost engine ingest contract

What Kaicon Cost expects from Field.

**Grain:** one row per line item or labor entry, at project × date × phase × cost_class × SKU.

**Required for ingest:** `project_id`, `work_date`, `cost_class`, `qty`, `unit`, `unit_cost`, `line_total`, `phase`.

**Aggregations produced:**

```
DC_actual by class     = Σ line_total  grouped by cost_class
DC_actual by phase     = Σ line_total  grouped by phase
Labor hours by trade   = Σ hours       grouped by trade
Rework ratio           = rework_hours / total_hours
Waste ratio            = waste_qty / qty          (where captured)
Unit cost observed     = Σ line_total / Σ qty     grouped by sku_code
CO impact              = Σ co.amount / DC_actual
```

**Feedback to the SKU catalog:** each ingest updates `typical_unit_cost`, increments `observation_count`, and promotes `cost_confidence` from `estimated` to `observed` once a SKU passes a threshold of real observations.

This is the write-back loop. It is the reason the platform gets more accurate with every project, and the reason a pure-software competitor cannot replicate it without running jobs.

---

## 11. Open items

| # | Item | Owner | Needed by |
|---|---|---|---|
| S1 | Is the 178-SKU seed library the v1 global catalog? | Franc / Jeffrey | Before alpha |
| S2 | Worker identity — named or anonymous IDs? Drives `worker` table privacy posture | Franc | Before alpha |
| S3 | Photo retention period and storage tiering | Raymond | Before beta |
| S4 | Does `F` (Fixtures) get split out of the existing BOM budget, which currently folds it into `M`? | Franc | Before variance reporting is meaningful |
| S5 | CSI MasterFormat mapping — needed for v1 or later? | Jeffrey | Before beta |
