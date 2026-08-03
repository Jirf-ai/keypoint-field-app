// Proves supabase/functions/notify-clocks/webpush.js against RFC 8291
// Appendix A — the complete interop vector, fetched verbatim from the RFC.
// Run: node --test scripts/webpush.test.mjs   (Node 20+, WebCrypto global)
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  b64uToBytes, bytesToB64u, encrypt, importEcdhPrivate, vapidAuthHeader,
} from "../supabase/functions/notify-clocks/webpush.js";

// RFC 8291 Appendix A inputs
const PLAINTEXT = "When I grow up, I want to be a watermelon";
const AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const SALT = "DGv6ra1nlYgDCS1FRnbzlw";
// RFC 8291 Appendix A final output — the complete encrypted message.
const EXPECTED =
  "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlml" +
  "MoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4M" +
  "qgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN";

test("b64u round-trips", () => {
  const bytes = b64uToBytes(AS_PUBLIC);
  assert.equal(bytes.length, 65);
  assert.equal(bytesToB64u(bytes), AS_PUBLIC);
});

test("RFC 8291 Appendix A: byte-exact encrypted message", async () => {
  const asPublicRaw = b64uToBytes(AS_PUBLIC);
  const out = await encrypt(
    PLAINTEXT,
    { p256dh: UA_PUBLIC, auth: AUTH_SECRET },
    {
      asPrivate: await importEcdhPrivate(AS_PRIVATE, asPublicRaw),
      asPublicRaw,
      salt: b64uToBytes(SALT),
    },
  );
  assert.equal(bytesToB64u(out), EXPECTED);
});

test("VAPID header: well-formed ES256 JWT that verifies against its public key", async () => {
  const pair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"],
  );
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const vapid = {
    subject: "mailto:ops@example.com",
    publicKey: bytesToB64u(publicRaw),
    privateJwk: { x: jwk.x, y: jwk.y, d: jwk.d },
  };
  const header = await vapidAuthHeader("https://fcm.googleapis.com/fcm/send/abc123", vapid);

  const m = header.match(/^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/);
  assert.ok(m, `header shape: ${header}`);
  const [h, p, sig] = m[1].split(".");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.aud, "https://fcm.googleapis.com");
  assert.equal(payload.sub, "mailto:ops@example.com");
  assert.ok(payload.exp > Date.now() / 1000 + 3600);
  assert.equal(m[2], vapid.publicKey);

  const ok = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    pair.publicKey,
    b64uToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`),
  );
  assert.equal(ok, true, "JWT signature must verify");
});
