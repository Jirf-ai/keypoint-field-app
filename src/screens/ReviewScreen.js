// End-of-day review → submit. Submit locks the day; anything added after is an
// amendment — never overwritten, never deleted (PRD §5.1). Reads as a ledger:
// big total, a mono stat strip, then one row per cost class (§2.5).
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { parseProject } from "../components/ProjectPicker";
import SubmitCelebration from "../components/SubmitCelebration";
import { ClassBadge, FormScreen, GroupLabel, Muted, NoticeCard, StickyFooter, usdCents } from "../components/ui";
import { CLASS_LABELS, colors, fonts, type } from "../theme";
import { activeLines, currentProject, dayStatus, photosFor, submitDay, todayTotals } from "../store";
import { syncNow } from "../sync";
import { buzz, dateStamp } from "../util";

function Stat({ label, value, zero }) {
  return (
    <View style={s.statCol}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, zero && { color: colors.placeholder }]}>{value}</Text>
    </View>
  );
}

export default function ReviewScreen({ t, lang, workDate, onDone }) {
  const totals = todayTotals(workDate);
  const lines = activeLines(workDate);
  const photos = photosFor(workDate);
  const status = dayStatus(workDate);
  const project = currentProject();
  const code = project ? parseProject(project).code : "";
  const classes = Object.entries(totals.byClass).filter(([, v]) => v > 0);

  const [celebrating, setCelebrating] = useState(false);

  // Clock-era review flags (2026-07-31): the day clock records as-is and the
  // SM is the editor — so days that need that editor's eye must be findable
  // here, not buried in the ledger. Flag overtime (auto-split over 8h) and
  // long days (>12h — usually a forgotten clock).
  const byWorker = new Map();
  for (const l of lines) {
    if (l.kind !== "labor") continue;
    const cur = byWorker.get(l.worker) ?? { worker: l.worker, hours: 0, overtime: 0, fromClock: false };
    cur.hours += Number(l.hours || 0);
    if (l.hour_type === "overtime") cur.overtime += Number(l.hours || 0);
    if (l.clock_id) cur.fromClock = true;
    byWorker.set(l.worker, cur);
  }
  const flagged = [...byWorker.values()].filter((w) => w.overtime > 0 || w.hours > 12);

  async function submit() {
    buzz(35); // acknowledge the tap before anything else happens
    await submitDay(workDate);
    syncNow();
    // The send-off overlay runs, then hands the user back to Today.
    setCelebrating(true);
  }

  // An amended day (new entries after submit) can be submitted again —
  // "Submit more!" has to land somewhere real. Only a clean submitted day
  // with nothing new is closed.
  const canSubmit = status !== "submitted";

  return (
    <View style={{ flex: 1 }}>
    <FormScreen
      footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={canSubmit ? t("submitDay") : t("submitted")} onPrimary={submit} tone="green" disabled={!canSubmit || celebrating} />}
    >
      <View style={s.card}>
        <Text style={s.metaLine}>{dateStamp(workDate, lang)}  ·  {code}</Text>
        <Text style={s.big}>{usdCents(totals.money)}</Text>

        <View style={s.stripRow}>
          <Stat label={t("statLines")} value={String(totals.count)} zero={totals.count === 0} />
          <Stat label={t("statHours")} value={Number(totals.hours).toFixed(1)} zero={Number(totals.hours) === 0} />
          <Stat label={t("statPhotos")} value={String(photos.length)} zero={photos.length === 0} />
        </View>

        {classes.map(([k, v]) => (
          <View key={k} style={s.classRow}>
            <ClassBadge cls={k} size={28} />
            <Text style={s.className}>{CLASS_LABELS[k] ?? k}</Text>
            <Text style={type.rowAmount}>{usdCents(v)}</Text>
          </View>
        ))}
      </View>

      {flagged.length > 0 && (
        <NoticeCard tone="warn" title={t("reviewFlagsTitle")}>
          {flagged.map((w) => (
            <Text key={w.worker} style={s.flagRow}>
              {w.fromClock ? "⏱ " : ""}{w.worker} — {w.hours.toFixed(2)}h
              {w.overtime > 0 ? `  ·  ${w.overtime.toFixed(2)}h ${t("overtime").toLowerCase()}` : ""}
              {w.hours > 12 ? `  ·  ${t("reviewLongDay")}` : ""}
            </Text>
          ))}
          <Muted style={{ marginTop: 8 }}>{t("reviewFlagsHint")}</Muted>
        </NoticeCard>
      )}

      <NoticeCard tone="warn" title={t("thisLocksDay")}>
        <Muted>{t("lockBody")}</Muted>
      </NoticeCard>
    </FormScreen>
    {celebrating && <SubmitCelebration t={t} onDone={onDone} />}
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginHorizontal: 14, marginBottom: 10, padding: 16 },
  metaLine: { fontFamily: fonts.mono, fontSize: 11, fontWeight: "600", letterSpacing: 0.4, color: colors.textMuted, textTransform: "uppercase" },
  big: { ...type.moneySubmit, marginTop: 6 },
  stripRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 12 },
  statCol: { flex: 1 },
  statLabel: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "600", letterSpacing: 1.2, textTransform: "uppercase", color: colors.label },
  statValue: { fontFamily: fonts.mono, fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 3, fontVariant: ["tabular-nums"] },
  classRow: { flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 12 },
  className: { flex: 1, fontFamily: fonts.body, fontSize: 14, fontWeight: "600", color: colors.text },
  flagRow: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: "600", color: colors.amber, lineHeight: 21, fontVariant: ["tabular-nums"] },
});
