// End Day — the receipt (2026-07-31). Hours come SOLELY from the clock: raw
// span, minus the auto lunch, rounded to the ¼ hour, split regular/overtime at
// 8h (schema CLOCK_POLICY). The worker sees exactly how the number was
// computed but never chooses it — corrections and overtime belong to the site
// manager at review, through the append-only amend flow. Trade/phase/area/rate
// are allocation metadata (not hours): prefilled from the profile and last
// entries, editable here, validated the same as a typed labor line. The lines
// write through addLine, so V-checks and the sync spine are untouched.
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import SubmitCelebration from "../components/SubmitCelebration";
import { Card, EmptyState, FormScreen, GroupLabel, MathStrip, NoticeCard, NumericField, PHASE_ORDER, PickerRow, StickyFooter, TRADE_ORDER } from "../components/ui";
import { phaseLabel } from "../i18n";
import { computeClockHours, TRADES, todayStr, validateLabor } from "../schema";
import { activeProfile, addLine, clockEnd, currentAreas, getSettings, openClock } from "../store";
import { buzz, timeStr } from "../util";
import { colors, fonts, type } from "../theme";


const FIX_KEYS = { V_trade: "fixTrade", V4_unit_cost: "fixRate", V_phase: "fixPhase", V_area: "fixArea" };

const durStr = (min) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
// 8 → "8", 8.5 → "8.5", 8.25 → "8.25" — quarter-hour steps never need more.
const hStr = (h) => String(+Number(h).toFixed(2));

export default function EndDayScreen({ t, lang, onDone }) {
  const start = openClock();
  const st = getSettings();
  const me = activeProfile();
  const [trade, setTrade] = useState(me?.default_trade ?? null);
  const [phase, setPhase] = useState(st.lastPhase);
  const [area, setArea] = useState(st.lastArea);
  const [rate, setRate] = useState(st.lastRate ?? "");
  const [errors, setErrors] = useState([]);
  const [saving, setSaving] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  // MUST come before the no-clock empty state: clockEnd() nulls the open
  // clock, so on the post-save re-render `start` is already gone — checking
  // !start first stranded the worker on an empty END DAY screen with no
  // send-off and no navigation (caught by the 2026-08-02 live walkthrough).
  if (celebrating) return <SubmitCelebration t={t} shout={t("daySentShout")} onDone={onDone} />;

  // Only reachable from a running clock; a stale navigation just shows empty.
  if (!start) return <EmptyState body={t("noEntriesToday")} style={{ marginTop: 14 }} />;

  const c = computeClockHours(start.at, new Date().toISOString());
  const closingEarlierDay = start.work_date !== todayStr();
  const longDay = c.elapsedMin > 12 * 60;
  const total = c.hours * Number(rate || 0);

  async function save() {
    if (saving) return;
    // Recompute at the moment of confirmation — the receipt on screen may be
    // minutes old by the time the thumb lands.
    const now = computeClockHours(start.at, new Date().toISOString());
    if (now.hours > 0) {
      const base = {
        kind: "labor",
        work_date: start.work_date, // a forgotten clock records on ITS day
        cost_class: "L",
        trade,
        worker: start.worker,
        worker_id: start.worker_id,
        hour_type: "regular",
        hours: now.regular,
        hourly_rate: rate === "" ? null : Number(rate),
        phase,
        area,
        note: null,
        clock_id: start.clock_id, // provenance: this line came off the clock
      };
      const blocks = validateLabor(base);
      if (blocks.length) {
        // The tap must never look dead (pilot 2026-08-01: a crew member with
        // rate/phase/area unset saw "no response" and walked away — the error
        // card rendered below the fold). Errors now pin above the footer
        // buttons, and the buzz says "the tap landed, look at the screen".
        setErrors(blocks);
        buzz(30);
        return;
      }
      setSaving(true);
      await clockEnd(start);
      await addLine(base);
      if (now.overtime > 0) await addLine({ ...base, hour_type: "overtime", hours: now.overtime });
    } else {
      setSaving(true);
      await clockEnd(start);
    }
    // The record is committed locally (sync rides behind) — the day earned its
    // send-off: diamond spins up, launches, "Day sent successfully".
    setCelebrating(true);
  }

  return (
    <View style={{ flex: 1 }}>
    <FormScreen
      footer={
        <View>
          {errors.length > 0 && (
            // Pinned HERE, above the buttons, so a blocked save is impossible
            // to miss — the inline card at the bottom of the scroll content
            // was invisible unless the worker happened to be scrolled there.
            <NoticeCard tone="error" title={t("needFix")} style={s.footerNotice}>
              {errors.map((e) => (
                <Text key={e} style={s.errItem}>• {t(FIX_KEYS[e] ?? e)}</Text>
              ))}
            </NoticeCard>
          )}
          <StickyFooter
            cancelLabel={t("keepWorking")}
            onCancel={onDone}
            primaryLabel={t("endDay")}
            onPrimary={save}
            disabled={saving}
          />
        </View>
      }
    >
      {closingEarlierDay && (
        <NoticeCard tone="warn" style={{ marginTop: 2 }}>
          <Text style={s.warnText}>{t("earlierDayNote")} · {start.work_date}</Text>
        </NoticeCard>
      )}

      <Card>
        <GroupLabel>{t("endDayTitle")}</GroupLabel>
        <Text style={s.span}>
          {timeStr(start.at, lang)} → {timeStr(new Date().toISOString(), lang)}
        </Text>

        <View style={s.rows}>
          <View style={s.row}>
            <Text style={s.rowKey}>{t("onTheClock")}</Text>
            <Text style={s.rowVal}>{durStr(c.elapsedMin)}</Text>
          </View>
          {c.lunchMin > 0 && (
            <View style={s.row}>
              <Text style={s.rowKey}>{t("lunchRow")}</Text>
              <Text style={s.rowVal}>− {durStr(c.lunchMin)}</Text>
            </View>
          )}
          <View style={s.row}>
            <Text style={s.rowKey}>{t("roundedRow")}</Text>
            <Text style={s.rowVal}>{durStr(c.hours * 60)}</Text>
          </View>
          {c.overtime > 0 && (
            <>
              <View style={s.row}>
                <Text style={s.rowKey}>{t("regular")}</Text>
                <Text style={s.rowVal}>{hStr(c.regular)}</Text>
              </View>
              <View style={s.row}>
                <Text style={s.rowKey}>{t("overtime")}</Text>
                <Text style={[s.rowVal, { color: colors.amber }]}>{hStr(c.overtime)}</Text>
              </View>
            </>
          )}
        </View>

        <View style={s.resultRow}>
          <Text style={s.resultKey}>{t("hoursRecorded")}</Text>
          <Text style={s.resultVal}>{hStr(c.hours)}</Text>
        </View>

        {c.hours === 0 ? (
          <Text style={s.note}>{t("clockZero")}</Text>
        ) : c.overtime > 0 ? (
          <Text style={[s.note, { color: colors.amber }]}>{t("otSplitNote")}</Text>
        ) : (
          <Text style={[s.note, { color: colors.green }]}>{t("regularNote")}</Text>
        )}
      </Card>

      {c.hours > 0 && (
        <Card>
          <NumericField
            label={t("rate")}
            value={rate}
            onChangeText={(x) => setRate(x.replace(/[^0-9.]/g, ""))}
            placeholder="0"
          />
          <MathStrip
            left={`${hStr(c.hours)} × ${rate || "0"}`}
            amount={`$${total.toLocaleString("en-US", { maximumFractionDigits: 2 })}`}
          />
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
        </Card>
      )}

      {longDay && (
        <NoticeCard tone="warn">
          <Text style={s.warnText}>{t("longDayNote")}</Text>
        </NoticeCard>
      )}

      {c.hours > 0 && <Text style={s.footNote}>{t("recordedFromClock")}</Text>}
    </FormScreen>
    </View>
  );
}

const s = StyleSheet.create({
  span: {
    fontFamily: fonts.mono,
    fontSize: 12.5,
    fontWeight: "600",
    color: colors.textSecondary,
    backgroundColor: colors.surfaceSunken,
    borderRadius: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    overflow: "hidden",
    fontVariant: ["tabular-nums"],
  },
  rows: { marginTop: 6 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  rowKey: { fontFamily: fonts.body, fontSize: 13, fontWeight: "600", color: colors.textSecondary },
  rowVal: { fontFamily: fonts.mono, fontSize: 13, fontWeight: "600", color: colors.text, fontVariant: ["tabular-nums"] },
  resultRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", paddingTop: 12 },
  resultKey: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.text },
  resultVal: { ...type.moneyForm, fontVariant: ["tabular-nums"] },
  note: { fontFamily: fonts.body, fontSize: 12.5, lineHeight: 18, marginTop: 8 },
  footNote: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, textAlign: "center", marginTop: 2, marginHorizontal: 24 },
  warnText: { fontFamily: fonts.body, color: colors.amber, fontSize: 13.5, fontWeight: "600", lineHeight: 19 },
  errItem: { fontFamily: fonts.body, color: colors.red, fontSize: 14, lineHeight: 21 },
  footerNotice: { marginHorizontal: 16, marginBottom: 0 },
});
