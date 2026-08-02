// The submit send-off (Jeffrey, 2026-07-30): the day's record deserves a
// moment. The orange Keypoint diamond — our envelope — spins center-screen
// like a loader winding up, launches off the top as if swiped to the
// database, then a green check springs in with SUBMITTED and a haptic tap.
// The overlay then dissolves and hands the user back to their day.
import { useEffect, useRef, useState } from "react";
import { Animated, Dimensions, Easing, StyleSheet, Text } from "react-native";
import { colors, fonts } from "../theme";
import { buzz } from "../util";

// `shout` overrides the landing text — End Day reuses the same send-off with
// "Day sent successfully" (Jeffrey 2026-08-01); default stays the submit copy.
export default function SubmitCelebration({ t, onDone, shout }) {
  const spin = useRef(new Animated.Value(0)).current; // rotations while winding up
  const lift = useRef(new Animated.Value(0)).current; // 0 → 1 = launched off-screen
  const check = useRef(new Animated.Value(0)).current; // checkmark spring scale
  const fade = useRef(new Animated.Value(1)).current; // whole-overlay dissolve
  const [phase, setPhase] = useState("fly");
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let dissolveTimer;
    Animated.sequence([
      // Wind-up: three turns, easing in like a rotor spinning up.
      Animated.timing(spin, { toValue: 3, duration: 950, easing: Easing.inOut(Easing.quad), useNativeDriver: false }),
      // Launch: accelerate straight up and off the screen.
      Animated.timing(lift, { toValue: 1, duration: 450, easing: Easing.in(Easing.cubic), useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (!finished) return;
      setPhase("check");
      buzz(45); // the "it landed" tap, right as the check appears
      Animated.spring(check, { toValue: 1, friction: 5, tension: 130, useNativeDriver: false }).start();
      dissolveTimer = setTimeout(() => {
        Animated.timing(fade, { toValue: 0, duration: 420, useNativeDriver: false }).start(() => done.current?.());
      }, 950);
    });
    return () => clearTimeout(dissolveTimer);
  }, [spin, lift, check, fade]);

  const rotate = spin.interpolate({ inputRange: [0, 3], outputRange: ["0deg", "1080deg"] });
  const translateY = lift.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -Dimensions.get("window").height * 1.2],
  });

  return (
    <Animated.View style={[s.overlay, { opacity: fade }]} pointerEvents="auto">
      {phase === "fly" ? (
        <Animated.Text style={[s.diamond, { transform: [{ translateY }, { rotate }] }]}>◆</Animated.Text>
      ) : (
        <Animated.View style={[s.checkWrap, { transform: [{ scale: check }], opacity: check }]}>
          <Text style={s.check}>✓</Text>
          <Text style={s.shout}>{shout ?? t("submittedShout")}</Text>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  diamond: { fontSize: 72, color: colors.accent, lineHeight: 86 },
  checkWrap: { alignItems: "center", gap: 10 },
  check: { fontSize: 76, lineHeight: 84, color: colors.green, fontWeight: "800" },
  shout: {
    fontFamily: fonts.display,
    fontSize: 24,
    fontWeight: "800",
    letterSpacing: 3,
    color: colors.green,
    textTransform: "uppercase",
  },
});
