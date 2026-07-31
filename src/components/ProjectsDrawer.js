// Projects drawer (Option A) — a compact left slide-in that lists all the
// worker's projects for one-tap switching, PLUS the Records search that is
// every worker's way to find a project (restored 2026-07-30: the picker
// consolidation dropped it, which left crew on their own phones with no path
// to a project at all — the KP share-code UI it left behind was device-local
// and confusing, so search replaces it entirely per Jeffrey).
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { searchProjects } from "../api";
import { parseProject } from "./ProjectPicker";
import { colors, fonts, radius, type } from "../theme";
import { copyToClipboard } from "../util";

// Punctuation-blind key for matching pasted project codes ("2825-MAJ",
// "2825maj", "2825 MAJ" all hit the same project).
const codeKey = (s) => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

const ROLE_PILL = {
  site_manager: { label: "site mgr", color: "#d95a1f", bg: "#d95a1f1c" },
  journeyman: { label: "crew", color: "#15803d", bg: "#15803d18" },
};

export default function ProjectsDrawer({ open, onClose, t, profile, role, current, projects, onPick, onAdd }) {
  const { width } = useWindowDimensions();
  const W = Math.min(300, Math.round(Math.min(width || 380, 520) * 0.86));
  // Render only while open/animating; JS-driven animation (RN-web ignores the
  // native driver, and native-driver transforms wouldn't reliably hide it).
  const [mounted, setMounted] = useState(open);
  const x = useRef(new Animated.Value(-W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  // Records typeahead — the universal find-your-project path (any role, any
  // phone). Debounced, from 3 characters. The SAME box also takes a pasted
  // PROJECT CODE ("2825-MAJ", per-project, shown on every row/plate — Jeffrey
  // 2026-07-30): a code-shaped query searches by its street number and floats
  // the exact code match to the top.
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [noHit, setNoHit] = useState(false);
  const [copiedId, setCopiedId] = useState(null);
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    setNoHit(false);
    const term = q.trim();
    if (term.length < 3) { setResults([]); setSearching(false); return; }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const bare = codeKey(term);
      const asCode = bare.match(/^(\d{1,6})([A-Z]{2,4})$/);
      try {
        const r = (await searchProjects(asCode ? asCode[1] : term)) ?? [];
        if (asCode) {
          r.sort(
            (a, b) =>
              (codeKey(parseProject(b).code) === bare ? 1 : 0) -
              (codeKey(parseProject(a).code) === bare ? 1 : 0),
          );
        }
        setResults(r);
        setNoHit(!r.length);
      } catch {
        setResults([]);
        setNoHit(true);
      }
      setSearching(false);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setQ("");
      setResults([]);
      x.setValue(-W);
      Animated.parallel([
        Animated.timing(x, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
        Animated.timing(fade, { toValue: 1, duration: 220, easing: Easing.out(Easing.quad), useNativeDriver: false }),
      ]).start();
    } else {
      Animated.parallel([
        Animated.timing(x, { toValue: -W, duration: 190, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
        Animated.timing(fade, { toValue: 0, duration: 190, easing: Easing.in(Easing.quad), useNativeDriver: false }),
      ]).start(() => setMounted(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!mounted) return null;

  const isSM = role === "site_manager";
  const pill = ROLE_PILL[role] ?? ROLE_PILL.journeyman;
  const name = profile?.display_name ?? "";

  const projectRow = (p, keyPrefix) => {
    const m = parseProject(p);
    const isCur = p.id === current?.id;
    const active = (p.status ?? "active") === "active";
    return (
      <Pressable key={`${keyPrefix}-${p.id}`} style={[s.row, isCur && s.rowCur]} onPress={() => onPick(p)} accessibilityRole="button" accessibilityLabel={m.display}>
        {isCur && <View style={s.rail} />}
        <View style={[s.dot, { backgroundColor: active ? colors.green : colors.placeholder }]} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.rowTitle} numberOfLines={1}>{m.display}</Text>
          <Text style={s.rowMeta} numberOfLines={1}>{m.city ? `${m.city} · ` : ""}<Text style={s.rowCode}>{m.code}</Text></Text>
        </View>
        {/* SM: one tap copies this project's code to text to the crew — they
            paste it into this same search box and the project pops up first. */}
        {isSM && (
          <Pressable
            hitSlop={10}
            style={s.rowCopy}
            accessibilityRole="button"
            accessibilityLabel={t("copyCode")}
            onPress={async () => {
              if (await copyToClipboard(m.code)) {
                setCopiedId(p.id);
                setTimeout(() => setCopiedId(null), 1400);
              }
            }}
          >
            <Text style={s.rowCopyText}>{copiedId === p.id ? "✓" : "⧉"}</Text>
          </Pressable>
        )}
      </Pressable>
    );
  };

  const showingSearch = q.trim().length >= 3;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={open ? "auto" : "none"}>
      <Animated.View style={[StyleSheet.absoluteFill, s.scrim, { opacity: fade }]}>
        <Pressable style={{ flex: 1 }} onPress={onClose} accessibilityRole="button" accessibilityLabel={t("close") || "Close"} />
      </Animated.View>

      <Animated.View style={[s.panel, { width: W, transform: [{ translateX: x }] }]}>
        {/* identity */}
        <View style={s.head}>
          {profile?.selfie_uri ? (
            <Image source={{ uri: profile.selfie_uri }} style={s.av} />
          ) : (
            <View style={[s.av, s.avEmpty]}><Text style={s.avInit}>{(name || "?")[0]}</Text></View>
          )}
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={s.nameRow}>
              <Text style={s.name} numberOfLines={1}>{name}</Text>
              <View style={[s.pill, { backgroundColor: pill.bg }]}><Text style={[s.pillText, { color: pill.color }]}>{pill.label}</Text></View>
            </View>
          </View>
        </View>

        {/* Find your project — the one path for every worker. */}
        <TextInput
          style={s.search}
          value={q}
          onChangeText={setQ}
          placeholder={t("projectSearchPlaceholder")}
          placeholderTextColor={colors.placeholder}
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel={t("projectAddressLabel")}
        />

        {showingSearch ? (
          <>
            <Text style={s.lbl}>
              {searching ? t("searchingRecords") : `${results.length} ${results.length === 1 ? t("matchOne") : t("matchMany")}`}
            </Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {searching && <ActivityIndicator color={colors.accent} style={{ marginTop: 14 }} />}
              {!searching && results.map((p) => projectRow(p, "hit"))}
              {!searching && noHit && <Text style={s.emptyText}>{t("noProjectFound")}</Text>}
            </ScrollView>
          </>
        ) : (
          <>
            <Text style={s.lbl}>{t("projectsLabel")} · {projects.length}</Text>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {projects.length === 0 ? (
                <Text style={s.emptyText}>{t("noProjectsYet")}</Text>
              ) : (
                projects.map((p) => projectRow(p, "mine"))
              )}
            </ScrollView>
          </>
        )}

        {/* pinned action — site managers create projects; crew find theirs by
            searching above, so they get no footer button. */}
        {isSM && (
          <View style={s.foot}>
            <Pressable style={s.action} onPress={onAdd} accessibilityRole="button">
              <Text style={s.actionText}>+ {t("addProject")}</Text>
            </Pressable>
          </View>
        )}
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  scrim: { backgroundColor: "rgba(20,16,12,0.42)" },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.bg,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: Platform.OS === "android" ? 40 : Platform.OS === "web" ? "max(16px, env(safe-area-inset-top))" : 16,
    paddingHorizontal: 14,
    paddingBottom: 0,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10, paddingBottom: 13, borderBottomWidth: 1, borderBottomColor: colors.border },
  av: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceSunken },
  avEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  avInit: { fontFamily: fonts.mono, color: colors.onInk, fontSize: 15, fontWeight: "700" },
  nameRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "800", color: colors.text, flexShrink: 1 },
  pill: { borderRadius: 999, paddingVertical: 3, paddingHorizontal: 7 },
  pillText: { fontFamily: fonts.mono, fontSize: 9, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase" },

  search: {
    marginTop: 12,
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.input,
    backgroundColor: colors.card,
    paddingHorizontal: 12,
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
  },

  lbl: { ...type.groupLabel, marginTop: 14, marginBottom: 4 },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, paddingVertical: 12 },

  row: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, paddingHorizontal: 8, borderRadius: 9, position: "relative" },
  rowCur: { backgroundColor: colors.surfaceSunken },
  rail: { position: "absolute", left: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: colors.accent },
  dot: { width: 7, height: 7, borderRadius: 4, flex: 0, alignSelf: "center" },
  rowTitle: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: "700", color: colors.text },
  rowMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 1 },
  rowCode: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.accent, fontWeight: "700", letterSpacing: 0.3 },
  rowCopy: { borderWidth: 1, borderColor: "#d95a1f44", borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8, backgroundColor: "#d95a1f0d" },
  rowCopyText: { color: colors.accent, fontSize: 12, fontWeight: "800" },

  foot: { paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  action: {
    minHeight: 46,
    borderRadius: radius.input,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217,90,31,0.5)",
    backgroundColor: "#d95a1f0d",
    alignItems: "center",
    justifyContent: "center",
  },
  actionText: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.accent },
});
