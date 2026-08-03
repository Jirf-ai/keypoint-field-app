// Settings — the worker's name (provenance on every entry) and the read-only
// project record. Name is inline-editable (no separate Save); the project record
// is set in mono so it reads as "not editable" (§SettingsScreen). A GC account
// on this device also finds its standing team code here (locked to the
// account; copy to hand to the crew — workers can't register without it).
import { useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { Avatar, Btn, Card, ChipWall, Field, GroupLabel, Muted, Segmented, StackedFooter } from "../components/ui";
import { parseProject } from "../components/ProjectPicker";
import { copyToClipboard } from "../util";
import { syncReminders } from "../notifications";
import { disablePush, enablePush, pushStatus } from "../push";
import { call } from "../api";
import { todayStr } from "../schema";
import { activeProfile, currentProject, gcAccount, getSettings, myProjects, saveSettings } from "../store";

const REMINDER_TIMES = ["15:00", "16:00", "17:00", "18:00", "19:00"];
const START_TIMES = ["05:30", "06:00", "06:30", "07:00", "07:30"];
import { colors, fonts, type } from "../theme";

export default function SettingsScreen({ t, onDone, onLogout, onWipe }) {
  const me = activeProfile();
  const st = getSettings();
  // Two-tap arm for the device wipe: the first tap reveals the warning + a
  // confirm button, the second tap actually erases. No native confirm dialog
  // (they don't render on RN-web and block automation).
  const [wipeArmed, setWipeArmed] = useState(false);
  const [name, setName] = useState(st.recorded_by || me?.display_name || "");
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [wifiOnly, setWifiOnly] = useState(!!st.wifiOnlyPhotos);
  // Web Push (PWA): "on" | "off" | "blocked" | "unsupported" — read from the
  // browser, not from settings, so the row can never disagree with reality.
  const [push, setPush] = useState("unsupported");
  useEffect(() => {
    if (Platform.OS === "web") pushStatus().then(setPush);
  }, []);
  async function togglePush(v) {
    if (v) {
      const r = await enablePush();
      // "server"/"subscribe-failed" are retryable — leave the switch off, not dead.
      setPush(r.ok ? "on" : r.reason === "blocked" ? "blocked" : r.reason === "unsupported" ? "unsupported" : "off");
    } else {
      await disablePush();
      setPush("off");
    }
  }
  const [remind, setRemind] = useState(!!st.remindEndOfDay);
  const [remindTime, setRemindTime] = useState(st.reminderTime || "17:00");
  const [remindDenied, setRemindDenied] = useState(false);
  const [remindStart, setRemindStart] = useState(!!st.remindStartOfDay);
  const [startTime, setStartTime] = useState(st.startReminderTime || "06:30");
  const [payroll, setPayroll] = useState({ busy: false, msg: null });
  const [payrollWeek, setPayrollWeek] = useState("this"); // "this" | "last"
  const gc = gcAccount();
  // The read-only record shows the REAL project the worker is on (from the
  // store) and their REAL company — never a hardcoded sample. Hidden until a
  // project is selected.
  const cur = currentProject();
  const proj = cur ? parseProject(cur) : null;
  const owned = cur ? myProjects().find((p) => p.id === cur.id) : null;
  const company = gc?.business_name || me?.gc_business || null;

  function changeName(x) {
    setName(x);
    saveSettings({ recorded_by: x.trim() });
  }

  function toggleWifi(v) {
    setWifiOnly(v);
    saveSettings({ wifiOnlyPhotos: v });
  }

  async function toggleReminder(v) {
    setRemind(v);
    setRemindDenied(false);
    await saveSettings({ remindEndOfDay: v });
    const ok = await syncReminders();
    // Enabled but the OS withheld permission → revert and point them to Settings.
    if (v && !ok) {
      setRemind(false);
      await saveSettings({ remindEndOfDay: false });
      setRemindDenied(true);
    }
  }

  async function pickTime(x) {
    setRemindTime(x);
    await saveSettings({ reminderTime: x });
    syncReminders();
  }

  async function toggleStartReminder(v) {
    setRemindStart(v);
    await saveSettings({ remindStartOfDay: v });
    syncReminders();
  }

  async function pickStartTime(x) {
    setStartTime(x);
    await saveSettings({ startReminderTime: x });
    syncReminders();
  }

  async function copyCode(code) {
    if (await copyToClipboard(code)) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    }
  }

  // Weekly payroll CSV off the labor spine (payroll-export). Web downloads the
  // file; native copies it for pasting into a spreadsheet or message.
  async function exportPayroll() {
    if (payroll.busy) return;
    setPayroll({ busy: true, msg: null });
    try {
      const gcCode = gc?.gc_code || me?.gc_code;
      // Any date inside the target week works — last week = today minus 7 days.
      const ref = new Date();
      if (payrollWeek === "last") ref.setDate(ref.getDate() - 7);
      const p = (n) => String(n).padStart(2, "0");
      const week_of = `${ref.getFullYear()}-${p(ref.getMonth() + 1)}-${p(ref.getDate())}`;
      const res = await call("payroll-export", { gc_code: gcCode, week_of });
      if (!res.ok || !res.csv) {
        setPayroll({ busy: false, msg: t(res.workers ? "payrollNone" : "payrollFailed") });
        return;
      }
      if (Platform.OS === "web") {
        const url = URL.createObjectURL(new Blob([res.csv], { type: "text/csv" }));
        const a = document.createElement("a");
        a.href = url;
        a.download = `payroll-${res.week_start}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setPayroll({ busy: false, msg: t("payrollDownloaded") });
      } else {
        await copyToClipboard(res.csv);
        setPayroll({ busy: false, msg: t("payrollCopied") });
      }
    } catch {
      setPayroll({ busy: false, msg: t("payrollFailed") });
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 12, paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
        {/* identity */}
        <Card>
          {editing ? (
            <Field label={t("nameLabel")} value={name} onChangeText={changeName} placeholder="—" />
          ) : (
            <View style={s.idRow}>
              <Avatar name={name} uri={me?.selfie_uri} size={46} />
              <View style={{ flex: 1 }}>
                <Text style={s.idLabel}>{t("nameLabel").toUpperCase()}</Text>
                <Text style={s.idName}>{name || "—"}</Text>
              </View>
              <Pressable onPress={() => setEditing(true)} hitSlop={8} accessibilityRole="button" accessibilityLabel={t("edit")}>
                <Text style={s.edit}>{t("edit")}</Text>
              </Pressable>
            </View>
          )}
        </Card>

        {/* preferences — data-plan protection + the end-of-day reminder */}
        <Card>
          <View style={s.prefRow}>
            <View style={{ flex: 1 }}>
              <Text style={s.prefLabel}>{t("wifiOnly")}</Text>
              <Muted style={{ marginTop: 3 }}>{t("wifiOnlyHint")}</Muted>
            </View>
            <Switch value={wifiOnly} onValueChange={toggleWifi} trackColor={{ false: "rgba(42,38,34,0.14)", true: colors.ink }} thumbColor="#ffffff" />
          </View>

          {/* Web Push — how the 8h overtime warning and 12h check reach an
              installed PWA with the app closed. iOS needs the app on the Home
              Screen; a plain Safari tab reads as unsupported. */}
          {Platform.OS === "web" && (
            <>
              <View style={s.prefDivider} />
              <View style={s.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.prefLabel}>{t("pushLabel")}</Text>
                  <Muted style={{ marginTop: 3 }}>{t("pushHint")}</Muted>
                </View>
                <Switch
                  value={push === "on"}
                  disabled={push === "unsupported"}
                  onValueChange={togglePush}
                  trackColor={{ false: "rgba(42,38,34,0.14)", true: colors.ink }}
                  thumbColor="#ffffff"
                />
              </View>
              {push === "unsupported" && <Muted style={{ marginTop: 8 }}>{t("pushUnsupported")}</Muted>}
              {push === "blocked" && <Muted style={{ marginTop: 8, color: colors.amber }}>{t("pushBlocked")}</Muted>}
            </>
          )}

          {/* Local reminders are native only. */}
          {Platform.OS !== "web" && (
            <>
              <View style={s.prefDivider} />
              <View style={s.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.prefLabel}>{t("remindLog")}</Text>
                  <Muted style={{ marginTop: 3 }}>{t("remindHint")}</Muted>
                </View>
                <Switch value={remind} onValueChange={toggleReminder} trackColor={{ false: "rgba(42,38,34,0.14)", true: colors.ink }} thumbColor="#ffffff" />
              </View>
              {remind && (
                <View style={{ marginTop: 12 }}>
                  <ChipWall options={REMINDER_TIMES} value={remindTime} onChange={pickTime} show={5} mono />
                </View>
              )}
              {remindDenied && <Muted style={{ marginTop: 8, color: colors.amber }}>{t("remindDenied")}</Muted>}

              <View style={s.prefDivider} />
              <View style={s.prefRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.prefLabel}>{t("remindStart")}</Text>
                  <Muted style={{ marginTop: 3 }}>{t("remindStartHint")}</Muted>
                </View>
                <Switch value={remindStart} onValueChange={toggleStartReminder} trackColor={{ false: "rgba(42,38,34,0.14)", true: colors.ink }} thumbColor="#ffffff" />
              </View>
              {remindStart && (
                <View style={{ marginTop: 12 }}>
                  <ChipWall options={START_TIMES} value={startTime} onChange={pickStartTime} show={5} mono />
                </View>
              )}
            </>
          )}
        </Card>

        {/* GC team code — standing, locked to the registered company account
            (Jeffrey 2026-07-27). The GC copies it here and hands it to
            workers; without it a worker cannot register. SITE MANAGERS ONLY
            (Jeffrey 2026-07-31): the code is the GC's to hand out — a crew
            profile never shows it, even when the GC session lives on this
            same device (shared/registration phone). */}
        {gc && me?.role === "site_manager" && (
          <Card>
            <GroupLabel>{t("gcCodeTitle")}</GroupLabel>
            <Text style={s.gcBiz}>{gc.business_name}</Text>
            <Text selectable style={s.codeBig}>{gc.gc_code}</Text>
            <Muted style={{ marginTop: 8 }}>{t("gcCodeHint")}</Muted>
            <View style={{ marginTop: 10 }}>
              <Btn label={copied ? t("copiedCode") : `⧉  ${t("copyCode")}`} onPress={() => copyCode(gc.gc_code)} variant="outline" />
            </View>
          </Card>
        )}

        {/* Weekly payroll export — SM only, needs a registered team. */}
        {me?.role === "site_manager" && (gc?.gc_code || me?.gc_code) && (
          <Card>
            <GroupLabel>{t("payrollTitle")}</GroupLabel>
            <Muted style={{ marginBottom: 10 }}>{t("payrollHint")}</Muted>
            <View style={{ marginBottom: 10 }}>
              <Segmented
                options={["this", "last"]}
                value={payrollWeek}
                onChange={setPayrollWeek}
                renderLabel={(k) => (k === "this" ? t("thisWeek") : t("lastWeek"))}
              />
            </View>
            <Btn label={payroll.busy ? t("saving") : `⇩  ${t("payrollExportCsv")}`} onPress={exportPayroll} variant="outline" disabled={payroll.busy} />
            {payroll.msg && <Muted style={{ marginTop: 8 }}>{payroll.msg}</Muted>}
          </Card>
        )}

        {/* Everyone else linked to a GC just sees which company signed them
            in — company name only, no code (the code is the GC's to give). */}
        {!(gc && me?.role === "site_manager") && me?.gc_business && (
          <Card>
            <GroupLabel>{t("yourCompany")}</GroupLabel>
            <Text style={s.gcBiz}>{me.gc_business}</Text>
          </Card>
        )}

        {/* read-only project record — the real current project + company */}
        {cur && (
          <Card>
            <View style={s.recHead}>
              <Text style={type.projectCode}>{proj.code}</Text>
              <Text style={s.recRO}>{t("readOnlyRecords")}</Text>
            </View>
            <Text style={s.recName}>{proj.display}</Text>
            {(owned?.address || proj.address) ? (
              <Text style={s.recAddr}>{owned?.address || proj.address}</Text>
            ) : null}
            {company ? (
              <View style={s.spec}>
                <View style={s.specRow}>
                  <Text style={s.specKey}>GC</Text>
                  <Text style={s.specVal}>{company}</Text>
                </View>
              </View>
            ) : null}
          </Card>
        )}

        {/* Wipe this device — profiles, projects, captured lines/photos, the lot.
            For handing a test/demo device to the next person. Two-tap confirm. */}
        {onWipe && (
          <Card>
            <Muted style={{ marginBottom: 12 }}>{t("deleteLocalHint")}</Muted>
            {wipeArmed ? (
              <View style={{ gap: 10 }}>
                <Btn label={t("deleteLocalConfirm")} onPress={onWipe} variant="destructive" />
                <Btn label={t("cancel")} onPress={() => setWipeArmed(false)} variant="outline" />
              </View>
            ) : (
              <Btn label={t("deleteLocalData")} onPress={() => setWipeArmed(true)} variant="destructive" />
            )}
          </Card>
        )}
      </ScrollView>

      <StackedFooter>
        {onLogout && <Btn label={t("switchWorker")} onPress={onLogout} variant="outline" />}
        {onLogout && <Btn label={t("logout")} onPress={onLogout} variant="destructive" />}
      </StackedFooter>
    </View>
  );
}

const s = StyleSheet.create({
  idRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  idLabel: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "600", letterSpacing: 1.33, textTransform: "uppercase", color: colors.label },
  idName: { fontFamily: fonts.body, fontSize: 17, fontWeight: "700", color: colors.text, marginTop: 2 },
  edit: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.accent },

  prefRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  prefLabel: { fontFamily: fonts.body, fontSize: 15, fontWeight: "700", color: colors.text },
  prefDivider: { height: 1, backgroundColor: colors.border, marginVertical: 14 },

  gcBiz: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: "700", color: colors.text, marginTop: 4, marginBottom: 8 },
  codeBig: {
    fontFamily: fonts.mono, color: colors.accent, fontSize: 28, fontWeight: "700",
    letterSpacing: 2, textAlign: "center", paddingVertical: 10,
    borderWidth: 1, borderColor: colors.borderStrong, borderRadius: 10,
    backgroundColor: colors.surfaceSunken, overflow: "hidden",
  },

  recHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  recRO: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "600", letterSpacing: 0.8, textTransform: "uppercase", color: colors.label },
  recName: { fontFamily: fonts.body, fontSize: 15.5, fontWeight: "700", color: colors.text, marginTop: 6 },
  recAddr: { fontFamily: fonts.body, fontSize: 13, color: colors.textMuted, marginTop: 2 },
  spec: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: 12, paddingTop: 10 },
  specRow: { flexDirection: "row", gap: 12 },
  specKey: { ...type.spec, width: 38, color: colors.label },
  specVal: { ...type.spec, flex: 1, color: colors.textSecondary },
});
