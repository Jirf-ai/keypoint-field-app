# Zero-loss gauntlet — run before any crew touches the app

Tech Evaluation §6: *"airplane mode for a full working day, force-quit
mid-capture, restart the device, then reconnect. Zero loss is the pass
condition, and this test runs before crews ever see the app."*
PRD §10.2: sync failures resulting in lost data — **0, not negotiable.**

Run on a real phone (the preview APK / TestFlight build, not Expo Go, not web).
Every step's expected result must hold or the app does not go to the pilot.

## Setup
1. Install the preview build. Create a profile (crew role), pick project 1257.
2. Note the Supabase row counts before starting (or just use a test project).

## The gauntlet
| # | Step | Pass condition |
|---|---|---|
| 1 | Airplane mode ON. Add 2 labor entries, 3 photos (camera), 1 more labor | Everything appears in Today; pending badge counts them |
| 2 | Force-quit the app mid-session (swipe away right after saving an entry) | Reopen: nothing missing, badge unchanged |
| 3 | Add another photo while still offline | Saves normally |
| 4 | **Restart the phone** (power off/on), airplane mode still ON | Reopen app: all entries + photos still there, badge unchanged |
| 5 | Leave it overnight offline if possible (storage-pressure check) | Same as 4 |
| 6 | Airplane mode OFF, open the app, land on Today | Badge drains to 0 without any taps (or after one badge tap) |
| 7 | Check Supabase: `field_labor_entries`, `field_photos` for the day | Every entry present exactly once; photos have `storage_path` + GPS |
| 8 | Force-quit during sync (turn network off mid-drain), reconnect, reopen | Remaining items sync; **no duplicates** (client UUIDs are idempotent) |
| 9 | Submit the day, then add one more entry | Day shows "amended"; late entry syncs |

## Row-count queries (run via Claude / Management API)
```sql
select count(*) from field_labor_entries where project_id = '<pid>' and work_date = '<date>';
select count(*), count(storage_path) from field_photos where project_id = '<pid>' and work_date = '<date>';
```
Counts must equal what the phone shows. `count(storage_path)` = photos whose
binary landed.

## Cleanup after a test run on 1257
Ask Claude to delete the test rows (service-role SQL + Storage API) — never
leave test data in pilot tables.

**Result log:** date, device, build, pass/fail per step — append below.

| Date | Device | Build | Result |
|---|---|---|---|
| 2026-07-29 | none — server half only | `b25dadd` via live `sync-field-log` v4 | **10/10 PASS.** Steps 7, 8, 9 and the SF-02 FK ordering, driven by a harness posting client-shaped payloads to the live endpoint on test project `56982d06` (2825 Majestic), never 1257. Proven: a full offline day lands exactly once; an identical replay (force-quit mid-sync) creates zero duplicates; a metadata-only photo later fills `storage_path` on the same `photo_id`; a bad row fails alone and is reported back while its batch-mates land; an incident and its photo link in one round; submit → late entry reads `amended`. Rows and the test GC account deleted after; row counts back to baseline. Steps 1–6 (real device, force-quit, phone restart, airplane mode, camera, GPS) STILL NOT RUN — they need a phone. |
| 2026-07-30 | Jeffrey's iPhone — installed PWA from keypoint-field.pages.dev (Cloudflare Pages went live same day) | web bundle `3f40414d` era | **Real-device half: FAIL then PASS, same day.** Attempt 1 (bundle `225b83cc`): steps 1–4 + 6 ran; badge drained to 0 but all 3 photos synced metadata-only — iOS Safari's picker returns a session-scoped `blob:` URL, and the phone restart orphaned the pixels (empty thumbnails, `storage_path` null). Fix: photos are pinned to durable downscaled `data:` URIs at save (same pattern that already protected the selfie), plus quota-pressure shrink-and-retry in the store persist. Attempt 2 on the fixed build: 3 labor + 3 camera photos captured in airplane mode, force-quit, full phone power-cycle, reconnect — **badge drained to 0 and every row landed exactly once with binary + GPS** (verified server-side: 3/3 `storage_path`, 3/3 gps). Step 5 (overnight storage-pressure) deferred. Bonus find: offline relaunch dropped the brand fonts (Google-CDN, cross-origin, never SW-cached) — fonts now self-hosted in the shell cache. Test rows from both attempts still in the tables pending cleanup. |
