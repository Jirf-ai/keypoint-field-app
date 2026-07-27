// + Hours — labor_entry (schema §4.4). Live math strip, segmented hour type,
// collapsing pickers for trade/phase/area (open when there's nothing prefilled
// from yesterday), sticky Cancel/Save footer. Rework stays blame-free: a missing
// note warns AFTER saving, never blocks.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Card, Field, FormScreen, GroupLabel, NumericField, PickerRow, Segmented, StickyFooter, preferred } from "../components/ui";
import { phaseLabel } from "../i18n";
import { HOUR_TYPES, PHASES, TRADES, areasFor, validateLabor, laborWarnings } from "../schema";
import { activeLines, activeProfile, addLine, currentProject, getSettings } from "../store";
import { colors, fonts, type } from "../theme";

const TRADE_ORDER = preferred(TRADES, ["laborer", "carpenter", "concrete", "framer", "electrician"]);
const PHASE_ORDER = preferred(PHASES, ["framing", "roofing", "drywall", "gazebo"]);

const FIX_KEYS = {
  V_trade: "fixTrade",
  V3_qty: "fixHours",
  V4_unit_cost: "fixRate",
  V_hour_type: "hourType",
  V_phase: "fixPhase",
  V_area: "fixArea",
  V_worker: "worker",
};

export default function AddLaborScreen({ t, lang, workDate, onDone }) {
  const st = getSettings();
  const me = activeProfile();
  // The logged-in profile IS the worker — no name typing (Jeffrey 2026-07-24).
  const worker = me?.display_name || st.recorded_by || "";
  const [trade, setTrade] = useState(me?.default_trade ?? null);
  const [hours, setHours] = useState("");
  const [hourType, setHourType] = useState("regular");
  const [rate, setRate] = useState(st.lastRate ?? "");
  const [phase, setPhase] = useState(st.lastPhase);
  const [area, setArea] = useState(st.lastArea);
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState([]);
  const [warned, setWarned] = useState(null);

  const total = Number(hours || 0) * Number(rate || 0);

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
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("save")} onPrimary={save} />}>
      <Card>
        <View style={s.numRow}>
          <NumericField label={t("hours")} value={hours} onChangeText={(x) => setHours(x.replace(/[^0-9.]/g, ""))} placeholder="0" style={{ flex: 1 }} />
          <NumericField label={t("rate")} value={rate} onChangeText={(x) => setRate(x.replace(/[^0-9.]/g, ""))} placeholder="0" style={{ flex: 1 }} />
        </View>
        <View style={s.mathStrip}>
          <Text style={s.mathLeft}>{hours || "0"} × {rate || "0"}</Text>
          <Text style={type.moneyForm}>${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</Text>
        </View>
      </Card>

      <Card>
        <GroupLabel>{t("hourType")}</GroupLabel>
        <Segmented options={HOUR_TYPES} value={hourType} onChange={setHourType} renderLabel={(k) => t(k)} />
        {hourType === "rework" && <Text style={s.reworkNote}>{t("reworkBlameFree")}</Text>}

        <View style={{ marginTop: 14 }}>
          <PickerRow
            first
            label={t("trade")}
            value={trade}
            displayValue={trade ? TRADES.find((x) => x.code === trade)?.[lang] ?? trade : null}
            options={TRADE_ORDER}
            onChange={setTrade}
            renderLabel={(o) => o[lang] ?? o.en}
            show={5}
          />
          <PickerRow
            label={t("phase")}
            value={phase}
            displayValue={phase ? phaseLabel(phase, lang) : null}
            options={PHASE_ORDER}
            onChange={setPhase}
            renderLabel={(p) => phaseLabel(p, lang)}
            show={4}
          />
          <PickerRow label={t("area")} value={area} displayValue={area} options={areasFor(currentProject()?.name)} onChange={setArea} show={6} />
        </View>

        <Field label={t("note")} value={note} onChangeText={setNote} autoCapitalize="sentences" style={{ marginTop: 14 }} placeholder="—" />
      </Card>

      {errors.length > 0 && (
        <Card style={s.errCard}>
          <Text style={s.errTitle}>{t("needFix")}</Text>
          {errors.map((e) => (
            <Text key={e} style={s.errItem}>• {t(FIX_KEYS[e] ?? e)}</Text>
          ))}
        </Card>
      )}
      {warned && (
        <Card style={s.warnCard}>
          <Text style={s.warnText}>{t(warned)}</Text>
        </Card>
      )}
    </FormScreen>
  );
}

const s = StyleSheet.create({
  numRow: { flexDirection: "row", gap: 9 },
  mathStrip: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 12,
    paddingTop: 10,
  },
  mathLeft: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  reworkNote: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  errCard: { borderColor: "#b91c1c33", backgroundColor: "#b91c1c0a" },
  errTitle: { fontFamily: fonts.body, color: colors.red, fontWeight: "700", marginBottom: 6, fontSize: 14 },
  errItem: { fontFamily: fonts.body, color: colors.red, fontSize: 14, lineHeight: 21 },
  warnCard: { borderColor: "#a1620733", backgroundColor: "#a1620712" },
  warnText: { fontFamily: fonts.body, color: colors.amber, fontSize: 14, lineHeight: 20 },
});
