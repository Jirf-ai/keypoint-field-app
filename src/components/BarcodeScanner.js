// Full-screen barcode / QR scanner (SM-11). Opens the camera, reads the first
// code it sees, hands the raw value back to the caller (which drops it into the
// SKU field), then closes. Native only — the caller gates the entry point so the
// web preview keeps manual entry. Keypoint system: dark scrim, orange scan
// window, one Cancel action.
import { useEffect, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { colors, fonts, radius } from "../theme";

// Retail UPC/EAN cover material SKUs; QR + the common 1D symbologies round it out.
const BARCODE_TYPES = ["qr", "ean13", "ean8", "upc_a", "upc_e", "code128", "code39", "code93", "itf14", "codabar"];

export default function BarcodeScanner({ visible, onScan, onClose, t }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [locked, setLocked] = useState(false);

  // On open: reset the one-shot lock and make sure we have permission.
  useEffect(() => {
    if (!visible) return;
    setLocked(false);
    if (permission && !permission.granted && permission.canAskAgain) requestPermission();
  }, [visible]);

  function handle(res) {
    if (locked || !res?.data) return;
    setLocked(true); // fire once — the camera streams many frames per code
    onScan(String(res.data).trim());
  }

  const granted = permission?.granted;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={s.root}>
        {granted ? (
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: BARCODE_TYPES }}
            onBarcodeScanned={locked ? undefined : handle}
          />
        ) : (
          <View style={s.permWrap}>
            <Text style={s.permText}>{t("cameraPermission")}</Text>
            {permission && !granted && permission.canAskAgain && (
              <Pressable onPress={requestPermission} style={s.permBtn} accessibilityRole="button">
                <Text style={s.permBtnText}>{t("grantCamera")}</Text>
              </Pressable>
            )}
          </View>
        )}

        {/* scrim + scan window */}
        <View style={s.overlay} pointerEvents="none">
          <View style={s.frame} />
          <Text style={s.hint}>{t("scanHint")}</Text>
        </View>

        <View style={s.footer}>
          <Pressable onPress={onClose} style={s.cancel} accessibilityRole="button" accessibilityLabel={t("cancel")}>
            <Text style={s.cancelText}>{t("cancel")}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  frame: {
    width: "70%",
    aspectRatio: 1,
    maxWidth: 300,
    borderWidth: 3,
    borderColor: colors.accent,
    borderRadius: radius.card,
    backgroundColor: "transparent",
  },
  hint: { fontFamily: fonts.body, color: "#fff", fontSize: 14, fontWeight: "600", marginTop: 20, textAlign: "center", paddingHorizontal: 24 },
  permWrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, gap: 16 },
  permText: { fontFamily: fonts.body, color: "#fff", fontSize: 15, textAlign: "center", lineHeight: 22 },
  permBtn: { backgroundColor: colors.accent, borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 24 },
  permBtnText: { fontFamily: fonts.body, color: colors.onInk, fontSize: 15.5, fontWeight: "700" },
  footer: { position: "absolute", left: 0, right: 0, bottom: 0, padding: 20, alignItems: "center" },
  cancel: { backgroundColor: "rgba(255,255,255,0.14)", borderRadius: radius.button, paddingVertical: 14, paddingHorizontal: 36 },
  cancelText: { fontFamily: fonts.body, color: "#fff", fontSize: 15.5, fontWeight: "700" },
});
