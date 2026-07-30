// One-time (re-)fetch of the app's three font families from Google Fonts into
// assets/webfonts/, with a rewritten local fonts.css. Self-hosting puts the
// fonts inside the service-worker cache — the 2026-07-30 gauntlet showed an
// offline relaunch losing the brand fonts because fonts.gstatic.com is
// cross-origin and never cached. Run: node scripts/fetch-fonts.js
const fs = require("fs");
const path = require("path");

const CSS_URL =
  "https://fonts.googleapis.com/css2?" +
  "family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&" +
  "family=Hanken+Grotesk:wght@400;500;600;700&" +
  "family=JetBrains+Mono:wght@500;600;700&display=swap";

// A modern-browser UA makes css2 serve woff2 (default UA gets legacy ttf).
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const outDir = path.join(__dirname, "..", "assets", "webfonts");

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const res = await fetch(CSS_URL, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`css2 fetch failed: ${res.status}`);
  let css = await res.text();

  const urls = [...new Set([...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+\.woff2)\)/g)].map((m) => m[1]))];
  if (!urls.length) throw new Error("no woff2 urls in css2 response");

  for (const u of urls) {
    // Unique, stable local name: family dir + versioned filename.
    const parts = new URL(u).pathname.split("/").filter(Boolean); // s/<family>/<ver>/<file>
    const local = `${parts[1]}-${parts[parts.length - 1]}`;
    const r = await fetch(u, { headers: { "User-Agent": UA } });
    if (!r.ok) throw new Error(`font fetch failed: ${u} -> ${r.status}`);
    fs.writeFileSync(path.join(outDir, local), Buffer.from(await r.arrayBuffer()));
    css = css.split(u).join(`./webfonts/${local}`);
    console.log(`fetched ${local} (${fs.statSync(path.join(outDir, local)).size} bytes)`);
  }

  fs.writeFileSync(path.join(outDir, "fonts.css"), css);
  console.log(`wrote fonts.css referencing ${urls.length} local woff2 files`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
