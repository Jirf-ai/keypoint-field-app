// Kaicon Field — KEYPOINT system (redesign 2026-07-27, per design handoff).
// Warm paper ground, flat hairline cards (zero drop shadow), ledger typography.
// Orange is NOT a general primary — it marks exactly three things:
//   1. the one action the user opened the app for (Photo capture tile),
//   2. whatever is unresolved / blocking (empty project slot, `required`,
//      `not saved yet`, disclosure carets),
//   3. structural wayfinding (project codes, section letters, "All N ▸", diamond).
// Everything else that used to be cobalt becomes INK (#2a2622): Save, Hours &
// Item tiles, selected pills.
import { Platform } from "react-native";

export const colors = {
  bg: "#faf6ee",              // app background — cream paper
  card: "#ffffff",
  surfaceSunken: "#f2ebdd",   // sand: project plate, sticky footers, empty states
  border: "rgba(42,38,34,0.09)",       // card hairline
  borderStrong: "rgba(42,38,34,0.20)", // field + pill outline
  borderDashed: "rgba(42,38,34,0.30)", // empty slots, "All N ▸" chips

  text: "#2a2622",            // ink — primary text AND primary button fill
  textSecondary: "#5f5951",
  textMuted: "#7a736a",
  label: "#8a857c",           // group labels, mono meta
  placeholder: "#a9a29a",     // unfilled field text

  accent: "#d95a1f",          // Keypoint orange (see usage rule above)
  accentPressed: "#c04e18",
  onInk: "#faf6ee",           // text on ink fill (cream, not pure white)

  green: "#15803d",           // submit / upload / active status
  amber: "#a16207",           // warnings (day-lock notice)
  red: "#b91c1c",             // destructive / remove

  // ---- back-compat aliases (older modules still read these). Orange focus is
  // the intended field-focus color, so brand = accent works for those. ----
  brand: "#d95a1f",
  brandDark: "#c04e18",
  brandTint: "#f2ebdd",
  ink: "#2a2622",
  inkPressed: "#1f1c19",
};

// cost_class chips — same hex at 8% fill (`14` alpha suffix); Subcontract uses
// an ink tint. Status pills reuse the color at 18% (`18` suffix).
export const CLASS_COLORS = {
  M: { color: "#1d4ed8", bg: "#1d4ed814" },
  F: { color: "#d95a1f", bg: "#d95a1f14" },
  L: { color: "#15803d", bg: "#15803d14" },
  E: { color: "#a16207", bg: "#a1620714" },
  S: { color: "#2a2622", bg: "rgba(42,38,34,0.08)" },
};

// Full words for the "kind of cost" grid (§AddItemScreen).
export const CLASS_LABELS = { M: "Material", F: "Freight", L: "Labor", E: "Equipment", S: "Subcontract" };

export const radius = { card: 12, input: 8, button: 12, pill: 999, badge: 7, phone: 22 };

// Minimum tap targets (gloves): fields 50, numeric 52, chips 40, primary 52.
export const touch = { field: 50, numeric: 52, chip: 40, button: 52, buttonSecondary: 48, min: 50 };

// The system is FLAT. Kept as an empty object so any lingering `...shadow.card`
// spread is a no-op rather than a crash.
export const shadow = { card: {} };

// Three families (Google Fonts on web; add via expo-font for native builds).
export const fonts = {
  display: "Bricolage Grotesque", // headings, money — stops the eye
  body: "Hanken Grotesk",         // prose / UI
  mono: "JetBrains Mono",         // codes, numbers, labels — anything reconciled
};

// Named text styles from the handoff §1 typography table. letterSpacing is in
// px (RN unit) = fontSize × em from the spec.
export const type = {
  screenTitle: { fontFamily: fonts.display, fontWeight: "700", fontSize: 24, letterSpacing: -0.6, color: colors.text },
  projectName: { fontFamily: fonts.display, fontWeight: "700", fontSize: 18, letterSpacing: -0.36, color: colors.text },
  moneyRollup: { fontFamily: fonts.display, fontWeight: "800", fontSize: 30, letterSpacing: -0.9, color: colors.text },
  moneySubmit: { fontFamily: fonts.display, fontWeight: "800", fontSize: 38, letterSpacing: -1.33, color: colors.text },
  moneyForm: { fontFamily: fonts.display, fontWeight: "800", fontSize: 24, letterSpacing: -0.72, color: colors.text },

  body: { fontFamily: fonts.body, fontWeight: "400", fontSize: 14, color: colors.textSecondary },
  bodyStrong: { fontFamily: fonts.body, fontWeight: "600", fontSize: 14, color: colors.text },
  fieldValue: { fontFamily: fonts.body, fontWeight: "600", fontSize: 16, color: colors.text },
  groupLabel: { fontFamily: fonts.body, fontWeight: "700", fontSize: 10, letterSpacing: 1.4, textTransform: "uppercase", color: colors.label },

  navTitle: { fontFamily: fonts.mono, fontWeight: "700", fontSize: 11, letterSpacing: 1.98, textTransform: "uppercase", color: colors.text },
  brandLockup: { fontFamily: fonts.mono, fontWeight: "700", fontSize: 10, letterSpacing: 1.8, textTransform: "uppercase", color: colors.text },
  numericInput: { fontFamily: fonts.mono, fontWeight: "600", fontSize: 18, color: colors.text, fontVariant: ["tabular-nums"] },
  rowAmount: { fontFamily: fonts.mono, fontWeight: "600", fontSize: 14, color: colors.text, fontVariant: ["tabular-nums"] },
  projectCode: { fontFamily: fonts.mono, fontWeight: "700", fontSize: 10.5, letterSpacing: 0.84, color: colors.accent },
  microLabel: { fontFamily: fonts.mono, fontWeight: "600", fontSize: 9.5, letterSpacing: 1.33, textTransform: "uppercase", color: colors.label },
  date: { fontFamily: fonts.mono, fontWeight: "600", fontSize: 11, letterSpacing: 0.66, textTransform: "uppercase", color: colors.textMuted },
  spec: { fontFamily: fonts.mono, fontWeight: "500", fontSize: 11.5, lineHeight: 22, color: colors.textSecondary },
};

// Web font loading — inject the Google Fonts stylesheet once. Native builds
// should register the same families through expo-font (assets not bundled here).
let _fontsInjected = false;
export function ensureFontsWeb() {
  if (Platform.OS !== "web" || _fontsInjected || typeof document === "undefined") return;
  _fontsInjected = true;
  const pre1 = document.createElement("link");
  pre1.rel = "preconnect";
  pre1.href = "https://fonts.googleapis.com";
  const pre2 = document.createElement("link");
  pre2.rel = "preconnect";
  pre2.href = "https://fonts.gstatic.com";
  pre2.crossOrigin = "anonymous";
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href =
    "https://fonts.googleapis.com/css2?" +
    "family=Bricolage+Grotesque:opsz,wght@12..96,700;12..96,800&" +
    "family=Hanken+Grotesk:wght@400;500;600;700&" +
    "family=JetBrains+Mono:wght@500;600;700&display=swap";
  document.head.appendChild(pre1);
  document.head.appendChild(pre2);
  document.head.appendChild(link);
}
