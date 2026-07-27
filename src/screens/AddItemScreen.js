// + Material / Item — the core cost record (schema §4.3). Minimal by doctrine:
// description, qty, unit, cost, one-tap cost class, phase/area preloaded. Unit is
// a mono chip wall (codes, not words); cost class is a labelled 2×2 grid.
import { useState } from "react";
import { Image, StyleSheet, Switch, Text, View } from "react-native";
import { Card, ChipWall, Field, FormScreen, GroupLabel, Muted, NumericField, PickerRow, StickyFooter, preferred } from "../components/ui";
import { phaseLabel } from "../i18n";
import { COST_CLASSES, PHASES, UNITS, areasFor, validateLineItem, lineWarnings } from "../schema";
import { activeLines, addLine, currentProject, getSettings, linkPhoto } from "../store";
import { CLASS_COLORS, CLASS_LABELS, colors, fonts, type } from "../theme";

const FIX_KEYS = {
  V1_cost_class: "fixClass",
  V_description: "fixDesc",
  V3_qty: "fixQty",
  V4_unit_cost: "fixCost",
  V2_unit: "fixUnit",
  V_phase: "fixPhase",
  V_area: "fixArea",
};

const UNIT_ORDER = preferred(UNITS, ["EA", "LF", "SF", "CY", "SHT", "BAG"]);
const PHASE_ORDER = preferred(PHASES, ["framing", "roofing", "drywall", "gazebo"]);

// The labelled 2×2 cost-class grid — replaces the four bare colored circles.
function KindOfCost({ value, onChange }) {
  return (
    <View style={s.ccGrid}>
      {COST_CLASSES.map((k) => {
        const cc = CLASS_COLORS[k];
        const on = value === k;
        return (
          <View key={k} style={s.ccCell}>
            <View
              style={[s.ccRow, on ? { borderColor: cc.color, borderWidth: 1.5, backgroundColor: cc.color + "0d" } : { borderColor: colors.borderStrong, backgroundColor: colors.bg }]}
              onStartShouldSetResponder={() => true}
              onResponderRelease={() => onChange(k)}
              accessible
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={CLASS_LABELS[k]}
            >
              <View style={[s.ccBadge, { backgroundColor: on ? cc.color : cc.bg }]}>
                <Text style={[s.ccBadgeText, { color: on ? "#fff" : cc.color }]}>{k}</Text>
              </View>
              <Text style={[s.ccLabel, on ? { color: cc.color, fontWeight: "700" } : { color: colors.text, fontWeight: "500" }]}>{CLASS_LABELS[k]}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

export default function AddItemScreen({ t, lang, workDate, onDone, fromPhoto }) {
  const st = getSettings();
  const [desc, setDesc] = useState("");
  const [sku, setSku] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState(null);
  const [cost, setCost] = useState("");
  const [cls, setCls] = useState(null);
  const [phase, setPhase] = useState(st.lastPhase);
  const [area, setArea] = useState(st.lastArea);
  const [est, setEst] = useState(false);
  const [vendor, setVendor] = useState("");
  const [invoice, setInvoice] = useState("");
  const [errors, setErrors] = useState([]);
  const [warned, setWarned] = useState(null);

  const total = Number(qty || 0) * Number(cost || 0);
  const canSave = !!desc.trim() && qty !== "" && cost !== "";

  async function save() {
    const entry = {
      kind: "item",
      work_date: workDate,
      description: desc,
      sku_code: sku.trim() || null,
      qty: Number(qty),
      unit,
      unit_cost: cost === "" ? null : Number(cost),
      cost_class: cls,
      phase,
      area,
      qty_is_estimated: est,
      vendor: vendor.trim() || null,
      invoice_ref: invoice.trim() || null,
      note: null,
    };
    const blocks = validateLineItem(entry);
    if (blocks.length) {
      setErrors(blocks);
      return;
    }
    const warns = lineWarnings(entry, activeLines(workDate));
    const saved = await addLine(entry);
    if (fromPhoto?.photo_id) await linkPhoto(fromPhoto.photo_id, saved.line_id);
    if (warns.includes("V8_duplicate") && !warned) {
      setWarned("warnDup");
      setTimeout(onDone, 1600);
      return;
    }
    onDone();
  }

  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("save")} onPrimary={save} disabled={!canSave} />}>
      <Card>
        {fromPhoto?.uri && (
          <View style={s.photoRow}>
            <Image source={{ uri: fromPhoto.uri }} style={s.photoThumb} resizeMode="cover" />
            <Muted style={{ flex: 1 }}>{fromPhoto.caption ?? fromPhoto.filename}</Muted>
          </View>
        )}
        <Field label={t("whatUsed")} value={desc} onChangeText={setDesc} placeholder="—" />
        <View style={[s.numRow, { marginTop: 10 }]}>
          <NumericField label={t("qty")} value={qty} onChangeText={(x) => setQty(x.replace(/[^0-9.]/g, ""))} placeholder="0" style={{ flex: 1 }} />
          <NumericField label={t("unitCost")} value={cost} onChangeText={(x) => setCost(x.replace(/[^0-9.]/g, ""))} placeholder="0" style={{ flex: 1.2 }} />
        </View>
        {canSave && (
          <View style={s.mathStrip}>
            <Text style={s.mathLeft}>{qty || "0"} × {cost || "0"}</Text>
            <Text style={type.moneyForm}>${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}</Text>
          </View>
        )}
        <GroupLabel style={{ marginTop: 14 }}>{t("unit")}</GroupLabel>
        <ChipWall options={UNIT_ORDER} value={unit} onChange={setUnit} show={6} mono />
      </Card>

      <Card>
        <GroupLabel>{t("kindOfCost")}</GroupLabel>
        <KindOfCost value={cls} onChange={setCls} />
        <View style={{ marginTop: 14 }}>
          <PickerRow
            first
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
        <View style={s.toggleRow}>
          <Switch value={est} onValueChange={setEst} trackColor={{ false: "rgba(42,38,34,0.14)", true: colors.ink }} thumbColor="#ffffff" />
          <Muted style={{ flex: 1 }}>{t("estimated")}</Muted>
        </View>
      </Card>

      <Card>
        <GroupLabel right={t("optional")}>{t("paperTrail")}</GroupLabel>
        <Field label="SKU code" value={sku} onChangeText={setSku} autoCapitalize="characters" placeholder="—" style={{ marginBottom: 8 }} />
        <Field label="Vendor" value={vendor} onChangeText={setVendor} placeholder="—" style={{ marginBottom: 8 }} />
        <Field label="Invoice #" value={invoice} onChangeText={setInvoice} autoCapitalize="none" placeholder="—" />
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
  photoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  photoThumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: colors.surfaceSunken },
  numRow: { flexDirection: "row", gap: 9 },
  mathStrip: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 10 },
  mathLeft: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "600", color: colors.textMuted, textTransform: "uppercase", letterSpacing: 0.5, fontVariant: ["tabular-nums"] },
  ccGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ccCell: { flexBasis: "48%", flexGrow: 1 },
  ccRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1 },
  ccBadge: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  ccBadgeText: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "700" },
  ccLabel: { fontFamily: fonts.body, fontSize: 14 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  errCard: { borderColor: "#b91c1c33", backgroundColor: "#b91c1c0a" },
  errTitle: { fontFamily: fonts.body, color: colors.red, fontWeight: "700", marginBottom: 6, fontSize: 14 },
  errItem: { fontFamily: fonts.body, color: colors.red, fontSize: 14, lineHeight: 21 },
  warnCard: { borderColor: "#a1620733", backgroundColor: "#a1620712" },
  warnText: { fontFamily: fonts.body, color: colors.amber, fontSize: 14, lineHeight: 20 },
});
