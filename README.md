# Keypoint Field

Mobile face over the BOBAI **Operations engine** — the on-site companion for the
crew: field video logs, SOP steps, and the observed-time capture that
recalibrates the Cost engine's labor standards.

Part of the Keypoint app family (see `BOBAI/trunk/APPS.md`):

- One repo, one deployable — no engine logic here; the app calls deployed
  Supabase functions and renders results (server is the system of record).
- Backend contract: `BOBAI/trunk/FIELD_APP_CONTRACT.md` (to be written as the
  scope lands).
- Sibling apps: `keypoint-dd-app` (address → due diligence), planned
  `keypoint-record-app` (project one-pagers).

## Status

Repo scaffolded 2026-07-24. Scope definition in progress — likely engine
surface (from the Operations root):

| Capability | Deployed functions |
|---|---|
| Field video → structured daily log | `parse-field-video`, `merge-field-log` |
| SOPs on site | `get-sop`, `expand-sop-steps` |
| Step tracking / observed time | `sop_steps` / `sop_step_events` / `sop_step_worktime` capture |

## Stack

Expo / React Native (same pattern as `keypoint-dd-app`).
