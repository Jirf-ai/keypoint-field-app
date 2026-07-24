// + Hours — labor_entry (schema §4.4). Rework is a first-class, blame-free
// choice: "if recording rework gets someone in trouble, it will never be
// recorded." A missing rework note warns AFTER saving, never blocks.
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { phaseLabel } from "../i18n";
import { HOUR_TYPES, PHASES, PROJECT, TRADES, validateLabor, laborWarnings } from "../schema";
import { activeLines, addLine, getSettings } from "../store";
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
  const [trade, setTrade] = useState(null);
  const [worker, setWorker] = useState(st.recorded_by || "");
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
        <Label>{t("trade")}</Label>
        <PickRow
          options={TRADES}
          value={trade}
          onChange={setTrade}
          renderLabel={(o) => o[lang] ?? o.en}
        />

        <FloatingLabelInput label={t("worker")} value={worker} onChangeText={setWorker} style={s.gapTop} />

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

        <Label>{t("phase")}</Label>
        <PickRow
          options={PHASES}
          value={phase}
          onChange={setPhase}
          renderLabel={(p) => phaseLabel(p, lang)}
        />

        <Label>{t("area")}</Label>
        <PickRow options={PROJECT.areas} value={area} onChange={setArea} />

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
