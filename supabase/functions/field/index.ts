// field — serves the Field app web build to crews (no app store, no accounts).
//
// TWO PLATFORM CONSTRAINTS SHAPE THIS FILE. Both were found live on
// 2026-07-28 after the app opened as raw source on a phone:
//
//  1. Supabase Storage will not serve HTML. It stores index.html with
//     mimetype text/html, but the public CDN rewrites the response to
//     `Content-Type: text/plain` + `X-Content-Type-Options: nosniff` — a
//     deliberate anti-XSS policy on the storage domain. The browser is then
//     forbidden from rendering it, so the page displays its own source.
//     => the HTML must come from here, where we control the headers.
//
//  2. The functions gateway swallows request paths ending in `.js` before
//     they reach the function (verified: /field/x and /field/a/b reach this
//     code, /field/sw.js does not). => the service worker is served from the
//     EXTENSIONLESS path /field/sw. Browsers key on Content-Type, not the
//     file extension, so that is fine — and its scope (/field/) still covers
//     the app page, which is what makes offline work.
//
// Everything else (the JS bundle, icons) is served straight from the public
// bucket, which returns correct types for those. So this function rewrites
// the two documents that need it and gets out of the way.
//
// Deploy with verify_jwt FALSE — crews open a URL, they have no token.

const BUCKET = "https://bbkeogzyqwszmijmvlmj.supabase.co/storage/v1/object/public/field-app";
const APP = "/functions/v1/field/";

const html = (body: string, extra: Record<string, string> = {}) =>
  new Response(body, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache", ...extra },
  });

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  const path = url.pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/field/, "")
    .replace(/^\//, "");

  // Relative asset paths only resolve under a trailing slash.
  if (path === "" && !url.pathname.endsWith("/")) {
    return new Response(null, { status: 302, headers: { Location: APP } });
  }

  // ---- the service worker (extensionless: see constraint 2) ----
  if (path === "sw") {
    const res = await fetch(`${BUCKET}/sw.js`);
    if (!res.ok) return new Response("// sw unavailable", { status: 502 });
    let sw = await res.text();
    // its cache list was written for a flat directory; point each entry at
    // where the file actually lives now
    sw = sw
      .replaceAll('"./index.html"', `"${APP}"`)
      .replaceAll('"./_expo/', `"${BUCKET}/_expo/`)
      .replaceAll('"./icon.png"', `"${BUCKET}/icon.png"`)
      .replaceAll('"./favicon.ico"', `"${BUCKET}/favicon.ico"`);
    return new Response(sw, {
      headers: {
        "Content-Type": "text/javascript; charset=utf-8",
        "Cache-Control": "no-cache",
        "Service-Worker-Allowed": APP,
      },
    });
  }

  // ---- the app shell ----
  if (path === "" || path === "index.html") {
    const res = await fetch(`${BUCKET}/index.html`);
    if (!res.ok) {
      return html(
        `<!doctype html><meta charset="utf-8"><title>Kaicon Field</title>
         <body style="font:16px system-ui;padding:2rem">
         <h1>Kaicon Field is not available right now</h1>
         <p>The app build could not be loaded. Tell the site supervisor.</p>
         <p style="color:#666">La aplicación no se pudo cargar. Avisa al supervisor.</p>`,
        { "Cache-Control": "no-store" },
      );
    }
    const shell = (await res.text())
      // assets load straight from the bucket, which types them correctly
      .replaceAll('"./_expo/', `"${BUCKET}/_expo/`)
      .replaceAll('"./icon.png"', `"${BUCKET}/icon.png"`)
      .replaceAll('"./favicon.ico"', `"${BUCKET}/favicon.ico"`)
      // register the extensionless worker (constraint 2)
      .replaceAll('"./sw.js"', '"./sw"');
    return html(shell);
  }

  return new Response("not found", { status: 404, headers: { "Content-Type": "text/plain" } });
});
