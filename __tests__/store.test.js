// The store's spine: append-only amend chains, day-clock selectors, and the
// sync bookkeeping (pendingByProject / markSynced) that decides what reaches
// the server. Native modules are stubbed (see jest.config.js); location is
// mocked here because it pulls in expo-location at import time.
jest.mock("../src/location", () => ({
  lastLocation: () => null,
  refreshLocation: async () => null,
}));
// Store fires real fire-and-forget calls (remember-project) — tests must
// never hit the live server, and dangling fetches leak jest workers.
jest.mock("../src/api", () => ({ call: jest.fn(async () => ({ ok: false, status: 0 })) }));

const TODAY = (() => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
})();

const LABOR = {
  kind: "labor", work_date: TODAY, cost_class: "L", trade: "framer",
  worker: "Ana", worker_id: null, hours: 8, hour_type: "regular",
  hourly_rate: 45, phase: "framing", area: "Interior", note: null,
};

let store;

beforeEach(async () => {
  jest.resetModules();
  const asMod = require("@react-native-async-storage/async-storage");
  const AsyncStorage = asMod.default ?? asMod;
  await AsyncStorage.clear();
  store = require("../src/store");
  await store.load();
  await store.createProfile({ display_name: "Ana", role: "journeyman", lang: "en" });
  await store.setCurrentProject({ id: "p1", name: "123 Test St" });
});

describe("append-only amend chain", () => {
  test("amend supersedes the old line; only the correction is active", async () => {
    const v1 = await store.addLine(LABOR);
    const v2 = await store.amendLine(v1.line_id, { ...LABOR, hours: 9 });

    const active = store.activeLines(TODAY);
    expect(active).toHaveLength(1);
    expect(active[0].line_id).toBe(v2.line_id);
    expect(active[0].hours).toBe(9);
    expect(active[0].supersedes).toBe(v1.line_id);
    expect(active[0].version).toBe(2);

    // The old row still exists (nothing is destroyed) but is not active.
    expect(store.lineById(v1.line_id)).toBeNull();
    expect(store.lineById(v2.line_id)).not.toBeNull();
  });

  test("lines are scoped to the current project", async () => {
    await store.addLine(LABOR);
    await store.setCurrentProject({ id: "p2", name: "456 Other Ave" });
    expect(store.activeLines(TODAY)).toHaveLength(0);
    await store.setCurrentProject({ id: "p1", name: "123 Test St" });
    expect(store.activeLines(TODAY)).toHaveLength(1);
  });

  test("adding to a submitted day marks it amended", async () => {
    await store.addLine(LABOR);
    await store.submitDay(TODAY);
    expect(store.dayStatus(TODAY)).toBe("submitted");
    await store.addLine({ ...LABOR, hours: 1, hour_type: "overtime" });
    expect(store.dayStatus(TODAY)).toBe("amended");
  });
});

describe("day clock", () => {
  test("start opens the clock; end closes it and pairs by starts-link", async () => {
    expect(store.openClock()).toBeNull();
    const start = await store.clockStart(TODAY);
    expect(store.openClock()?.clock_id).toBe(start.clock_id);
    expect(store.clockFor(TODAY)).toBeNull(); // running, not done

    const end = await store.clockEnd(start);
    expect(store.openClock()).toBeNull();
    const pair = store.clockFor(TODAY);
    expect(pair.start.clock_id).toBe(start.clock_id);
    expect(pair.end.clock_id).toBe(end.clock_id);
    expect(end.starts).toBe(start.clock_id);
    expect(end.work_date).toBe(TODAY);
  });

  test("a forgotten earlier-day clock resolves before today", async () => {
    const yesterday = "2026-07-30";
    const old = await store.clockStart(yesterday);
    await store.clockStart(TODAY);
    // Oldest dangling start first — the forgotten day blocks today.
    expect(store.openClock().clock_id).toBe(old.clock_id);
    await store.clockEnd(old);
    // With yesterday closed, today's clock surfaces.
    expect(store.openClock().work_date).toBe(TODAY);
  });

  test("clock is scoped to worker and project", async () => {
    await store.clockStart(TODAY);
    await store.setCurrentProject({ id: "p2", name: "456 Other Ave" });
    expect(store.openClock()).toBeNull(); // other project — not my clock
  });

  // The timer-reset bug (2026-08-01): a wiped device restored by phone number
  // had no local clock_events, so a running punch-in showed as "Start Day"
  // again. mergeClockEvents brings the server's stamps back.
  test("server rehydration restores a running clock and resumes its elapsed time", async () => {
    const me = store.activeProfile();
    const startAt = new Date(Date.now() - 3 * 3600_000).toISOString(); // punched in 3h ago
    const serverRow = {
      clock_id: "srv-start-1", event: "start", work_date: TODAY,
      worker_id: me.worker_id, worker_name: "Ana", starts: null,
      at: startAt, project_id: "p1", project_name: "123 Test St",
    };
    expect(await store.mergeClockEvents([serverRow])).toBe(1);
    const open = store.openClock();
    expect(open?.clock_id).toBe("srv-start-1");
    expect(open?.at).toBe(startAt); // timer continues from the ORIGINAL punch-in
    // Idempotent — the next pull adds nothing.
    expect(await store.mergeClockEvents([serverRow])).toBe(0);
    // Already server-side — must never re-enter the pending queue.
    expect(store.pendingByProject()["p1"]?.clock_events ?? []).toHaveLength(0);
    // End Day closes the rehydrated start like any local one.
    await store.clockEnd(open);
    expect(store.openClock()).toBeNull();
    expect(store.clockFor(TODAY).start.clock_id).toBe("srv-start-1");
  });

  test("a rehydrated start+end pair reads as a recorded day, not a running clock", async () => {
    const me = store.activeProfile();
    const rows = [
      { clock_id: "s1", event: "start", work_date: TODAY, worker_id: me.worker_id,
        at: "2026-08-01T14:00:00Z", project_id: "p1", project_name: "123 Test St" },
      { clock_id: "e1", event: "end", work_date: TODAY, worker_id: me.worker_id,
        starts: "s1", at: "2026-08-01T22:30:00Z", project_id: "p1", project_name: "123 Test St" },
    ];
    expect(await store.mergeClockEvents(rows)).toBe(2);
    expect(store.openClock()).toBeNull();
    const pair = store.clockFor(TODAY);
    expect(pair.start.clock_id).toBe("s1");
    expect(pair.end.clock_id).toBe("e1");
  });
});

describe("photo-draft crash net", () => {
  test("drafts persist at pick, scope to project+date, and clear on demand", async () => {
    const [d] = await store.addPhotoDrafts(TODAY, ["data:image/jpeg;base64,AAA"]);
    expect(store.photoDrafts(TODAY).map((x) => x.draft_id)).toEqual([d.draft_id]);
    // Another project's photo screen must not see them.
    await store.setCurrentProject({ id: "p2", name: "456 Other Ave" });
    expect(store.photoDrafts(TODAY)).toHaveLength(0);
    await store.setCurrentProject({ id: "p1", name: "123 Test St" });
    // ✕ on a thumbnail removes just that draft.
    await store.removePhotoDraft(d.draft_id);
    expect(store.photoDrafts(TODAY)).toHaveLength(0);
    // Upload / Cancel / leaving the screen clears the whole batch.
    await store.addPhotoDrafts(TODAY, ["u1", "u2"]);
    await store.clearPhotoDrafts(TODAY);
    expect(store.photoDrafts(TODAY)).toHaveLength(0);
    // Drafts never reach the sync queue.
    expect(store.pendingCount()).toBe(0);
  });
});

describe("labor rehydration (My Hours survives device loss)", () => {
  test("server rows fill the week, honor amend chains, never re-queue or dupe", async () => {
    const me = store.activeProfile();
    const serverRows = [
      { labor_id: "srv-l1", project_id: "p1", project_name: "123 Test St", work_date: TODAY,
        trade: "laborer", worker_id: me.worker_id, worker_name: "Ana", hours: "8.00",
        hour_type: "regular", hourly_rate: "25.00", phase: "drywall", area: "Interior",
        note: null, clock_id: "srv-c1", recorded_by: "Jeffrey", recorded_at: "2026-08-01T20:00:00Z",
        version: 1, supersedes: null },
      // An SM correction chain: v2 supersedes v1 — only v2 may count.
      { labor_id: "srv-l2", project_id: "p1", project_name: "123 Test St", work_date: TODAY,
        trade: "laborer", worker_id: me.worker_id, worker_name: "Ana", hours: "0.50",
        hour_type: "overtime", hourly_rate: "25.00", phase: "drywall", area: "Interior",
        note: null, clock_id: null, recorded_by: "Robert", recorded_at: "2026-08-01T21:00:00Z",
        version: 1, supersedes: null },
      { labor_id: "srv-l3", project_id: "p1", project_name: "123 Test St", work_date: TODAY,
        trade: "laborer", worker_id: me.worker_id, worker_name: "Ana", hours: "0.25",
        hour_type: "overtime", hourly_rate: "25.00", phase: "drywall", area: "Interior",
        note: null, clock_id: null, recorded_by: "Robert", recorded_at: "2026-08-01T22:00:00Z",
        version: 2, supersedes: "srv-l2" },
    ];
    expect(await store.mergeLaborLines(serverRows)).toBe(3);
    // Active view: v1 8h + v2-of-chain 0.25h; the superseded 0.5h is out.
    const week = store.myWeekHours(TODAY);
    expect(week.total).toBe(8.25);
    expect(week.byType.regular).toBe(8);
    expect(week.byType.overtime).toBe(0.25);
    // Idempotent, and nothing re-enters the sync queue.
    expect(await store.mergeLaborLines(serverRows)).toBe(0);
    expect(store.pendingCount()).toBe(0);
    // Clock provenance survives the merge.
    expect(store.activeLines(TODAY).find((l) => l.line_id === "srv-l1").clock_id).toBe("srv-c1");
  });
});

describe("multi-context union merge", () => {
  test("adopts another tab's rows and stamps, never duplicates or deletes", async () => {
    const mine = await store.addLine(LABOR);
    const dayKey = `p1:${TODAY}`;
    const ext = {
      lines: [
        // Same row, but the other tab already synced it — adopt the stamp.
        { ...mine, synced_at: "2026-08-01T10:00:00Z" },
        // A row we've never seen — adopt it whole.
        { ...LABOR, line_id: "ext-line-1", project_id: "p1", worker: "Ben", recorded_at: "2026-08-01T09:00:00Z", version: 1, supersedes: null, synced_at: null },
      ],
      clock_events: [
        { clock_id: "ext-clock-1", event: "start", work_date: TODAY, worker_id: "w-ext", at: "2026-08-01T14:00:00Z", project_id: "p1" },
      ],
      days: { [dayKey]: { status: "submitted", submitted_at: "2026-08-01T23:00:00Z", submitted_by: "Ana" } },
    };
    expect(await store.mergeExternalState(ext)).toBe(true);
    expect(store.activeLines(TODAY)).toHaveLength(2);
    expect(mine.synced_at).toBe("2026-08-01T10:00:00Z");
    expect(store.dayStatus(TODAY)).toBe("submitted");
    // Idempotent — a second delivery of the same blob changes nothing.
    expect(await store.mergeExternalState(ext)).toBe(false);
    expect(store.activeLines(TODAY)).toHaveLength(2);
  });
});

describe("overtime confirmation gate", () => {
  const startedHoursAgo = async (h) => {
    const ev = await store.clockStart(TODAY);
    ev.at = new Date(Date.now() - h * 3_600_000).toISOString();
    return ev;
  };

  test("no cap under 8h, none inside the grace window", async () => {
    const ev = await startedHoursAgo(7);
    expect(store.clockCap(ev)).toBeNull();
    ev.at = new Date(Date.now() - (8 * 60 + 3) * 60_000).toISOString(); // 8h03
    expect(store.clockCap(ev)).toBeNull();
  });

  test("unconfirmed OT caps at start + 8h + grace", async () => {
    const ev = await startedHoursAgo(9);
    const cap = store.clockCap(ev);
    expect(cap).not.toBeNull();
    const capMin = (new Date(cap) - new Date(ev.at)) / 60_000;
    expect(capMin).toBe(8 * 60 + 5);
  });

  test("confirming overtime removes the cap and rides the sync spine", async () => {
    const ev = await startedHoursAgo(9);
    const confirm = await store.confirmOvertime(ev);
    expect(store.otConfirmed(ev.clock_id)).toBe(true);
    expect(store.clockCap(ev)).toBeNull();
    // The confirmation is an append-only clock event pointed at the start —
    // notify-clocks (server cron) and cross-device rehydration read it there.
    expect(confirm.event).toBe("ot_confirm");
    expect(confirm.starts).toBe(ev.clock_id);
    const pending = store.pendingByProject()["p1"].clock_events.map((e) => e.clock_id);
    expect(pending).toContain(confirm.clock_id);
    // Idempotent: a second confirm writes nothing.
    expect(await store.confirmOvertime(ev)).toBeNull();
  });

  test("a rehydrated ot_confirm from the server counts as confirmed", async () => {
    const me = store.activeProfile();
    const startAt = new Date(Date.now() - 9 * 3_600_000).toISOString();
    const rows = [
      { clock_id: "srv-s1", event: "start", work_date: TODAY, worker_id: me.worker_id,
        at: startAt, project_id: "p1", project_name: "123 Test St" },
      { clock_id: "srv-c1", event: "ot_confirm", work_date: TODAY, worker_id: me.worker_id,
        starts: "srv-s1", at: startAt, project_id: "p1", project_name: "123 Test St" },
    ];
    expect(await store.mergeClockEvents(rows)).toBe(2);
    expect(store.otConfirmed("srv-s1")).toBe(true);
    expect(store.clockCap(store.openClock())).toBeNull(); // confirmed — no cap
    // Server copies never re-enter the pending queue.
    expect(store.pendingByProject()["p1"]?.clock_events ?? []).toHaveLength(0);
  });

  test("legacy device-local confirmations (pre-event map) still count", async () => {
    const ev = await startedHoursAgo(9);
    // Simulate a confirmation saved by the 2026-08-03 map-based build.
    const state = await store.load();
    state.ot_confirms = { [ev.clock_id]: new Date().toISOString() };
    expect(store.otConfirmed(ev.clock_id)).toBe(true);
    expect(store.clockCap(ev)).toBeNull();
  });

  test("clockEnd honors an explicit cap stamp", async () => {
    const ev = await startedHoursAgo(9);
    const cap = store.clockCap(ev);
    const end = await store.clockEnd(ev, cap);
    expect(end.at).toBe(cap);
    expect(end.starts).toBe(ev.clock_id);
  });
});

describe("sync bookkeeping", () => {
  test("pendingByProject groups rows the way sync-field-log wants them", async () => {
    const labor = await store.addLine(LABOR);
    const item = await store.addLine({
      kind: "item", work_date: TODAY, cost_class: "M", description: "2x4 studs",
      qty: 10, unit: "EA", unit_cost: 4.5, phase: "framing", area: "Interior", note: null,
    });
    const clock = await store.clockStart(TODAY);
    await store.submitDay(TODAY);

    const groups = store.pendingByProject();
    const g = groups["p1"];
    expect(g.labor.map((l) => l.line_id)).toEqual([labor.line_id]);
    expect(g.items.map((l) => l.line_id)).toEqual([item.line_id]);
    expect(g.clock_events.map((e) => e.clock_id)).toEqual([clock.clock_id]);
    expect(g.days).toEqual([expect.objectContaining({ work_date: TODAY, status: "submitted" })]);
  });

  test("markSynced stamps only echoed ids; the rest stay pending", async () => {
    const a = await store.addLine(LABOR);
    const b = await store.addLine({ ...LABOR, worker: "Ben" });
    const clock = await store.clockStart(TODAY);
    const before = store.pendingCount();
    expect(before).toBe(3);

    await store.markSynced(
      { labor: [a.line_id], clock_events: [clock.clock_id] },
      "2026-07-31T20:00:00Z",
    );
    expect(store.pendingCount()).toBe(1); // only b remains
    const g = store.pendingByProject()["p1"];
    expect(g.labor.map((l) => l.line_id)).toEqual([b.line_id]);
    expect(g.clock_events).toHaveLength(0);
  });

  test("writes reach AsyncStorage (the zero-loss contract)", async () => {
    const asMod = require("@react-native-async-storage/async-storage");
  const AsyncStorage = asMod.default ?? asMod;
    await store.addLine(LABOR);
    const raw = JSON.parse(await AsyncStorage.getItem("kaicon-field:v1"));
    expect(raw.lines).toHaveLength(1);
    expect(raw.lines[0].worker).toBe("Ana");
  });
});

describe("role-scoped visibility", () => {
  test("crew see only their own labor; nothing else", async () => {
    await store.addLine(LABOR); // Ana's own
    await store.addLine({ ...LABOR, worker: "Ben" });
    await store.addLine({
      kind: "item", work_date: TODAY, cost_class: "M", description: "paint",
      qty: 1, unit: "GAL", unit_cost: 30, phase: "painting", area: "Interior", note: null,
    });
    const visible = store.visibleLines(TODAY);
    expect(visible).toHaveLength(1);
    expect(visible[0].worker).toBe("Ana");
    // …while the full day (review/sync) still sees everything.
    expect(store.activeLines(TODAY)).toHaveLength(3);
  });
});
