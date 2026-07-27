// Add a project (site managers only). Creates a project on-device and selects
// it; the share code below is what crew type to join this manager's list.
import { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { Card, Field, FormScreen, GroupLabel, Muted, StickyFooter } from "../components/ui";
import { addOwnedProject, myShareCode } from "../store";
import { colors, fonts } from "../theme";

export default function AddProjectScreen({ t, onDone }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const code = myShareCode();

  async function save() {
    if (!name.trim()) return;
    await addOwnedProject({ name, address });
    onDone();
  }

  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("addProjectCta")} onPrimary={save} disabled={!name.trim()} />}>
      <Card>
        <Field label={t("projectNameLabel")} value={name} onChangeText={setName} placeholder={t("projectNamePlaceholder")} style={{ marginBottom: 12 }} />
        <Field label={t("addressLabel")} value={address} onChangeText={setAddress} placeholder="—" />
      </Card>

      <Card>
        <GroupLabel>{t("shareCodeLabel")}</GroupLabel>
        <Text style={s.code}>{code}</Text>
        <Muted style={{ marginTop: 6 }}>{t("shareCodeHint")}</Muted>
      </Card>
    </FormScreen>
  );
}

const s = StyleSheet.create({
  code: { fontFamily: fonts.mono, fontSize: 22, fontWeight: "700", letterSpacing: 1, color: colors.accent },
});
