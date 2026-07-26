// Kaicon Field — graphite + high-vis kit (re-skinned 2026-07-26, Jeffrey:
// "modern like Uber/Lemonade, built for construction, zero clarity loss").
// Primary actions are near-black; ONE vivid safety-orange accent carries the
// brand (badge, date, live dot, hero CTA) instead of orange slabs everywhere.
// Field twist stays: bigger touch targets everywhere — the user wears gloves.

// BLUEPRINT BLUE (Jeffrey 2026-07-26, "try this for now"): single deep-cobalt
// system on light slate — Stripe/Linear family, and blueprints ARE construction.
export const colors = {
  bg: "#F6F7FB",           // light slate
  card: "#FFFFFF",
  border: "#E7E9F0",
  borderStrong: "#D8DCE6",
  text: "#0F1222",
  textSecondary: "#5A6172",
  textMuted: "#8B92A3",

  ink: "#2947F5",          // primary action surface — deep cobalt
  inkPressed: "#1F38CC",

  brand: "#2947F5",        // one color, used confidently (accent = primary)
  brandDark: "#1F38CC",
  brandTint: "#EDF0FF",

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
