// End-of-day review → submit. Submit locks the day; anything added after is an
// amendment — never overwritten, never deleted (PRD §5.1). Reads as a ledger:
// big total, a mono stat strip, then one row per cost class (§2.5).
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { parseProject } from "../components/ProjectPicker";
import { ClassBadge, FormScreen, GroupLabel, StickyFooter, usdCents } from "../components/ui";
import { CLASS_LABELS, colors, fonts, type } from "../theme";
import { activeLines, currentProject, dayStatus, photosFor, submitDay, todayTotals } from "../store";
import { syncNow } from "../sync";

function dateLine(workDate) {
  const d = new Date(workDate + "T12:00:00");
  const wd = d.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase();
  const mo = d.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
  return `${wd} ${d.getDate()} ${mo} ${d.getFullYear()}`;
}

function Stat({ label, value, zero }) {
  return (
    <View style={s.statCol}>
      <Text style={s.statLabel}>{label}</Text>
      <Text style={[s.statValue, zero && { color: colors.placeholder }]}>{value}</Text>
    </View>
  );
}

export default function ReviewScreen({ t, workDate, onDone }) {
  const totals = todayTotals(workDate);
  const lines = activeLines(workDate);
  const photos = photosFor(workDate);
  const status = dayStatus(workDate);
  const project = currentProject();
  const code = project ? parseProject(project).code : "";
  const classes = Object.entries(totals.byClass).filter(([, v]) => v > 0);

  async function submit() {
    await submitDay(workDate);
    syncNow();
    onDone();
  }

  return (
    <FormScreen
      footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={status === "draft" ? t("submitDay") : t("submitted")} onPrimary={submit} tone="green" disabled={status !== "draft"} />}
    >
      <View style={s.card}>
        <Text style={s.metaLine}>{dateLine(workDate)}  ·  {code}</Text>
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

      <View style={s.notice}>
        <Text style={s.noticeLabel}>{t("thisLocksDay")}</Text>
        <Text style={s.noticeBody}>{t("lockBody")}</Text>
      </View>
    </FormScreen>
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

  notice: { backgroundColor: "#a1620712", borderWidth: 1, borderColor: "#a1620733", borderRadius: 12, marginHorizontal: 14, padding: 14 },
  noticeLabel: { fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase", color: colors.amber },
  noticeBody: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 6 },
});
