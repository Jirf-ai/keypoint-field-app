// Web Push for the PWA (2026-08-03) — the browser channel that lets the
// server's notify-clocks cron reach a phone with the app closed (the 8h
// overtime warning, the 12h still-working check). Native installs use
// notifications.js/Expo instead; this module is web-only and no-ops
// everywhere else. Never throws — callers get { ok, reason }.
//
// iPhone caveat (iOS 16.4+): Web Push only works for a PWA ADDED TO THE HOME
// SCREEN — exactly how the crew installs it, but Safari-tab users will see
// "unsupported" until they install.
import { Platform } from "react-native";
import { call } from "./api";
import { activeProfile } from "./store";

// Public half of the VAPID pair (safe to ship). The private half lives only
// in the Supabase function secrets (VAPID_PRIVATE_JWK) — see DEPLOY.md.
const VAPID_PUBLIC_KEY =
  "BNtdc4W6Pv6APAl09AEjjdwEn4howLMqnddFdJsXWV95jcWzH9PknYEVCJPzq3Sn-I7eKi3L4bDZF2YDVDMYmQ4";

function b64uToUint8(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return (
    Platform.OS === "web" &&
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof window !== "undefined" &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

async function registration() {
  // patch-dist registers ./sw.js on load; the dev server has no sw, so this
  // resolves null there and every caller degrades to "unsupported".
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}

// Current state for the Settings row: "on" | "off" | "blocked" | "unsupported"
export async function pushStatus() {
  if (!pushSupported()) return "unsupported";
  const reg = await registration();
  if (!reg) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    const sub = await reg.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

export async function enablePush() {
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  const me = activeProfile();
  if (!me?.worker_id) return { ok: false, reason: "no-profile" };
  const reg = await registration();
  if (!reg) return { ok: false, reason: "unsupported" };

  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return { ok: false, reason: "blocked" };
    const sub =
      (await reg.pushManager.getSubscription()) ??
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: b64uToUint8(VAPID_PUBLIC_KEY),
      }));
    const r = await call("push-token", { worker_id: me.worker_id, web_push: sub.toJSON() });
    if (!r.ok) {
      // The server never saw it — leave the browser unsubscribed too, so the
      // Settings row's state can't lie.
      await sub.unsubscribe().catch(() => {});
      return { ok: false, reason: "server" };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "subscribe-failed" };
  }
}

export async function disablePush() {
  if (!pushSupported()) return { ok: true };
  const me = activeProfile();
  const reg = await registration();
  try {
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      const endpoint = sub.endpoint;
      await sub.unsubscribe().catch(() => {});
      if (me?.worker_id) {
        await call("push-token", { worker_id: me.worker_id, web_push_remove: endpoint }).catch(() => {});
      }
    }
    return { ok: true };
  } catch {
    return { ok: true }; // best-effort — local unsubscribe is what matters
  }
}
