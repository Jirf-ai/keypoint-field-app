// The store's spine: append-only amend chains, day-clock selectors, and the
// sync bookkeeping (pendingByProject / markSynced) that decides what reaches
// the server. Native modules are stubbed (see jest.config.js); location is
// mocked here because it pulls in expo-location at import time.
jest.mock("../src/location", () => ({
  lastLocation: () => null,
  refreshLocation: async () => null,
}));

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
