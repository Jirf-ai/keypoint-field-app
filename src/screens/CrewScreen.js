// Crew today (OV-01) — which of my crew haven't logged, so the foreman can chase
// the gap before it becomes permanently lost data (the app's whole reason to
// exist). "On the clock" leads (live, from the server), then logged, then the
// actionable not-yet list.
//
// Two sources merged by worker_id (2026-07-31): the device-local roster/lines
// (crewLogStatus — instant, offline-safe, carries selfies) and the crew-day
// edge function (server truth: crew who log on their OWN phones sync there,
// never to this device — and the live day-clock state only exists there).
// Offline, the screen is exactly the old local-only view.
import { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { call } from "../api";
import { Card, EmptyState, GroupLabel, NoticeCard } from "../components/ui";
import { TRADES } from "../schema";
import { activeProfile, crewLogStatus, currentProject, gcAccount } from "../store";
import { timeStr } from "../util";
import { colors, fonts } from "../theme";

function Avatar({ name, selfie, tone }) {
  if (selfie) return <Image source={{ uri: selfie }} style={s.avatar} />;
  return (
    <View style={[s.avatar, { backgroundColor: tone ?? colors.ink }]}>
      <Text style={s.avatarInitial}>{(name || "?")[0].toUpperCase()}</Text>
    </View>
  );
}

function CrewRow({ row, lang, right, rightTone }) {
  const trade = row.trade ? TRADES.find((x) => x.code === row.trade)?.[lang] ?? row.trade : null;
  return (
    <View style={s.row}>
      <Avatar name={row.name} selfie={row.selfie} tone={rightTone} />
      <View style={{ flex: 1 }}>
        <Text style={s.name} numberOfLines={1}>{row.name}</Text>
        {trade ? <Text style={s.trade} numberOfLines={1}>{trade}</Text> : null}
      </View>
      <Text style={[s.right, rightTone && { color: rightTone }]}>{right}</Text>
    </View>
  );
}

export default function CrewScreen({ t, lang, workDate }) {
  const me = activeProfile();
  const [remote, setRemote] = useState(null);

  useEffect(() => {
    const gcCode = gcAccount()?.gc_code || me?.gc_code;
    const pid = currentProject()?.id;
    if (!gcCode || !pid) return;
    let alive = true;
    call("crew-day", { gc_code: gcCode, project_id: pid, work_date: workDate })
      .then((r) => {
        if (alive && r.ok && Array.isArray(r.workers)) setRemote(r.workers);
      })
      .catch(() => {}); // offline → local-only view, same as before
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workDate]);

  // Merge: local rows seed the map (selfies, offline coverage); server rows
  // override hours (superset once synced) and are the only source of the
  // live clock state.
  const local = crewLogStatus(workDate);
  const byId = new Map();
  for (const r of [...local.logged, ...local.missing]) {
    byId.set(r.worker_id, { ...r, on_clock: false, clock_in: null });
  }
  for (const w of remote ?? []) {
    if (w.worker_id === me?.worker_id) continue;
    const cur = byId.get(w.worker_id);
    byId.set(w.worker_id, {
      worker_id: w.worker_id,
      name: cur?.name ?? w.name,
      trade: cur?.trade ?? w.trade,
      selfie: cur?.selfie ?? null,
      hours: w.hours > 0 ? w.hours : cur?.hours ?? 0,
      on_clock: w.on_clock,
      clock_in: w.clock_in,
    });
  }
  const rows = [...byId.values()];
  const onClock = rows.filter((r) => r.on_clock).sort((a, b) => (a.clock_in < b.clock_in ? -1 : 1));
  const logged = rows.filter((r) => !r.on_clock && r.hours > 0).sort((a, b) => b.hours - a.hours);
  const missing = rows.filter((r) => !r.on_clock && !(r.hours > 0)).sort((a, b) => a.name.localeCompare(b.name));
  const total = rows.length;
  const activeCount = onClock.length + logged.length;

  if (total === 0) {
    return (
      <ScrollView contentContainerStyle={{ paddingVertical: 12 }}>
        <EmptyState title={t("crewTitle")} body={t("noCrewYet")} />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ paddingVertical: 12, paddingBottom: 32 }}>
      <Card>
        <GroupLabel>{t("crewTitle")}</GroupLabel>
        <View style={s.countRow}>
          <Text style={s.count}>{activeCount}<Text style={s.countTotal}> / {total}</Text></Text>
          <Text style={s.countLabel}>{t("loggedToday")}</Text>
        </View>
      </Card>

      {onClock.length > 0 && (
        <Card>
          <GroupLabel>⏱ {t("onTheClock")}</GroupLabel>
          {onClock.map((r) => (
            <CrewRow key={r.worker_id} row={r} lang={lang} right={`${t("sinceAt")} ${timeStr(r.clock_in, lang)}`} rightTone={colors.green} />
          ))}
        </Card>
      )}

      {missing.length > 0 ? (
        <Card>
          <GroupLabel>{t("notYetLogged")}</GroupLabel>
          {missing.map((r) => (
            <CrewRow key={r.worker_id} row={r} lang={lang} right={t("notYet")} rightTone={colors.accent} />
          ))}
        </Card>
      ) : (
        <NoticeCard tone="success" title={t("allLogged")} />
      )}

      {logged.length > 0 && (
        <Card>
          <GroupLabel>{t("loggedLabel")}</GroupLabel>
          {logged.map((r) => (
            <CrewRow key={r.worker_id} row={r} lang={lang} right={`${r.hours.toFixed(1)}h`} rightTone={colors.green} />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

const s = StyleSheet.create({
  countRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: 2 },
  count: { fontFamily: fonts.display, fontWeight: "800", fontSize: 34, letterSpacing: -1, color: colors.text, fontVariant: ["tabular-nums"] },
  countTotal: { color: colors.textMuted, fontSize: 22, fontWeight: "700" },
  countLabel: { fontFamily: fonts.mono, fontSize: 10.5, fontWeight: "600", letterSpacing: 1, textTransform: "uppercase", color: colors.label },

  row: { flexDirection: "row", alignItems: "center", gap: 11, borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 11 },
  avatar: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: colors.ink },
  avatarInitial: { fontFamily: fonts.mono, color: colors.onInk, fontSize: 14, fontWeight: "700" },
  name: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.text },
  trade: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 1 },
  right: { fontFamily: fonts.mono, fontSize: 12.5, fontWeight: "700", color: colors.textSecondary, textTransform: "uppercase", letterSpacing: 0.4, fontVariant: ["tabular-nums"] },
});
