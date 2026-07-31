// Add a project (site managers only). Creates a project on-device and selects
// it, then hands the SM THE PROJECT'S OWN CODE to text to the crew — they
// paste it into their project search to pull the job up (Jeffrey 2026-07-30;
// the old personal share-code card is retired).
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { parseProject } from "../components/ProjectPicker";
import { Btn, Card, Field, FormScreen, GroupLabel, Muted, StickyFooter } from "../components/ui";
import { addOwnedProject } from "../store";
import { copyToClipboard } from "../util";
import { colors, fonts } from "../theme";

export default function AddProjectScreen({ t, onDone }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [areas, setAreas] = useState("");
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  async function save() {
    if (!name.trim()) return;
    const p = await addOwnedProject({ name, address, areas: areas.split(",") });
    setCreated(p);
  }

  // ---- success: the project's code, front and center, one tap to copy ----
  if (created) {
    const code = parseProject(created).code;
    return (
      <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("close")} primaryLabel={t("done")} onPrimary={onDone} tone="green" />}>
        <Card>
          <GroupLabel>{t("projectCreated")}</GroupLabel>
          <Text style={s.createdName}>{parseProject(created).display}</Text>
          <View style={s.codeRow}>
            <Text style={s.code}>{code}</Text>
            <Pressable
              style={s.copyChip}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("copyCode")}
              onPress={async () => {
                if (await copyToClipboard(code)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }
              }}
            >
              <Text style={s.copyChipText}>{copied ? `✓ ${t("copiedCode")}` : `⧉ ${t("copyCode")}`}</Text>
            </Pressable>
          </View>
          <Muted style={{ marginTop: 8 }}>{t("projectCodeShareHint")}</Muted>
        </Card>
      </FormScreen>
    );
  }

  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("addProjectCta")} onPrimary={save} disabled={!name.trim()} />}>
      <Card>
        <Field label={t("projectNameLabel")} value={name} onChangeText={setName} placeholder={t("projectNamePlaceholder")} style={{ marginBottom: 12 }} />
        <Field label={t("addressLabel")} value={address} onChangeText={setAddress} placeholder="—" style={{ marginBottom: 12 }} />
        <Field label={t("areasLabel")} value={areas} onChangeText={setAreas} autoCapitalize="words" placeholder={t("areasPlaceholder")} hint={t("areasHint")} />
      </Card>
    </FormScreen>
  );
}

const s = StyleSheet.create({
  createdName: { fontFamily: fonts.display, fontSize: 19, fontWeight: "800", color: colors.text, marginTop: 2 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  code: { fontFamily: fonts.mono, fontSize: 24, fontWeight: "700", letterSpacing: 1, color: colors.accent },
  copyChip: { borderWidth: 1, borderColor: "#d95a1f55", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, backgroundColor: "#d95a1f0d" },
  copyChipText: { fontFamily: fonts.body, fontSize: 12, fontWeight: "700", color: colors.accent },
});
