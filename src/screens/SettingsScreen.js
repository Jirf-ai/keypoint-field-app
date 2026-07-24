// Settings — the crew member's name (provenance on every entry) and language.
// Kept to the minimum the schema needs; personal data is minimized on purpose
// (schema §4.8).
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted } from "../components/ui";
import { PROJECT } from "../schema";
import { getSettings, saveSettings } from "../store";
import { colors } from "../theme";

const LANGS = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];

export default function SettingsScreen({ t, onDone, onLang, onLogout }) {
  const st = getSettings();
  const [name, setName] = useState(st.recorded_by || "");
  const [lang, setLang] = useState(st.lang || "en");

  async function save() {
    await saveSettings({ recorded_by: name.trim(), lang });
    onLang(lang);
    onDone();
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        <FloatingLabelInput label={t("yourName")} value={name} onChangeText={setName} style={{ marginBottom: 12 }} />
        <Label>{t("language")}</Label>
        <View style={s.langRow}>
          {LANGS.map((l) => (
            <BigButton
              key={l.code}
              label={l.label}
              onPress={() => setLang(l.code)}
              tone={lang === l.code ? "brand" : "plain"}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </Card>
      <Card>
        <Label>{PROJECT.project_id}</Label>
        <Text style={s.proj}>{PROJECT.name}</Text>
        <Muted>{PROJECT.address}</Muted>
        <Muted>
          {PROJECT.gc_of_record} · {PROJECT.gc_license}
        </Muted>
        <Muted>PM: {PROJECT.pm_entity} · Permits: {PROJECT.permits.join(", ")}</Muted>
      </Card>
      <View style={{ paddingHorizontal: 16, gap: 10 }}>
        <BigButton label={t("save")} onPress={save} />
        <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
        {onLogout && <BigButton label={t("switchUser")} onPress={onLogout} tone="plain" />}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  langRow: { flexDirection: "row", gap: 10 },
  proj: { color: colors.text, fontWeight: "700", fontSize: 15, marginBottom: 4 },
});
