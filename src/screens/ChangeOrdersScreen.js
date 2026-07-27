// Change orders (schema §4.6) — CO list + add. Reason is an enum on purpose:
// aggregated across projects it shows which CO categories get under-estimated.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Btn, Card, ChipWall, EmptyState, Field, FormScreen, GroupLabel, NumericField, StickyFooter, usdCents } from "../components/ui";
import { CO_REASONS } from "../schema";
import { addChangeOrder, changeOrders, nextCoNo } from "../store";
import { colors, fonts, type } from "../theme";

const STATUS_TONE = {
  pending: colors.amber,
  approved: colors.green,
  rejected: colors.red,
  completed: colors.textSecondary,
};

export default function ChangeOrdersScreen({ t, workDate, onDone }) {
  const [adding, setAdding] = useState(false);
  const [desc, setDesc] = useState("");
  const [reason, setReason] = useState(null);
  const [amount, setAmount] = useState("");
  const [days, setDays] = useState("");
  const [approver, setApprover] = useState("");
  const [err, setErr] = useState(false);

  const cos = changeOrders();

  async function save() {
    if (!desc.trim() || !reason || amount === "") {
      setErr(true);
      return;
    }
    await addChangeOrder({
      co_no: nextCoNo(),
      date: workDate,
      description: desc.trim(),
      reason,
      amount: Number(amount),
      schedule_impact_days: days === "" ? null : Number(days),
      approved_by: approver.trim() || null,
    });
    setDesc(""); setReason(null); setAmount(""); setDays(""); setApprover(""); setErr(false);
    setAdding(false);
  }

  // ---- add form ----
  if (adding) {
    return (
      <FormScreen footer={<StickyFooter onCancel={() => setAdding(false)} cancelLabel={t("cancel")} primaryLabel={t("save")} onPrimary={save} />}>
        <Card>
          <Text style={type.projectCode}>{nextCoNo()}</Text>
          <Field label={t("coDesc")} value={desc} onChangeText={setDesc} autoCapitalize="sentences" placeholder="—" style={{ marginTop: 8 }} />
          <GroupLabel style={{ marginTop: 14 }}>{t("coReason")}</GroupLabel>
          <ChipWall options={CO_REASONS} value={reason} onChange={setReason} renderLabel={(k) => t(k)} show={6} />
          <View style={[s.numRow, { marginTop: 14 }]}>
            <NumericField label={t("coAmount")} value={amount} onChangeText={(x) => setAmount(x.replace(/[^0-9.]/g, ""))} placeholder="0" style={{ flex: 1 }} />
            <NumericField label={t("coDays")} value={days} onChangeText={(x) => setDays(x.replace(/[^0-9]/g, ""))} placeholder="0" style={{ flex: 1 }} />
          </View>
          <Field label={t("coApprover")} value={approver} onChangeText={setApprover} placeholder="—" style={{ marginTop: 10 }} />
          {err && <Text style={s.err}>{t("needFix")}</Text>}
        </Card>
      </FormScreen>
    );
  }

  // ---- list / empty ----
  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("back")} primaryLabel={t("addCO")} onPrimary={() => setAdding(true)} />}>
      {cos.length === 0 ? (
        <EmptyState dashed title={t("noChangeOrders")} body={t("coEmptyBody")} />
      ) : (
        <Card>
          <GroupLabel>{t("changeOrders")}</GroupLabel>
          {cos.map((c) => (
            <View key={c.co_id} style={s.coRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.coTitle}>{c.co_no} · {usdCents(c.amount)}</Text>
                <Text style={s.coDesc} numberOfLines={2}>{c.description}</Text>
              </View>
              <Text style={[s.coStatus, { color: STATUS_TONE[c.status] ?? colors.textSecondary }]}>{c.status}</Text>
            </View>
          ))}
        </Card>
      )}
    </FormScreen>
  );
}

const s = StyleSheet.create({
  numRow: { flexDirection: "row", gap: 9 },
  coRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 11, borderTopWidth: 1, borderTopColor: colors.border },
  coTitle: { fontFamily: fonts.body, color: colors.text, fontWeight: "700", fontSize: 14 },
  coDesc: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12.5, marginTop: 1 },
  coStatus: { fontFamily: fonts.mono, fontWeight: "700", fontSize: 10.5, letterSpacing: 0.6, textTransform: "uppercase" },
  err: { fontFamily: fonts.body, color: colors.red, marginTop: 12, fontSize: 14 },
});
