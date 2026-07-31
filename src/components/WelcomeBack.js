// The welcome-back moment (Jeffrey, 2026-07-31): restoring an account by
// phone number deserves the same ceremony as a submit. The brand diamond
// spins up center-screen and settles; "Welcome back," and the worker's name
// rise in beneath it; a beat later the whole overlay dissolves onto Today so
// they continue where they left off. Calmer cousin of SubmitCelebration —
// the diamond stays (nothing launches), because they just arrived.
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";
import { colors, fonts } from "../theme";
import { buzz } from "../util";

export default function WelcomeBack({ t, name, onDone }) {
  const spin = useRef(new Animated.Value(0)).current; // rotations winding down
  const settle = useRef(new Animated.Value(0)).current; // greeting fade + rise
  const fade = useRef(new Animated.Value(1)).current; // whole-overlay dissolve
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    let holdTimer;
    Animated.parallel([
      // Two turns easing out — a rotor settling, not winding up.
      Animated.timing(spin, { toValue: 2, duration: 1150, easing: Easing.out(Easing.cubic), useNativeDriver: false }),
      Animated.timing(settle, { toValue: 1, duration: 620, delay: 480, easing: Easing.out(Easing.quad), useNativeDriver: false }),
    ]).start(({ finished }) => {
      if (!finished) return;
      buzz(30); // soft "you're in" tap as everything comes to rest
      holdTimer = setTimeout(() => {
        Animated.timing(fade, { toValue: 0, duration: 520, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start(() => done.current?.());
      }, 900);
    });
    return () => clearTimeout(holdTimer);
  }, [spin, settle, fade]);

  const rotate = spin.interpolate({ inputRange: [0, 2], outputRange: ["0deg", "720deg"] });
  const rise = settle.interpolate({ inputRange: [0, 1], outputRange: [16, 0] });

  return (
    <Animated.View style={[s.overlay, { opacity: fade }]} pointerEvents="auto">
      <Animated.Text style={[s.diamond, { transform: [{ rotate }] }]}>◆</Animated.Text>
      <Animated.View style={[s.textWrap, { opacity: settle, transform: [{ translateY: rise }] }]}>
        <Text style={s.hello}>{t("welcomeBack")}</Text>
        <Text style={s.name} numberOfLines={1}>{name}</Text>
      </Animated.View>
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
  textWrap: { alignItems: "center", marginTop: 18, paddingHorizontal: 24, maxWidth: "100%" },
  hello: {
    fontFamily: fonts.mono,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
    color: colors.textMuted,
  },
  name: {
    fontFamily: fonts.display,
    fontSize: 30,
    fontWeight: "800",
    color: colors.text,
    marginTop: 6,
    textAlign: "center",
  },
});
