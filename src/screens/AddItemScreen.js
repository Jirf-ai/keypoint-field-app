// + Material / Item — the core cost record (schema §4.3). Every field that
// isn't essential is a reason to abandon the app (PRD §3), so: description,
// qty, unit, cost, one-tap cost class, phase/area preloaded from last use.
import { useState } from "react";
import { Image, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { phaseLabel } from "../i18n";
import { COST_CLASSES, PHASES, UNITS, areasFor, validateLineItem, lineWarnings } from "../schema";
import { activeLines, addLine, changeOrders, currentProject, getSettings, linkPhoto } from "../store";
import { CLASS_COLORS, colors } from "../theme";

const FIX_KEYS = {
  V1_cost_class: "fixClass",
  V_description: "fixDesc",
  V3_qty: "fixQty",
  V4_unit_cost: "fixCost",
  V2_unit: "fixUnit",
  V_phase: "fixPhase",
  V_area: "fixArea",
};

// fromPhoto: photo-first flow — the material was photographed earlier; this
// form fills in its details and links the photo to the new line on save.
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
  const [note, setNote] = useState("");
  const [coRef, setCoRef] = useState(null);
  const [errors, setErrors] = useState([]);
  const [warned, setWarned] = useState(null);

  const cos = changeOrders().filter((c) => c.status !== "rejected");

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
      co_ref: coRef,
      note: note.trim() || null,
    };
    const blocks = validateLineItem(entry);
    if (blocks.length) {
      setErrors(blocks);
      return;
    }
    // Warnings NEVER block capture (schema §8) — save first, mention after.
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
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        {fromPhoto?.uri && (
          <View style={s.photoRow}>
            <Image source={{ uri: fromPhoto.uri }} style={s.photoThumb} resizeMode="cover" />
            <Muted style={{ flex: 1 }}>{fromPhoto.caption ?? fromPhoto.filename}</Muted>
          </View>
        )}
        <FloatingLabelInput label={t("whatUsed")} value={desc} onChangeText={setDesc} style={s.gap} />
        <View style={[s.row, s.gap]}>
          <View style={{ flex: 1 }}>
            <FloatingLabelInput
              label={t("qty")}
              value={qty}
              onChangeText={(x) => setQty(x.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              autoCapitalize="none"
            />
          </View>
          <View style={{ flex: 1.2 }}>
            <FloatingLabelInput
              label={t("unitCost")}
              value={cost}
              onChangeText={(x) => setCost(x.replace(/[^0-9.]/g, ""))}
              keyboardType="decimal-pad"
              autoCapitalize="none"
            />
          </View>
        </View>
        {qty !== "" && cost !== "" && (
          <Text style={s.total}>
            = ${(Number(qty) * Number(cost)).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </Text>
        )}

        <Label>{t("unit")}</Label>
        <PickRow options={UNITS} value={unit} onChange={setUnit} />

        <Label>{t("costClass")}</Label>
        <PickRow
          options={COST_CLASSES}
          value={cls}
          onChange={setCls}
          colorFor={(k) => CLASS_COLORS[k]}
        />
        {cls && <Muted style={s.gapTop}>{t(`class${cls}`)}</Muted>}

        <Label>{t("phase")}</Label>
        <PickRow
          options={PHASES}
          value={phase}
          onChange={setPhase}
          renderLabel={(p) => phaseLabel(p, lang)}
        />

        <Label>{t("area")}</Label>
        <PickRow options={areasFor(currentProject()?.name)} value={area} onChange={setArea} />

        <View style={[s.row, s.gapTop, { alignItems: "center" }]}>
          <Switch value={est} onValueChange={setEst} trackColor={{ true: colors.brand }} />
          <Muted style={{ flex: 1 }}>{t("estimated")}</Muted>
        </View>
      </Card>

      <Card>
        <FloatingLabelInput label={t("skuOptional")} value={sku} onChangeText={setSku} autoCapitalize="characters" style={s.gap} />
        <FloatingLabelInput label={t("vendor")} value={vendor} onChangeText={setVendor} style={s.gap} />
        <FloatingLabelInput label={t("invoice")} value={invoice} onChangeText={setInvoice} autoCapitalize="none" style={s.gap} />
        <FloatingLabelInput label={t("note")} value={note} onChangeText={setNote} autoCapitalize="sentences" />
        {cos.length > 0 && (
          <>
            <Label>{t("linkCO")}</Label>
            <PickRow
              options={[{ code: null }, ...cos.map((c) => ({ code: c.co_no }))]}
              value={coRef}
              onChange={setCoRef}
              renderLabel={(o) => (o.code == null ? t("none") : o.code)}
            />
          </>
        )}
      </Card>

      {errors.length > 0 && (
        <Card style={s.errCard}>
          <Text style={s.errTitle}>{t("needFix")}</Text>
          {errors.map((e) => (
            <Text key={e} style={s.errItem}>
              • {t(FIX_KEYS[e] ?? e)}
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
  photoRow: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 12 },
  photoThumb: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#eee" },
  row: { flexDirection: "row", gap: 10 },
  gap: { marginBottom: 10 },
  gapTop: { marginTop: 8 },
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
