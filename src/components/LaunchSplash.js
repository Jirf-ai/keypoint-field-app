// Launch animation — same identity as the DD app (DESIGN_DECISIONS.md there):
// spinning ◆ diamond centered with the wordmark, then the logo glides up and
// docks into the header slot pixel-for-pixel. Geometry via measureInWindow
// polling (RN-web on Expo 57 never fires onLayout — recorded gotcha).
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo, Animated, Easing, StyleSheet, Text, View,
  useWindowDimensions,
} from "react-native";
import { colors, fonts } from "../theme";

const TURN_MS = 1350;
const DOCK_MS = 680;
const MIN_SPLASH_MS = 1600;
// Hard cap: on RN-web `measureInWindow` can silently never report the header
// dock slot, which would leave the splash logo hanging centered over the page
// forever. Past this point we finish the splash no matter what.
const MAX_SPLASH_MS = 2800;
const SPLASH_SCALE = 1.5;

const spinEase = Easing.bezier(0.5, 0.08, 0.35, 0.92);
const dockEase = Easing.bezier(0.22, 1, 0.36, 1);

// Shared logo row — the header renders it static; the splash spins the gem.
export function LogoRow({ gemTransform }) {
  return (
    <View style={l.row}>
      <View style={l.gem}>
        <Animated.View style={[l.gemInner, gemTransform && { transform: gemTransform }]}>
          <View style={l.gemShape} />
        </Animated.View>
      </View>
      <Text style={l.wordmark}>Keypoint Field</Text>
      {/* brand lockup renders as mono caps via style textTransform */}
    </View>
  );
}

export default function LaunchSplash({ dock, onDone }) {
  const { width: winW, height: winH } = useWindowDimensions();
  const [reduced, setReduced] = useState(false);
  const [revealed, setRevealed] = useState(false);

  const rot = useRef(new Animated.Value(0)).current;
  const prog = useRef(new Animated.Value(0)).current;
  const dockWanted = useRef(false);
  const docking = useRef(false);
  const minHoldDone = useRef(false);
  const live = useRef({});
  live.current = { dock, reduced, onDone };

  function startDock() {
    if (docking.current) return;
    docking.current = true;
    setRevealed(true);
    // No dock target measured (or reduced motion): finish instantly — the
    // static header logo takes over rather than gliding to nowhere.
    if (live.current.reduced || !live.current.dock) {
      prog.setValue(1);
      live.current.onDone?.();
      return;
    }
    Animated.timing(prog, {
      toValue: 1, duration: DOCK_MS, easing: dockEase, useNativeDriver: true,
    }).start(() => live.current.onDone?.());
  }

  // The diamond always completes its turn and rests flat before the glide.
  function spinOnce() {
    rot.setValue(0);
    Animated.timing(rot, {
      toValue: 1, duration: TURN_MS, easing: spinEase, useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      if (dockWanted.current) startDock();
      else spinOnce();
    });
  }

  function tryDock() {
    if (!minHoldDone.current || !live.current.dock || docking.current) return;
    dockWanted.current = true;
    if (live.current.reduced) startDock();
  }

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => setReduced(!!v))
      .catch(() => {});
    const t = setTimeout(() => {
      minHoldDone.current = true;
      tryDock();
    }, MIN_SPLASH_MS);
    // Safety net so the splash can never hang if the dock slot never measures.
    const hardStop = setTimeout(() => {
      if (!docking.current) startDock();
    }, MAX_SPLASH_MS);
    spinOnce();
    return () => {
      clearTimeout(t);
      clearTimeout(hardStop);
    };
  }, []);

  useEffect(() => {
    tryDock();
  }, [dock, reduced]);

  const tx = dock ? dock.x + dock.w / 2 - winW / 2 : 0;
  const ty = dock ? dock.y + dock.h / 2 - winH / 2 : 0;
  const logoStyle = {
    transform: [
      { translateX: prog.interpolate({ inputRange: [0, 1], outputRange: [0, tx] }) },
      { translateY: prog.interpolate({ inputRange: [0, 1], outputRange: [0, ty] }) },
      { scale: prog.interpolate({ inputRange: [0, 1], outputRange: [SPLASH_SCALE, 1] }) },
    ],
  };

  const gemTransform = [
    { perspective: 300 },
    { rotateY: rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] }) },
  ];

  return (
    <View
      style={[StyleSheet.absoluteFill, l.overlay, revealed && l.overlayClear]}
      pointerEvents={revealed ? "none" : "auto"}
    >
      <Animated.View style={logoStyle}>
        <LogoRow gemTransform={gemTransform} />
      </Animated.View>
    </View>
  );
}

const l = StyleSheet.create({
  overlay: {
    backgroundColor: colors.bg, alignItems: "center", justifyContent: "center",
    zIndex: 10, elevation: 10,
  },
  overlayClear: { backgroundColor: "transparent" },
  row: { flexDirection: "row", alignItems: "center", gap: 8 },
  gem: { width: 15, height: 15 },
  gemInner: { width: "100%", height: "100%" },
  gemShape: {
    width: "100%", height: "100%", backgroundColor: colors.brand,
    borderRadius: 3, transform: [{ rotate: "45deg" }, { scale: 0.74 }],
  },
  wordmark: {
    fontFamily: fonts.mono, fontSize: 12, fontWeight: "700",
    letterSpacing: 2.1, textTransform: "uppercase", color: colors.text,
  },
});
