// + Hours — labor_entry (schema §4.4). Rework is a first-class, blame-free
// choice: "if recording rework gets someone in trouble, it will never be
// recorded." A missing rework note warns AFTER saving, never blocks.
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, CollapsedPick, Label, Muted, PickRow } from "../components/ui";
import { phaseLabel } from "../i18n";
import { HOUR_TYPES, PHASES, TRADES, areasFor, validateLabor, laborWarnings } from "../schema";
import { activeLines, activeProfile, addLine, currentProject, getSettings } from "../store";
import { colors } from "../theme";

const FIX_KEYS = {
  V_trade: "fixTrade",
  V3_qty: "fixHours",
  V4_unit_cost: "fixRate",
  V_hour_type: "hourType",
  V_phase: "fixPhase",
  V_area: "fixArea",
};

export default function AddLaborScreen({ t, lang, workDate, onDone }) {
  const st = getSettings();
  const me = activeProfile();
  // Logging YOUR hours is the common case: name + usual trade prefilled from
  // the profile — two taps (hours, save) for a normal day.
  const [trade, setTrade] = useState(me?.default_trade ?? null);
  const [worker, setWorker] = useState(me?.display_name || st.recorded_by || "");
  const [hours, setHours] = useState("");
  const [hourType, setHourType] = useState("regular");
  const [rate, setRate] = useState("");
  const [phase, setPhase] = useState(st.lastPhase);
  const [area, setArea] = useState(st.lastArea);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [warned, setWarned] = useState(null);

  async function save() {
    const entry = {
      kind: "labor",
      work_date: workDate,
      cost_class: "L",
      trade,
      worker: worker.trim(),
      hours: Number(hours),
      hour_type: hourType,
      hourly_rate: rate === "" ? null : Number(rate),
      phase,
      area,
      note: note.trim() || null,
    };
    const blocks = validateLabor(entry);
    if (!entry.worker) blocks.push("V_worker");
    if (blocks.length) {
      setErrors(blocks);
      return;
    }
    const warns = laborWarnings(entry, activeLines(workDate));
    await addLine(entry);
    if (warns.length && !warned) {
      setWarned(warns.includes("V10_rework_note") ? "warnRework" : "warnHours");
      setTimeout(onDone, 1800);
      return;
    }
    onDone();
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        <FloatingLabelInput label={t("worker")} value={worker} onChangeText={setWorker} />

        {/* Quick hours — one tap covers most days; the field takes odd amounts. */}
        <View style={[s.row, { marginTop: 12, alignItems: "center" }]}>
          {["4", "6", "8", "10"].map((h) => (
            <BigButton
              key={h}
              label={`${h}h`}
              onPress={() => setHours(h)}
              tone={hours === h ? "brand" : "plain"}
              style={s.quickHour}
            />
          ))}
        </View>
        <View style={[s.row, { marginTop: 10 }]}>
          <View style={{ flex: 1 }}>
            <FloatingLabelInput
              label={t("hours")}
              value={hours}
              onChangeText={(x) => setHours(x.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1 }}>
            <FloatingLabelInput
              label={t("rate")}
              value={rate}
              onChangeText={(x) => setRate(x.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              autoCapitalize="none"
            />
          </View>
        </View>
        {hours !== "" && rate !== "" && (
          <Text style={s.total}>
            = ${(Number(hours) * Number(rate)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
        )}

        <Label>{t("hourType")}</Label>
        <PickRow
          options={HOUR_TYPES}
          value={hourType}
          onChange={setHourType}
          renderLabel={(k) => t(k)}
        />
        {hourType === "rework" && <Muted style={s.gapTop}>{t("reworkBlameFree")}</Muted>}

        {/* Pre-filled from profile / last use — collapsed one-liners; expand
            only to change (schema still gets all required fields). */}
        <View style={{ marginTop: 12 }}>
          <CollapsedPick
            label={t("trade")}
            value={trade}
            displayValue={trade ? (TRADES.find((x) => x.code === trade)?.[lang] ?? trade) : null}
            options={TRADES}
            onChange={setTrade}
            renderLabel={(o) => o[lang] ?? o.en}
          />
          <CollapsedPick
            label={t("phase")}
            value={phase}
            displayValue={phase ? phaseLabel(phase, lang) : null}
            options={PHASES}
            onChange={setPhase}
            renderLabel={(p) => phaseLabel(p, lang)}
          />
          <CollapsedPick
            label={t("area")}
            value={area}
            displayValue={area}
            options={areasFor(currentProject()?.name)}
            onChange={setArea}
          />
        </View>

        <FloatingLabelInput
          label={t("note")}
          value={note}
          onChangeText={setNote}
          autoCapitalize="sentences"
          style={s.gapTop}
        />
      </Card>

      {errors.length > 0 && (
        <Card style={s.errCard}>
          <Text style={s.errTitle}>{t("needFix")}</Text>
          {errors.map((e) => (
            <Text key={e} style={s.errItem}>
              • {t(FIX_KEYS[e] ?? (e === "V_worker" ? "worker" : e))}
            </Text>
          ))}
        </Card>
      )}
      {warned && (
        <Card style={s.warnCard}>
          <Text style={s.warnText}>{t(warned)}</Text>
        </Card>
      )}

      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <BigButton label={t("save")} onPress={save} />
        <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  gapTop: { marginTop: 10 },
  quickHour: { flex: 1, minHeight: 48, paddingVertical: 10, paddingHorizontal: 0 },
  total: {
    color: colors.text,
    fontWeight: "800",
    fontSize: 18,
    marginTop: 2,
    fontVariant: ["tabular-nums"],
  },
  errCard: { borderColor: "#FCD5D2", backgroundColor: "#FEF1F0" },
  errTitle: { color: colors.red, fontWeight: "800", marginBottom: 6, fontSize: 15 },
  errItem: { color: colors.red, fontSize: 14.5, lineHeight: 22 },
  warnCard: { borderColor: "#FDE9C8", backgroundColor: "#FEF6E7" },
  warnText: { color: "#a16207", fontSize: 14.5, lineHeight: 20 },
});
