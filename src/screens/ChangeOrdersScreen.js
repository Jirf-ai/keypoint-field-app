// Change orders (schema §4.6) — CO list + add. Reason is an enum on purpose:
// aggregated across projects it shows which CO categories get under-estimated.
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { CO_REASONS } from "../schema";
import { addChangeOrder, changeOrders, nextCoNo } from "../store";
import { colors } from "../theme";

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
    setAdding(false);
    setDesc(""); setReason(null); setAmount(""); setDays(""); setApprover(""); setErr(false);
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        <Label>{t("changeOrders")}</Label>
        {cos.length === 0 && <Muted>—</Muted>}
        {cos.map((c) => (
          <View key={c.co_id} style={s.coRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.coTitle}>
                {c.co_no} · ${Number(c.amount).toLocaleString()}
              </Text>
              <Muted numberOfLines={2}>{c.description}</Muted>
            </View>
            <Text style={[s.coStatus, { color: STATUS_TONE[c.status] ?? colors.textSecondary }]}>
              {c.status}
            </Text>
          </View>
        ))}
      </Card>

      {adding ? (
        <Card>
          <Label>{nextCoNo()}</Label>
          <FloatingLabelInput label={t("coDesc")} value={desc} onChangeText={setDesc} autoCapitalize="sentences" style={s.gap} />
          <Label>{t("coReason")}</Label>
          <PickRow options={CO_REASONS} value={reason} onChange={setReason} renderLabel={(k) => t(k)} />
          <View style={[s.row, { marginTop: 10 }]}>
            <View style={{ flex: 1 }}>
              <FloatingLabelInput
                label={t("coAmount")}
                value={amount}
                onChangeText={(x) => setAmount(x.replace(/[^0-9.]/g, ""))}
                keyboardType="decimal-pad"
                autoCapitalize="none"
              />
            </View>
            <View style={{ flex: 1 }}>
              <FloatingLabelInput
                label={t("coDays")}
                value={days}
                onChangeText={(x) => setDays(x.replace(/[^0-9]/g, ""))}
                keyboardType="number-pad"
                autoCapitalize="none"
              />
            </View>
          </View>
          <FloatingLabelInput label={t("coApprover")} value={approver} onChangeText={setApprover} style={s.gapTop} />
          {err && <Text style={s.err}>{t("needFix")} {t("coDesc")}, {t("coReason")}, {t("coAmount")}</Text>}
          <View style={{ gap: 10, marginTop: 12 }}>
            <BigButton label={t("save")} onPress={save} />
            <BigButton label={t("cancel")} onPress={() => setAdding(false)} tone="plain" />
          </View>
        </Card>
      ) : (
        <View style={{ paddingHorizontal: 16, gap: 10 }}>
          <BigButton label={t("addCO")} onPress={() => setAdding(true)} />
          <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10 },
  gap: { marginBottom: 10 },
  gapTop: { marginTop: 10 },
  coRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  coTitle: { color: colors.text, fontWeight: "700", fontSize: 14.5 },
  coStatus: { fontWeight: "800", fontSize: 12.5, textTransform: "uppercase" },
  err: { color: colors.red, marginTop: 10, fontSize: 14 },
});
