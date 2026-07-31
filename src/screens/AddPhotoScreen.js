// + Photo — batch capture with review-before-upload. The camera IS the screen:
// one big orange block. Shoot first, tag after. Nothing persists until the
// explicit Upload confirmation; each photo is organized server-side by project,
// line, who shot it, and time (schema §4.5).
import { useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { refreshLocation } from "../location";
import { Btn, Card, ChipWall, Field, FormScreen, GroupLabel, PHASE_ORDER, PickerRow, Segmented, StickyFooter } from "../components/ui";
import { phaseLabel } from "../i18n";
import { photoFilename } from "../schema";
import { parseProject } from "../components/ProjectPicker";
import { activeLines, addPhoto, currentAreas, currentProject, getSettings, nextPhotoSeq } from "../store";
import { durablePhotoUri } from "../util";
import { colors, fonts, type } from "../theme";


export default function AddPhotoScreen({ t, lang, workDate, onDone }) {
  const st = getSettings();
  const [assets, setAssets] = useState([]); // pending, NOT saved yet
  const [caption, setCaption] = useState("");
  // Work vs receipt (2026-07-31): one tap separates jobsite evidence from the
  // paper trail. Applies to the whole batch — crews don't mix receipts and
  // progress shots in one capture session.
  const [kind, setKind] = useState("work");
  // Auto-tag phase/area with the day's last-used values (PRD §5.1); overridable.
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
        if (!perm.granted) return grab(false);
        res = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsMultipleSelection: true, selectionLimit: 12 });
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

  async function upload() {
    if (!assets.length) return;
    // Force a fresh fix for the geotag (also warms the cache for line stamps).
    const gps = await refreshLocation({ maxAgeMs: 0 });
    let seq = nextPhotoSeq(workDate);
    const proj = currentProject();
    const projCode = proj ? parseProject(proj).code : null;
    for (const a of assets) {
      const filename = photoFilename(workDate, seq++, projCode);
      let storedUri = a.uri;
      if (Platform.OS !== "web") {
        try {
          const dest = new File(Paths.document, filename);
          new File(a.uri).copy(dest);
          storedUri = dest.uri;
        } catch {
          storedUri = a.uri;
        }
      } else {
        // Web: the picker's blob: URL dies with the page session (2026-07-30
        // gauntlet: a phone restart orphaned every photo) — pin the pixels
        // into the row itself before anything else can happen.
        storedUri = await durablePhotoUri(a.uri);
      }
      await addPhoto({
        work_date: workDate,
        uri: storedUri,
        filename,
        caption: caption.trim() || null,
        photo_kind: kind,
        phase,
        area,
        line_id: lineId,
        captured_at: new Date().toISOString(),
        ...(gps ?? {}),
      });
    }
    onDone();
  }

  // ---- capture state ----
  if (assets.length === 0) {
    return (
      <FormScreen
        footer={
          <View style={s.cancelBar}>
            <Pressable onPress={onDone} accessibilityRole="button"><Text style={s.cancelText}>{t("cancel")}</Text></Pressable>
          </View>
        }
      >
        <Pressable onPress={() => grab(true)} style={s.camera} accessibilityRole="button" accessibilityLabel={t("takePhotoTitle")}>
          <Text style={s.camGlyph}>📷</Text>
          <Text style={s.camTitle}>{t("takePhotoTitle")}</Text>
          <Text style={s.camSub}>{t("shootFirst")}</Text>
        </Pressable>
        <View style={{ paddingHorizontal: 14, marginTop: 10 }}>
          <Btn label={t("pickLibrary")} onPress={() => grab(false)} variant="outline" style={{ minHeight: 50 }} />
        </View>
        {err ? <Text style={s.err}>{err}</Text> : null}
      </FormScreen>
    );
  }

  // ---- review state ----
  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={`${t("upload")} ${assets.length}`} onPrimary={upload} tone="green" />}>
      <Card>
        <View style={s.reviewHead}>
          <Text style={s.reviewCount}>{assets.length} {assets.length === 1 ? "photo" : "photos"}</Text>
          <Text style={s.notSaved}>{t("notSavedYet")}</Text>
        </View>
        <Text style={s.reviewSub}>{t("dropMisfires")}</Text>
        <View style={s.thumbs}>
          {assets.map((a, i) => (
            <View key={`${a.uri}-${i}`} style={s.thumbWrap}>
              <Image source={{ uri: a.uri }} style={s.thumb} resizeMode="cover" />
              <Pressable style={s.removeBtn} onPress={() => removeAt(i)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("removePhoto")}>
                <Text style={s.removeX}>✕</Text>
              </Pressable>
            </View>
          ))}
        </View>
        <View style={s.addRow}>
          <Btn label={`📷 ${t("addMore")}`} onPress={() => grab(true)} variant="outline" style={{ flex: 1, minHeight: 44 }} />
          <Btn label={t("library")} onPress={() => grab(false)} variant="outline" style={{ flex: 1, minHeight: 44 }} />
        </View>
      </Card>

      <Card>
        <GroupLabel>{t("photoKind")}</GroupLabel>
        <Segmented
          options={["work", "receipt"]}
          value={kind}
          onChange={setKind}
          renderLabel={(k) => (k === "work" ? t("kindWork") : `🧾 ${t("kindReceipt")}`)}
        />
        <Field label={t("caption")} value={caption} onChangeText={setCaption} autoCapitalize="sentences" placeholder="—" style={{ marginTop: 14 }} />
        <GroupLabel style={{ marginTop: 14 }}>{t("phase")}</GroupLabel>
        <ChipWall options={PHASE_ORDER} value={phase} onChange={setPhase} renderLabel={(p) => phaseLabel(p, lang)} show={4} />
        <GroupLabel style={{ marginTop: 14 }}>{t("area")}</GroupLabel>
        <ChipWall options={currentAreas()} value={area} onChange={setArea} show={6} />
        {lines.length > 0 && (
          <View style={{ marginTop: 6 }}>
            <PickerRow
              label={t("linkLine")}
              value={lineId}
              displayValue={lineId ? (lines.find((l) => l.line_id === lineId)?.worker ?? "—") : t("none")}
              options={[{ code: null }, ...lines.map((l) => ({ code: l.line_id, short: l.kind === "labor" ? `${l.worker} ${l.hours}h` : (l.description ?? "").slice(0, 22) }))]}
              onChange={setLineId}
              renderLabel={(o) => (o.code == null ? t("none") : o.short)}
              show={6}
            />
          </View>
        )}
      </Card>
    </FormScreen>
  );
}

const s = StyleSheet.create({
  camera: { backgroundColor: colors.accent, borderRadius: 14, marginHorizontal: 14, minHeight: 180, alignItems: "center", justifyContent: "center", padding: 20 },
  camGlyph: { fontSize: 34 },
  camTitle: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", color: colors.onInk, marginTop: 6 },
  camSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.onInk, opacity: 0.85, marginTop: 2 },
  cancelBar: { backgroundColor: colors.surfaceSunken, borderTopWidth: 1, borderTopColor: "rgba(42,38,34,0.12)", paddingVertical: 15, alignItems: "center" },
  cancelText: { fontFamily: fonts.body, fontSize: 15, fontWeight: "600", color: colors.textMuted },
  err: { fontFamily: fonts.body, color: colors.red, marginHorizontal: 14, marginTop: 10, fontSize: 13 },

  reviewHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  reviewCount: { fontFamily: fonts.display, fontSize: 20, fontWeight: "700", color: colors.text },
  notSaved: { fontFamily: fonts.mono, fontSize: 10, fontWeight: "700", letterSpacing: 0.8, textTransform: "uppercase", color: colors.accent },
  reviewSub: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 4 },
  thumbs: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between", rowGap: 8, marginTop: 12 },
  thumbWrap: { flexBasis: "31.5%", position: "relative" },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: colors.surfaceSunken },
  removeBtn: { position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  removeX: { color: "#fff", fontSize: 11, fontWeight: "800", lineHeight: 13 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 12 },
});
