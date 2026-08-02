// The sending spine: one poisoned project or hung chunk must never strand the
// rest of the queue, and a photo whose pixels couldn't be read this pass must
// stay pending (metadata syncs, the binary retries) instead of being stamped
// synced — the pilot-day-1 orphan-pixels failure mode.
jest.mock("../src/location", () => ({
  lastLocation: () => null,
  refreshLocation: async () => null,
}));
jest.mock("../src/api", () => ({ call: jest.fn() }));
jest.mock("expo-file-system", () => ({
  File: class {
    constructor() {
      throw new Error("no filesystem in tests"); // readB64 must fail-soft to null
    }
  },
}));
jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: { fetch: async () => ({ type: "wifi" }) },
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

// Echo every row the server was sent — the happy-path server response.
function echoAll(body) {
  return {
    ok: true,
    synced: {
      days: [],
      items: (body.items ?? []).map((r) => r.line_id),
      labor: (body.labor ?? []).map((r) => r.line_id),
      change_orders: (body.change_orders ?? []).map((r) => r.co_id),
      incidents: (body.incidents ?? []).map((r) => r.incident_id),
      clock_events: (body.clock_events ?? []).map((r) => r.clock_id),
      photos: (body.photos ?? []).map((r) => r.photo_id),
    },
    failed: [],
    synced_at: "2026-08-01T20:00:00Z",
  };
}

let store, sync, api;

beforeEach(async () => {
  jest.resetModules();
  jest.useFakeTimers();
  const asMod = require("@react-native-async-storage/async-storage");
  const AsyncStorage = asMod.default ?? asMod;
  await AsyncStorage.clear();
  api = require("../src/api");
  // Default: benign failure (store's fire-and-forget remember-project rides this
  // too); each test overrides with its own server behavior before syncing.
  api.call.mockResolvedValue({ ok: false, status: 0 });
  store = require("../src/store");
  sync = require("../src/sync");
  await store.load();
  await store.createProfile({ display_name: "Ana", role: "journeyman", lang: "en" });
  await store.setCurrentProject({ id: "p1", name: "123 Test St" });
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test("a failing project does not block the others from syncing", async () => {
  const bad = await store.addLine(LABOR); // p1
  await store.setCurrentProject({ id: "p2", name: "456 Other Ave" });
  const good = await store.addLine({ ...LABOR, worker: "Ben" }); // p2

  api.call.mockImplementation(async (fn, body) =>
    body.project_id === "p1" ? { ok: false, status: 500 } : echoAll(body)
  );
  await sync.syncNow();

  const pending = store.pendingByProject();
  expect(pending.p1.labor.map((l) => l.line_id)).toEqual([bad.line_id]); // still queued
  expect(pending.p2).toBeUndefined(); // synced despite p1's failure
  expect(good.synced_at).toBeTruthy();
  expect(sync.lastSyncError()).toMatch(/p1/);
});

test("unreadable-but-recoverable pixels keep the photo pending; dead blobs settle", async () => {
  const stuck = await store.addPhoto({ work_date: TODAY, uri: "idb:some-photo", phase: "framing", area: "Interior" });
  const dead = await store.addPhoto({ work_date: TODAY, uri: "blob:https://dead", phase: "framing", area: "Interior" });

  api.call.mockImplementation(async (fn, body) => echoAll(body));
  await sync.syncNow();

  // The idb: read failed this pass — metadata went up, the binary must retry.
  const pendingPhotos = store.pendingPhotosByProject().p1 ?? [];
  expect(pendingPhotos.map((p) => p.photo_id)).toEqual([stuck.photo_id]);
  // The dead blob: is unrecoverable by decision — metadata-only counts as done.
  expect(dead.synced_at).toBeTruthy();
  // Neither payload carried b64 (no filesystem, no data: URI in this test).
  const photoBodies = api.call.mock.calls.map(([, b]) => b).filter((b) => b.photos);
  expect(photoBodies.flatMap((b) => b.photos).every((p) => !p.b64)).toBe(true);
});

test("a clean pass clears the error; photos with data: URIs carry b64", async () => {
  await store.addPhoto({ work_date: TODAY, uri: "data:image/jpeg;base64,QUJD", phase: "framing", area: "Interior" });
  api.call.mockImplementation(async (fn, body) => echoAll(body));
  await sync.syncNow();

  expect(store.pendingCount()).toBe(0);
  expect(sync.lastSyncError()).toBeNull();
  const photoBodies = api.call.mock.calls.map(([, b]) => b).filter((b) => b.photos);
  expect(photoBodies.flatMap((b) => b.photos).map((p) => p.b64)).toEqual(["data:image/jpeg;base64,QUJD"]);
});
