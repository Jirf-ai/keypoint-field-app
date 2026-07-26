// Kaicon Field — graphite + high-vis kit (re-skinned 2026-07-26, Jeffrey:
// "modern like Uber/Lemonade, built for construction, zero clarity loss").
// Primary actions are near-black; ONE vivid safety-orange accent carries the
// brand (badge, date, live dot, hero CTA) instead of orange slabs everywhere.
// Field twist stays: bigger touch targets everywhere — the user wears gloves.

export const colors = {
  bg: "#F4F5F7",           // cool porcelain (the cream read as early-2000s)
  card: "#FFFFFF",
  border: "#E8EAED",
  borderStrong: "#D6D9DE",
  text: "#0E1116",
  textSecondary: "#5C6470",
  textMuted: "#8A929E",

  ink: "#15181E",          // primary action surface — dark, unmistakable
  inkPressed: "#2A2F38",

  brand: "#FF5A1F",        // high-vis construction orange — accent, not wallpaper
  brandDark: "#E64A12",
  brandTint: "#FFF1EA",

  green: "#0E9F6E",
  amber: "#B45309",
  red: "#DC2626",
};

// cost_class chip colors — distinct, high-contrast, label always shown.
export const CLASS_COLORS = {
  M: { color: "#1d4ed8", bg: "#EFF4FF" },
  F: { color: "#7c3aed", bg: "#F5F1FE" },
  L: { color: "#b45309", bg: "#FEF6E7" },
  E: { color: "#0f766e", bg: "#ECFDF8" },
  S: { color: "#be185d", bg: "#FDF0F6" },
};

export const radius = { card: 20, input: 14, pill: 999 };

export const touch = { min: 56 }; // minimum tap-target height (gloves)

export const shadow = {
  card: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.05,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
};
