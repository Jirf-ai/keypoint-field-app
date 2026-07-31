// Tap-a-thumbnail viewer for the crew proof strip (Jeffrey 2026-07-31): see
// the shot big and fix its tags after the fact — caption, phase, area. The
// pixels are evidence and stay untouched; saving re-queues the photo so the
// server copy carries the corrected tags. Keypoint system: cream ground,
// ink-framed image, chip walls, Save/Cancel.
import { useState } from "react";
import { Image, Modal, ScrollView, StyleSheet, View } from "react-native";
import { Btn, Card, ChipWall, Field, GroupLabel, Segmented, preferred } from "./ui";
import { phaseLabel } from "../i18n";
import { PHASES } from "../schema";
import { currentAreas } from "../store";
import { colors } from "../theme";

const PHASE_ORDER = preferred(PHASES, ["framing", "roofing", "drywall", "gazebo"]);

export default function PhotoViewer({ photo, t, lang, onSave, onDelete, onClose }) {
  const [caption, setCaption] = useState(photo.caption ?? "");
  // Work vs receipt is fixable after the fact too — old photos default work.
  const [kind, setKind] = useState(photo.photo_kind ?? "work");
  const [phase, setPhase] = useState(photo.phase ?? null);
  const [area, setArea] = useState(photo.area ?? null);
  // Two-tap arm for delete (same pattern as the device wipe): first tap
  // turns the button into the confirm, second tap deletes.
  const [delArmed, setDelArmed] = useState(false);

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={s.root}>
        <ScrollView contentContainerStyle={{ paddingVertical: 16, paddingBottom: 32 }}>
          <Image source={{ uri: photo.uri }} style={s.image} resizeMode="contain" />
          <Card style={{ marginTop: 14 }}>
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
          </Card>
          <View style={{ paddingHorizontal: 14, gap: 10, marginTop: 4 }}>
            <Btn label={t("save")} onPress={() => onSave({ caption, phase, area, photo_kind: kind })} />
            <Btn label={t("cancel")} onPress={onClose} variant="outline" />
            {onDelete && (
              <Btn
                label={delArmed ? t("deletePhotoArm") : t("deletePhoto")}
                onPress={() => (delArmed ? onDelete() : setDelArmed(true))}
                variant="destructive"
              />
            )}
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  image: { width: "100%", height: 320, backgroundColor: colors.ink },
});
