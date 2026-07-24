// Kaicon Field — same cream/ink/orange kit as the DD app (one company, one kit).
// Field twist: bigger touch targets everywhere — the user wears gloves.

export const colors = {
  bg: "#FAF6EF",
  card: "#FFFFFF",
  border: "#E8E1D6",
  borderStrong: "#D9CFBE",
  text: "#16130F",
  textSecondary: "#6E675E",
  textMuted: "#9C9488",

  brand: "#D9531F",
  brandDark: "#B8431A",
  brandTint: "#FBEEE6",

  green: "#15803d",
  amber: "#a16207",
  red: "#b91c1c",
};

// cost_class chip colors — distinct, high-contrast, label always shown.
export const CLASS_COLORS = {
  M: { color: "#1d4ed8", bg: "#EFF4FF" },
  F: { color: "#7c3aed", bg: "#F5F1FE" },
  L: { color: "#b45309", bg: "#FEF6E7" },
  E: { color: "#0f766e", bg: "#ECFDF8" },
  S: { color: "#be185d", bg: "#FDF0F6" },
};

export const radius = { card: 16, input: 12, pill: 999 };

export const touch = { min: 56 }; // minimum tap-target height (gloves)

export const shadow = {
  card: {
    shadowColor: "#0B1220",
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};
