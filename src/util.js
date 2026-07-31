// Small cross-platform helpers shared across screens.
import { Platform } from "react-native";

// The ledger date stamp — "MON 28 JUL 2026", localized. One formatter so Today
// and Review read identically in every language (no en-US drift).
export function dateStamp(workDate, lang) {
  const locale = lang === "es" ? "es-MX" : lang === "zh" ? "zh-CN" : "en-US";
  const d = new Date(workDate + "T12:00:00");
  const wd = d.toLocaleDateString(locale, { weekday: "short" }).toUpperCase().replace(".", "");
  const mo = d.toLocaleDateString(locale, { month: "short" }).toUpperCase().replace(".", "");
  return `${wd} ${d.getDate()} ${mo} ${d.getFullYear()}`;
}

// Short localized weekday for a date string — "Mon" / "lun" / "周一".
// Localized clock time ("6:52 AM") from an ISO stamp — shared by the day-clock
// strip, the End Day receipt, and the submitted banner.
export function timeStr(iso, lang) {
  const locale = lang === "es" ? "es-MX" : lang === "zh" ? "zh-CN" : "en-US";
  return new Date(iso).toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
}

export function weekdayLabel(dateStr, lang) {
  const locale = lang === "es" ? "es-MX" : lang === "zh" ? "zh-CN" : "en-US";
  return new Date(dateStr + "T12:00:00").toLocaleDateString(locale, { weekday: "short" }).replace(".", "");
}

// ---- Web photo durability (zero-loss, Tech Eval §6) ----
// iOS Safari's camera hands the picker a blob: URL that dies with the page
// session — a force-quit or phone restart orphans the pixels while the row
// survives (the 2026-07-30 gauntlet failure). At save time, convert to a
// self-contained data: URI, downscaled so a day of photos fits the web
// store's localStorage quota. Native never enters these paths.

function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = document.createElement("img");
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function scaleToDataUri(src, maxDim, quality) {
  const w = src.naturalWidth ?? src.width;
  const h = src.naturalHeight ?? src.height;
  if (!w || !h) return null;
  const k = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

export async function durablePhotoUri(uri, { maxDim = 1600, quality = 0.6 } = {}) {
  if (Platform.OS !== "web" || !uri || uri.startsWith("data:")) return uri;
  try {
    const blob = await (await fetch(uri)).blob();
    let out = null;
    try {
      if (typeof createImageBitmap === "function") {
        const bmp = await createImageBitmap(blob);
        out = scaleToDataUri(bmp, maxDim, quality);
        bmp.close?.();
      }
    } catch {
      // Older Safari: fall through to the <img> path.
    }
    if (!out) {
      const url = URL.createObjectURL(blob);
      try {
        out = scaleToDataUri(await loadImg(url), maxDim, quality);
      } finally {
        URL.revokeObjectURL(url);
      }
    }
    if (out) return out;
    // Last resort: a full-size data URI still beats a session-scoped blob: URL.
    return await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  } catch {
    return uri;
  }
}

// Re-compress an existing data: URI (quota pressure — see store.doPersist).
// Returns null when it can't produce something strictly smaller.
export async function shrinkDataUri(dataUri, maxDim, quality) {
  if (Platform.OS !== "web" || !dataUri || !dataUri.startsWith("data:image")) return null;
  try {
    const out = scaleToDataUri(await loadImg(dataUri), maxDim, quality);
    return out && out.length < dataUri.length ? out : null;
  } catch {
    return null;
  }
}

// Haptic tap. Web: navigator.vibrate where the browser offers it (Android).
// iOS Safari has no web vibration API — silently no-op there; the native
// build gets real haptics via RN Vibration.
export function buzz(ms = 35) {
  try {
    if (Platform.OS === "web") {
      if (typeof navigator !== "undefined") navigator.vibrate?.(ms);
      return;
    }
    const { Vibration } = require("react-native");
    Vibration?.vibrate?.(ms);
  } catch {
    // haptics are garnish — never let them break a submit
  }
}

// Copy text to the clipboard on web or native. Returns true on success; on
// failure the caller's code stays visible + selectable so nothing is lost.
export async function copyToClipboard(text) {
  try {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator?.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const Clipboard = require("react-native").Clipboard;
    Clipboard?.setString?.(text);
    return true;
  } catch {
    return false;
  }
}
