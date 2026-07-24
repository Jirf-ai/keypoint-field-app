// End-of-day review → submit. Submit locks the day; anything added after is
// marked an amendment — never overwritten, never deleted (PRD §5.1).
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BigButton, Card, Label, Muted } from "../components/ui";
import { activeLines, dayStatus, photosFor, submitDay, todayTotals } from "../store";
import { CLASS_COLORS, colors } from "../theme";

function usd(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export default function ReviewScreen({ t, workDate, onDone }) {
  const totals = todayTotals(workDate);
  const lines = activeLines(workDate);
  const photos = photosFor(workDate);
  const status = dayStatus(workDate);
  const rework = lines
    .filter((l) => l.kind === "labor" && l.hour_type === "rework")
    .reduce((n, l) => n + Number(l.hours || 0), 0);

  async function submit() {
    await submitDay(workDate);
    onDone();
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        <Label>{t("reviewTitle")} — {workDate}</Label>
        <Text style={s.big}>{usd(totals.money)}</Text>
        <Muted>
          {totals.count} {t("lines")} · {totals.hours} {t("laborHours")} · {photos.length}{" "}
          {t("photosToday")}
        </Muted>
        <View style={s.classRow}>
          {Object.entries(totals.byClass).map(([k, v]) =>
            v > 0 ? (
              <View key={k} style={[s.classPill, { backgroundColor: CLASS_COLORS[k].bg }]}>
                <Text style={[s.classPillText, { color: CLASS_COLORS[k].color }]}>
                  {k} {usd(v)}
                </Text>
              </View>
            ) : null
          )}
        </View>
        {rework > 0 && (
          <Muted style={{ marginTop: 8 }}>⟲ {rework}h rework</Muted>
        )}
      </Card>

      <Card>
        <Muted>{t("submitLocks")}</Muted>
      </Card>

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <BigButton
          label={status === "draft" ? t("submitDay") : t("submitted")}
          onPress={submit}
          tone="green"
          disabled={status !== "draft"}
        />
        <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  big: {
    color: colors.text,
    fontSize: 30,
    fontWeight: "800",
    fontVariant: ["tabular-nums"],
    marginBottom: 2,
  },
  classRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  classPill: { borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  classPillText: { fontWeight: "800", fontSize: 13.5, fontVariant: ["tabular-nums"] },
});
