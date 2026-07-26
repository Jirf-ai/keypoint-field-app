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
