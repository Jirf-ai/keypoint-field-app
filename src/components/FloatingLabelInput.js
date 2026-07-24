// Floating-label input (Lemonade pattern). At rest the label is a full-size
// placeholder; on focus (or once non-empty) it shrinks to the top-left inside the
// field while the user types below. Input text stays 16px+ so iOS doesn't zoom.
// Used on ALL text inputs app-wide (DESIGN_DECISIONS.md).
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, TextInput, View } from "react-native";
import { colors, radius } from "../theme";

export default function FloatingLabelInput({
  label,
  value,
  onChangeText,
  onSubmitEditing,
  keyboardType,
  autoCapitalize = "words",
  returnKeyType,
  style,
}) {
  const [focused, setFocused] = useState(false);
  const active = focused || !!value;
  const anim = useRef(new Animated.Value(active ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: active ? 1 : 0,
      duration: 150,
      useNativeDriver: false, // animating layout + color
    }).start();
  }, [active, anim]);

  const labelStyle = {
    top: anim.interpolate({ inputRange: [0, 1], outputRange: [19, 9] }),
    fontSize: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 11] }),
    color: anim.interpolate({
      inputRange: [0, 1],
      outputRange: [colors.textMuted, focused ? colors.brand : colors.textSecondary],
    }),
  };

  return (
    <View
      style={[
        s.wrap,
        { borderColor: focused ? colors.brand : colors.borderStrong },
        style,
      ]}
    >
      <Animated.Text pointerEvents="none" style={[s.label, labelStyle]}>
        {label}
      </Animated.Text>
      <TextInput
        style={s.input}
        value={value}
        onChangeText={onChangeText}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSubmitEditing={onSubmitEditing}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={false}
        returnKeyType={returnKeyType}
        selectionColor={colors.brand}
        accessibilityLabel={label}
        maxFontSizeMultiplier={1.4}
      />
      {!!value && (
        <Pressable
          style={s.clear}
          hitSlop={10}
          onPress={() => onChangeText("")}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label}`}
        >
          <Animated.Text style={s.clearX}>×</Animated.Text>
        </Pressable>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {
    backgroundColor: colors.card,
    borderRadius: radius.input,
    borderWidth: 1,
    paddingHorizontal: 14,
    height: 58,
    justifyContent: "flex-end",
  },
  label: {
    position: "absolute",
    left: 14,
    fontWeight: "500",
  },
  input: {
    fontSize: 16,
    color: colors.text,
    paddingTop: 22,
    paddingBottom: 9,
    paddingRight: 24,
  },
  clear: {
    position: "absolute",
    right: 12,
    bottom: 15,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#C9CFD8",
    alignItems: "center",
    justifyContent: "center",
  },
  clearX: { color: "#fff", fontSize: 16, lineHeight: 18, fontWeight: "600" },
});
