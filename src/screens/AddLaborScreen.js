// + Hours — labor_entry (schema §4.4). Live math strip, segmented hour type,
// collapsing pickers for trade/phase/area (open when there's nothing prefilled
// from yesterday), sticky Cancel/Save footer. Rework stays blame-free: a missing
// note warns AFTER saving, never blocks. Site managers can log hours on behalf
// of crew who don't self-report ("record for someone else"). Opening with an
// existing line in `editing` prefills the form and saves an append-only
// correction (amendLine) instead of a new row.
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { fetchTeamRoster } from "../auth";
import { Card, Field, FormScreen, GroupLabel, NoticeCard, NumericField, PHASE_ORDER, PickerRow, Segmented, StickyFooter, TRADE_ORDER } from "../components/ui";
import { phaseLabel } from "../i18n";
import { HOUR_TYPES, TRADES, validateLabor, laborWarnings } from "../schema";
import { activeLines, activeProfile, addLine, amendLine, currentAreas, getSettings, setTeamRoster, teamRoster } from "../store";
import { colors, fonts } from "../theme";


const FIX_KEYS = {
  V_trade: "fixTrade",
  V3_qty: "fixHours",
  V_hour_type: "hourType",
  V_phase: "fixPhase",
  V_area: "fixArea",
  V_worker: "worker",
};

export default function AddLaborScreen({ t, lang, workDate, onDone, editing }) {
  const st = getSettings();
  const me = activeProfile();
  const isSM = me?.role === "site_manager";
  // The logged-in profile IS the worker by default — no name typing (Jeffrey
  // 2026-07-24). Site managers can override to record for someone else.
  const myName = me?.display_name || st.recorded_by || "";
  const editingOther = !!editing && editing.worker !== myName;
  const [forOther, setForOther] = useState(editingOther);
  const [otherName, setOtherName] = useState(editingOther ? editing.worker : "");
  // Picked roster identity ("__manual" = typed name, e.g. a one-day laborer
  // who never registered). Registered picks carry worker_id onto the entry —
  // hard identity, no spelling drift (SM-15).
  const [otherId, setOtherId] = useState(editingOther ? editing.worker_id ?? "__manual" : null);
  const [, setRosterTick] = useState(0);

  // Refresh the server roster when an SM opens the form (fire-and-forget —
  // offline just keeps the cached copy).
  useEffect(() => {
    if (!isSM || !me?.gc_code) return;
    fetchTeamRoster(me.gc_code)
      .then(async (r) => {
        if (r?.ok && Array.isArray(r.workers)) {
          await setTeamRoster(r.workers);
          setRosterTick((n) => n + 1);
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const roster = teamRoster().filter((w) => w.worker_id !== me?.worker_id);
  const [trade, setTrade] = useState(editing?.trade ?? me?.default_trade ?? null);
  const [hours, setHours] = useState(editing ? String(editing.hours ?? "") : "");
  const [hourType, setHourType] = useState(editing?.hour_type ?? "regular");
  // No rate state (Jeffrey 2026-08-04): SMs record hours like everyone else;
  // the worker's rate is inner-company data on the Payroll agent.
  const [phase, setPhase] = useState(editing?.phase ?? st.lastPhase);
  const [area, setArea] = useState(editing?.area ?? st.lastArea);
  const [note, setNote] = useState(editing?.note ?? "");
  const [errors, setErrors] = useState([]);
  const [warned, setWarned] = useState(null);

  const worker = forOther ? otherName : myName;

  async function save() {
    const entry = {
      kind: "labor",
      work_date: workDate,
      cost_class: "L",
      trade,
      worker: worker.trim(),
      // Hard identity: roster picks carry the crew member's registered id;
      // typed names (unregistered day labor) and self-entries resolve too.
      worker_id: forOther ? (otherId && otherId !== "__manual" ? otherId : null) : me?.worker_id ?? null,
      hours: Number(hours),
      hour_type: hourType,
      hourly_rate: null, // rates never ride field rows — Payroll owns comp
      phase,
      area,
      note: note.trim() || null,
    };
    const blocks = validateLabor(entry);
    if (!entry.worker) blocks.push("V_worker");
    if (blocks.length) {
      setErrors(blocks);
      return;
    }
    if (editing) {
      await amendLine(editing.line_id, entry);
      onDone();
      return;
    }
    const warns = laborWarnings(entry, activeLines(workDate));
    await addLine(entry);
    if (warns.length && !warned) {
      setWarned(warns.includes("V10_rework_note") ? "warnRework" : "warnHours");
      setTimeout(onDone, 1800);
      return;
    }
    onDone();
  }

  return (
    <FormScreen footer={<StickyFooter onCancel={onDone} cancelLabel={t("cancel")} primaryLabel={t("save")} onPrimary={save} />}>
      {editing && (
        <NoticeCard tone="warn" style={{ marginTop: 2 }}>
          <Text style={s.editNote}>{t("editEntry")}</Text>
        </NoticeCard>
      )}
      <Card>
        {/* Rate field + $ math strip removed 2026-08-04 (Jeffrey): hours
            only — the worker's rate is the Payroll agent's business. */}
        <NumericField label={t("hours")} value={hours} onChangeText={(x) => setHours(x.replace(/[^0-9.]/g, ""))} placeholder="0" />
      </Card>

      <Card>
        <GroupLabel>{t("hourType")}</GroupLabel>
        <Segmented options={HOUR_TYPES} value={hourType} onChange={setHourType} renderLabel={(k) => t(k)} />
        {hourType === "rework" && <Text style={s.reworkNote}>{t("reworkBlameFree")}</Text>}

        <View style={{ marginTop: 14 }}>
          <PickerRow
            first
            label={t("trade")}
            value={trade}
            displayValue={trade ? TRADES.find((x) => x.code === trade)?.[lang] ?? trade : null}
            options={TRADE_ORDER}
            onChange={setTrade}
            renderLabel={(o) => o[lang] ?? o.en}
            show={5}
          />
          <PickerRow
            label={t("phase")}
            value={phase}
            displayValue={phase ? phaseLabel(phase, lang) : null}
            options={PHASE_ORDER}
            onChange={setPhase}
            renderLabel={(p) => phaseLabel(p, lang)}
            show={4}
          />
          <PickerRow label={t("area")} value={area} displayValue={area} options={currentAreas()} onChange={setArea} show={6} />
        </View>

        {/* Site managers can log for a crew member who isn't recording their own
            hours; everyone else records as themselves. Registered crew are
            picked from the team roster (identity by worker_id); the typed-name
            path stays for unregistered day labor. */}
        {isSM && (
          <View style={{ marginTop: 14 }}>
            <Pressable onPress={() => setForOther((v) => !v)} hitSlop={6} accessibilityRole="button">
              <Text style={s.link}>{forOther ? `↩ ${t("recordingAs")} ${myName}` : t("forSomeoneElse")}</Text>
            </Pressable>
            {forOther && roster.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <PickerRow
                  first
                  label={t("worker")}
                  value={otherId}
                  displayValue={otherId === "__manual" ? t("notListed") : roster.find((w) => w.worker_id === otherId)?.display_name ?? null}
                  options={[...roster.map((w) => ({ code: w.worker_id, name: w.display_name })), { code: "__manual" }]}
                  onChange={(code) => {
                    setOtherId(code);
                    const w = roster.find((x) => x.worker_id === code);
                    setOtherName(w ? w.display_name : "");
                  }}
                  renderLabel={(o) => (o.code === "__manual" ? t("notListed") : o.name)}
                  show={6}
                />
              </View>
            )}
            {forOther && (roster.length === 0 || otherId === "__manual") && (
              <Field label={t("worker")} value={otherName} onChangeText={setOtherName} placeholder="—" style={{ marginTop: 10 }} />
            )}
          </View>
        )}

        <Field label={t("note")} value={note} onChangeText={setNote} autoCapitalize="sentences" style={{ marginTop: 14 }} placeholder="—" />
      </Card>

      {errors.length > 0 && (
        <NoticeCard tone="error" title={t("needFix")}>
          {errors.map((e) => (
            <Text key={e} style={s.errItem}>• {t(FIX_KEYS[e] ?? e)}</Text>
          ))}
        </NoticeCard>
      )}
      {warned && (
        <NoticeCard tone="warn">
          <Text style={s.warnText}>{t(warned)}</Text>
        </NoticeCard>
      )}
    </FormScreen>
  );
}

const s = StyleSheet.create({
  numRow: { flexDirection: "row", gap: 9 },
  reworkNote: { fontFamily: fonts.body, color: colors.textMuted, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  link: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: "700", color: colors.accent },
  editNote: { fontFamily: fonts.body, color: colors.amber, fontSize: 13.5, fontWeight: "600" },
  errItem: { fontFamily: fonts.body, color: colors.red, fontSize: 14, lineHeight: 21 },
  warnText: { fontFamily: fonts.body, color: colors.amber, fontSize: 14, lineHeight: 20 },
});
