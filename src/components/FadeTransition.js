// Screen transition: a professional diffuse fade instead of an instant swap.
// The outgoing page fades down quickly, the incoming one fades up with a
// subtle rise; the header (logo, avatar, language) never moves. Honors
// reduce-motion (instant swap).
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Easing } from "react-native";

const OUT_MS = 110;
const IN_MS = 240;
const RISE_PX = 8;

export default function FadeTransition({ screenKey, children }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [shownKey, setShownKey] = useState(screenKey);
  const lastNode = useRef(children);
  const reduced = useRef(false);

  // While the key matches, keep the freshest node so in-screen updates render
  // live; during a transition we keep showing the frozen outgoing node.
  if (screenKey === shownKey) lastNode.current = children;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => (reduced.current = !!v))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (screenKey === shownKey) return;
    if (reduced.current) {
      setShownKey(screenKey);
      opacity.setValue(1);
      return;
    }
    Animated.timing(opacity, {
      toValue: 0,
      duration: OUT_MS,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      setShownKey(screenKey);
      Animated.timing(opacity, {
        toValue: 1,
        duration: IN_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    });
  }, [screenKey, shownKey]);

  const node = screenKey === shownKey ? children : lastNode.current;

  return (
    <Animated.View
      style={{
        flex: 1,
        opacity,
        transform: [
          {
            translateY: opacity.interpolate({
              inputRange: [0, 1],
              outputRange: [RISE_PX, 0],
            }),
          },
        ],
      }}
    >
      {node}
    </Animated.View>
  );
}
