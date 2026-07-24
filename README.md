# Kaicon Field

On-site data capture for the Kaicon platform (Kaicon = Keypoint). Site managers
and journeymen record what was actually consumed and actually worked, every
day, on every job — because **the Cost engine cannot be trained without ground
truth, and ground truth only exists if someone captures it at the moment work
happens** (PRD §1).

Not a project-management tool: a data acquisition instrument that happens to be
useful to the crew.

## Spec (authoritative, Franc Huang 2026-07-24)

| Doc | What it fixes |
|---|---|
| `Kaicon_Field_PRD(1).md` | Users, goals, flows, pilot, release plan |
| `Kaicon_Field_Schema(1).md` | The capture schema — `cost_class` M/F/L/E/S on everything, append-only, provenance |
| `Kaicon_Field_Tech_Evaluation(1).md` | Stack decision: Expo/RN + WatermelonDB + Supabase, offline-first |
| `REVIEW_DECISIONS.md` | Reviewer answers to the docs' open questions |

## Pilot — 1257 Inspiration Point (starts 2026-07-30)

Bao Residence, West Covina — 733 SF additions + 360 SF gazebo. GC of record
L'Or Constructions Inc.; PM KPKB OC LLC. The app will not exist by July 30;
**`Kaicon_Field_1257.xlsx` (in this repo) is the interim instrument** —
schema-matched so records import cleanly when the app ships (PRD §10.1).

## Hard requirements (carry into every build decision)

- **Offline-first, zero data loss** — capture never blocks on network; local
  queue with visible pending count; append-only server; airplane-mode test
  before crews ever see it.
- **`cost_class` required on every cost-bearing line** — a line without it is
  permanently lost data.
- **Rework must be capturable and blame-free** — `hour_type = rework` is the
  single most valuable field in the schema.
- **Under 3 minutes per day; Spanish at P0**; first screen is capture, not a
  dashboard.
- iOS + Android from day one; app small, sync cheap (personal phones).

## Platform context

BOBAI (`RamenBoui/BOBAI`) is the engine repo — this app is a face over it and
computes nothing (see `BOBAI/trunk/APPS.md`). Platform docs: `BOBAI/
Kaicon_Whole_Picture_260724.pdf` and `Kaicon_Platform_Architecture_260724.pdf`.
Sibling apps: `keypoint-dd-app` (live), `keypoint-cost-app` (planned),
`keypoint-record-app` (planned).

## Timeline (PRD §11)

Interim spreadsheet **Jul 30** → Alpha ~Sep (TestFlight/APK, own crews) →
Beta ~Nov (+CO, PM dashboard, Spanish) → v1 ~Q1 2027 (stores, 3 languages).
