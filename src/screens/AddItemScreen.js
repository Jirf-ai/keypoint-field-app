// + Material / Item — the core cost record (schema §4.3). Minimal by doctrine:
// description, qty, unit, cost, one-tap cost class, phase/area preloaded. Unit is
// a mono chip wall (codes, not words); cost class is a labelled 2×2 grid that
// pre-selects a sensible default for the phase (PRD Appendix #2). Opening with an
// existing line in `editing` prefills the form and saves an append-only
// correction (amendLine) instead of a new row.
import { useState } from "react";
import { Image, StyleSheet, Switch, Text, View } from "react-native";
import BarcodeScanner from "../components/BarcodeScanner";
import { Btn, Card, ChipWall, Field, FormScreen, GroupLabel, MathStrip, Muted, NoticeCard, NumericField, PickerRow, StickyFooter, preferred } from "../components/ui";
import { phaseLabel } from "../i18n";
import { COST_CLASSES, PHASES, UNITS, defaultClassForPhase, validateLineItem, lineWarnings } from "../schema";
import { activeLines, addLine, amendLine, changeOrders, currentAreas, getSettings, linkPhoto } from "../store";
import { CLASS_COLORS, CLASS_LABELS, colors, fonts } from "../theme";

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

export default function AddItemScreen({ t, lang, workDate, onDone, fromPhoto, editing }) {
  const st = getSettings();
  const initPhase = editing?.phase ?? st.lastPhase;
  const [desc, setDesc] = useState(editing?.description ?? "");
  const [sku, setSku] = useState(editing?.sku_code ?? "");
  const [qty, setQty] = useState(editing ? String(editing.qty ?? "") : "");
  const [unit, setUnit] = useState(editing?.unit ?? null);
  const [cost, setCost] = useState(editing?.unit_cost != null ? String(editing.unit_cost) : "");
  // cost_class starts on the phase's sensible default; a manual tap pins it.
  const [cls, setCls] = useState(editing?.cost_class ?? (initPhase ? defaultClassForPhase(initPhase) : null));
  const [clsTouched, setClsTouched] = useState(!!editing);
  const [phase, setPhase] = useState(initPhase);
  const [area, setArea] = useState(editing?.area ?? st.lastArea);
  const [est, setEst] = useState(editing?.qty_is_estimated ?? false);
  const [vendor, setVendor] = useState(editing?.vendor ?? "");
  const [invoice, setInvoice] = useState(editing?.invoice_ref ?? "");
  const [coNo, setCoNo] = useState(editing?.co_no ?? null);
  const [scanning, setScanning] = useState(false);
  const [errors, setErrors] = useState([]);
  const [warned, setWarned] = useState(null);

  const cos = changeOrders();
  const total = Number(qty || 0) * Number(cost || 0);
  const canSave = !!desc.trim() && qty !== "" && cost !== "";

  // Changing the phase re-suggests its default class — unless the user already
  // picked one by hand (or we're editing an existing line).
  function pickPhase(p) {
    setPhase(p);
    if (!clsTouched) setCls(defaultClassForPhase(p));
  }
  function pickClass(k) {
    setCls(k);
    setClsTouched(true);
  }

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
      co_no: coNo,
      note: editing?.note ?? null,
    };
    const blocks = validateLineItem(entry);
    if (blocks.length) {
      setErrors(blocks);
      return;
    }
    if (editing) {
      // Corrections are append-only: the old row stays, marked superseded.
      await amendLine(editing.line_id, entry);
      onDone();
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

  const coOptions = [{ code: null }, ...cos.map((c) => ({ code: c.co_no, short: `${c.co_no} · ${(c.description ?? "").slice(0, 20)}` }))];

  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("save")} onPrimary={save} disabled={!canSave} />}>
      {editing && (
        <NoticeCard tone="warn" style={{ marginTop: 2 }}>
          <Text style={s.editNote}>{t("editEntry")}</Text>
        </NoticeCard>
      )}
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
        {canSave && <MathStrip left={`${qty || "0"} × ${cost || "0"}`} amount={`$${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`} />}
        <GroupLabel style={{ marginTop: 14 }}>{t("unit")}</GroupLabel>
        <ChipWall options={UNIT_ORDER} value={unit} onChange={setUnit} show={6} mono />
      </Card>

      <Card>
        <GroupLabel right={t("optional")}>{t("paperTrail")}</GroupLabel>
        <Field label={t("skuCode")} value={sku} onChangeText={setSku} autoCapitalize="characters" placeholder="—" style={{ marginBottom: 8 }} />
        <Btn label={`▥  ${t("scanBarcode")}`} onPress={() => setScanning(true)} variant="outline" style={{ minHeight: 44, marginBottom: 8 }} />
        <Field label={t("vendor")} value={vendor} onChangeText={setVendor} placeholder="—" style={{ marginBottom: 8 }} />
        <Field label={t("invoice")} value={invoice} onChangeText={setInvoice} autoCapitalize="none" placeholder="—" />
        {cos.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <PickerRow
              label={t("linkCO")}
              value={coNo}
              displayValue={coNo ?? t("none")}
              options={coOptions}
              onChange={setCoNo}
              renderLabel={(o) => (o.code == null ? t("none") : o.short)}
              show={6}
            />
          </View>
        )}
      </Card>

      <Card>
        <GroupLabel>{t("kindOfCost")}</GroupLabel>
        <KindOfCost value={cls} onChange={pickClass} />
        <View style={{ marginTop: 14 }}>
          <PickerRow
            first
            label={t("phase")}
            value={phase}
            displayValue={phase ? phaseLabel(phase, lang) : null}
            options={PHASE_ORDER}
            onChange={pickPhase}
            renderLabel={(p) => phaseLabel(p, lang)}
            show={4}
          />
          <PickerRow label={t("area")} value={area} displayValue={area} options={currentAreas()} onChange={setArea} show={6} />
        </View>
        <View style={s.toggleRow}>
          <Switch value={est} onValueChange={setEst} trackColor={{ false: "rgba(42,38,34,0.14)", true: colors.ink }} thumbColor="#ffffff" />
          <Muted style={{ flex: 1 }}>{t("estimated")}</Muted>
        </View>
      </Card>

      {errors.length > 0 && (
        <NoticeCard tone="error" title={t("needFix")}>
          {errors.map((e) => (
            <Text key={e} style={s.errItem}>• {t(FIX_KEYS[e] ?? e)}</Text>
          ))}
        </NoticeCard>
      )}
      {warned && (
        <NoticeCard tone="warn">
          <Text style={s.warnText}>{t(warned)}</Text>
        </NoticeCard>
      )}

      <BarcodeScanner
        visible={scanning}
        t={t}
        onClose={() => setScanning(false)}
        onScan={(codeVal) => {
          setSku(codeVal);
          setScanning(false);
        }}
      />
    </FormScreen>
  );
}

const s = StyleSheet.create({
  photoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  photoThumb: { width: 60, height: 60, borderRadius: 10, backgroundColor: colors.surfaceSunken },
  numRow: { flexDirection: "row", gap: 9 },
  ccGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  ccCell: { flexBasis: "48%", flexGrow: 1 },
  ccRow: { flexDirection: "row", alignItems: "center", gap: 10, borderRadius: 8, paddingVertical: 11, paddingHorizontal: 12, borderWidth: 1 },
  ccBadge: { width: 26, height: 26, borderRadius: 7, alignItems: "center", justifyContent: "center" },
  ccBadgeText: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "700" },
  ccLabel: { fontFamily: fonts.body, fontSize: 14 },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 },
  editNote: { fontFamily: fonts.body, color: colors.amber, fontSize: 13.5, fontWeight: "600" },
  errItem: { fontFamily: fonts.body, color: colors.red, fontSize: 14, lineHeight: 21 },
  warnText: { fontFamily: fonts.body, color: colors.amber, fontSize: 14, lineHeight: 20 },
});
