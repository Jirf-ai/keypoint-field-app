// Today — capture-first (PRD §6.1). The project plate sits up top (§2.1), then
// a capture tile row (§2.2), then the day reads as a ledger (§2.5). Role decides
// the surface: crew log hours + photos; site managers add materials, review,
// submit, and raise change orders.
import { useEffect, useRef } from "react";
import { Animated, Easing, Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { parseProject } from "../components/ProjectPicker";
import { isSyncing } from "../sync";
import { Btn, Card, CaptureTiles, EmptyState, GroupLabel, LedgerRow, Muted, ProjectPlate, usd, usdCents } from "../components/ui";
import { phaseLabel } from "../i18n";
import {
  activeProfile,
  crewLogStatus,
  currentProject,
  dayStatus,
  daySubmittedAt,
  incidentsFor,
  myWeekHours,
  photosFor,
  visibleLines,
  visibleTotals,
} from "../store";
import { colors, fonts, type } from "../theme";
import { dateStamp } from "../util";

// Small spinning brand diamond + "updating" — lives inside the pending badge
// while a sync drain is running, so a crew member knows the app is actively
// sending (wait) rather than stuck (Jeffrey, 2026-07-30).
function UpdatingSpinner({ t }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [rot]);
  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={s.updatingRow}>
      <Animated.Text style={[s.updatingDiamond, { transform: [{ rotate }] }]}>◆</Animated.Text>
      <Text style={s.updatingText}>{t("updating")}</Text>
    </View>
  );
}

export default function TodayScreen({ t, lang, workDate, pending, onSync, nav, onFillPhoto, onEditLine, onProjectChange, onOpenProjects }) {
  const project = currentProject();
  const projectMeta = project ? parseProject(project) : null;
  // Role-scoped: crew see only their own hours/wage; materials and other
  // workers' labor are the site manager's view (see visibleLines in store).
  const lines = visibleLines(workDate);
  const photos = photosFor(workDate);
  const totals = visibleTotals(workDate);
  const status = dayStatus(workDate);
  const me = activeProfile();
  const isSM = me?.role === "site_manager";
  const myName = me?.display_name;
  const inbox = isSM ? photos.filter((p) => !p.line_id) : [];

  const dateLabel = dateStamp(workDate, lang);
  const statusTag = status !== "draft" ? `  ·  ${t(status === "amended" ? "amended" : "submitted")}` : "";

  const tiles = [
    { key: "photo", glyph: "📷", label: t("tilePhoto"), tone: "accent" },
    { key: "labor", glyph: "⏱", label: t("tileHours"), tone: "ink" },
  ];
  if (isSM) tiles.push({ key: "item", glyph: "📦", label: t("tileItem"), tone: "ink" });

  // Safety records for the day — everyone sees them (SF-02).
  const incidents = incidentsFor(workDate);
  const hasEntries = lines.length > 0 || photos.length > 0;
  // Crew get their own week back for logging (CS-01) — the adoption lever.
  const week = !isSM ? myWeekHours() : null;
  // Site managers see who on their crew hasn't logged today (OV-01).
  const crew = isSM ? crewLogStatus(workDate) : null;

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      {/* The plate opens the projects drawer (the single place to switch, add,
          or see your team code). No inline dropdown — that lived here before and
          duplicated the drawer. */}
      <View>
        {project ? (
          <ProjectPlate
            code={projectMeta.code}
            name={projectMeta.display}
            role={activeProfile()?.role}
            city={projectMeta.city}
            date={dateLabel + statusTag}
            onPress={onOpenProjects}
            hint={t("projectsLabel")}
          />
        ) : (
          <Pressable onPress={onOpenProjects} style={s.projectSlot} accessibilityRole="button" accessibilityLabel={t("findProject")}>
            <Text style={s.projectSlotTitle}>{t("findProject")}</Text>
            <Text style={s.projectSlotSub}>{t("findProjectSub")}</Text>
          </Pressable>
        )}
      </View>

      {/* No project: the date rides its own row (the plate carries it otherwise). */}
      {!project && (
        <View style={s.todayRow}>
          <Text style={s.todayBig}>{t("today")}</Text>
          <Text style={type.date}>{dateLabel}</Text>
        </View>
      )}

      {pending > 0 && (
        <Pressable style={s.pending} onPress={onSync} accessibilityRole="button" accessibilityLabel={t("pending")}>
          <Text style={s.pendingText}>{pending} {t("pending")}</Text>
          {isSyncing() && <UpdatingSpinner t={t} />}
        </Pressable>
      )}

      <View style={{ marginTop: 12 }}>
        <CaptureTiles tiles={tiles} disabled={!project} onPress={(k) => nav(k)} />
      </View>

      {/* SF-02 — every role, one tap from Today, never behind a menu. Sits
          apart from the capture tiles because it is not a cost record. */}
      {project && (
        <Pressable
          onPress={() => nav("incident")}
          style={({ pressed }) => [s.incidentBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={t("incidentReport")}
        >
          <Text style={s.incidentGlyph}>⚠️</Text>
          <Text style={s.incidentLabel}>{t("incidentReport")}</Text>
        </Pressable>
      )}

      {incidents.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <GroupLabel>{t("incidentsToday")}</GroupLabel>
          {incidents.map((i) => (
            <View key={i.incident_id} style={s.incRow}>
              <Text style={s.incType}>{t(`incident_${i.incident_type}`)}</Text>
              <Text style={s.incDesc} numberOfLines={2}>{i.description}</Text>
              <Text style={s.incBy}>{i.reported_by}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Crew guide — the two duties as an orange-numbered list. */}
      {!isSM && project && !hasEntries && (
        <Card style={{ marginTop: 14 }}>
          <GroupLabel>{t("crewGuideTitle")}</GroupLabel>
          <View style={s.guideRow}>
            <Text style={s.guideNum}>01</Text>
            <Text style={s.guideText}>{t("crewGuide1")}</Text>
          </View>
          <View style={s.guideRow}>
            <Text style={s.guideNum}>02</Text>
            <Text style={s.guideText}>{t("crewGuide2")}</Text>
          </View>
        </Card>
      )}

      {inbox.length > 0 && (
        <Card style={{ marginTop: 14 }}>
          <GroupLabel>📷 {inbox.length} {t("needDetails")}</GroupLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={s.inboxRow}>
              {inbox.map((p) => (
                <Pressable key={p.photo_id} onPress={() => onFillPhoto(p)} accessibilityRole="button" accessibilityLabel={t("needDetails")}>
                  <Image source={{ uri: p.uri }} style={s.inboxThumb} resizeMode="cover" />
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <Muted style={{ marginTop: 8 }}>{t("needDetailsHint")}</Muted>
        </Card>
      )}

      {/* The ledger — total + one row per line (§2.5). */}
      <View style={{ marginTop: 14 }}>
        {!hasEntries ? (
          <EmptyState body={project ? t("noEntriesToday") : t("pickToUnlock")} />
        ) : (
          <Card>
            {/* The reward moment: the day's work is in — say so with joy, not
                just a status tag (crew feedback 2026-07-30). The time is the
                LATEST submission, so a re-submit moves it. */}
            {status !== "draft" && (
              <View style={s.submittedBanner}>
                <Text style={s.submittedEmoji}>🎉</Text>
                <Text style={s.submittedText}>{t("submittedJoy")}</Text>
                {daySubmittedAt(workDate) && (
                  <Text style={s.submittedTime}>
                    {new Date(daySubmittedAt(workDate)).toLocaleTimeString(
                      lang === "es" ? "es-MX" : lang === "zh" ? "zh-CN" : "en-US",
                      { hour: "numeric", minute: "2-digit" },
                    )}
                  </Text>
                )}
              </View>
            )}
            <View style={s.rollupHead}>
              <View>
                <GroupLabel>{t("recordedToday")}</GroupLabel>
                <Text style={type.moneyRollup}>{usd(totals.money)}</Text>
              </View>
              <View style={s.rollupMeta}>
                <Text style={s.metaLine}>{totals.count} {(totals.count === 1 ? t("statLine") : t("statLines")).toUpperCase()}</Text>
                <Text style={s.metaLine}>{Number(totals.hours).toFixed(1)} {t("statHours").toUpperCase()}</Text>
                {photos.length ? <Text style={s.metaLine}>{photos.length} {(photos.length === 1 ? t("statPhoto") : t("statPhotos")).toUpperCase()}</Text> : null}
              </View>
            </View>
            {lines.map((l) => {
              const isLabor = l.kind === "labor";
              const amount = isLabor
                ? Number(l.hours || 0) * Number(l.hourly_rate || 0)
                : Number(l.qty || 0) * Number(l.unit_cost || 0);
              const title = isLabor ? `${l.worker} · ${l.hours}h` : l.description;
              const meta = `${phaseLabel(l.phase, lang)} · ${l.area}${!isLabor && l.qty ? ` · ${l.qty} ${l.unit}` : ""}`;
              const row = <LedgerRow cls={l.cost_class} title={title} meta={meta} amount={usdCents(amount)} />;
              // SM corrects any line; crew only their own hours. Corrections are
              // append-only — tapping opens the form prefilled (see amendLine).
              const canEdit = onEditLine && (isSM || (isLabor && l.worker === myName));
              return canEdit ? (
                <Pressable key={l.line_id} onPress={() => onEditLine(l)} accessibilityRole="button" accessibilityLabel={`${t("edit")} · ${title}`}>
                  {row}
                </Pressable>
              ) : (
                <View key={l.line_id}>{row}</View>
              );
            })}
          </Card>
        )}
      </View>

      {/* Crew: this week's own hours, tap for the day breakdown (CS-01). */}
      {!isSM && project && (
        <Pressable onPress={() => nav("myhours")} accessibilityRole="button" accessibilityLabel={t("myHours")}>
          <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <GroupLabel>{t("thisWeek")}</GroupLabel>
              <View style={s.weekRow}>
                <Text style={s.weekHours}>{Number(week.total).toFixed(1)}</Text>
                <Text style={s.weekUnit}>{t("statHours").toLowerCase()}</Text>
              </View>
            </View>
            <Text style={s.weekCaret}>›</Text>
          </Card>
        </Pressable>
      )}

      {/* Site manager: who on the crew hasn't logged today (OV-01). */}
      {isSM && project && crew.total > 0 && (
        <Pressable onPress={() => nav("crew")} accessibilityRole="button" accessibilityLabel={t("crewTitle")}>
          <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <GroupLabel>{t("crewTitle")}</GroupLabel>
              <View style={s.weekRow}>
                <Text style={s.weekHours}>{crew.loggedCount}</Text>
                <Text style={s.weekUnit}>/ {crew.total} {t("loggedToday")}</Text>
              </View>
            </View>
            <Text style={s.weekCaret}>›</Text>
          </Card>
        </Pressable>
      )}

      {/* Site-manager duties, below the ledger. */}
      {isSM && (
        <View style={s.smActions}>
          <Btn label={t(status !== "draft" ? "submitMore" : "review")} onPress={() => nav("review")} variant="green" disabled={lines.length === 0} />
          <Btn label={t("changeOrders")} onPress={() => nav("cos")} variant="outline" style={{ minHeight: 48 }} />
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  todayRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 14, marginTop: 14 },
  todayBig: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", letterSpacing: -0.3, color: colors.text },
  // No-project prompt (opens the projects drawer). Same dashed-orange look the
  // old picker slot used, so nothing shifts visually.
  projectSlot: {
    backgroundColor: "#d95a1f0d",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217,90,31,0.5)",
    borderRadius: 14,
    marginHorizontal: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  projectSlotTitle: { fontFamily: fonts.display, fontSize: 17, fontWeight: "700", color: colors.accent },
  projectSlotSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, marginTop: 3, textAlign: "center" },
  pending: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 14,
    marginTop: 10,
    backgroundColor: "#a1620712",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pendingText: { fontFamily: fonts.mono, color: colors.amber, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  updatingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  updatingDiamond: { fontSize: 11, lineHeight: 13, color: colors.accent },
  updatingText: { fontFamily: fonts.mono, color: colors.accent, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  incidentBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 14,
    marginTop: 8,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#b91c1c33",
    backgroundColor: "#b91c1c0a",
  },
  incidentGlyph: { fontSize: 15 },
  incidentLabel: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.red },
  incRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 },
  incType: { fontFamily: fonts.mono, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.red },
  incDesc: { fontFamily: fonts.body, fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 3, lineHeight: 19 },
  incBy: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  guideRow: { flexDirection: "row", gap: 10, marginTop: 4, alignItems: "flex-start" },
  guideNum: { fontFamily: fonts.mono, color: colors.accent, fontSize: 12, fontWeight: "700", width: 22, lineHeight: 22 },
  guideText: { fontFamily: fonts.body, color: colors.text, fontSize: 14, fontWeight: "600", lineHeight: 22, flex: 1 },
  inboxRow: { flexDirection: "row", gap: 8 },
  inboxThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surfaceSunken, borderWidth: 2, borderColor: colors.accent },
  submittedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#15803d14", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12 },
  submittedEmoji: { fontSize: 16 },
  submittedText: { fontFamily: fonts.display, fontSize: 15, fontWeight: "800", color: colors.green },
  submittedTime: { fontFamily: fonts.mono, fontSize: 11.5, fontWeight: "700", color: colors.green, opacity: 0.75, marginLeft: "auto" },
  rollupHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  rollupMeta: { alignItems: "flex-end" },
  metaLine: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.label, lineHeight: 18, letterSpacing: 0.4, fontVariant: ["tabular-nums"] },
  smActions: { paddingHorizontal: 14, gap: 8, marginTop: 4 },
  weekRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  weekHours: { fontFamily: fonts.display, fontWeight: "800", fontSize: 26, letterSpacing: -0.7, color: colors.text, fontVariant: ["tabular-nums"] },
  weekUnit: { fontFamily: fonts.body, fontSize: 13, fontWeight: "600", color: colors.textMuted },
  weekCaret: { color: colors.accent, fontSize: 22, fontWeight: "800" },
});
