# Deploy

The web app is hosted on **Cloudflare Pages** → **https://keypoint-field.pages.dev**.

## How deploys happen now (CI on push to main)

Since 2026-07-31, every push to `main` runs `.github/workflows/deploy.yml`:
build → preview deploy (`fix-check` branch) → **headless render check** (the
app must actually paint — a build once shipped blank-white with a valid
bundle hash) → promote to production. Watch runs with `gh run list`.

**It needs two GitHub repo secrets** (Settings → Secrets and variables →
Actions): `CLOUDFLARE_API_TOKEN` (a Cloudflare API token with Pages edit
permission) and `CLOUDFLARE_ACCOUNT_ID`. Without them the workflow fails
fast with an error naming this fix — nothing deploys.

> ⚠️ **As of 2026-08-01 CI has NEVER succeeded (13/13 runs failed).** Both
> secrets are set, but wrangler reports *"The Pages project keypoint-field
> does not exist"* for the account the secrets point at. The project lives
> under account **`5ef946c1cc3eba5892b3da3a945c45cf`**
> (Liaojeff630@gmail.com's Account — `npx wrangler whoami`). Fix: set
> `CLOUDFLARE_ACCOUNT_ID` to that value, and make sure
> `CLOUDFLARE_API_TOKEN` was minted **from that same account** with Pages
> edit permission, then re-run the failed workflow. Until then, every
> deploy is the manual path below.

## Manual deploy (fallback / emergency)

The pre-CI flow still works from any machine with wrangler auth:

```
npm run build                       # expo export (web) + patch-dist  →  dist/
npx wrangler pages deploy dist --project-name keypoint-field --branch main
```

`npm run build` runs:

```
EXPO_NO_TYPESCRIPT_SETUP=1 expo export --platform web && node scripts/patch-dist.js
```

1. `expo export --platform web` → static site in `dist/`.
   `EXPO_NO_TYPESCRIPT_SETUP=1` is **required**: the repo contains Deno `.ts` edge
   functions under `supabase/functions/`, and without this flag `expo export`
   aborts asking for TypeScript dev deps ("It looks like you're trying to use
   TypeScript…"). The flag skips that setup — no dependency change needed.
2. `node scripts/patch-dist.js` rewrites `dist/` for the PWA / offline path:
   relative asset paths, Add-to-Home-Screen meta + icon, self-hosted fonts
   (`assets/webfonts/` → `dist/webfonts/`), and a cache-first `sw.js` keyed to the
   current bundle hashes. **Skipping this ships no service worker** — the app can't
   work offline. Always deploy the output of `npm run build`, never a bare
   `expo export`.

Cloudflare serves at the domain root, so the relative paths patch-dist writes work
as-is. Do **not** set `GITHUB_PAGES=true` — that adds the `/keypoint-field-app`
base path (app.config.js), which is only for the retired GitHub Pages host.

## Other paths (not Cloudflare)

- `deploy-web.ps1` — a separate, Windows-only path that uploads `dist/` to a public
  Supabase Storage bucket. Independent of Cloudflare; run by hand if that
  distribution is ever needed.
- **GitHub Pages** (`jirf-ai.github.io/keypoint-field-app`) is **retired** — its
  deploy workflow was removed. That URL serves a frozen old build; don't share it.

## Web Push backend (2026-08-03 — one-time setup, then hands-off)

The client half (Settings toggle, `src/push.js`, `sw.js` push handlers) ships
with the normal Cloudflare deploy. The server half needs, once, with
`SUPABASE_ACCESS_TOKEN` set (or `npx supabase login`):

1. **Migration** — `supabase/migrations/20260803_web_push.sql`
   (`worker_push_subscriptions`, `field_push_log`, `field_clock_events.event`
   learns `ot_confirm`). Apply via MCP `apply_migration` or
   `npx supabase db push`.
2. **Function secrets** — from the untracked `.secrets/webpush-secrets.json`
   (generated 2026-08-03; regenerate with the node one-liner in git history if
   lost — a NEW VAPID key orphans existing subscriptions, so keep this one):
   `npx supabase secrets set VAPID_PUBLIC_KEY=… VAPID_PRIVATE_JWK=… CRON_KEY=… VAPID_SUBJECT=mailto:… --project-ref bbkeogzyqwszmijmvlmj`
   The public key is ALSO hardcoded in `src/push.js` — they must match.
3. **Deploy functions** — `push-token` (v2: web_push subscribe/remove shapes)
   and `notify-clocks` (the minute cron worker; bundles `webpush.js`, which is
   RFC 8291-vector-tested by `node --test scripts/webpush.test.mjs`).
4. **Cron** — run the `cron.schedule('notify-clocks-minutely', …)` SQL from the
   note at the bottom of the migration file, substituting the real CRON_KEY.
   pg_cron + pg_net are already enabled on the project (classify-photos uses
   them).

Verify: subscribe a phone via Settings → "Notifications on this phone" (PWA
must be installed to the Home Screen on iOS), insert a test start event >8h
old, invoke notify-clocks with the `x-cron-key` header, expect the push and a
`field_push_log` row; delete the test rows after.
