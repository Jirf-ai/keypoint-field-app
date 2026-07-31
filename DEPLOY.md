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
