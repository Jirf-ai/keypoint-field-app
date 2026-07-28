// Today — capture-first (PRD §6.1). The project plate sits up top (§2.1), then
// a capture tile row (§2.2), then the day reads as a ledger (§2.5). Role decides
// the surface: crew log hours + photos; site managers add materials, review,
// submit, and raise change orders.
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import ProjectPicker from "../components/ProjectPicker";
import { Btn, Card, CaptureTiles, EmptyState, GroupLabel, LedgerRow, Muted, usd, usdCents } from "../components/ui";
import { phaseLabel } from "../i18n";
import {
  activeLines,
  activeProfile,
  currentProject,
  dayStatus,
  photosFor,
  recentProjects,
  setCurrentProject,
  todayTotals,
} from "../store";
import { colors, fonts, type } from "../theme";
import { dateStamp } from "../util";

export default function TodayScreen({ t, lang, workDate, pending, onSync, nav, onFillPhoto, onEditLine, onProjectChange }) {
  const project = currentProject();
  const lines = activeLines(workDate);
  const photos = photosFor(workDate);
  const totals = todayTotals(workDate);
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

  const hasEntries = lines.length > 0 || photos.length > 0;

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <View style={{ zIndex: 100 }}>
        <ProjectPicker
          t={t}
          current={project}
          recents={recentProjects()}
          role={activeProfile()?.role}
          dateLabel={dateLabel + statusTag}
          onAddProject={() => nav("addproject")}
          onJoin={() => nav("joinlist")}
          onSelect={async (p) => {
            await setCurrentProject(p);
            onProjectChange?.();
          }}
        />
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
        </Pressable>
      )}

      <View style={{ marginTop: 12 }}>
        <CaptureTiles tiles={tiles} disabled={!project} onPress={(k) => nav(k)} />
      </View>

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
            <View style={s.rollupHead}>
              <View>
                <GroupLabel>{t("recordedToday")}</GroupLabel>
                <Text style={type.moneyRollup}>{usd(totals.money)}</Text>
              </View>
              <View style={s.rollupMeta}>
                <Text style={s.metaLine}>{totals.count} {t("statLines").toUpperCase()}</Text>
                <Text style={s.metaLine}>{Number(totals.hours).toFixed(1)} {t("statHours").toUpperCase()}</Text>
                {photos.length ? <Text style={s.metaLine}>{photos.length} {t("statPhotos").toUpperCase()}</Text> : null}
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

      {/* Site-manager duties, below the ledger. */}
      {isSM && (
        <View style={s.smActions}>
          <Btn label={t("review")} onPress={() => nav("review")} variant="green" disabled={lines.length === 0} />
          <Btn label={t("changeOrders")} onPress={() => nav("cos")} variant="outline" style={{ minHeight: 48 }} />
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  todayRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 14, marginTop: 14 },
  todayBig: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", letterSpacing: -0.3, color: colors.text },
  pending: {
    alignSelf: "flex-start",
    marginHorizontal: 14,
    marginTop: 10,
    backgroundColor: "#a1620712",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pendingText: { fontFamily: fonts.mono, color: colors.amber, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  guideRow: { flexDirection: "row", gap: 10, marginTop: 4, alignItems: "flex-start" },
  guideNum: { fontFamily: fonts.mono, color: colors.accent, fontSize: 12, fontWeight: "700", width: 22, lineHeight: 22 },
  guideText: { fontFamily: fonts.body, color: colors.text, fontSize: 14, fontWeight: "600", lineHeight: 22, flex: 1 },
  inboxRow: { flexDirection: "row", gap: 8 },
  inboxThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surfaceSunken, borderWidth: 2, borderColor: colors.accent },
  rollupHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  rollupMeta: { alignItems: "flex-end" },
  metaLine: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.label, lineHeight: 18, letterSpacing: 0.4, fontVariant: ["tabular-nums"] },
  smActions: { paddingHorizontal: 14, gap: 8, marginTop: 4 },
});
