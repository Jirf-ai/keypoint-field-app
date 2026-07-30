# Deploy

The web app is hosted on **Cloudflare Pages** → **https://keypoint-field.pages.dev**.

## How deploys happen now (manual — the pilot flow)

Deploys are **manual and deliberate**: someone builds locally and pushes the
finished files to Cloudflare with `wrangler`. This is on purpose during the pilot
— nothing reaches the crew's phones until we choose to deploy after testing. That
manual gate is a feature, not a gap.

```
npm run build                       # expo export (web) + patch-dist  →  dist/
npx wrangler pages deploy dist      # upload dist/ to the Cloudflare Pages project
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

## Optional post-pilot upgrade: push-to-deploy (Git integration)

Not set up, and deliberately deferred until after the pilot (auto-deploy would push
work-in-progress commits straight to the field). When the app settles down, connect
the repo in the Cloudflare dashboard so Cloudflare rebuilds and deploys on every
push to `main` — no PC, no manual `wrangler`.

The build script this needs is **already in the repo** (`npm run build`, above), so
it won't ship the offline-broken build the old GitHub Pages workflow did. Dashboard
settings (Settings → Builds & deployments) would be:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repo root) |
| Node version | from `.nvmrc` (`20`) — or env `NODE_VERSION=20` |

## Other paths (not Cloudflare)

- `deploy-web.ps1` — a separate, Windows-only path that uploads `dist/` to a public
  Supabase Storage bucket. Independent of Cloudflare; run by hand if that
  distribution is ever needed.
- **GitHub Pages** (`jirf-ai.github.io/keypoint-field-app`) is **retired** — its
  deploy workflow was removed. That URL serves a frozen old build; don't share it.
