// Project selector — tap the address to open: recent projects to tap, and a
// search box that typeaheads against the Records engine (more letters →
// tighter match). A brand-new worker sees "Find your project" and searches;
// recents make every later switch two taps and work offline.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Animated, Easing, Pressable, StyleSheet, Text, View } from "react-native";
import { searchProjects } from "../api";
import FloatingLabelInput from "./FloatingLabelInput";
import { Card, Label, Muted } from "./ui";
import { colors, radius } from "../theme";

export default function ProjectPicker({ t, current, recents, onSelect }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [noHit, setNoHit] = useState(false);
  const timer = useRef(null);

  // Debounced typeahead: search from 3 characters, 350ms after the last key.
  useEffect(() => {
    clearTimeout(timer.current);
    setNoHit(false);
    if (q.trim().length < 3) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      const matches = await searchProjects(q.trim());
      setResults(matches);
      setNoHit(matches.length === 0);
      setSearching(false);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [q]);

  function pick(p) {
    setOpen(false);
    setQ("");
    setResults([]);
    onSelect(p);
  }

  const otherRecents = recents.filter((r) => r.id !== current?.id);

  // No project yet = the ONE thing to do. Render a full-width brand CTA with a
  // slow breathing pulse until it's tapped; once a project exists, collapse to
  // the compact address row.
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (current || open) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [current, open]);

  return (
    <View>
      {!current && !open ? (
        <Animated.View
          style={{
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.02] }) }],
          }}
        >
          <Pressable
            onPress={() => setOpen(true)}
            style={({ pressed }) => [s.cta, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t("findProject")}
          >
            <Text style={s.ctaIcon}>🔍</Text>
            <Text style={s.ctaText}>{t("findProject")}</Text>
            <Text style={s.ctaChev}>▾</Text>
          </Pressable>
        </Animated.View>
      ) : (
        <Pressable
          onPress={() => setOpen(!open)}
          style={s.head}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          accessibilityLabel={current?.name ?? t("findProject")}
        >
          <Text style={[s.name, !current && s.namePlaceholder]} numberOfLines={1}>
            {current?.name ?? t("findProject")}
          </Text>
          <Text style={s.chev}>{open ? "▴" : "▾"}</Text>
        </Pressable>
      )}

      {open && (
        <Card style={s.drop}>
          <FloatingLabelInput
            label={t("typeAddress")}
            value={q}
            onChangeText={setQ}
            autoCapitalize="none"
          />
          {searching && <ActivityIndicator style={{ marginTop: 10 }} color={colors.brand} />}
          {results.map((p) => (
            <Pressable key={p.id} style={s.row} onPress={() => pick(p)} accessibilityRole="button">
              <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
              {p.status ? <Text style={s.rowStatus}>{p.status}</Text> : null}
            </Pressable>
          ))}
          {noHit && <Muted style={{ marginTop: 10 }}>{t("noProjectFound")}</Muted>}

          {otherRecents.length > 0 && (
            <>
              <Label>{t("recentProjects")}</Label>
              {otherRecents.map((p) => (
                <Pressable key={p.id} style={s.row} onPress={() => pick(p)} accessibilityRole="button">
                  <Text style={s.rowName} numberOfLines={1}>{p.name}</Text>
                </Pressable>
              ))}
            </>
          )}
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.brand,
    borderRadius: radius.input,
    minHeight: 58,
    paddingHorizontal: 18,
    shadowColor: colors.brand,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  ctaIcon: { fontSize: 18 },
  ctaText: { color: "#fff", fontSize: 17, fontWeight: "800", letterSpacing: 0.2 },
  ctaChev: { color: "#fff", fontSize: 15, fontWeight: "800" },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 2,
  },
  name: { color: colors.text, fontSize: 16, fontWeight: "800", flexShrink: 1 },
  namePlaceholder: { color: colors.brand },
  chev: { color: colors.brand, fontSize: 14, fontWeight: "800" },
  drop: { marginHorizontal: 0, marginTop: 10, marginBottom: 4 },
  row: {
    paddingVertical: 13,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  rowName: { color: colors.text, fontSize: 15, fontWeight: "600", flex: 1 },
  rowStatus: { color: colors.textMuted, fontSize: 12, textTransform: "uppercase", fontWeight: "700" },
});
