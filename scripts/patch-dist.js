// Post-export patch for the web-PWA distribution path. `expo export` rewrites
// dist/ from scratch each time, so everything phone-install needs is applied
// here, idempotently, by deploy-web.ps1 (or by hand: node scripts/patch-dist.js):
//   - relative asset paths (the bundle is served under a storage-path prefix)
//   - Add-to-Home-Screen meta + icon
//   - sw.js offline shell (cache-first, keyed to the current bundle hash)
const fs = require("fs");
const path = require("path");

const dist = path.join(__dirname, "..", "dist");
const htmlPath = path.join(dist, "index.html");
let html = fs.readFileSync(htmlPath, "utf8");

// ALL bundles: expo emits an entry bundle plus split chunks. The cache key
// must move when ANY of them changes (keying to one file left phones on a
// stale build when only the other changed), and every one belongs in the
// offline shell.
const bundles = fs.readdirSync(path.join(dist, "_expo", "static", "js", "web"))
  .filter((f) => f.endsWith(".js"))
  .sort();
if (!bundles.length) throw new Error("no web bundle found in dist/_expo");
const hash = bundles
  .map((b) => ((b.match(/index-([0-9a-f]+)\.js/) || [])[1] || "x").slice(0, 8))
  .join("-");

// Relative paths (idempotent: only rewrites root-absolute forms).
html = html.replace('href="/favicon.ico"', 'href="./favicon.ico"');
html = html.replace('src="/_expo/', 'src="./_expo/');

// Full-bleed on notched/home-indicator phones: viewport-fit=cover makes the
// page own the whole screen and turns on env(safe-area-inset-*), which the
// app's styles use so buttons never sit under the home indicator (idempotent).
if (!html.includes("viewport-fit=cover")) {
  html = html.replace("shrink-to-fit=no", "shrink-to-fit=no, viewport-fit=cover");
}

// Self-hosted fonts (scripts/fetch-fonts.js): copy into dist and link the
// stylesheet. Same-origin means the service worker can cache them — the
// offline relaunch keeps the brand fonts (2026-07-30 gauntlet fix).
const fontsSrc = path.join(__dirname, "..", "assets", "webfonts");
const fontFiles = fs.existsSync(fontsSrc)
  ? fs.readdirSync(fontsSrc).filter((f) => f.endsWith(".woff2"))
  : [];
if (fontFiles.length) {
  fs.mkdirSync(path.join(dist, "webfonts"), { recursive: true });
  for (const f of fontFiles) fs.copyFileSync(path.join(fontsSrc, f), path.join(dist, "webfonts", f));
  fs.copyFileSync(path.join(fontsSrc, "fonts.css"), path.join(dist, "fonts.css"));
  if (!html.includes("data-local-fonts")) {
    html = html.replace("</head>", `  <link rel="stylesheet" href="./fonts.css" data-local-fonts />\n</head>`);
  }
}

// Kill the native whole-page rubber-band (iOS drags the entire app hundreds
// of px on any touch — it stacked on top of the app's own pull-to-refresh and
// made every swipe feel hyper-sensitive). The app's ScrollView is the only
// scroller; the document itself never moves. Idempotent.
if (!html.includes("data-kf-overscroll")) {
  html = html.replace("</head>", `  <style data-kf-overscroll>
      html, body { overscroll-behavior: none; overflow: hidden; height: 100%; position: fixed; width: 100%; }
      #root { height: 100%; overflow: hidden; }
    </style></head>`);
}

// PWA meta + service-worker registration, once.
if (!html.includes("apple-mobile-web-app-capable")) {
  html = html.replace("</head>", `  <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="Keypoint Field" />
    <link rel="apple-touch-icon" href="./icon.png" />
    <script>
      if ("serviceWorker" in navigator) {
        window.addEventListener("load", function () {
          navigator.serviceWorker.register("./sw.js").catch(function () {});
        });
      }
    </script></head>`);
}
fs.writeFileSync(htmlPath, html);

fs.copyFileSync(path.join(__dirname, "..", "assets", "icon.png"), path.join(dist, "icon.png"));

fs.writeFileSync(path.join(dist, "sw.js"), `// Offline shell for the Field app web build. Cache-first: once installed, the
// app launches with no connectivity (zero-loss rule). CACHE is keyed to the
// JS bundle hash: a new export busts the old cache on next online launch.
const CACHE = "field-app-${hash}";
const SHELL = [
  "./index.html",
${bundles.map((b) => `  "./_expo/static/js/web/${b}",`).join("\n")}
${fontFiles.length ? `  "./fonts.css",\n${fontFiles.map((f) => `  "./webfonts/${f}",`).join("\n")}\n` : ""}  "./icon.png",
  "./favicon.ico",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return; // sync/API calls always hit the network
  const url = new URL(e.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL("./", self.location.href).pathname)) return;

  // Navigations are NETWORK-FIRST: the live index always references bundles
  // that exist on the server, which kills the white-screen update race
  // (a cached OLD index asking for a purged OLD bundle got the SPA fallback
  // HTML back as "JavaScript"). Offline falls back to the pre-cached shell.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html", { ignoreSearch: true })),
    );
    return;
  }

  // Assets stay cache-first (instant + offline). Never cache an HTML body
  // for a non-navigation request — that's the SPA fallback masquerading as
  // an asset, and executing it is exactly the white screen.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(e.request).then((res) => {
          const ct = res.headers.get("content-type") || "";
          if (res.ok && !ct.includes("text/html")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, copy));
          }
          return res;
        }),
    ),
  );
});
`);

console.log(`patched dist/: relative paths + PWA meta + sw.js (bundles ${bundles.join(", ")} → cache field-app-${hash})`);
