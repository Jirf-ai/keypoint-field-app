// + Photo — batch capture with review-before-upload (Jeffrey 2026-07-24).
// Take or pick MULTIPLE photos; they show as an array of thumbnails, each with
// an ✕ to remove a misclick, and NOTHING saves until the explicit Upload
// confirmation. Each saved photo is organized server-side by project, task
// line, who recorded it, and time of day (schema §4.5; sync fills storage).
import { useState } from "react";
import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import FloatingLabelInput from "../components/FloatingLabelInput";
import { BigButton, Card, Label, Muted, PickRow } from "../components/ui";
import { phaseLabel } from "../i18n";
import { PHASES, areasFor, photoFilename } from "../schema";
import { activeLines, addPhoto, currentProject, getSettings, nextPhotoSeq } from "../store";
import { colors } from "../theme";

export default function AddPhotoScreen({ t, lang, workDate, onDone }) {
  const st = getSettings();
  const [assets, setAssets] = useState([]); // pending, NOT saved yet
  const [caption, setCaption] = useState("");
  const [phase, setPhase] = useState(st.lastPhase);
  const [area, setArea] = useState(st.lastArea);
  const [lineId, setLineId] = useState(null);
  const [err, setErr] = useState(null);

  const lines = activeLines(workDate);

  async function grab(fromCamera) {
    setErr(null);
    try {
      let res;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return;
        res = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({
          quality: 0.6,
          allowsMultipleSelection: true,
          selectionLimit: 12,
        });
      }
      if (!res.canceled && res.assets?.length) {
        setAssets((prev) => [...prev, ...res.assets.map((a) => ({ uri: a.uri }))]);
      }
    } catch (e) {
      setErr(String(e?.message ?? e));
    }
  }

  function removeAt(i) {
    setAssets((prev) => prev.filter((_, idx) => idx !== i));
  }

  // The official confirmation — only now does anything persist.
  async function upload() {
    if (!assets.length) return;
    let seq = nextPhotoSeq(workDate);
    for (const a of assets) {
      const filename = photoFilename(workDate, seq++);
      let storedUri = a.uri;
      if (Platform.OS !== "web") {
        try {
          const dest = new File(Paths.document, filename);
          new File(a.uri).copy(dest);
          storedUri = dest.uri;
        } catch {
          storedUri = a.uri; // keep the original reference; never lose a capture
        }
      }
      await addPhoto({
        work_date: workDate,
        uri: storedUri,
        filename,
        caption: caption.trim() || null,
        phase,
        area,
        line_id: lineId,
        captured_at: new Date().toISOString(),
      });
    }
    onDone();
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}>
      <Card>
        <View style={{ gap: 10 }}>
          <BigButton label={`📷  ${t("takePhoto")}`} onPress={() => grab(true)} tone={assets.length ? "plain" : "brand"} />
          <BigButton label={t("pickPhoto")} onPress={() => grab(false)} tone="plain" />
        </View>
        {err && <Text style={s.err}>{err}</Text>}

        {assets.length > 0 && (
          <>
            <Label>
              {assets.length} {t("photosSelected")}
            </Label>
            <Muted style={{ marginBottom: 10 }}>{t("reviewPhotosHint")}</Muted>
            <View style={s.grid}>
              {assets.map((a, i) => (
                <View key={`${a.uri}-${i}`} style={s.thumbWrap}>
                  <Image source={{ uri: a.uri }} style={s.thumb} resizeMode="cover" />
                  <Pressable
                    style={s.removeBtn}
                    onPress={() => removeAt(i)}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={t("removePhoto")}
                  >
                    <Text style={s.removeX}>✕</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          </>
        )}
      </Card>

      {assets.length > 0 && (
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
            <PickRow options={areasFor(currentProject()?.name)} value={area} onChange={setArea} />
            {lines.length > 0 && (
              <>
                <Label>{t("linkLine")}</Label>
                <PickRow
                  options={[
                    { code: null },
                    ...lines.map((l) => ({
                      code: l.line_id,
                      short:
                        l.kind === "labor"
                          ? `${l.worker} ${l.hours}h`
                          : (l.description ?? "").slice(0, 26),
                    })),
                  ]}
                  value={lineId}
                  onChange={setLineId}
                  renderLabel={(o) => (o.code == null ? t("none") : o.short)}
                />
              </>
            )}
          </Card>
          <View style={{ paddingHorizontal: 16, gap: 10 }}>
            <BigButton
              label={`${t("upload")} (${assets.length})`}
              onPress={upload}
              tone="green"
            />
            <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
          </View>
        </>
      )}
      {assets.length === 0 && (
        <View style={{ paddingHorizontal: 16 }}>
          <BigButton label={t("cancel")} onPress={onDone} tone="plain" />
        </View>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  thumbWrap: { position: "relative" },
  thumb: { width: 96, height: 96, borderRadius: 12, backgroundColor: "#eee" },
  removeBtn: {
    position: "absolute",
    top: -7,
    left: -7,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.red,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#fff",
    elevation: 3,
  },
  removeX: { color: "#fff", fontSize: 13, fontWeight: "800", lineHeight: 15 },
  err: { color: colors.red, marginTop: 8, fontSize: 13.5 },
});
