// My hours (CS-01) — the crew's give-back for logging: their own week, so the
// app returns something personal, not just feeds the office. Read-only; the
// header carries the back action. Week total, a regular/OT/rework split, a
// Mon–Sun day breakdown (today marked), and a by-project split when more than
// one job contributed.
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, EmptyState, GroupLabel } from "../components/ui";
import { myWeekTrueHours } from "../store";
import { todayStr } from "../schema";
import { weekdayLabel } from "../util";
import { colors, fonts, type } from "../theme";

const hrs = (n) => `${Number(n || 0).toFixed(1)}`;

function TypeStat({ label, value, tone }) {
  return (
    <View style={s.typeCol}>
      <Text style={s.typeLabel}>{label}</Text>
      <Text style={[s.typeValue, tone && { color: tone }, Number(value) === 0 && { color: colors.placeholder }]}>{hrs(value)}</Text>
    </View>
  );
}

// Shift a YYYY-MM-DD by whole days (noon-anchored — immune to DST edges).
const shiftDays = (ds, n) => {
  const d = new Date(ds + "T12:00:00");
  d.setDate(d.getDate() + n);
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export default function MyHoursScreen({ t, lang }) {
  // True punch-to-punch hours (Jeffrey 2026-08-05): the crew sees their
  // actual time, not what the recording caps booked.
  const wk = myWeekTrueHours();
  const today = todayStr();
  const projects = Object.entries(wk.byProject).sort((a, b) => b[1] - a[1]);
  // Last week rides along whenever it holds hours (Jeffrey 2026-08-04): the
  // crew worked Saturday 8/1, and Mon-start weeks pushed it out of "this
  // week" — weekend hours must stay visible in their correct day. Same
  // card, same day bars; days without hours are skipped to keep it short.
  const lastWk = myWeekTrueHours(shiftDays(today, -7));

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 32 }}>
      <Card>
        <GroupLabel>{t("thisWeek")}</GroupLabel>
        <View style={s.totalRow}>
          <Text style={s.big}>{hrs(wk.total)}</Text>
          <Text style={s.unit}>{t("statHours").toLowerCase()}</Text>
        </View>
        <View style={s.typeRow}>
          <TypeStat label={t("regular")} value={wk.byType.regular} />
          <TypeStat label={t("overtime")} value={wk.byType.overtime} tone={colors.amber} />
          <TypeStat label={t("rework")} value={wk.byType.rework} tone={colors.accent} />
        </View>
      </Card>

      {wk.total === 0 ? (
        <EmptyState body={t("noHoursWeek")} />
      ) : (
        <Card>
          {wk.days.map((d) => {
            const isToday = d.date === today;
            const worked = d.hours > 0;
            return (
              <View key={d.date} style={s.dayRow}>
                <Text style={[s.dayName, isToday && { color: colors.accent, fontWeight: "800" }]}>{weekdayLabel(d.date, lang)}</Text>
                <View style={s.dayBarTrack}>
                  <View style={[s.dayBar, { width: `${Math.min(100, (d.hours / 12) * 100)}%` }, isToday && { backgroundColor: colors.accent }]} />
                </View>
                <Text style={[s.dayHours, !worked && { color: colors.placeholder }]}>{worked ? hrs(d.hours) : "—"}</Text>
              </View>
            );
          })}
        </Card>
      )}

      <Text style={s.trueNote}>{t("trueHoursNote")}</Text>

      {lastWk.total > 0 && (
        <Card>
          <GroupLabel>{t("lastWeek")}</GroupLabel>
          <View style={s.totalRow}>
            <Text style={s.big}>{hrs(lastWk.total)}</Text>
            <Text style={s.unit}>{t("statHours").toLowerCase()}</Text>
          </View>
          {lastWk.days.filter((d) => d.hours > 0).map((d) => (
            <View key={d.date} style={s.dayRow}>
              <Text style={s.dayName}>{weekdayLabel(d.date, lang)}</Text>
              <View style={s.dayBarTrack}>
                <View style={[s.dayBar, { width: `${Math.min(100, (d.hours / 12) * 100)}%` }]} />
              </View>
              <Text style={s.dayHours}>{hrs(d.hours)}</Text>
            </View>
          ))}
        </Card>
      )}

      {projects.length > 1 && (
        <Card>
          <GroupLabel>{t("byProjectLabel")}</GroupLabel>
          {projects.map(([name, h]) => (
            <View key={name} style={s.projRow}>
              <Text style={s.projName} numberOfLines={1}>{name}</Text>
              <Text style={s.projHours}>{hrs(h)}</Text>
            </View>
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  totalRow: { flexDirection: "row", alignItems: "baseline", gap: 6, marginTop: 2 },
  big: { fontFamily: fonts.display, fontWeight: "800", fontSize: 40, letterSpacing: -1.2, color: colors.text, fontVariant: ["tabular-nums"] },
  unit: { fontFamily: fonts.body, fontSize: 15, fontWeight: "600", color: colors.textMuted },
  typeRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border, marginTop: 14, paddingTop: 12 },
  typeCol: { flex: 1 },
  typeLabel: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", color: colors.label },
  typeValue: { fontFamily: fonts.mono, fontSize: 18, fontWeight: "700", color: colors.text, marginTop: 3, fontVariant: ["tabular-nums"] },

  dayRow: { flexDirection: "row", alignItems: "center", gap: 12, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11 },
  dayName: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "700", color: colors.textSecondary, width: 40, textTransform: "uppercase" },
  dayBarTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: colors.surfaceSunken, overflow: "hidden" },
  dayBar: { height: 8, borderRadius: 4, backgroundColor: colors.ink },
  dayHours: { fontFamily: fonts.mono, fontSize: 14, fontWeight: "700", color: colors.text, width: 40, textAlign: "right", fontVariant: ["tabular-nums"] },

  trueNote: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, paddingHorizontal: 16, marginTop: 8, marginBottom: 4 },

  projRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11 },
  projName: { flex: 1, fontFamily: fonts.body, fontSize: 14, fontWeight: "600", color: colors.text },
  projHours: { fontFamily: fonts.mono, fontSize: 14, fontWeight: "700", color: colors.text, fontVariant: ["tabular-nums"] },
});
