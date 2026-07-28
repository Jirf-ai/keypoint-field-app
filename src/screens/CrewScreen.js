// Crew today (OV-01) — which of my crew haven't logged, so the foreman can chase
// the gap before it becomes permanently lost data (the app's whole reason to
// exist). "Not yet" leads, because that's the actionable list. Roster is what
// this device knows (crew who joined my code here / same GC team); a full cross-
// device roster arrives with sync. Read-only; header back closes it.
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { Card, EmptyState, GroupLabel, NoticeCard } from "../components/ui";
import { TRADES } from "../schema";
import { crewLogStatus } from "../store";
import { colors, fonts } from "../theme";

function Avatar({ name, selfie, tone }) {
  if (selfie) return <Image source={{ uri: selfie }} style={s.avatar} />;
  return (
    <View style={[s.avatar, { backgroundColor: tone ?? colors.ink }]}>
      <Text style={s.avatarInitial}>{(name || "?")[0].toUpperCase()}</Text>
    </View>
  );
}

function CrewRow({ row, lang, right, rightTone }) {
  const trade = row.trade ? TRADES.find((x) => x.code === row.trade)?.[lang] ?? row.trade : null;
  return (
    <View style={s.row}>
      <Avatar name={row.name} selfie={row.selfie} tone={rightTone} />
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{row.name}</Text>
        {trade ? <Text style={s.trade} numberOfLines={1}>{trade}</Text> : null}
      </View>
      <Text style={[s.right, rightTone && { color: rightTone }]}>{right}</Text>
    </View>
  );
}

export default function CrewScreen({ t, lang, workDate }) {
  const { logged, missing, total, loggedCount } = crewLogStatus(workDate);

  if (total === 0) {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
        <EmptyState title={t("crewTitle")} body={t("noCrewYet")} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 32 }}>
      <Card>
        <GroupLabel>{t("crewTitle")}</GroupLabel>
        <View style={s.countRow}>
          <Text style={s.count}>{loggedCount}<Text style={s.countTotal}> / {total}</Text></Text>
          <Text style={s.countLabel}>{t("loggedToday")}</Text>
        </View>
      </Card>

      {missing.length > 0 ? (
        <Card>
          <GroupLabel>{t("notYetLogged")}</GroupLabel>
          {missing.map((r) => (
            <CrewRow key={r.worker_id} row={r} lang={lang} right={t("notYet")} rightTone={colors.accent} />
          ))}
        </Card>
      ) : (
        <NoticeCard tone="success" title={t("allLogged")} />
      )}

      {logged.length > 0 && (
        <Card>
          <GroupLabel>{t("loggedLabel")}</GroupLabel>
          {logged.map((r) => (
            <CrewRow key={r.worker_id} row={r} lang={lang} right={`${r.hours.toFixed(1)}h`} rightTone={colors.green} />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  countRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  count: { fontFamily: fonts.display, fontWeight: "800", fontSize: 34, letterSpacing: -1, color: colors.text, fontVariant: ["tabular-nums"] },
  countTotal: { color: colors.textMuted, fontSize: 22, fontWeight: "700" },
  countLabel: { fontFamily: fonts.mono, fontSize: 10.5, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", color: colors.label },

  row: { flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  avatarInitial: { fontFamily: fonts.mono, color: colors.onInk, fontSize: 14, fontWeight: "700" },
  name: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.text },
  trade: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  right: { fontFamily: fonts.mono, fontSize: 12.5, fontWeight: "700", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, fontVariant: ["tabular-nums"] },
});
