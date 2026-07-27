// Settings — the worker's name (provenance on every entry) and the read-only
// project record. Name is inline-editable (no separate Save); the project record
// is set in mono so it reads as "not editable" (§SettingsScreen).
import { useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Btn, Card, Field, StackedFooter } from "../components/ui";
import { PROJECT } from "../schema";
import { activeProfile, getSettings, saveSettings } from "../store";
import { colors, fonts, type } from "../theme";

const SPEC = [
  ["GC", PROJECT.gc_of_record],
  ["LIC", PROJECT.gc_license],
  ["PM", PROJECT.pm_entity],
  ["PMT", PROJECT.permits.join(" · ")],
];

export default function SettingsScreen({ t, onDone, onLogout }) {
  const me = activeProfile();
  const st = getSettings();
  const [name, setName] = useState(st.recorded_by || me?.display_name || "");
  const [editing, setEditing] = useState(false);

  function changeName(x) {
    setName(x);
    saveSettings({ recorded_by: x.trim() });
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
        {/* identity */}
        <Card>
          {editing ? (
            <Field label="Your name" value={name} onChangeText={changeName} placeholder="Your name" />
          ) : (
            <View style={s.idRow}>
              {me?.selfie_uri ? (
                <Image source={{ uri: me.selfie_uri }} style={s.avatar} />
              ) : (
                <View style={[s.avatar, s.avatarEmpty]}><Text style={s.avatarInitial}>{(name || "?")[0]}</Text></View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={s.idLabel}>YOUR NAME</Text>
                <Text style={s.idName}>{name || "—"}</Text>
              </View>
              <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("edit")}>
                <Text style={s.edit}>{t("edit")}</Text>
              </Pressable>
            </View>
          )}
        </Card>

        {/* read-only project record */}
        <Card>
          <View style={s.recHead}>
            <Text style={type.projectCode}>{PROJECT.project_id}</Text>
            <Text style={s.recRO}>{t("readOnlyRecords")}</Text>
          </View>
          <Text style={s.recName}>{PROJECT.name}</Text>
          <Text style={s.recAddr}>{PROJECT.address}</Text>
          <View style={s.spec}>
            {SPEC.map(([k, v]) => (
              <View key={k} style={s.specRow}>
                <Text style={s.specKey}>{k}</Text>
                <Text style={s.specVal}>{v}</Text>
              </View>
            ))}
          </View>
        </Card>
      </ScrollView>

      <StackedFooter>
        {onLogout && <Btn label={t("switchWorker")} onPress={onLogout} variant="outline" />}
        {onLogout && <Btn label={t("logout")} onPress={onLogout} variant="destructive" />}
      </StackedFooter>
    </View>
  );
}

const s = StyleSheet.create({
  idRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  avatar: { width: 46, height: 46, borderRadius: 23, backgroundColor: colors.surfaceSunken },
  avatarEmpty: { alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  avatarInitial: { fontFamily: fonts.mono, color: colors.onInk, fontSize: 18, fontWeight: "700" },
  idLabel: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "600", letterSpacing: 1.33, textTransform: "uppercase", color: colors.label },
  idName: { fontFamily: fonts.body, fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 2 },
  edit: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.accent },

  recHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  recRO: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase", color: colors.label },
  recName: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: "700", color: colors.text, marginTop: 6 },
  recAddr: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 2 },
  spec: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 10 },
  specRow: { flexDirection: "row", gap: 12 },
  specKey: { ...type.spec, width: 38, color: colors.label },
  specVal: { ...type.spec, flex: 1, color: colors.textSecondary },
});
