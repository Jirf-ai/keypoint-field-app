// Projects drawer (Option A) — a compact left slide-in that lists all the
// worker's projects for one-tap switching. Opened by tapping the header avatar.
// Site managers add projects from here; crew join a manager's list.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { parseProject } from "./ProjectPicker";
import { colors, fonts, radius, type } from "../theme";
import { copyToClipboard } from "../util";

const ROLE_PILL = {
  site_manager: { label: "site mgr", color: "#d95a1f", bg: "#d95a1f1c" },
  journeyman: { label: "crew", color: "#15803d", bg: "#15803d18" },
};

export default function ProjectsDrawer({ open, onClose, t, profile, role, current, projects, shareCode, onPick, onAdd, onJoin }) {
  const { width } = useWindowDimensions();
  const W = Math.min(300, Math.round(Math.min(width || 380, 520) * 0.86));
  // Render only while open/animating; JS-driven animation (RN-web ignores the
  // native driver, and native-driver transforms wouldn't reliably hide it).
  const [mounted, setMounted] = useState(open);
  const [copied, setCopied] = useState(false);
  const x = useRef(new Animated.Value(-W)).current;
  const fade = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (open) {
      setMounted(true);
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
            {isSM && shareCode ? (
              <>
                <View style={s.shareRow}>
                  <Text style={s.share}>{t("projectListCode")} · {shareCode}</Text>
                  <Pressable
                    hitSlop={8}
                    style={s.copyChip}
                    accessibilityRole="button"
                    accessibilityLabel={t("copyCode")}
                    onPress={async () => {
                      if (await copyToClipboard(shareCode)) {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1600);
                      }
                    }}
                  >
                    <Text style={s.copyChipText}>{copied ? `✓ ${t("copiedCode")}` : `⧉ ${t("copyCode")}`}</Text>
                  </Pressable>
                </View>
                {/* TWO codes exist and GCs must never mix them up (Jeffrey
                    2026-07-30): this one shares the PROJECT LIST with crew who
                    already have accounts; the company TEAM code (Settings) is
                    what NEW crew register with. */}
                <Text style={s.shareHint}>{t("projectListCodeHint")}</Text>
              </>
            ) : null}
          </View>
        </View>

        <Text style={s.lbl}>{t("projectsLabel")} · {projects.length}</Text>

        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} showsVerticalScrollIndicator={false}>
          {projects.length === 0 ? (
            <Text style={s.emptyText}>{isSM ? t("noProjectsYet") : t("teamProjects")}</Text>
          ) : (
            projects.map((p) => {
              const m = parseProject(p);
              const isCur = p.id === current?.id;
              const active = (p.status ?? "active") === "active";
              return (
                <Pressable key={p.id} style={[s.row, isCur && s.rowCur]} onPress={() => onPick(p)} accessibilityRole="button" accessibilityLabel={m.display}>
                  {isCur && <View style={s.rail} />}
                  <View style={[s.dot, { backgroundColor: active ? colors.green : colors.placeholder }]} />
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={s.rowTitle} numberOfLines={1}>{m.display}</Text>
                    <Text style={s.rowMeta} numberOfLines={1}>{m.city ? `${m.city} · ` : ""}<Text style={s.rowCode}>{m.code}</Text></Text>
                  </View>
                </Pressable>
              );
            })
          )}
        </ScrollView>

        {/* pinned action */}
        <View style={s.foot}>
          <Pressable style={s.action} onPress={isSM ? onAdd : onJoin} accessibilityRole="button">
            <Text style={s.actionText}>{isSM ? `+ ${t("addProject")}` : `${t("joinList")} ▸`}</Text>
          </Pressable>
        </View>
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
  share: { fontFamily: fonts.mono, fontSize: 10, color: colors.textMuted },
  shareRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 3 },
  shareHint: { fontFamily: fonts.body, fontSize: 10.5, lineHeight: 14, color: colors.textMuted, marginTop: 4 },
  copyChip: { borderWidth: 1, borderColor: "#d95a1f55", borderRadius: 999, paddingVertical: 2, paddingHorizontal: 7, backgroundColor: "#d95a1f0d" },
  copyChipText: { fontFamily: fonts.body, fontSize: 10, fontWeight: "700", color: colors.accent },

  lbl: { ...type.groupLabel, marginTop: 14, marginBottom: 4 },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, paddingVertical: 12 },

  row: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 11, paddingHorizontal: 8, borderRadius: 9, position: "relative" },
  rowCur: { backgroundColor: colors.surfaceSunken },
  rail: { position: "absolute", left: 0, top: 9, bottom: 9, width: 3, borderRadius: 2, backgroundColor: colors.accent },
  dot: { width: 7, height: 7, borderRadius: 4, flex: 0, alignSelf: "center" },
  rowTitle: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: "700", color: colors.text },
  rowMeta: { fontFamily: fonts.body, fontSize: 11, color: colors.textMuted, marginTop: 1 },
  rowCode: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.accent, fontWeight: "700", letterSpacing: 0.3 },

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
