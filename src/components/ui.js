// Field primitives — big, obvious, glove-friendly. One-handed outdoors use.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, shadow, touch } from "../theme";

export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Muted({ children, style }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

export function Label({ children }) {
  return <Text style={s.label}>{children}</Text>;
}

// The primary action: full-width, 60px tall, impossible to miss.
export function BigButton({ label, onPress, tone = "brand", disabled, style }) {
  const bg =
    tone === "brand" ? colors.brand : tone === "green" ? colors.green : colors.card;
  const fg = tone === "plain" ? colors.text : "#fff";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        s.big,
        { backgroundColor: bg },
        tone === "plain" && s.bigPlain,
        (pressed || disabled) && { opacity: disabled ? 0.4 : 0.85 },
        style,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[s.bigText, { color: fg }]}>{label}</Text>
    </Pressable>
  );
}

// Single-tap chip picker (cost class, phase, area, unit, trade, hour type).
// Chips wrap; selected fills brand; every chip is a full-height touch target.
export function PickRow({ options, value, onChange, renderLabel, colorFor }) {
  return (
    <View style={s.pickWrap}>
      {options.map((o) => {
        const key = typeof o === "string" ? o : o.code;
        const on = value === key;
        const custom = colorFor ? colorFor(key) : null;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            style={[
              s.pick,
              custom && !on && { backgroundColor: custom.bg, borderColor: custom.bg },
              on && s.pickOn,
            ]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            accessibilityLabel={renderLabel ? renderLabel(o) : key}
          >
            <Text
              style={[
                s.pickText,
                custom && !on && { color: custom.color },
                on && s.pickTextOn,
              ]}
            >
              {renderLabel ? renderLabel(o) : key}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    ...shadow.card,
  },
  muted: { color: colors.textMuted, fontSize: 13.5, lineHeight: 19 },
  label: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 8,
    marginTop: 4,
  },
  big: {
    minHeight: touch.min,
    borderRadius: radius.input,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  bigPlain: { borderWidth: 1.5, borderColor: colors.borderStrong },
  bigText: { fontSize: 17, fontWeight: "800", letterSpacing: 0.2 },
  pickWrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  pick: {
    minHeight: 46,
    paddingVertical: 11,
    paddingHorizontal: 16,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    justifyContent: "center",
  },
  pickOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  pickText: { color: colors.textSecondary, fontSize: 15, fontWeight: "700" },
  pickTextOn: { color: "#fff" },
});
