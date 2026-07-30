// SF-02 — report an incident or near-miss. Available to EVERY role (safety is
// not the foreman's private duty), reachable in one tap from Today, and built
// to be done in under a minute while standing on the site: pick a type, say
// what happened, snap a photo, save.
//
// What the app fills in silently so the worker doesn't have to: location, the
// time it was recorded, who is reporting, the project and the day. What it
// refuses to do: block the save. A photo is urged and never required — someone
// helping a person up should not be arguing with a camera. Records are
// append-only and nothing is ever hard-deleted (PRD §5.3).
import { useState } from "react";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { File, Paths } from "expo-file-system";
import { refreshLocation } from "../location";
import { Btn, Card, ChipWall, Field, FormScreen, GroupLabel, Muted, NoticeCard, StickyFooter } from "../components/ui";
import { INCIDENT_TYPES, incidentWarnings, photoFilename, validateIncident } from "../schema";
import { addIncident, addPhoto, currentAreas, getSettings, nextPhotoSeq } from "../store";
import { colors, fonts, type } from "../theme";

// Each type gets a glyph so the choice reads at arm's length in sunlight.
const TYPE_GLYPH = { injury: "🚑", near_miss: "⚠️", property: "🔧", other: "•" };

export default function IncidentScreen({ t, lang, workDate, onDone }) {
  const st = getSettings();
  const [incidentType, setIncidentType] = useState(null);
  const [description, setDescription] = useState("");
  const [area, setArea] = useState(st.lastArea);
  const [assets, setAssets] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [saved, setSaved] = useState(null); // the recorded incident → confirmation
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function grab(fromCamera) {
    setErr(null);
    try {
      let res;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted) return grab(false);
        res = await ImagePicker.launchCameraAsync({ quality: 0.6, exif: false });
      } else {
        res = await ImagePicker.launchImageLibraryAsync({ quality: 0.6, allowsMultipleSelection: true, selectionLimit: 6 });
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

  async function save() {
    const draft = { incident_type: incidentType, description, work_date: workDate };
    const b = validateIncident(draft);
    setBlocks(b);
    if (b.length) return;

    setBusy(true);
    // Force a fresh fix — where it happened is half the record.
    const gps = await refreshLocation({ maxAgeMs: 0 });
    const now = new Date().toISOString();
    const inc = await addIncident({
      ...draft,
      description: description.trim(),
      area: area ?? null,
      phase: st.lastPhase ?? null,
      occurred_at: now,
      ...(gps ?? {}),
    });

    // Photos hang off the incident and travel the normal photo pipeline.
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
          storedUri = a.uri;
        }
      }
      await addPhoto({
        work_date: workDate,
        uri: storedUri,
        filename,
        caption: null,
        phase: st.lastPhase ?? null,
        area: area ?? null,
        line_id: null,
        incident_id: inc.incident_id,
        captured_at: now,
        ...(gps ?? {}),
      });
    }
    setBusy(false);
    // Warnings are reported AFTER the save, never before it — the record is
    // already safe; this only tells the reporter what would strengthen it.
    setSaved({ inc, photos: assets.length, located: !!gps, warns: incidentWarnings({ photo_count: assets.length }) });
  }

  // ---- confirmation: it is on the record, and here is exactly what was kept ----
  if (saved) {
    return (
      <FormScreen footer={<View style={s.doneBar}><Btn label={t("done")} onPress={onDone} variant="green" fill /></View>}>
        <NoticeCard tone="success" title={t("incidentSaved")}>
          <Muted>{t("incidentSavedBody")}</Muted>
        </NoticeCard>
        <Card>
          <GroupLabel>{t("incidentRecordLabel")}</GroupLabel>
          <Text style={s.confirmType}>
            {TYPE_GLYPH[saved.inc.incident_type]} {t(`incident_${saved.inc.incident_type}`)}
          </Text>
          <Text style={s.confirmDesc}>{saved.inc.description}</Text>
          <View style={s.confirmMeta}>
            <Text style={s.metaLine}>{t("incidentBy")}: {saved.inc.reported_by}</Text>
            <Text style={s.metaLine}>
              {t("incidentAt")}: {new Date(saved.inc.occurred_at).toLocaleTimeString(lang === "zh" ? "zh-CN" : lang === "es" ? "es-US" : "en-US", { hour: "numeric", minute: "2-digit" })}
            </Text>
            <Text style={s.metaLine}>
              {t("incidentWhere")}: {saved.located ? t("incidentLocated") : t("incidentNoLocation")}
            </Text>
            <Text style={s.metaLine}>{t("statPhotos")}: {saved.photos}</Text>
          </View>
        </Card>
        {saved.warns.includes("V11_incident_photo") && (
          <NoticeCard tone="warn" title={t("incidentNoPhotoTitle")}>
            <Muted>{t("incidentNoPhotoBody")}</Muted>
          </NoticeCard>
        )}
      </FormScreen>
    );
  }

  // ---- capture ----
  const blocked = (k) => blocks.includes(k);
  return (
    <FormScreen
      footer={
        <StickyFooter
          onCancel={onDone}
          cancelLabel={t("cancel")}
          primaryLabel={busy ? t("saving") : t("incidentSave")}
          onPrimary={save}
          tone="accent"
          disabled={busy}
        />
      }
    >
      <Card style={s.hero}>
        <Text style={s.heroTitle}>{t("incidentTitle")}</Text>
        <Text style={s.heroSub}>{t("incidentSub")}</Text>
      </Card>

      <Card>
        <GroupLabel>{t("incidentWhat")}</GroupLabel>
        <ChipWall
          options={INCIDENT_TYPES}
          value={incidentType}
          onChange={(v) => setIncidentType(v)}
          renderLabel={(k) => `${TYPE_GLYPH[k]} ${t(`incident_${k}`)}`}
          show={4}
        />
        {blocked("V_incident_type") ? <Text style={s.blockText}>{t("incidentPickType")}</Text> : null}

        <View style={{ marginTop: 16 }}>
          <Field
            label={t("incidentDescribe")}
            value={description}
            onChangeText={setDescription}
            autoCapitalize="sentences"
            placeholder={t("incidentDescribePlaceholder")}
          />
          {blocked("V_description") ? <Text style={s.blockText}>{t("incidentNeedDescription")}</Text> : null}
        </View>
      </Card>

      <Card>
        <GroupLabel right={t("optional")}>{t("incidentPhotos")}</GroupLabel>
        {assets.length === 0 ? (
          <>
            <Pressable onPress={() => grab(true)} style={s.shoot} accessibilityRole="button" accessibilityLabel={t("takePhotoTitle")}>
              <Text style={s.shootGlyph}>📷</Text>
              <Text style={s.shootLabel}>{t("takePhotoTitle")}</Text>
            </Pressable>
            <Muted style={{ marginTop: 8 }}>{t("incidentPhotoHint")}</Muted>
          </>
        ) : (
          <>
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
          </>
        )}
        {err ? <Text style={s.blockText}>{err}</Text> : null}
      </Card>

      <Card>
        <GroupLabel right={t("optional")}>{t("area")}</GroupLabel>
        <ChipWall options={currentAreas()} value={area} onChange={setArea} show={6} />
        <Muted style={{ marginTop: 12 }}>{t("incidentAutoNote")}</Muted>
      </Card>
    </FormScreen>
  );
}

const s = StyleSheet.create({
  hero: { borderColor: "#b91c1c33", backgroundColor: "#b91c1c0a" },
  heroTitle: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", color: colors.red },
  heroSub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 4 },

  blockText: { fontFamily: fonts.body, fontSize: 13, color: colors.red, marginTop: 8, fontWeight: "600" },

  shoot: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  shootGlyph: { fontSize: 26 },
  shootLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: "700", color: colors.onInk },

  thumbs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  thumbWrap: { flexBasis: "31.5%", position: "relative" },
  thumb: { width: "100%", aspectRatio: 1, borderRadius: 10, backgroundColor: colors.surfaceSunken },
  removeBtn: { position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: 11, backgroundColor: colors.red, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff" },
  removeX: { color: "#fff", fontSize: 11, fontWeight: "800", lineHeight: 13 },
  addRow: { flexDirection: "row", gap: 8, marginTop: 12 },

  confirmType: { fontFamily: fonts.display, fontSize: 17, fontWeight: "700", color: colors.text },
  confirmDesc: { fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.textSecondary, marginTop: 6 },
  confirmMeta: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 10, gap: 3 },
  metaLine: { fontFamily: fonts.mono, fontSize: 11, color: colors.label, letterSpacing: 0.3 },

  doneBar: {
    backgroundColor: colors.surfaceSunken,
    borderTopWidth: 1,
    borderTopColor: "rgba(42,38,34,0.12)",
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
  },
});
