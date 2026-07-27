// Project selector — the sand PROJECT PLATE is the switcher target (§2.1).
// Tapping it (or the dashed orange "find your project" slot when none is set)
// opens the typeahead: a search box against the Records engine plus recents.
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { searchProjects } from "../api";
import { Card, Field, Muted, ProjectPlate, StatusPill } from "./ui";
import { myProjects, myShareCode } from "../store";
import { colors, fonts, radius, type } from "../theme";

// Records returns { id, name, status }. The plate wants a code, a clean display
// name (address suffix dropped) and a city — derive them here. The 1257 pilot
// is special-cased to its real project record; address-style names are parsed.
export function parseProject(p) {
  const name = p?.name ?? "";
  const low = name.toLowerCase();
  if (low.includes("1257") || low.includes("bao") || low.includes("inspiration")) {
    return { code: "1257-INSP", display: "Bao Residence — Main Addition", city: "West Covina", address: "1257 Inspiration Point, West Covina, CA 91791" };
  }
  const parts = name.split(",").map((x) => x.trim());
  const street = parts[0] || name;
  const city = parts[1] || "";
  const m = street.match(/^(\d+)\s+([A-Za-z]+)/);
  const code = m ? `${m[1]}-${m[2].slice(0, 3).toUpperCase()}` : name.replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
  return { code, display: street, city, address: name };
}

function statusColor(status) {
  return status === "active"
    ? { color: "#15803d", bg: "#15803d18" }
    : { color: colors.textMuted, bg: "rgba(42,38,34,0.08)" };
}

export default function ProjectPicker({ t, current, recents, onSelect, role, dateLabel, onAddProject, onJoin }) {
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

  const recentList = current ? [current, ...recents.filter((r) => r.id !== current.id)] : recents;
  const meta = current ? parseProject(current) : null;
  const isSM = role === "site_manager";
  const mine = myProjects();
  const shareCode = myShareCode();

  function act(cb) {
    setOpen(false);
    setQ("");
    setResults([]);
    cb?.();
  }

  return (
    <View style={s.wrap}>
      {current ? (
        <ProjectPlate code={meta.code} name={meta.display} role={role} city={meta.city} date={dateLabel} onPress={() => setOpen(!open)} />
      ) : (
        <Pressable onPress={() => setOpen(!open)} style={s.slot} accessibilityRole="button" accessibilityLabel={t("findProject")}>
          <Text style={s.slotTitle}>{t("findProject")}</Text>
          <Text style={s.slotSub}>{t("findProjectSub")}</Text>
        </Pressable>
      )}

      {open && (
        <Card style={s.drop}>
          <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 460 }}>
            {/* Site managers add projects; crew join a manager's list by code. */}
            {isSM ? (
              <Pressable style={s.action} onPress={() => act(onAddProject)} accessibilityRole="button" accessibilityLabel={t("addProject")}>
                <Text style={s.actionText}>+ {t("addProject")}</Text>
              </Pressable>
            ) : (
              <Pressable style={s.action} onPress={() => act(onJoin)} accessibilityRole="button" accessibilityLabel={t("joinList")}>
                <Text style={s.actionText}>{t("joinList")} ▸</Text>
              </Pressable>
            )}
            {isSM && shareCode ? (
              <Text style={s.shareLine}>{t("shareCodeInline")} <Text style={s.shareCode}>{shareCode}</Text></Text>
            ) : null}

            {mine.length > 0 && (
              <>
                <Text style={[type.groupLabel, { marginTop: 14, marginBottom: 6 }]}>{isSM ? t("yourProjects") : t("teamProjects")}</Text>
                {mine.map((p) => {
                  const m = parseProject(p);
                  const isCur = p.id === current?.id;
                  return (
                    <Pressable key={p.id} style={s.recentRow} onPress={() => pick(p)} accessibilityRole="button">
                      <Text style={[s.recentName, isCur && { fontWeight: "700" }]} numberOfLines={1}>{p.name}</Text>
                      <Text style={type.projectCode}>{m.code}</Text>
                    </Pressable>
                  );
                })}
              </>
            )}

            <View style={{ marginTop: 16 }}>
              <Field label={t("projectAddressLabel")} value={q} onChangeText={setQ} autoCapitalize="none" placeholder={t("typeAddress")} />
            </View>
            {q.trim().length >= 3 && !searching && (
              <Text style={s.count}>
                {results.length} {results.length === 1 ? t("matchOne") : t("matchMany")} · {t("searchingRecords")}
              </Text>
            )}
            {searching && <ActivityIndicator style={{ marginTop: 12 }} color={colors.accent} />}
            {results.map((p) => {
              const m = parseProject(p);
              return (
                <Pressable key={p.id} style={s.resultCard} onPress={() => pick(p)} accessibilityRole="button" accessibilityLabel={m.display}>
                  <View style={s.resultRow1}>
                    <Text style={type.projectCode}>{m.code}</Text>
                    {p.status ? <StatusPill label={p.status} color={statusColor(p.status)} /> : null}
                  </View>
                  <Text style={s.resultName}>{m.display}</Text>
                  <Text style={s.resultAddr}>{m.address}</Text>
                </Pressable>
              );
            })}
            {noHit && <Muted style={{ marginTop: 12 }}>{t("noProjectFound")}</Muted>}

            {recentList.length > 0 && (
              <>
                <Text style={[type.groupLabel, { marginTop: 16, marginBottom: 6 }]}>{t("recentProjects")}</Text>
                {recentList.map((p) => {
                  const m = parseProject(p);
                  const isCur = p.id === current?.id;
                  return (
                    <Pressable key={p.id} style={s.recentRow} onPress={() => pick(p)} accessibilityRole="button">
                      <Text style={[s.recentName, isCur && { fontWeight: "700" }]} numberOfLines={1}>{m.display}</Text>
                      <Text style={type.projectCode}>{m.code}</Text>
                    </Pressable>
                  );
                })}
              </>
            )}
          </ScrollView>
        </Card>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { zIndex: 100 },
  slot: {
    backgroundColor: "#d95a1f0d",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217,90,31,0.5)",
    borderRadius: radius.card,
    marginHorizontal: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  slotTitle: { fontFamily: fonts.display, fontSize: 17, fontWeight: "700", color: colors.accent },
  slotSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, marginTop: 3, textAlign: "center" },
  drop: { marginTop: 8 },
  action: {
    minHeight: 46,
    borderRadius: radius.input,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217,90,31,0.5)",
    backgroundColor: "#d95a1f0d",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  actionText: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.accent },
  shareLine: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 8, textAlign: "center" },
  shareCode: { fontFamily: fonts.mono, fontSize: 12, fontWeight: "700", color: colors.accent },
  count: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textMuted, marginTop: 10, marginBottom: 2 },
  resultCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    backgroundColor: colors.bg,
    padding: 12,
    marginTop: 10,
  },
  resultRow1: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  resultName: { fontFamily: fonts.body, fontSize: 15, fontWeight: "700", color: colors.text, marginTop: 5 },
  resultAddr: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, marginTop: 2 },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  recentName: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "600", color: colors.text, flex: 1 },
});
