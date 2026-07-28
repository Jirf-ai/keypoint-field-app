# Kaicon Field — User Story Backlog

Personas and stories for the on-site daily-capture app. Grounded in the PRD
(`Kaicon_Field_PRD(1).md`): Field is a **data-acquisition instrument** for the
Kaicon Cost engine — capture what was *actually* consumed and *actually* worked,
at the moment of work. Brutal simplicity, offline-first, Spanish at P0.

Status legend: ✅ built · ⏸ deferred (needs a dependency / decision) · ⚠ pushes
against the PRD's "not a PM tool" non-goals.

---

## Personas

- **Site Manager / Foreman** — records the day's consumption and labor, reviews,
  submits; owns data quality. Runs the full log.
- **Crew / Journeyman** — logs their own hours and photos. Low friction,
  Spanish-first, personal device.
- **Subcontractor lead** *(expansion)* — on site but not employed by the GC;
  documents their own trade's work and crew.
- **Safety / compliance lead** *(expansion)* — usually the foreman's second hat;
  owns the safety records inspectors and insurers ask for.
- **PM / Office** *(tertiary, desktop)* — reviews, resolves flags, exports. Out
  of scope for this mobile app.

---

## Phase 1 — core capture (shipped)

### Site Manager
| # | Story | Status |
|---|---|---|
| SM-01 | Stay signed in | ✅ |
| SM-02 | Capture-first on open | ✅ |
| SM-03 | Create a project with configurable areas | ✅ |
| SM-04 | Switch between projects | ✅ |
| SM-05 | Generate a crew join code | ✅ |
| SM-06 | Material line (qty/unit/cost, auto-total) | ✅ |
| SM-07 | cost_class required, sensible default by phase | ✅ |
| SM-08 | Phase/area tagging from a constrained list | ✅ |
| SM-09 | Reuse last-used phase/area/rate | ✅ |
| SM-10 | Voice-to-text for descriptions | ⏸ |
| SM-11 | Barcode/QR scan into the SKU field | ✅ |
| SM-12 | Duplicate-line warning | ✅ |
| SM-13 | Labor rework as a first-class type, auto-`L` | ✅ |
| SM-14 | Record hours for someone else | ✅ |
| SM-15 | Consistent worker identity (named) | ✅ |
| SM-16 | Photo attached to a line or the day | ✅ |
| SM-17 | Photo auto-tags project/date/GPS/phase | ✅ |
| SM-18 | Compress + keep original until sync | ✅ |
| SM-19 | Record a change order | ✅ |
| SM-20 | Link a line item to a change order | ✅ |
| SM-21 | Full capture offline | ✅ |
| SM-22 | Visible pending-sync count | ✅ |
| SM-23 | Auto sync on reconnect + manual retry | ✅ |
| SM-24 | Zero data loss on kill/restart | ✅ |
| SM-25 | Conflicts retain both versions | ✅ |
| SM-26 | End-of-day review screen | ✅ |
| SM-27 | Submit locks the day | ✅ |
| SM-28 | Edit after submit → append-only correction | ✅ |
| SM-29 | Recording time captured automatically | ✅ |
| SM-30 | Weather auto-capture | ⏸ |
| SM-31 | Full localization (UI, trades, phases) | ✅ |
| SM-32 | Glove-sized tap targets | ✅ |

### Crew / Journeyman
| # | Story | Status |
|---|---|---|
| CR-01 | Join a project by code | ✅ |
| CR-02 | Small app footprint | ✅ |
| CR-03 | Android/iOS parity | ✅ |
| CR-04 | Log hours in <1 min, trade prefilled | ✅ |
| CR-05 | Regular / overtime / rework | ✅ |
| CR-06 | Yesterday's values as a starting point | ✅ |
| CR-07 | Voice for hours/notes | ⏸ |
| CR-08 | Photo of completed work | ✅ |
| CR-09 | Compress + Wi-Fi-only upload option | ✅ |
| CR-10 | Offline logging | ✅ |
| CR-11 | Never lose a logged entry | ✅ |
| CR-12 | Clear saved / synced state | ✅ |
| CR-13 | Whole app in Spanish | ✅ |
| CR-14 | Whole app in Chinese | ✅ |
| CR-15 | See only the few fields that matter to me | ✅ |
| CR-16 | No background location | ✅ |

Also shipped beyond the original backlog: **location provenance on every record**
(web + native, all line types, not just photos) and **CS-01 "my hours this week"**
(below).

---

## Phase 2 — day-to-day documentation (expansion)

Everything below serves the same mission — more ground truth, captured at the
moment of work — **except** ⚠ items, which drift toward project-management scope
the PRD fenced off. Built items marked ✅.

### A — Safety & compliance
- **SF-01 ⭐** Foreman runs a **toolbox talk** and captures attendees (tap faces).
- **SF-02 ⭐** Any worker reports an **incident / near-miss** with photo + location.
- **SF-03** Daily **heat-illness / weather check** (Cal-OSHA §3395), temp-stamped.
- **SF-04** One-tap daily **PPE / hazard acknowledgment**.

### B — Deliveries & materials received
- **DL-01 ⭐** Log a **delivery** by photographing the packing slip.
- **DL-02 ⭐** Flag a delivery **short or damaged** (received ≠ ordered).
- **DL-03** **Equipment/rental check-in and check-out** with dates.

### C — Time & attendance
- **TA-01 ⭐** Crew **clock in/out** with a location stamp.
- **TA-02** Foreman **who's-on-site headcount** roster.
- **TA-03 ⚠** **Meal/rest-break logging** (California penalties) — payroll-adjacent.

### D — Quality, inspections & rework
- **QA-01 ⭐** Log an **inspection result** (rough/final, pass/fail, inspector, photo).
- **QA-02** Open/close a **punch-list item** with before/after photos.
- **QA-03 ⭐** Raise an **RFI** with a photo; link resulting rework back to it.

### E — Progress narrative & media
- **PR-01 ⭐** Short **daily progress note** (advanced / blocked).
- **PR-02** **Dictate** that note by voice (shares SM-10/CR-07).
- **PR-03** **Before/after photo pairs** per area/phase.
- **PR-04 ⚠** **Video walkthrough** transcribed to notes — bandwidth-heavy.

### F — Site conditions & blockers
- **SC-01 ⭐** Log a **delay/blocker** with a reason code (weather, materials, hold, access).
- **SC-02** Flag a **site access / utility issue** with a photo.

### G — Subcontractors & visitors
- **SUB-01 ⭐** Sub lead logs **their own crew's hours and trade work**.
- **SUB-02** **Visitor log** (inspector, owner, architect on site).

### H — Crew self-service & motivation
- **CS-01 ⭐ ✅** Crew sees **their own hours this week** (day + type + project breakdown).
- **CS-02 ⭐** **End-of-day reminder** if they haven't logged.
- **CS-03** Browse **my photos** for a project.

### I — Foreman oversight & completeness
- **OV-01 ⭐** See **which crew haven't logged today**.
- **OV-02** **Duplicate yesterday** as a starting point.
- **OV-03 ⚠** **Approve/reject** a crew member's submitted hours — approval workflow.

### J — Trust, audit & verification
- **AU-01** **View the edit history** of a line (chain already exists).
- **AU-02** **Flag a line for PM review** with a note.
- **AU-03 ⚠** **Signature** for a delivery/handoff — v1 non-goal (PRD §5.3).

---

## Acceptance criteria — priority set

The four highest-leverage expansion stories (plus CS-01, now built). The rest
get AC when scheduled.

### CS-01 — My hours this week ✅ (built)
> As a crew member, I want to see my own hours this week, so the app gives *me*
> something back — the biggest lever against the "crew doesn't use it" failure.

- [x] A **This week** card on the crew's Today screen shows the running week total.
- [x] Tapping it opens a detail screen: week total, a **regular / overtime / rework**
      split, a **Mon–Sun** day breakdown (today marked, mini bars), and a
      **by-project** split when more than one job contributed.
- [x] Hours are the worker's own (matched to their profile name), active versions
      only, summed across all their projects (a pay week isn't per-job).
- [x] Week = the calendar week (Mon–Sun) containing today; localized weekday labels.
- [x] Zero state reads "No hours logged this week yet."
- [x] Read-only; header back closes it. es/zh complete.

### DL-01 — Log a material delivery
> As a site manager, I want to log a delivery by photographing the packing slip,
> so received SKUs/quantities are captured without retyping.

- [ ] From Today, a **+ Delivery** action captures ≥1 packing-slip photo, vendor,
      and delivery date (defaults to today), tagged to the current project.
- [ ] Optional line items received (SKU, qty, unit) — reuses the item form + barcode.
- [ ] Stored append-only with provenance (who/when/where/offline), same as a line.
- [ ] Works fully offline; syncs with the day's rows.
- [ ] es/zh complete.

### DL-02 — Flag a short or damaged delivery
> As a site manager, I want to flag a delivery as short or damaged, so the
> variance is a visible signal, not a silent loss.

- [ ] On a delivery, mark a line **received qty ≠ ordered qty**, or flag **damaged**
      with a reason and photo.
- [ ] The variance is stored as a first-class field the Cost engine/PM can read
      (not buried in a note).
- [ ] A warning-toned confirmation is shown; saving is never blocked.
- [ ] es/zh complete.

### SF-02 — Report an incident / near-miss
> As any worker, I want to report an incident or near-miss with a photo,
> location, and note in under a minute.

- [ ] Available to **every** role from Today, not buried in a menu.
- [ ] Captures: type (injury / near-miss / property / other), short description,
      ≥1 photo, auto location + timestamp, reporter identity.
- [ ] Works offline; syncs like any record; nothing hard-deleted (append-only).
- [ ] Confirmation that it was recorded; median capture < 60 s.
- [ ] es/zh complete (safety copy is P0 for a Spanish-speaking crew).

### SC-01 — Log a delay / blocker with a reason
> As a foreman, I want to log a delay/blocker with a reason code, so schedule
> slippage has a documented cause (the PRD notes delays correlate with overruns).

- [ ] **+ Delay** captures a reason from a constrained enum (weather, no materials,
      inspection hold, site access, other), an optional note/photo, and duration.
- [ ] Tagged to project, phase/area, date; provenance stamped.
- [ ] Reason is an enum (not free text) so it aggregates across jobs.
- [ ] Offline-first; append-only; es/zh complete.

---

## Deferred (need a dependency + decision)
- **SM-10 / CR-07 / PR-02** voice-to-text — native speech module + dev build.
- **SM-30** weather auto-capture — weather API + key, lat/lng lookup at submit.
- **PR-04** video walkthrough → transcript — bandwidth + the Field Log video tool.

## Explicitly out of scope per PRD (revisit only with a reason)
Scheduling / Gantt / critical path · payroll or direct payment · client-facing
portals · document management · cost estimation (that's Kaicon Cost) ·
multi-project portfolio views · signature capture (§5.3).
