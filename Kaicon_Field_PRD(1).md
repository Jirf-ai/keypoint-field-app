# Kaicon Field — Product Requirements Document

**Version** 0.1 (Draft for review)
**Owner** Franc Huang
**Reviewers** Jeffrey Liao, Raymond Huang
**Date** July 24, 2026
**Status** Pre-development — pilot project starts July 30, 2026

---

## 1. Summary

Kaicon Field is the on-site data capture application for the Kaicon platform. Site managers and journeymen use it to record what was actually consumed and actually worked, every day, on every job.

It is the first of the three agents to ship, and it exists for one reason: **the Kaicon Cost engine cannot be trained without ground truth, and ground truth only exists if someone captures it at the moment work happens.**

Field is not a project management tool. It is a data acquisition instrument that happens to be useful to the crew.

---

## 2. Why this ships first

The three planned agents have a dependency chain that is not obvious from the org chart:

| Agent | Depends on | Can ship without |
|---|---|---|
| Kaicon ARV | Dev. Cost + market data | — |
| Kaicon Cost | Real SKU + labor data | — |
| **Kaicon Field** | Nothing | Ships standalone |

Kaicon ARV computes value *after redevelopment*, which requires a Dev. Cost. Kaicon Cost produces Dev. Cost, which requires historical data on what things actually cost. That data comes from Field.

Shipping ARV or Cost first means training on estimates rather than actuals — which reproduces the industry's existing guesswork with a more confident interface. That is the failure mode this whole platform exists to avoid.

**Corollary:** Field can and should ship before it is polished. A rough app collecting real data beats a beautiful app collecting nothing.

---

## 3. Users

### 3.1 Primary — Site Manager / Foreman

Records the day's consumption and labor. Reviews and submits. Owns data quality for their site.

- Works outdoors, phone in one hand, often with gloves
- Signal is unreliable (interior framing, basements, hillside lots)
- Fluent in at least one of: English, Spanish, Mandarin
- Has 3–5 minutes at end of day for this, not 30

### 3.2 Secondary — Journeyman / Crew

Logs their own hours and uploads photos of completed work.

- May not own a smartphone with capacity for a large app
- May be using personal data plan — bandwidth is a real cost to them
- Spanish is the most likely primary language on Southern California residential sites
- Low tolerance for friction; will stop using anything that takes more than a minute

### 3.3 Tertiary — PM / Office (KPKB OC LLC)

Reviews submitted logs, resolves flagged discrepancies, exports for accounting and for the Cost engine.

- Desktop, not mobile
- Needs export, audit trail, and variance visibility

**Design consequence:** the interface must work for someone who did not choose to use it, is not paid to use it, and gains nothing personally from using it. Every field that isn't essential is a reason to abandon the app.

---

## 4. Goals and non-goals

### Goals

| # | Goal | Measure |
|---|---|---|
| G1 | Capture daily actuals at the point of work | ≥ 90% of working days have a submitted log |
| G2 | Produce data the Cost engine can consume without cleanup | 100% of line items carry a valid `cost_class` |
| G3 | Work when the network doesn't | Full capture offline; sync within 24h of reconnect |
| G4 | Take under 3 minutes for a typical day | Median session under 180 seconds |
| G5 | Be adopted by crews who didn't ask for it | ≥ 80% of active crew submit at least weekly by week 4 |

### Non-goals for v1

- Scheduling, Gantt charts, critical path
- Payroll processing or direct payment
- Client-facing progress portals
- Document management (plans, permits, submittals)
- Cost estimation — that is Kaicon Cost, downstream
- Multi-project portfolio views — v1 is one project at a time

Every one of these is a real need. None of them is why this app exists. Adding them before the data pipeline works would be building the restaurant before securing the ingredients.

---

## 5. Scope — v1 (Pilot)

### 5.1 Must have

**Daily log entry**
- Add line item: SKU or free-text description, quantity, unit, unit cost
- `cost_class` selection — M / F / L / E / S, required, single tap
- Phase and area selection from a project-configured list
- Line total computed automatically

**Labor entry**
- Trade, hours, worker name or ID
- Distinguishes regular / overtime / rework — **rework must be capturable**, it is among the most valuable signals for the model
- Auto-classifies as `L`

**Photo capture**
- In-app camera, attaches to the current line item or to the day
- Auto-tags project, date, GPS, phase
- Compressed before upload; original retained locally until sync confirms

**Offline-first**
- All capture works with no connectivity
- Local queue with visible pending count
- Automatic sync on reconnect; manual retry available
- No data loss on app kill or device restart

**Change orders**
- Record a CO with description, reason, amount, approver
- Link subsequent line items to the CO number

**Daily submit**
- End-of-day review screen: today's lines, total, hours
- Submit locks the day; edits after submit create an audit entry rather than overwriting

### 5.2 Should have

- Voice-to-text for descriptions and notes
- Barcode / QR scan for SKU lookup
- Duplicate detection — flag a line that looks like today's earlier entry
- Weather auto-capture (delays correlate with cost overruns)

### 5.3 Out of scope for v1

- Signature capture
- Offline maps
- Equipment telematics
- Direct accounting system integration (export only)

---

## 6. Key flows

### 6.1 End-of-day capture (the critical path)

```
Open app
  → Today's log (pre-loaded with project, date, last-used phase)
  → [+ Material]  → SKU or description → qty → unit cost → cost_class → save
  → [+ Labor]     → trade → hours → worker → regular/OT/rework → save
  → [+ Photo]     → camera → attach → save
  → Review: N lines · $X materials · Y hours
  → Submit
```

Target: under 180 seconds for a typical day of 4–8 line items.

**Design constraint:** the first screen after opening must be capture, not a dashboard. Anything between opening the app and entering data is friction paid every single day.

### 6.2 Offline → sync

```
Capture offline → local queue (badge shows "3 pending")
  → device regains connectivity
  → background sync
  → on success: badge clears, timestamp recorded
  → on conflict: PM notified, both versions retained, no silent overwrite
```

### 6.3 PM review

```
Web dashboard → project → date range
  → view submitted logs, flagged items, variance vs budget
  → resolve flags
  → export CSV / XLSX for accounting and for the Cost engine
```

---

## 7. Data requirements

The full schema is specified in the companion document, **Kaicon Field — Data Schema v0.1**. Requirements that bind the product:

- **`cost_class` is mandatory** on every cost-bearing line. A line without it cannot enter the Cost engine and represents permanently lost data.
- **Timestamps are captured, not entered.** Recording time is separate from work date; both are stored. Back-dated entries are flagged.
- **Nothing is hard-deleted.** Corrections write a new version; the original is retained with its author and timestamp.
- **Every line carries provenance** — who recorded it, on what device, at what location, online or offline.
- **Units are constrained per SKU.** Free-text units make aggregation impossible downstream.

---

## 8. Localization

| Language | Priority | Rationale |
|---|---|---|
| English | P0 | Default; PM and office |
| Spanish | **P0** | Most likely primary language of the trades on Southern California residential sites |
| Chinese (Simplified) | P1 | Ownership, PM, some crews |

Spanish is not a P1 nicety. If the crew cannot read the app, the crew will not use the app, and the entire data pipeline fails at the first mile.

Trade names, phases, and units must be localized — not just UI chrome.

---

## 9. Constraints and realities

### 9.1 The phone is not yours

Crew members use personal devices. This rules out:
- Mandatory MDM or device enrollment
- Aggressive background location
- Large app footprint
- High data consumption

Design targets: app under 60 MB, a typical day's sync under 5 MB, no background location outside an active shift.

### 9.2 Android matters as much as iOS

A significant share of the trades run Android. An iOS-only pilot would exclude a meaningful portion of the intended users and bias the very first dataset toward the people least representative of the crew.

### 9.3 Data ownership on non-affiliated GC projects

The pilot project's contractor of record is **L'Or Constructions Inc.**, which Franc is not legally associated with. Cost, vendor pricing, and labor data captured on that job is L'Or's commercial information.

**Before capture begins, a written data-use understanding should be in place** covering scope of collection, purpose, retention, and whether the data may be used to train Kaicon models. This is a prerequisite for the data being usable in a future financing diligence process, not a formality.

This is a business and legal matter for counsel, not a product decision — but it blocks the product, so it belongs in this document.

---

## 10. Pilot — 1257 Inspiration Point

| | |
|---|---|
| **Project** | Bao Residence — 1257 Inspiration Point, West Covina, CA 91791 |
| **Scope** | 223 SF first-floor addition + 510 SF second-floor addition (733 SF) + 360 SF gazebo |
| **Permits** | B25-1199 (main) · B25-1200 (gazebo) — City of West Covina |
| **GC of record** | L'Or Constructions Inc. — CSLB #1156094 |
| **PM / payments** | KPKB OC LLC |
| **Start** | July 30, 2026 |

### 10.1 Interim capture — starts July 30 regardless of app readiness

The app will not exist by July 30. The data window opens anyway.

**`Kaicon_Field_1257.xlsx` is deployed as the interim instrument.** Its schema matches the app's, so records import cleanly when Field ships. Foundation, framing, and rough-in data is captured from day one rather than reconstructed later.

Reconstructed cost data is materially less accurate than data captured the day work happened. Losing the first two months of a project's cost history to wait for an app is a worse outcome than a spreadsheet.

### 10.2 Pilot success criteria

| Criterion | Target |
|---|---|
| Working days with a submitted log | ≥ 90% |
| Line items with valid `cost_class` | 100% |
| Median time to submit a day | < 180 s |
| Data requiring manual cleanup before Cost ingest | < 5% |
| Crew still using it at week 8 | ≥ 80% |
| Sync failures resulting in lost data | 0 |

The last one is not negotiable. A crew that loses a day's work to a sync bug will never trust the app again, and rebuilding that trust costs more than the feature that broke it.

---

## 11. Release plan

| Phase | Timing | Scope | Distribution |
|---|---|---|---|
| **Interim** | Jul 30 | Spreadsheet capture | Direct file |
| **Alpha** | ~Sep | Core capture, offline, photos | TestFlight / internal APK, own crews only |
| **Beta** | ~Nov | + CO, PM dashboard, Spanish | Selected friendly GCs |
| **v1** | ~Q1 2027 | Hardened, three languages | App Store / Play Store |

Rationale for not shipping to stores early: an app that loses field data damages the Kaicon brand with exactly the audience — working contractors — who are hardest to win back. Own crews absorb early defects; customers do not.

---

## 12. Open questions

| # | Question | Owner | Needed by |
|---|---|---|---|
| Q1 | Data-use understanding with L'Or for the pilot | Franc / counsel | **Before Jul 30** |
| Q2 | Do crews use personal or company devices, and who pays for data? | Franc | Before alpha |
| Q3 | Is the 178-SKU seed library the v1 catalog, or does 1257 need its own? | Franc / Jeffrey | Before alpha |
| Q4 | Worker identity — named individuals or anonymous IDs? Affects privacy posture. | Franc | Before alpha |
| Q5 | Does the PM dashboard belong in this app or in the main Kaicon web app? | Raymond | Before beta |
| Q6 | Photo retention period and storage cost model | Raymond | Before beta |

---

## 13. Appendix — what would make this fail

Recorded deliberately, because these are the failure modes worth designing against:

1. **The crew doesn't use it.** Most likely cause of failure. Mitigation: brutal simplicity, Spanish at P0, under 3 minutes, and a site manager who is accountable for submission.
2. **Data arrives without `cost_class`.** Makes it unusable downstream. Mitigation: required field, single tap, sensible default by phase.
3. **Sync loses data.** Destroys trust permanently. Mitigation: local-first storage, no destructive operations, explicit pending state.
4. **Scope creep into project management.** Turns a focused instrument into a weak competitor to established PM tools. Mitigation: the non-goals list in §4, enforced.
5. **Waiting for the app and losing the pilot's data window.** Mitigation: §10.1 — the spreadsheet ships now.
