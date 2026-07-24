// + Photo — schema §4.5. In-app capture, stored per project + date with the
// naming convention {1257-YYYYMMDD-seq.jpg}; original kept locally until sync
// confirms (the app never deletes what the server hasn't acknowledged).
import { useState } from "react";
import { Image, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { phaseLabel } from "../i18n";
import { PHASES, PROJECT, photoFilename } from "../schema";
import { addPhoto, getSettings, nextPhotoSeq } from "../store";
import { colors } from "../theme";

export default function AddPhotoScreen({ t, lang, workDate, onDone }) {
  const st = getSettings();
  const [uri, setUri] = useState(null);
  const [caption, setCaption] = useState("");
  const [phase, setPhase] = useState(st.lastPhase);
  const [area, setArea] = useState(st.lastArea);
  const [err, setErr] = useState(null);

  async function grab(fromCamera) {
    setErr(null);
    try {
      const fn = fromCamera ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
      }
      const res = await fn({ quality: 0.6, exif: false });
      if (!res.canceled && res.assets?.[0]?.uri) setUri(res.assets[0].uri);
    } catch (e) {
      setErr(String(e?.message ?? e));
    }
  }

  async function save() {
    if (!uri) return;
    const filename = photoFilename(workDate, nextPhotoSeq(workDate));
    let storedUri = uri;
    // Copy into app documents under the convention name (native only — web
    // keeps the blob/data URI as-is).
    if (Platform.OS !== "web") {
      try {
        const dest = new File(Paths.document, filename);
        new File(uri).copy(dest);
        storedUri = dest.uri;
      } catch {
        storedUri = uri; // keep the original reference; never lose the capture
      }
    }
    await addPhoto({
      work_date: workDate,
      uri: storedUri,
      filename,
      caption: caption.trim() || null,
      phase,
      area,
      captured_at: new Date().toISOString(),
    });
    onDone();
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        {uri ? (
          <Image source={{ uri }} style={s.preview} resizeMode="cover" />
        ) : (
          <View style={{ gap: 10 }}>
            <BigButton label={`📷  ${t("takePhoto")}`} onPress={() => grab(true)} />
            <BigButton label={t("pickPhoto")} onPress={() => grab(false)} tone="plain" />
          </View>
        )}
        {err && <Text style={s.err}>{err}</Text>}
      </Card>

      {uri && (
        <>
          <Card>
            <FloatingLabelInput
              label={t("caption")}
              value={caption}
              onChangeText={setCaption}
              autoCapitalize="sentences"
              style={{ marginBottom: 10 }}
            />
            <Label>{t("phase")}</Label>
            <PickRow
              options={PHASES}
              value={phase}
              onChange={setPhase}
              renderLabel={(p) => phaseLabel(p, lang)}
            />
            <Label>{t("area")}</Label>
            <PickRow options={PROJECT.areas} value={area} onChange={setArea} />
            <Muted style={{ marginTop: 8 }}>
              {photoFilename(workDate, nextPhotoSeq(workDate))}
            </Muted>
          </Card>
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            <BigButton label={t("save")} onPress={save} />
            <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
          </View>
        </>
      )}
      {!uri && (
        <View style={{ paddingHorizontal: 16 }}>
          <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  preview: { width: "100%", height: 280, borderRadius: 12, backgroundColor: "#eee" },
  err: { color: colors.red, marginTop: 8, fontSize: 13.5 },
});
