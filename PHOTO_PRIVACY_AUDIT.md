# Photo Privacy Audit — 2026-07-30

Question audited: **can the app take or leak photos from a crew member's phone
without them choosing to upload them?** Answer: **no.** Verified in code and by
live probes against the production Supabase project, the day before the 1257
pilot. No code changes were needed — this file is the record of what was
checked and why it holds.

## 1. Photos enter only by deliberate user action

- Exactly one function queues a photo for upload: `addPhoto` (`src/store.js`).
  Its only callers are `AddPhotoScreen.js` and `IncidentScreen.js`.
- Both paths are user-initiated: `launchCameraAsync` (a photo the worker takes
  right then) or `launchImageLibraryAsync` (the **OS photo picker**, which runs
  out-of-process — iOS PHPicker / Android Photo Picker — and hands the app only
  the photos the user taps; the app can never browse or enumerate the library).
- `expo-media-library` (the package an app would need to scan a camera roll) is
  **not installed** — see `package.json`. No background photo access exists.

## 2. Explicit review-before-upload in both flows

- `AddPhotoScreen`: pending photos sit in a "NOT SAVED YET" review state with
  per-photo ✕ remove ("drop misfires"); nothing is stored or queued until the
  explicit **Upload N** press.
- `IncidentScreen`: thumbnails with ✕ remove shown before "Save incident";
  post-save confirmation card states exactly what was kept, incl. photo count.
- Sync (`src/sync.js`) pushes only what those confirmations queued.

## 3. Personal metadata stripped on the way in

- Camera captures use `exif: false`; both paths re-encode at `quality: 0.6`,
  which strips original EXIF (home GPS, device info) from library picks.
- The only location on a photo is the job-site geotag the app itself adds,
  disclosed in the `expo-location` permission string (`app.json`).

## 4. Server side is closed — live-probed 2026-07-30

Probes run against `bbkeogzyqwszmijmvlmj.supabase.co` using only what an
outsider could extract from the app bundle (the anon key):

| Probe | Result |
| --- | --- |
| Public URL fetch from `field-photos` bucket | `NoSuchBucket` — bucket is private |
| List bucket contents with anon key | `[]` — RLS blocks |
| Upload rogue file with anon key | `403` — RLS denies writes |
| Read `field_photos` table via REST with anon key | `[]` — RLS blocks |
| Call `sync-field-log` with no credentials | `401` |

Photos are readable only with the service-role key, which exists solely in the
edge-function environment — never on a device.

## Residual risks (accepted for pilot)

1. **Intentional upload of a personal photo** cannot be prevented by code —
   crew briefing line: *"only job photos; whatever you upload goes on the
   project record."*
2. **Write-spoofing:** `sync-field-log` accepts any valid JWT (the shared anon
   key qualifies), so someone holding the key AND a project's unguessable UUID
   could inject junk *rows* (never read anything out). Pilot-acceptable;
   hardening path is tying sync to the worker-auth login when scaling past one
   crew.
