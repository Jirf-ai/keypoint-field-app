# Deploy

The web app is hosted on **Cloudflare Pages** → **https://keypoint-field.pages.dev**.

Deploys are driven by Cloudflare Pages' **Git integration**: every push to `main`
auto-builds and deploys. Nothing runs from a GitHub Actions workflow anymore.

## Cloudflare Pages dashboard settings

Set these once on the Pages project (Settings → Builds & deployments):

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | `/` (repo root) |
| Node version | from `.nvmrc` (`20`) — or set env `NODE_VERSION=20` if the image ignores it |

That's the whole config. Everything the build needs is in the repo, so builds are
reproducible and can't silently drift.

## What `npm run build` does

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
   current bundle hashes. Skipping this ships no service worker (the reason the old
   GitHub Pages workflow was retired).

Cloudflare serves at the domain root, so the relative paths patch-dist writes work
as-is. Do **not** set `GITHUB_PAGES=true` for Cloudflare — that adds the
`/keypoint-field-app` base path (app.config.js) which is only for GitHub Pages.

## Other paths (not Cloudflare)

- `deploy-web.ps1` — a separate, Windows-only path that uploads `dist/` to a public
  Supabase Storage bucket. Independent of Cloudflare; run by hand if that
  distribution is ever needed.
- **GitHub Pages** (`jirf-ai.github.io/keypoint-field-app`) is **retired** — its
  deploy workflow was removed. That URL serves a frozen old build; don't share it.
