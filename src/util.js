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
export function weekdayLabel(dateStr, lang) {
  const locale = lang === "es" ? "es-MX" : lang === "zh" ? "zh-CN" : "en-US";
  return new Date(dateStr + "T12:00:00").toLocaleDateString(locale, { weekday: "short" }).replace(".", "");
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
