// Keypoint Field — shared primitives for the Keypoint system (redesign
// 2026-07-27). Flat hairline cards, ledger typography, glove-sized targets.
// Orange marks only the one action / the unresolved / structural wayfinding;
// everything else that used to be cobalt is ink.
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, TextInput, View, ScrollView } from "react-native";
import { tr } from "../i18n";
import { PHASES, TRADES } from "../schema";
import { CLASS_COLORS, colors, fonts, radius, touch, type } from "../theme";

const keyOf = (o) => (typeof o === "string" ? o : o.code);

// Reorder an options list so the "most likely" keys lead (§2.3). Falls back to
// the given order for anything not named. Used to seed the visible chips.
export function preferred(options, firstKeys) {
  const firsts = firstKeys.map((fk) => options.find((o) => keyOf(o) === fk)).filter(Boolean);
  const rest = options.filter((o) => !firstKeys.includes(keyOf(o)));
  return [...firsts, ...rest];
}

// The "most likely first" picker orders — one copy, so every form (labor,
// item, photo, auth, end-day, viewer) agrees on what leads.
export const TRADE_ORDER = preferred(TRADES, ["laborer", "carpenter", "concrete", "framer", "electrician"]);
export const PHASE_ORDER = preferred(PHASES, ["framing", "roofing", "drywall", "gazebo"]);

// ------------------------------------------------------------------ avatar
// Worker avatar with a dead-image fallback: old profiles may hold a blob: URI
// that didn't survive a reload — show their initial rather than a gray dot.
// One component for the header, crew list, and settings (sizes differ only).
export function Avatar({ name, uri, size = 34, tone }) {
  const [broken, setBroken] = useState(false);
  const box = { width: size, height: size, borderRadius: size / 2 };
  if (!uri || broken) {
    return (
      <View style={[s.avatarBox, box, { backgroundColor: tone ?? colors.ink }]}>
        <Text style={[s.avatarInitial, { fontSize: Math.round(size * 0.4) }]}>
          {(name || "?")[0].toUpperCase()}
        </Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={[s.avatarImg, box]} onError={() => setBroken(true)} />;
}

// ------------------------------------------------------------------ money
export const usd = (n) => "$" + Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 });
export const usdCents = (n) =>
  "$" + Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ------------------------------------------------------------------ surfaces
export function Card({ children, style }) {
  return <View style={[s.card, style]}>{children}</View>;
}

export function Muted({ children, style }) {
  return <Text style={[s.muted, style]}>{children}</Text>;
}

// Group label with an optional right-aligned mono meta ("recent", "optional").
export function GroupLabel({ children, right, style }) {
  return (
    <View style={[s.groupRow, style]}>
      <Text style={type.groupLabel}>{children}</Text>
      {right ? <Text style={s.groupRight}>{right}</Text> : null}
    </View>
  );
}
export const Label = GroupLabel; // back-compat alias

// ------------------------------------------------------------------ fields
export function Field({ label, value, onChangeText, placeholder, keyboardType, autoCapitalize = "words", style, hint }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={style}>
      {label ? <Text style={[type.microLabel, { marginBottom: 6 }]}>{label}</Text> : null}
      <View style={[s.field, { borderColor: focused ? colors.accent : colors.borderStrong }]}>
        <TextInput
          style={s.fieldInput}
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.placeholder}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          selectionColor={colors.accent}
          maxFontSizeMultiplier={1.4}
        />
      </View>
      {hint ? <Text style={s.hint}>{hint}</Text> : null}
    </View>
  );
}

// Filled numeric box: mono value, mono micro-label; orange focus ring.
export function NumericField({ label, value, onChangeText, placeholder, style }) {
  const [focused, setFocused] = useState(false);
  return (
    <View style={[s.numeric, { borderColor: focused ? colors.accent : colors.borderStrong }, style]}>
      <Text style={type.microLabel}>{label}</Text>
      <TextInput
        style={s.numericInput}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.placeholder}
        keyboardType="decimal-pad"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={colors.accent}
        autoCapitalize="none"
        autoCorrect={false}
        maxFontSizeMultiplier={1.4}
      />
    </View>
  );
}

// ------------------------------------------------------------------ chips
function Chip({ label, selected, onPress, mono, classColor }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        s.chip,
        mono && s.chipMono,
        classColor && !selected && { backgroundColor: classColor.bg, borderColor: classColor.bg },
        selected && s.chipOn,
        pressed && { opacity: 0.8 },
      ]}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
    >
      <Text style={[s.chipText, mono && s.chipTextMono, classColor && !selected && { color: classColor.color }, selected && s.chipTextOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

// Collapsing chip wall (§2.3): show `show` most-likely options + a dashed
// `All N ▸`; tapping expands the rest in the SAME wrap; toggle relabels to
// `Show less ▴` and moves to the end.
export function ChipWall({ options, value, onChange, renderLabel, show = 6, mono, colorFor }) {
  const [expanded, setExpanded] = useState(false);
  const total = options.length;
  const collapsible = total > show + 1;
  const visible = !collapsible || expanded ? options : options.slice(0, show);
  return (
    <View style={s.chipWrap}>
      {visible.map((o) => {
        const k = keyOf(o);
        return (
          <Chip
            key={k}
            label={renderLabel ? renderLabel(o) : k}
            selected={value === k}
            mono={mono}
            classColor={colorFor ? colorFor(k) : null}
            onPress={() => onChange(k)}
          />
        );
      })}
      {collapsible && (
        <Pressable
          onPress={() => setExpanded(!expanded)}
          style={[s.chip, mono && s.chipMono, s.chipDashed]}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
        >
          <Text style={[s.chipDashedText, mono && { fontFamily: fonts.mono, fontSize: 13 }]}>
            {expanded ? `${tr("chipLess")} ▴` : `${tr("chipAll")} ${total} ▸`}
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// Collapsed picker row (§2.4): one-liner that expands inline to the chip wall.
// Opens by default when there is no value yet.
export function PickerRow({ label, value, displayValue, options, onChange, renderLabel, show = 6, mono, first }) {
  const [open, setOpen] = useState(value == null);
  return (
    <View style={[s.pickerRow, first && { borderTopWidth: 0 }]}>
      <Pressable
        style={s.pickerHead}
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`${label}: ${displayValue ?? "—"}`}
      >
        <Text style={type.groupLabel}>{label}</Text>
        <Text style={[s.pickerValue, value == null && { color: colors.accent }]} numberOfLines={1}>
          {displayValue ?? "—"}
        </Text>
        <Text style={s.pickerCaret}>{open ? "▴" : "▾"}</Text>
      </Pressable>
      {open && (
        <View style={{ marginTop: 9 }}>
          <ChipWall
            options={options}
            value={value}
            onChange={(v) => {
              onChange(v);
              setOpen(false);
            }}
            renderLabel={renderLabel}
            show={show}
            mono={mono}
          />
        </View>
      )}
    </View>
  );
}

// 3-column segmented control (Type of hours) — 8px-radius buttons, not pills.
export function Segmented({ options, value, onChange, renderLabel }) {
  return (
    <View style={s.segRow}>
      {options.map((o) => {
        const k = keyOf(o);
        const on = value === k;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            style={[s.seg, on && s.segOn]}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
          >
            <Text style={[s.segText, on && s.segTextOn]}>{renderLabel ? renderLabel(o) : k}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ buttons
export function Btn({ label, onPress, variant = "ink", disabled, style, fill }) {
  const box =
    variant === "green" ? s.btnGreen :
    variant === "accent" ? s.btnAccent :
    variant === "outline" ? s.btnOutline :
    variant === "destructive" ? s.btnDestructive : s.btnInk;
  const txt =
    variant === "outline" ? s.btnTextOutline :
    variant === "destructive" ? s.btnTextDestructive : s.btnTextOnInk;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [s.btn, box, fill && { flex: 1 }, disabled && { opacity: 0.32 }, pressed && !disabled && { opacity: 0.85 }, style]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
    >
      <Text style={[s.btnText, txt]}>{label}</Text>
    </Pressable>
  );
}

// Scroll body + pinned footer. Screens render <FormScreen footer={<StickyFooter…/>}>.
export function FormScreen({ children, footer }) {
  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
      {footer}
    </View>
  );
}

// Sticky footer bar (§2.4): Cancel hugs left, primary fills.
export function StickyFooter({ cancelLabel = "Cancel", onCancel, primaryLabel, onPrimary, tone = "ink", disabled }) {
  return (
    <View style={s.footer}>
      <Btn label={cancelLabel} onPress={onCancel} variant="outline" style={{ paddingHorizontal: 18 }} />
      <Btn label={primaryLabel} onPress={onPrimary} variant={tone} disabled={disabled} fill />
    </View>
  );
}

// Stacked footer variant (Settings): outlined action then destructive.
export function StackedFooter({ children }) {
  return <View style={s.footerStacked}>{children}</View>;
}

// ------------------------------------------------------------------ math strip
// The "qty × cost → $total" ledger line shared by the Item and Hours forms.
export function MathStrip({ left, amount }) {
  return (
    <View style={s.mathStrip}>
      <Text style={s.mathLeft}>{left}</Text>
      <Text style={type.moneyForm}>{amount}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ notices
// Inline notice card — the one surface for status messages across the app.
// `tone`: "error" (red, blocks), "warn" (amber, saved-anyway), or "success"
// (green, confirmation). Children are the caller's lines so each screen keeps
// its own copy.
export function NoticeCard({ tone = "error", title, children, style }) {
  const box = tone === "warn" ? s.noticeWarn : tone === "success" ? s.noticeSuccess : s.noticeError;
  const color = tone === "warn" ? colors.amber : tone === "success" ? colors.green : colors.red;
  return (
    <View style={[s.card, box, style]}>
      {title ? <Text style={[s.noticeTitle, { color }]}>{title}</Text> : null}
      {children}
    </View>
  );
}

// ------------------------------------------------------------------ status
// `solid` flips the pill from a tint to a full-color fill — used where the
// label must be unmissable (the role tag on the Today plate: Jeffrey
// 2026-07-31, after mistaking the SM surface for the crew one).
export function StatusPill({ label, color, solid }) {
  return (
    <View style={[s.statusPill, solid ? { backgroundColor: color.color } : { backgroundColor: color.bg }]}>
      <Text style={[s.statusPillText, { color: solid ? "#faf6ee" : color.color }]}>{label}</Text>
    </View>
  );
}

export const ROLE_PILL = {
  site_manager: { label: "site mgr", color: { color: "#d95a1f", bg: "#d95a1f1c" } },
  journeyman: { label: "crew", color: { color: "#15803d", bg: "#15803d18" } },
};

// ------------------------------------------------------------------ project plate
export function ProjectPlate({ code, name, role, roleLabel, city, date, onPress, hint }) {
  const pill = ROLE_PILL[role] ?? ROLE_PILL.journeyman;
  return (
    <Pressable
      onPress={onPress}
      // Pressed "pop": the plate visibly reacts to the tap, then the drawer
      // slides in from the left (Jeffrey 2026-07-30 — the action must read).
      style={({ pressed }) => [s.plate, pressed && s.platePressed]}
      accessibilityRole="button"
      accessibilityLabel={name}
    >
      <View style={s.plateRow1}>
        <Text style={type.projectCode}>{code}</Text>
        {/* Solid fill + localized full role name: which side of the app you
            are on must read at a glance (SM orange / crew green). */}
        <StatusPill label={roleLabel ?? pill.label} color={pill.color} solid />
        <View style={{ flex: 1 }} />
        {/* Left-pointing affordance: the drawer comes FROM the left, so the
            chip points left and says what opens — clearer than a bare caret. */}
        <View style={s.plateHint}>
          <Text style={s.plateHintArrow}>‹</Text>
          {hint ? <Text style={s.plateHintText}>{hint}</Text> : null}
        </View>
      </View>
      <Text style={s.plateName}>{name}</Text>
      <View style={s.plateDivider} />
      <View style={s.plateRow3}>
        <Text style={s.plateCity} numberOfLines={1}>{city}</Text>
        <Text style={type.date}>{date}</Text>
      </View>
    </Pressable>
  );
}

// ------------------------------------------------------------------ capture tiles
export function CaptureTiles({ tiles, disabled, onPress }) {
  return (
    <View style={[s.tileGrid, disabled && { opacity: 0.34 }]}>
      {tiles.map((tl) => {
        const filled = !disabled;
        const bg = disabled ? colors.card : tl.tone === "accent" ? colors.accent : colors.ink;
        return (
          <Pressable
            key={tl.key}
            disabled={disabled}
            onPress={() => onPress(tl.key)}
            style={({ pressed }) => [s.tile, { backgroundColor: bg }, disabled && s.tileDisabled, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={tl.label}
          >
            <Text style={[s.tileGlyph, disabled && { color: colors.text }]}>{tl.glyph}</Text>
            <Text style={[s.tileLabel, disabled && { color: colors.text }]}>{tl.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ------------------------------------------------------------------ ledger
export function ClassBadge({ cls, size = 30, solid }) {
  const cc = CLASS_COLORS[cls] ?? CLASS_COLORS.M;
  return (
    <View style={[s.badge, { width: size, height: size, backgroundColor: solid ? cc.color : cc.bg }]}>
      <Text style={[s.badgeText, { fontSize: Math.round(size * 0.43), color: solid ? "#fff" : cc.color }]}>{cls}</Text>
    </View>
  );
}

export function LedgerRow({ cls, title, meta, amount }) {
  return (
    <View style={s.ledgerRow}>
      <ClassBadge cls={cls} size={30} />
      <View style={{ flex: 1 }}>
        <Text style={s.ledgerTitle} numberOfLines={1}>{title}</Text>
        {meta ? <Text style={s.ledgerMeta} numberOfLines={1}>{meta}</Text> : null}
      </View>
      <Text style={type.rowAmount}>{amount}</Text>
    </View>
  );
}

// ------------------------------------------------------------------ empty states
export function EmptyState({ title, body, dashed, style }) {
  return (
    <View style={[s.empty, dashed ? s.emptyDashed : s.emptySand, style]}>
      {title ? <Text style={s.emptyTitle}>{title}</Text> : null}
      <Text style={s.emptyBody}>{body}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  avatarBox: { alignItems: "center", justifyContent: "center" },
  avatarImg: { backgroundColor: colors.surfaceSunken },
  avatarInitial: { fontFamily: fonts.mono, color: colors.onInk, fontWeight: "700" },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginHorizontal: 14,
    marginBottom: 10,
    padding: 14,
  },
  muted: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  hint: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12.5, lineHeight: 17, marginTop: 6 },
  groupRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginTop: 4, marginBottom: 9 },
  groupRight: { fontFamily: fonts.mono, fontSize: 10, color: colors.placeholder, letterSpacing: 0.4 },

  field: {
    minHeight: touch.field,
    borderRadius: radius.input,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    justifyContent: "center",
  },
  fieldInput: { fontFamily: fonts.body, fontSize: 15, fontWeight: "500", color: colors.text, paddingVertical: 0, outlineStyle: "none" },
  numeric: {
    minHeight: touch.numeric,
    borderRadius: radius.input,
    borderWidth: 1,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    paddingVertical: 7,
    justifyContent: "center",
    gap: 2,
  },
  numericInput: { ...type.numericInput, paddingVertical: 0, outlineStyle: "none" },

  chipWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    minHeight: touch.chip,
    paddingVertical: 10,
    paddingHorizontal: 15,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.card,
    justifyContent: "center",
    alignItems: "center",
  },
  chipMono: { borderRadius: radius.input, paddingHorizontal: 12, paddingVertical: 9 },
  chipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  chipText: { fontFamily: fonts.body, fontSize: 14, fontWeight: "600", color: colors.text },
  chipTextMono: { fontFamily: fonts.mono, fontSize: 13, fontWeight: "600" },
  chipTextOn: { color: colors.onInk, fontWeight: "700" },
  chipDashed: { backgroundColor: "transparent", borderStyle: "dashed", borderColor: colors.borderDashed },
  chipDashedText: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.accent },

  pickerRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 12 },
  pickerHead: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 26 },
  pickerValue: { flex: 1, textAlign: "right", fontFamily: fonts.body, fontWeight: "700", fontSize: 14.5, color: colors.text },
  pickerCaret: { color: colors.accent, fontSize: 13, fontWeight: "800" },

  segRow: { flexDirection: "row", gap: 8 },
  seg: {
    flex: 1,
    minHeight: touch.buttonSecondary,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  segOn: { backgroundColor: colors.ink, borderColor: colors.ink },
  segText: { fontFamily: fonts.body, fontSize: 14, fontWeight: "600", color: colors.text },
  segTextOn: { color: colors.onInk, fontWeight: "700" },

  btn: {
    minHeight: touch.button,
    borderRadius: radius.button,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    flexDirection: "row",
    gap: 8,
  },
  btnInk: { backgroundColor: colors.ink },
  btnAccent: { backgroundColor: colors.accent },
  btnGreen: { backgroundColor: colors.green },
  btnOutline: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.borderStrong },
  btnDestructive: { backgroundColor: "#b91c1c0a", borderWidth: 1, borderColor: "#b91c1c33" },
  btnText: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: "700" },
  btnTextOnInk: { color: colors.onInk },
  btnTextOutline: { color: colors.text, fontWeight: "600", fontSize: 15 },
  btnTextDestructive: { color: colors.red, fontWeight: "600", fontSize: 15 },

  footer: {
    backgroundColor: colors.surfaceSunken,
    borderTopWidth: 1,
    borderTopColor: "rgba(42,38,34,0.12)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    gap: 9,
    alignItems: "stretch",
  },
  footerStacked: {
    backgroundColor: colors.surfaceSunken,
    borderTopWidth: 1,
    borderTopColor: "rgba(42,38,34,0.12)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 8,
  },

  mathStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 10 },
  mathLeft: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },

  noticeError: { borderColor: "#b91c1c33", backgroundColor: "#b91c1c0a" },
  noticeWarn: { borderColor: "#a1620733", backgroundColor: "#a1620712" },
  noticeSuccess: { borderColor: "#15803d33", backgroundColor: "#15803d0a" },
  noticeTitle: { fontFamily: fonts.body, fontWeight: "700", marginBottom: 6, fontSize: 14 },

  statusPill: { borderRadius: radius.pill, paddingVertical: 3, paddingHorizontal: 8, alignSelf: "flex-start" },
  statusPillText: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "700", letterSpacing: 0.76, textTransform: "uppercase" },

  plate: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: radius.card,
    marginHorizontal: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
  },
  plateRow1: { flexDirection: "row", alignItems: "center", gap: 8 },
  platePressed: { transform: [{ scale: 0.975 }], opacity: 0.9 },
  plateHint: { flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: "#d95a1f44", backgroundColor: "#d95a1f0d", borderRadius: 999, paddingVertical: 3, paddingHorizontal: 9 },
  plateHintArrow: { color: colors.accent, fontSize: 14, fontWeight: "800", lineHeight: 15 },
  plateHintText: { fontFamily: fonts.body, fontSize: 10, fontWeight: "700", color: colors.accent, textTransform: "uppercase", letterSpacing: 0.6 },
  plateName: { ...type.projectName, lineHeight: 22, marginTop: 8 },
  plateDivider: { height: 1, backgroundColor: "rgba(42,38,34,0.1)", marginTop: 9, marginBottom: 8 },
  plateRow3: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  plateCity: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, flex: 1 },

  tileGrid: { flexDirection: "row", gap: 8, marginHorizontal: 14 },
  tile: { flex: 1, minHeight: 74, borderRadius: radius.card, padding: 13, justifyContent: "space-between" },
  tileDisabled: { borderWidth: 1, borderColor: colors.borderStrong },
  tileGlyph: { fontSize: 17, color: colors.onInk },
  tileLabel: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.onInk },

  badge: { borderRadius: radius.badge, alignItems: "center", justifyContent: "center" },
  badgeText: { fontFamily: fonts.mono, fontWeight: "700" },
  ledgerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 11,
  },
  ledgerTitle: { fontFamily: fonts.body, fontWeight: "700", fontSize: 14, color: colors.text },
  ledgerMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.label, marginTop: 1 },

  empty: { borderRadius: radius.card, marginHorizontal: 14, marginBottom: 10, paddingVertical: 26, paddingHorizontal: 20, alignItems: "center" },
  emptySand: { backgroundColor: colors.surfaceSunken },
  emptyDashed: { borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(42,38,34,0.26)" },
  emptyTitle: { fontFamily: fonts.display, fontWeight: "700", fontSize: 18, color: colors.text, marginBottom: 6, textAlign: "center" },
  emptyBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textMuted, textAlign: "center" },
});
