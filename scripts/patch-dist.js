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

const bundle = fs.readdirSync(path.join(dist, "_expo", "static", "js", "web"))
  .find((f) => f.endsWith(".js"));
if (!bundle) throw new Error("no web bundle found in dist/_expo");
const hash = (bundle.match(/index-([0-9a-f]+)\.js/) || [])[1] || String(Date.now());

// Relative paths (idempotent: only rewrites root-absolute forms).
html = html.replace('href="/favicon.ico"', 'href="./favicon.ico"');
html = html.replace('src="/_expo/', 'src="./_expo/');

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
  "./_expo/static/js/web/${bundle}",
  "./icon.png",
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
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(
      (hit) =>
        hit ??
        fetch(e.request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
          return res;
        }),
    ),
  );
});
`);

console.log(`patched dist/: relative paths + PWA meta + sw.js (bundle ${bundle})`);
