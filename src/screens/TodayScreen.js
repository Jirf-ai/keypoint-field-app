// Today — capture-first (PRD §6.1). The project plate sits up top (§2.1), then
// a capture tile row (§2.2), then the day reads as a ledger (§2.5). Role decides
// the surface: crew log hours + photos; site managers add materials, review,
// submit, and raise change orders.
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Image, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { parseProject } from "../components/ProjectPicker";
import PhotoViewer from "../components/PhotoViewer";
import { isSyncing, syncNow } from "../sync";
import { Btn, Card, CaptureTiles, EmptyState, GroupLabel, LedgerRow, Muted, ProjectPlate, usd, usdCents } from "../components/ui";
import { phaseLabel } from "../i18n";
import { syncReminders } from "../notifications";
import {
  activeProfile,
  clockCap,
  clockFor,
  clockStart,
  confirmOvertime,
  crewLogStatus,
  currentProject,
  dayStatus,
  daySubmittedAt,
  incidentsFor,
  deletePhoto,
  myWeekHours,
  openClock,
  otConfirmed,
  photosFor,
  updatePhotoMeta,
  visibleLines,
  visibleTotals,
} from "../store";
import { colors, fonts, type } from "../theme";
import { dateStamp, timeStr } from "../util";

// Small spinning brand diamond + "updating" — lives inside the pending badge
// while a sync drain is running, so a crew member knows the app is actively
// sending (wait) rather than stuck (Jeffrey, 2026-07-30).
function UpdatingSpinner({ t }) {
  const rot = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(rot, { toValue: 1, duration: 1100, easing: Easing.linear, useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [rot]);
  const rotate = rot.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  return (
    <View style={s.updatingRow}>
      <Animated.Text style={[s.updatingDiamond, { transform: [{ rotate }] }]}>◆</Animated.Text>
      <Text style={s.updatingText}>{t("updating")}</Text>
    </View>
  );
}

// Start Day / End Day (2026-07-31) — the day's frame, between the plate and
// the capture tile. Hours come SOLELY from this clock (see EndDayScreen); the
// running strip is green (= active, like submit/upload) and flips amber when
// the clock is clearly forgotten. Not a capture tile because it is not a cost
// record — same rule that keeps the incident button separate.
function DayClock({ t, lang, workDate, nav, onStart }) {
  const open = openClock();
  const done = clockFor(workDate);
  // Tick the elapsed readout while running; 30s keeps it honest without
  // churn — except inside the OT-confirm window, where a 5-minute countdown
  // needs a 10s tick to read as a countdown.
  const [, setTick] = useState(0);
  const openId = open?.clock_id;
  const otMins = 8 * 60; // CLOCK_POLICY.overtimeAfterHours — display gate only
  const graceMins = 5;   // CLOCK_POLICY.otConfirmGraceMinutes
  const elapsedNow = open ? Math.floor((Date.now() - new Date(open.at)) / 60000) : 0;
  const inOtWindow = open && !otConfirmed(open.clock_id) && elapsedNow >= otMins - 1 && elapsedNow < otMins + graceMins;
  useEffect(() => {
    if (!openId) return;
    const iv = setInterval(() => setTick((x) => x + 1), inOtWindow ? 10_000 : 30_000);
    return () => clearInterval(iv);
  }, [openId, inOtWindow]);

  if (open) {
    const mins = Math.max(0, Math.floor((Date.now() - new Date(open.at)) / 60000));
    const cap = clockCap(open); // set = OT unconfirmed and the grace ran out
    const confirmed = otConfirmed(open.clock_id);
    const otDue = !cap && !confirmed && mins >= otMins; // the 5-minute window
    const overdue = open.work_date !== workDate || mins > 12 * 60;

    // Grace expired: the payable span is capped — the strip stops "running"
    // and sends them to End Day (which records to the cap, not to now).
    if (cap) {
      return (
        <View style={[s.clockCard, s.clockCardOverdue]}>
          <View style={{ flex: 1 }}>
            <View style={s.clockLabelRow}>
              <View style={[s.clockDot, s.clockDotOverdue]} />
              <Text style={[s.clockLabel, s.clockLabelOverdue]}>
                {t("dayClosedAt")} {timeStr(cap, lang)}
              </Text>
            </View>
            <Text style={s.clockOtHint}>{t("otClosedHint")}</Text>
          </View>
          <Pressable
            onPress={() => nav("endday")}
            style={({ pressed }) => [s.endBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t("endDay")}
          >
            <Text style={s.endBtnText}>{t("endDay")}</Text>
          </Pressable>
        </View>
      );
    }

    return (
      <View>
        <View style={[s.clockCard, overdue && s.clockCardOverdue]}>
          <View style={{ flex: 1 }}>
            <View style={s.clockLabelRow}>
              <View style={[s.clockDot, overdue && s.clockDotOverdue]} />
              <Text style={[s.clockLabel, overdue && s.clockLabelOverdue]}>
                {t(overdue ? "stillOnClockQ" : "onTheClock")}
              </Text>
            </View>
            <Text style={s.clockElapsed}>
              {Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}
            </Text>
            <Text style={s.clockSince}>
              {t("sinceAt")} {timeStr(open.at, lang)}
              {open.work_date !== workDate ? ` · ${open.work_date}` : ""}
            </Text>
          </View>
          <Pressable
            onPress={() => nav("endday")}
            style={({ pressed }) => [s.endBtn, pressed && { opacity: 0.85 }]}
            accessibilityRole="button"
            accessibilityLabel={t("endDay")}
          >
            <Text style={s.endBtnText}>{t("endDay")}</Text>
          </Pressable>
        </View>
        {otDue && (
          <View style={s.otBar}>
            <View style={{ flex: 1 }}>
              <Text style={s.otBarTitle}>{t("otConfirmBar")}</Text>
              <Text style={s.otBarCount}>
                {t("otClosesIn")} {Math.max(1, otMins + graceMins - mins)} {t("minShort")}
              </Text>
            </View>
            <Pressable
              onPress={async () => {
                await confirmOvertime(open.clock_id);
                setTick((x) => x + 1);
                syncReminders(); // re-arm: drops the 8h warning, arms the 12h check
              }}
              style={({ pressed }) => [s.otBtn, pressed && { opacity: 0.85 }]}
              accessibilityRole="button"
              accessibilityLabel={t("otConfirmBtn")}
            >
              <Text style={s.otBtnText}>{t("otConfirmBtn")}</Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (done) {
    return (
      <View style={s.clockDone}>
        <Text style={s.clockDoneText}>
          ✓ {t("dayRecorded")} · {timeStr(done.start.at, lang)} – {timeStr(done.end.at, lang)}
        </Text>
      </View>
    );
  }

  return (
    <View>
      <Pressable
        onPress={onStart}
        style={({ pressed }) => [s.startBtn, pressed && { opacity: 0.85 }]}
        accessibilityRole="button"
        accessibilityLabel={t("startDay")}
      >
        <Text style={s.startLbl}>{t("startDay")}</Text>
        <Text style={s.startNow}>{timeStr(new Date().toISOString(), lang)}</Text>
      </Pressable>
      <Text style={s.startHint}>{t("startDayHint")}</Text>
    </View>
  );
}

export default function TodayScreen({ t, lang, workDate, pending, onSync, nav, onFillPhoto, onEditLine, onProjectChange, onOpenProjects }) {
  // ---- Pull-to-refresh (Jeffrey 2026-07-30, Instagram-style): drag down from
  // the top, the brand diamond appears in the stretch gap and spins while the
  // app syncs pending work and checks for a new version, then the page springs
  // back. The diamond rotates WITH the drag before release — it feels held.
  const scrollTop = useRef(0);
  const pull = useRef(new Animated.Value(0)).current;
  const pullVal = useRef(0);
  useEffect(() => {
    const id = pull.addListener(({ value }) => { pullVal.current = value; });
    return () => pull.removeListener(id);
  }, [pull]);
  const gesture = useRef({ startY: null, active: false });
  const [refreshing, setRefreshing] = useState(false);
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!refreshing) return;
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 900, easing: Easing.linear, useNativeDriver: false }),
    );
    loop.start();
    return () => loop.stop();
  }, [refreshing, spin]);

  const touchPt = (e) => {
    const t0 = e.nativeEvent.touches?.[0] ?? e.nativeEvent;
    return { x: t0.pageX ?? 0, y: t0.pageY ?? 0 };
  };
  const onPullStart = (e) => {
    const p = touchPt(e);
    gesture.current = scrollTop.current <= 1 && !refreshing
      ? { startX: p.x, startY: p.y, active: true, engaged: false }
      : { startY: null, active: false, engaged: false };
  };
  const onPullMove = (e) => {
    const g = gesture.current;
    if (!g.active || refreshing) return;
    const p = touchPt(e);
    const dy = p.y - g.startY;
    const dx = p.x - g.startX;
    // Direction gate: engage only on a clearly-vertical downward drag past a
    // small dead zone — sideways swipes must never move the page (Jeffrey).
    if (!g.engaged) {
      if (dy > 14 && dy > Math.abs(dx) * 1.6) g.engaged = true;
      else if (Math.abs(dx) > 18) { g.active = false; return; }
      else return;
    }
    // Heavy resistance + a short leash (Instagram-feel): half-screen drags
    // land at ~90px of stretch, not a page's worth.
    if (dy > 0 && scrollTop.current <= 1) pull.setValue(Math.min(90, dy * 0.35));
    else pull.setValue(0);
  };
  const onPullEnd = async () => {
    const g = gesture.current;
    g.active = false;
    if (refreshing) return;
    if (pullVal.current > 55) {
      setRefreshing(true);
      Animated.timing(pull, { toValue: 64, duration: 260, easing: Easing.inOut(Easing.quad), useNativeDriver: false }).start();
      // The refresh: drain pending sync + ask for a newer app version. If one
      // exists, the AppUpdatePill flow takes over (spin → dissolve → reload).
      try {
        await Promise.allSettled([
          syncNow(),
          Platform.OS === "web" && typeof navigator !== "undefined" && navigator.serviceWorker
            ? navigator.serviceWorker.getRegistration().then((r) => r?.update())
            : Promise.resolve(),
          // Hold the spin ≥2s even when there's nothing to sync and no update
          // — an instant spring-back reads as "nothing happened" (Jeffrey).
          new Promise((res) => setTimeout(res, 2000)),
        ]);
      } catch { /* offline pull just glides back */ }
      setRefreshing(false);
      // Instagram-soft return: one long ease-in-out glide, never a bounce.
      Animated.timing(pull, { toValue: 0, duration: 550, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start(() => onSync?.());
    } else {
      Animated.timing(pull, { toValue: 0, duration: 380, easing: Easing.inOut(Easing.cubic), useNativeDriver: false }).start();
    }
  };
  const pullRotate = refreshing
    ? spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })
    : pull.interpolate({ inputRange: [0, 110], outputRange: ["0deg", "300deg"] });
  const pullScale = pull.interpolate({ inputRange: [0, 64], outputRange: [0.3, 1], extrapolate: "clamp" });

  const [, bump] = useState(0);
  const project = currentProject();
  const projectMeta = project ? parseProject(project) : null;
  // Role-scoped: crew see only their own hours/wage; materials and other
  // workers' labor are the site manager's view (see visibleLines in store).
  const lines = visibleLines(workDate);
  const photos = photosFor(workDate);
  const totals = visibleTotals(workDate);
  const status = dayStatus(workDate);
  // Photo inbox: open while the day is live, folded once submitted. Synced by
  // effect because this screen re-renders in place now (no more key={tick}
  // remounts — those were wiping the pull-to-refresh animation mid-gesture).
  const [inboxOpen, setInboxOpen] = useState(status === "draft");
  useEffect(() => { setInboxOpen(status === "draft"); }, [status]);
  const me = activeProfile();
  const isSM = me?.role === "site_manager";
  const myName = me?.display_name;
  const inbox = isSM ? photos.filter((p) => !p.line_id) : [];
  // Crew's proof strip: their OWN photos today (Jeffrey 2026-07-31 — a bare
  // count is weak reassurance that the pixels saved; the shot itself is the
  // proof). Dot = sync state. Tap opens the viewer to fix caption/phase/area
  // — metadata only, the pixels never change.
  const myPhotos = !isSM ? photos.filter((p) => p.recorded_by === myName) : [];
  const [viewPhoto, setViewPhoto] = useState(null);

  const dateLabel = dateStamp(workDate, lang);
  const statusTag = status !== "draft" ? `  ·  ${t(status === "amended" ? "amended" : "submitted")}` : "";

  // Crew have no ⏱ Hours tile — the day clock is their only time surface (no
  // typed hours, no backdoor around the clock). Photo goes full-width: it
  // really is the one capture action. Site managers keep the form for
  // on-behalf-of logging and corrections.
  const tiles = [{ key: "photo", glyph: "📷", label: t("tilePhoto"), tone: "accent" }];
  if (isSM) {
    tiles.push({ key: "labor", glyph: "⏱", label: t("tileHours"), tone: "ink" });
    tiles.push({ key: "item", glyph: "📦", label: t("tileItem"), tone: "ink" });
  }

  // Safety records for the day — everyone sees them (SF-02).
  const incidents = incidentsFor(workDate);
  const hasEntries = lines.length > 0 || photos.length > 0;
  // Crew get their own week back for logging (CS-01) — the adoption lever.
  const week = !isSM ? myWeekHours() : null;
  // Site managers see who on their crew hasn't logged today (OV-01).
  const crew = isSM ? crewLogStatus(workDate) : null;

  return (
    <View style={{ flex: 1 }} onTouchStart={onPullStart} onTouchMove={onPullMove} onTouchEnd={onPullEnd} onTouchCancel={onPullEnd}>
      {/* The stretch gap: the brand diamond grows and turns with the drag,
          spins while refreshing, and the page springs back when done. */}
      <Animated.View style={[s.pullGap, { height: pull }]} pointerEvents="none">
        <Animated.Text style={[s.pullDiamond, { transform: [{ rotate: pullRotate }, { scale: pullScale }] }]}>◆</Animated.Text>
      </Animated.View>
    <ScrollView
      contentContainerStyle={{ paddingVertical: 12, paddingBottom: 40 }}
      onScroll={(e) => { scrollTop.current = e.nativeEvent.contentOffset?.y ?? 0; }}
      scrollEventThrottle={16}
      style={Platform.OS === "web" ? { overscrollBehaviorY: "contain" } : undefined}
    >
      {/* The plate opens the projects drawer (the single place to switch, add,
          or see your team code). No inline dropdown — that lived here before and
          duplicated the drawer. */}
      <View>
        {project ? (
          <ProjectPlate
            code={projectMeta.code}
            name={projectMeta.display}
            role={activeProfile()?.role}
            roleLabel={t(isSM ? "roleSMShort" : "roleCrewShort")}
            city={projectMeta.city}
            date={dateLabel + statusTag}
            onPress={onOpenProjects}
            hint={t("projectsLabel")}
          />
        ) : (
          <Pressable onPress={onOpenProjects} style={s.projectSlot} accessibilityRole="button" accessibilityLabel={t("findProject")}>
            <Text style={s.projectSlotTitle}>{t("findProject")}</Text>
            <Text style={s.projectSlotSub}>{t("findProjectSub")}</Text>
          </Pressable>
        )}
      </View>

      {/* No project: the date rides its own row (the plate carries it otherwise). */}
      {!project && (
        <View style={s.todayRow}>
          <Text style={s.todayBig}>{t("today")}</Text>
          <Text style={type.date}>{dateLabel}</Text>
        </View>
      )}

      {/* The day's frame: Start Day stamps attendance immediately; End Day
          turns the span into labor lines on the receipt screen. Everyone gets
          their own clock — the SM's works the same as crew. */}
      {project && (
        <DayClock
          t={t}
          lang={lang}
          workDate={workDate}
          nav={nav}
          onStart={async () => {
            await clockStart(workDate);
            syncReminders(); // arm the "still on the clock?" quit-time nudge
            bump((x) => x + 1);
          }}
        />
      )}

      {pending > 0 && (
        <Pressable style={s.pending} onPress={onSync} accessibilityRole="button" accessibilityLabel={t("pending")}>
          <Text style={s.pendingText}>{pending} {t("pending")}</Text>
          {isSyncing() && <UpdatingSpinner t={t} />}
        </Pressable>
      )}

      <View style={{ marginTop: 12 }}>
        <CaptureTiles tiles={tiles} disabled={!project} onPress={(k) => nav(k)} />
      </View>

      {/* SF-02 — every role, one tap from Today, never behind a menu. Sits
          apart from the capture tiles because it is not a cost record. */}
      {project && (
        <Pressable
          onPress={() => nav("incident")}
          style={({ pressed }) => [s.incidentBtn, pressed && { opacity: 0.85 }]}
          accessibilityRole="button"
          accessibilityLabel={t("incidentReport")}
        >
          <Text style={s.incidentGlyph}>⚠️</Text>
          <Text style={s.incidentLabel}>{t("incidentReport")}</Text>
        </Pressable>
      )}

      {incidents.length > 0 && (
        <Card style={{ marginTop: 12 }}>
          <GroupLabel>{t("incidentsToday")}</GroupLabel>
          {incidents.map((i) => (
            <View key={i.incident_id} style={s.incRow}>
              <Text style={s.incType}>{t(`incident_${i.incident_type}`)}</Text>
              <Text style={s.incDesc} numberOfLines={2}>{i.description}</Text>
              <Text style={s.incBy}>{i.reported_by}</Text>
            </View>
          ))}
        </Card>
      )}

      {/* Photo inbox — collapsible so it stops dominating the screen
          (Jeffrey 2026-07-30). Expanded while the day is a draft (labeling is
          live work); once submitted it folds to a one-line summary that
          expands on tap. */}
      {inbox.length > 0 && (
        <Card style={{ marginTop: 14 }}>
          <Pressable
            onPress={() => setInboxOpen((v) => !v)}
            style={s.inboxHead}
            accessibilityRole="button"
            accessibilityLabel={t("needDetails")}
          >
            <GroupLabel>📷 {inbox.length} {t("needDetails")}</GroupLabel>
            <Text style={s.inboxChevron}>{inboxOpen ? "▾" : "▸"}</Text>
          </Pressable>
          {inboxOpen && (
            <>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
                <View style={s.inboxRow}>
                  {inbox.map((p) => (
                    <Pressable key={p.photo_id} style={s.crewThumbWrap} onPress={() => onFillPhoto(p)} accessibilityRole="button" accessibilityLabel={t("needDetails")}>
                      <Image source={{ uri: p.uri }} style={s.inboxThumb} resizeMode="cover" />
                      {p.photo_kind === "receipt" && <Text style={s.kindBadge}>🧾</Text>}
                    </Pressable>
                  ))}
                </View>
              </ScrollView>
              <Muted style={{ marginTop: 8 }}>{t("needDetailsHint")}</Muted>
            </>
          )}
        </Card>
      )}

      {/* Crew photo previews — display only, no pricing action (that is the
          SM's inbox above). Green dot = synced in, orange = still waiting. */}
      {myPhotos.length > 0 && (
        <Card style={{ marginTop: 14 }}>
          <GroupLabel>📷 {t("todaysPhotos")}</GroupLabel>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
            <View style={s.inboxRow}>
              {myPhotos.map((p) => (
                <Pressable key={p.photo_id} style={s.crewThumbWrap} onPress={() => setViewPhoto(p)} accessibilityRole="button" accessibilityLabel={t("todaysPhotos")}>
                  <Image source={{ uri: p.uri }} style={s.crewThumb} resizeMode="cover" />
                  <View style={[s.syncDot, { backgroundColor: p.synced_at ? colors.green : colors.accent }]} />
                  {p.photo_kind === "receipt" && <Text style={s.kindBadge}>🧾</Text>}
                </Pressable>
              ))}
            </View>
          </ScrollView>
        </Card>
      )}

      {/* Tap-to-edit viewer for the proof strip: caption/phase/area only. */}
      {viewPhoto && (
        <PhotoViewer
          photo={viewPhoto}
          t={t}
          lang={lang}
          onClose={() => setViewPhoto(null)}
          onSave={async (meta) => {
            await updatePhotoMeta(viewPhoto.photo_id, meta);
            setViewPhoto(null);
          }}
          onDelete={async () => {
            await deletePhoto(viewPhoto.photo_id);
            setViewPhoto(null);
          }}
        />
      )}

      {/* The ledger — total + one row per line (§2.5). */}
      <View style={{ marginTop: 14 }}>
        {!hasEntries ? (
          <EmptyState body={project ? t("noEntriesToday") : t("pickToUnlock")} />
        ) : (
          <Card>
            {/* The reward moment: the day's work is in — say so with joy, not
                just a status tag (crew feedback 2026-07-30). The time is the
                LATEST submission, so a re-submit moves it. */}
            {status !== "draft" && (
              <View style={s.submittedBanner}>
                <Text style={s.submittedEmoji}>🎉</Text>
                <Text style={s.submittedText}>{t("submittedJoy")}</Text>
                {daySubmittedAt(workDate) && (
                  <Text style={s.submittedTime}>{timeStr(daySubmittedAt(workDate), lang)}</Text>
                )}
              </View>
            )}
            <View style={s.rollupHead}>
              <View>
                <GroupLabel>{t("recordedToday")}</GroupLabel>
                <Text style={type.moneyRollup}>{usd(totals.money)}</Text>
              </View>
              <View style={s.rollupMeta}>
                <Text style={s.metaLine}>{totals.count} {(totals.count === 1 ? t("statLine") : t("statLines")).toUpperCase()}</Text>
                <Text style={s.metaLine}>{Number(totals.hours).toFixed(1)} {t("statHours").toUpperCase()}</Text>
                {photos.length ? <Text style={s.metaLine}>{photos.length} {(photos.length === 1 ? t("statPhoto") : t("statPhotos")).toUpperCase()}</Text> : null}
              </View>
            </View>
            {lines.map((l) => {
              const isLabor = l.kind === "labor";
              const amount = isLabor
                ? Number(l.hours || 0) * Number(l.hourly_rate || 0)
                : Number(l.qty || 0) * Number(l.unit_cost || 0);
              const title = isLabor ? `${l.worker} · ${l.hours}h` : l.description;
              const meta = `${phaseLabel(l.phase, lang)} · ${l.area}${!isLabor && l.qty ? ` · ${l.qty} ${l.unit}` : ""}`;
              const row = <LedgerRow cls={l.cost_class} title={title} meta={meta} amount={usdCents(amount)} />;
              // SM corrects any line. Crew rows are read-only since the day
              // clock landed — hours come off the clock, and fixes are the
              // site manager's (append-only amendLine, named trail).
              const canEdit = onEditLine && isSM;
              return canEdit ? (
                <Pressable key={l.line_id} onPress={() => onEditLine(l)} accessibilityRole="button" accessibilityLabel={`${t("edit")} · ${title}`}>
                  {row}
                </Pressable>
              ) : (
                <View key={l.line_id}>{row}</View>
              );
            })}
          </Card>
        )}
      </View>

      {/* Crew: this week's own hours, tap for the day breakdown (CS-01). */}
      {!isSM && project && (
        <Pressable onPress={() => nav("myhours")} accessibilityRole="button" accessibilityLabel={t("myHours")}>
          <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <GroupLabel>{t("thisWeek")}</GroupLabel>
              <View style={s.weekRow}>
                <Text style={s.weekHours}>{Number(week.total).toFixed(1)}</Text>
                <Text style={s.weekUnit}>{t("statHours").toLowerCase()}</Text>
              </View>
            </View>
            <Text style={s.weekCaret}>›</Text>
          </Card>
        </Pressable>
      )}

      {/* Site manager: who on the crew hasn't logged today (OV-01). */}
      {isSM && project && crew.total > 0 && (
        <Pressable onPress={() => nav("crew")} accessibilityRole="button" accessibilityLabel={t("crewTitle")}>
          <Card style={{ marginTop: 14, flexDirection: "row", alignItems: "center" }}>
            <View style={{ flex: 1 }}>
              <GroupLabel>{t("crewTitle")}</GroupLabel>
              <View style={s.weekRow}>
                <Text style={s.weekHours}>{crew.loggedCount}</Text>
                <Text style={s.weekUnit}>/ {crew.total} {t("loggedToday")}</Text>
              </View>
            </View>
            <Text style={s.weekCaret}>›</Text>
          </Card>
        </Pressable>
      )}

      {/* Site-manager duties, below the ledger. */}
      {isSM && (
        <View style={s.smActions}>
          {/* Three states: draft → "Review & submit day"; amended (new
              entries since submit) → "Submit more!"; submitted with nothing
              new → faded "Day submitted", nothing to send. */}
          <Btn
            label={t(status === "amended" ? "submitMore" : status === "submitted" ? "submitted" : "review")}
            onPress={() => nav("review")}
            variant="green"
            disabled={lines.length === 0 || status === "submitted"}
          />
          <Btn label={t("changeOrders")} onPress={() => nav("cos")} variant="outline" style={{ minHeight: 48 }} />
        </View>
      )}
    </ScrollView>
    </View>
  );
}

const s = StyleSheet.create({
  todayRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingHorizontal: 14, marginTop: 14 },
  todayBig: { fontFamily: fonts.display, fontSize: 19, fontWeight: "700", letterSpacing: -0.3, color: colors.text },
  // No-project prompt (opens the projects drawer). Same dashed-orange look the
  // old picker slot used, so nothing shifts visually.
  projectSlot: {
    backgroundColor: "#d95a1f0d",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "rgba(217,90,31,0.5)",
    borderRadius: 14,
    marginHorizontal: 14,
    paddingVertical: 18,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  projectSlotTitle: { fontFamily: fonts.display, fontSize: 17, fontWeight: "700", color: colors.accent },
  projectSlotSub: { fontFamily: fonts.body, fontSize: 12.5, color: colors.textMuted, marginTop: 3, textAlign: "center" },
  pending: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 14,
    marginTop: 10,
    backgroundColor: "#a1620712",
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 11,
  },
  pendingText: { fontFamily: fonts.mono, color: colors.amber, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  updatingRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  updatingDiamond: { fontSize: 11, lineHeight: 13, color: colors.accent },
  updatingText: { fontFamily: fonts.mono, color: colors.accent, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.4, textTransform: "uppercase" },
  // ---- day clock (Start Day / End Day) ----
  startBtn: {
    backgroundColor: colors.ink,
    borderRadius: 12,
    minHeight: 60,
    marginHorizontal: 14,
    marginTop: 10,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  startLbl: { fontFamily: fonts.display, fontSize: 18, fontWeight: "800", letterSpacing: -0.3, color: colors.onInk },
  startNow: { fontFamily: fonts.mono, fontSize: 11.5, fontWeight: "700", color: colors.onInk, opacity: 0.65, fontVariant: ["tabular-nums"] },
  startHint: { fontFamily: fonts.body, fontSize: 11.5, color: colors.textMuted, marginHorizontal: 18, marginTop: 5 },
  clockCard: {
    backgroundColor: "#15803d0d",
    borderWidth: 1,
    borderColor: "#15803d33",
    borderRadius: 12,
    marginHorizontal: 14,
    marginTop: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  clockCardOverdue: { backgroundColor: "#a1620710", borderColor: "#a1620744" },
  clockLabelRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  clockDot: { width: 7, height: 7, borderRadius: 99, backgroundColor: colors.green },
  clockDotOverdue: { backgroundColor: colors.amber },
  clockLabel: { fontFamily: fonts.mono, fontSize: 9.5, fontWeight: "700", letterSpacing: 1.33, textTransform: "uppercase", color: colors.green },
  clockLabelOverdue: { color: colors.amber },
  clockElapsed: { fontFamily: fonts.display, fontSize: 30, fontWeight: "800", letterSpacing: -0.9, color: colors.text, fontVariant: ["tabular-nums"], marginTop: 2 },
  clockSince: { fontFamily: fonts.mono, fontSize: 10, fontWeight: "600", letterSpacing: 0.6, textTransform: "uppercase", color: colors.textMuted, marginTop: 1 },
  endBtn: { backgroundColor: colors.ink, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16 },
  endBtnText: { fontFamily: fonts.body, fontSize: 14, fontWeight: "700", color: colors.onInk },
  clockOtHint: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.amber, marginTop: 3, paddingRight: 8 },
  // OT-confirm bar — unresolved/blocking state, so this is one of orange's
  // three sanctioned jobs (theme header rule #2).
  otBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginTop: 6,
    backgroundColor: `${colors.accent}14`,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  otBarTitle: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: "700", color: colors.text },
  otBarCount: { fontFamily: fonts.mono, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", color: colors.accent, marginTop: 2, fontVariant: ["tabular-nums"] },
  otBtn: { backgroundColor: colors.accent, borderRadius: 10, paddingVertical: 12, paddingHorizontal: 14 },
  otBtnText: { fontFamily: fonts.body, fontSize: 13.5, fontWeight: "700", color: colors.onInk },
  clockDone: {
    backgroundColor: colors.surfaceSunken,
    borderRadius: 12,
    marginHorizontal: 14,
    marginTop: 10,
    paddingVertical: 11,
    paddingHorizontal: 14,
    alignItems: "center",
  },
  clockDoneText: { fontFamily: fonts.mono, fontSize: 11, fontWeight: "700", letterSpacing: 0.4, color: colors.green, fontVariant: ["tabular-nums"] },
  incidentBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginHorizontal: 14,
    marginTop: 8,
    minHeight: 46,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#b91c1c33",
    backgroundColor: "#b91c1c0a",
  },
  incidentGlyph: { fontSize: 15 },
  incidentLabel: { fontFamily: fonts.body, fontSize: 14.5, fontWeight: "700", color: colors.red },
  incRow: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 10 },
  incType: { fontFamily: fonts.mono, fontSize: 10.5, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", color: colors.red },
  incDesc: { fontFamily: fonts.body, fontSize: 14, fontWeight: "600", color: colors.text, marginTop: 3, lineHeight: 19 },
  incBy: { fontFamily: fonts.body, fontSize: 12, color: colors.textMuted, marginTop: 2 },
  pullGap: { alignItems: "center", justifyContent: "center", overflow: "hidden" },
  pullDiamond: { fontSize: 30, lineHeight: 36, color: colors.accent },
  inboxHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  inboxChevron: { color: colors.accent, fontSize: 14, fontWeight: "800" },
  inboxRow: { flexDirection: "row", gap: 8 },
  inboxThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surfaceSunken, borderWidth: 2, borderColor: colors.accent },
  // Crew proof strip: neutral border (nothing to act on), sync dot top-right.
  crewThumbWrap: { position: "relative" },
  crewThumb: { width: 72, height: 72, borderRadius: 10, backgroundColor: colors.surfaceSunken, borderWidth: 1, borderColor: colors.borderStrong },
  syncDot: { position: "absolute", top: -4, right: -4, width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: colors.bg },
  // Receipt marker — bottom-left so it never collides with the sync dot.
  kindBadge: { position: "absolute", bottom: 3, left: 3, fontSize: 13, backgroundColor: "rgba(255,255,255,0.92)", borderRadius: 6, overflow: "hidden", paddingHorizontal: 2, paddingVertical: 1 },
  submittedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "#15803d14", borderRadius: 10, paddingVertical: 8, paddingHorizontal: 12, marginBottom: 12 },
  submittedEmoji: { fontSize: 16 },
  submittedText: { fontFamily: fonts.display, fontSize: 15, fontWeight: "800", color: colors.green },
  submittedTime: { fontFamily: fonts.mono, fontSize: 11.5, fontWeight: "700", color: colors.green, opacity: 0.75, marginLeft: "auto" },
  rollupHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 4 },
  rollupMeta: { alignItems: "flex-end" },
  metaLine: { fontFamily: fonts.mono, fontSize: 10.5, color: colors.label, lineHeight: 18, letterSpacing: 0.4, fontVariant: ["tabular-nums"] },
  smActions: { paddingHorizontal: 14, gap: 8, marginTop: 4 },
  weekRow: { flexDirection: "row", alignItems: "baseline", gap: 5 },
  weekHours: { fontFamily: fonts.display, fontWeight: "800", fontSize: 26, letterSpacing: -0.7, color: colors.text, fontVariant: ["tabular-nums"] },
  weekUnit: { fontFamily: fonts.body, fontSize: 13, fontWeight: "600", color: colors.textMuted },
  weekCaret: { color: colors.accent, fontSize: 22, fontWeight: "800" },
});
