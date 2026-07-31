// Add a project (site managers only). NOT free creation: the address is
// verified against the Records engine, the SM confirms the matching project,
// and only then does it join their list — carrying its REAL Records id, so
// every captured line reconciles server-side. Unknown address → "Project does
// not exist", full stop (Jeffrey 2026-07-30: no phantom projects). The
// confirmation hands the SM the project's own code to text to the crew.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { searchProjects } from "../api";
import { parseProject } from "../components/ProjectPicker";
import { Card, Field, FormScreen, GroupLabel, Muted, NoticeCard, StickyFooter } from "../components/ui";
import { addOwnedProject } from "../store";
import { copyToClipboard } from "../util";
import { colors, fonts } from "../theme";

export default function AddProjectScreen({ t, onDone }) {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [areas, setAreas] = useState("");
  const [checking, setChecking] = useState(false);
  const [matches, setMatches] = useState(null); // null = not searched yet
  const [notFound, setNotFound] = useState(false);
  const [created, setCreated] = useState(null);
  const [copied, setCopied] = useState(false);

  // LIVE typeahead against Records as the SM types the address (Jeffrey
  // 2026-07-30): debounced, from 3 characters — matches drop down beneath the
  // field; zero matches shows "Project does not exist" right away.
  const timer = useRef(null);
  useEffect(() => {
    clearTimeout(timer.current);
    setNotFound(false);
    const q = address.trim() || name.trim();
    if (q.length < 3) { setMatches(null); setChecking(false); return; }
    setChecking(true);
    timer.current = setTimeout(async () => {
      try {
        const r = (await searchProjects(q)) ?? [];
        setMatches(r.length ? r : null);
        setNotFound(!r.length);
      } catch {
        setMatches(null);
        setNotFound(true);
      }
      setChecking(false);
    }, 350);
    return () => clearTimeout(timer.current);
  }, [address, name]);

  async function confirm(p) {
    const proj = await addOwnedProject({
      id: p.id,
      name: p.name,
      status: p.status,
      areas: areas.split(","),
    });
    setCreated(proj);
  }

  // ---- confirmed: the project's code, front and center, one tap to copy ----
  if (created) {
    const code = parseProject(created).code;
    return (
      <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("close")} primaryLabel={t("done")} onPrimary={onDone} tone="green" />}>
        <Card>
          <GroupLabel>{t("projectCreated")}</GroupLabel>
          <Text style={s.createdName}>{parseProject(created).display}</Text>
          <View style={s.codeRow}>
            <Text style={s.code}>{code}</Text>
            <Pressable
              style={s.copyChip}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={t("copyCode")}
              onPress={async () => {
                if (await copyToClipboard(code)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1600);
                }
              }}
            >
              <Text style={s.copyChipText}>{copied ? `✓ ${t("copiedCode")}` : `⧉ ${t("copyCode")}`}</Text>
            </Pressable>
          </View>
          <Muted style={{ marginTop: 8 }}>{t("projectCodeShareHint")}</Muted>
        </Card>
      </FormScreen>
    );
  }

  return (
    <FormScreen
      footer={
        <View style={s.cancelBar}>
          <Pressable onPress={onDone} accessibilityRole="button">
            <Text style={s.cancelText}>{t("cancel")}</Text>
          </Pressable>
        </View>
      }
    >
      <Card>
        <Field label={t("projectNameLabel")} value={name} onChangeText={setName} placeholder={t("projectNamePlaceholder")} style={{ marginBottom: 12 }} />
        <Field label={t("addressLabel")} value={address} onChangeText={setAddress} placeholder="—" style={{ marginBottom: 12 }} />
        <Field label={t("areasLabel")} value={areas} onChangeText={setAreas} autoCapitalize="words" placeholder={t("areasPlaceholder")} hint={t("areasHint")} />
      </Card>

      {checking && <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />}

      {/* The database knows this address → confirm which project it is. */}
      {matches && matches.length > 0 && (
        <Card>
          <GroupLabel>{t("confirmProject")}</GroupLabel>
          {matches.map((p) => {
            const m = parseProject(p);
            return (
              <Pressable key={p.id} style={s.matchRow} onPress={() => confirm(p)} accessibilityRole="button" accessibilityLabel={m.display}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={s.matchTitle} numberOfLines={1}>{m.display}</Text>
                  <Text style={s.matchMeta} numberOfLines={1}>{m.city ? `${m.city} · ` : ""}<Text style={s.matchCode}>{m.code}</Text></Text>
                </View>
                <Text style={s.matchCaret}>›</Text>
              </Pressable>
            );
          })}
        </Card>
      )}

      {notFound && (
        <NoticeCard tone="error" title={t("projectNotFoundTitle")}>
          <Muted>{t("projectNotFoundBody")}</Muted>
        </NoticeCard>
      )}
    </FormScreen>
  );
}

const s = StyleSheet.create({
  createdName: { fontFamily: fonts.display, fontSize: 19, fontWeight: "800", color: colors.text, marginTop: 2 },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 },
  code: { fontFamily: fonts.mono, fontSize: 24, fontWeight: "700", letterSpacing: 1, color: colors.accent },
  copyChip: { borderWidth: 1, borderColor: "#d95a1f55", borderRadius: 999, paddingVertical: 5, paddingHorizontal: 11, backgroundColor: "#d95a1f0d" },
  copyChipText: { fontFamily: fonts.body, fontSize: 12, fontWeight: "700", color: colors.accent },

  matchRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  matchTitle: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.text },
  matchMeta: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  matchCode: { fontFamily: fonts.mono, fontSize: 11, color: colors.accent, fontWeight: "700" },
  matchCaret: { color: colors.accent, fontSize: 20, fontWeight: "800" },

  cancelBar: { backgroundColor: colors.surfaceSunken, borderTopWidth: 1, borderTopColor: "rgba(42,38,34,0.12)", paddingVertical: 15, alignItems: "center" },
  cancelText: { fontFamily: fonts.body, fontSize: 15, fontWeight: "600", color: colors.textMuted },
});
