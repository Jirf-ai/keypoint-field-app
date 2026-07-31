// Web counterpart of BarcodeScanner (SM-11) — Metro resolves this file for the
// web export, the native sibling for iOS/Android builds. Same contract: open,
// read one code, hand the raw value back, close. Two engines: the browser's
// native BarcodeDetector (Android Chrome — fast, no JS decode), else ZXing in
// JS (iOS Safari has no BarcodeDetector). Keypoint system: dark scrim, orange
// scan window, one Cancel action.
import { useEffect, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { colors, fonts, radius } from "../theme";

// The native scanner's symbology list, in BarcodeDetector spelling.
const BD_FORMATS = ["qr_code", "ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "itf", "codabar"];

export default function BarcodeScanner({ visible, onScan, onClose, t }) {
  const videoRef = useRef(null);
  const [denied, setDenied] = useState(false);
  const [attempt, setAttempt] = useState(0); // "Allow camera" retries the stream

  useEffect(() => {
    if (!visible) return;
    let dead = false;
    let stream = null;
    let stopEngine = null;
    let locked = false;
    const fire = (raw) => {
      if (dead || locked) return;
      const value = String(raw ?? "").trim();
      if (!value) return;
      locked = true; // fire once — both engines stream many frames per code
      onScan(value);
    };

    (async () => {
      // Camera prompt happens here (needs HTTPS — pages.dev qualifies).
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" } },
          audio: false,
        });
      } catch {
        if (!dead) setDenied(true);
        return;
      }
      if (dead) {
        stream.getTracks().forEach((tr) => tr.stop());
        return;
      }
      setDenied(false);
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play().catch(() => {});
      if (dead) return;

      if ("BarcodeDetector" in window) {
        let detector = null;
        try {
          detector = new window.BarcodeDetector({ formats: BD_FORMATS });
        } catch {
          try { detector = new window.BarcodeDetector(); } catch {}
        }
        if (detector) {
          const iv = setInterval(async () => {
            if (video.readyState < 2) return;
            try {
              const codes = await detector.detect(video);
              if (codes && codes.length) fire(codes[0].rawValue);
            } catch {}
          }, 180);
          stopEngine = () => clearInterval(iv);
          return;
        }
      }

      try {
        const reader = new BrowserMultiFormatReader();
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) fire(result.getText());
        });
        stopEngine = () => controls.stop();
      } catch {
        if (!dead) setDenied(true);
      }
    })();

    return () => {
      dead = true;
      if (stopEngine) stopEngine();
      if (stream) stream.getTracks().forEach((tr) => tr.stop());
      const video = videoRef.current;
      if (video) video.srcObject = null;
    };
  }, [visible, attempt]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent={false}>
      <View style={s.root}>
        {denied ? (
          <View style={s.permWrap}>
            <Text style={s.permText}>{t("cameraPermission")}</Text>
            <Pressable onPress={() => { setDenied(false); setAttempt((n) => n + 1); }} style={s.permBtn} accessibilityRole="button">
              <Text style={s.permBtnText}>{t("grantCamera")}</Text>
            </Pressable>
          </View>
        ) : (
          // Raw DOM element — this file only ever renders through react-dom.
          // playsInline keeps iOS Safari from fullscreening the preview; muted
          // autoplay is what lets play() succeed without a user gesture.
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "cover" }}
          />
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
