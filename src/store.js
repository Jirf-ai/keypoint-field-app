// Local-first store (Tech Eval §6): every write commits to AsyncStorage
// immediately and unconditionally. Sync is a future background reconciliation
// (Supabase tables land as BOBAI engine work) — never a precondition for
// capture. Append-only: corrections write a new version pointing at the old
// one via `supersedes`; nothing is destroyed. Client-generated ids make future
// sync idempotent.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { todayStr } from "./schema";

const KEY = "kaicon-field:v1";

let state = null;

function uuid() {
  // RFC4122-ish v4, no crypto dependency (ids only need uniqueness per device).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

const EMPTY = {
  // Worker profiles (schema §4.8, minimized on purpose): name, trade,
  // language, selfie. active_worker_id gates the app — no profile, no capture.
  profiles: [],
  active_worker_id: null,
  // Multi-project (Jeffrey 2026-07-24): the worker picks their project from
  // Records; everything below partitions by current_project.id (Records uuid).
  current_project: null,      // { id, name, status }
  recent_projects: [],        // most recent first, deduped, capped
  lines: [],          // items + labor, append-only ({kind: 'item'|'labor'})
  photos: [],
  change_orders: [],
  days: {},           // `${project_id}:${work_date}` -> {status, submitted_at, submitted_by}
  settings: { lang: "en", recorded_by: "", lastPhase: null, lastArea: null },
};

export async function load() {
  if (state) return state;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    state = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    state = { ...EMPTY };
  }
  return state;
}

async function persist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Never throw out of a capture path. The in-memory copy stays valid and the
    // next successful persist writes everything (single-blob store).
  }
}

function stamp(entry) {
  return {
    ...entry,
    project_id: state.current_project?.id ?? null,   // Records uuid
    project_name: state.current_project?.name ?? null,
    recorded_at: new Date().toISOString(),
    recorded_by: state.settings.recorded_by || "unknown",
    captured_offline: true, // v0 is always offline-first; sync layer comes later
    synced_at: null,
    version: 1,
    supersedes: null,
  };
}

const RECENTS_MAX = 6;

export async function setCurrentProject(p) {
  state.current_project = { id: p.id, name: p.name, status: p.status ?? null };
  state.recent_projects = [
    state.current_project,
    ...state.recent_projects.filter((x) => x.id !== p.id),
  ].slice(0, RECENTS_MAX);
  await persist();
  return state.current_project;
}

export function currentProject() {
  return state?.current_project ?? null;
}

export function recentProjects() {
  return state?.recent_projects ?? [];
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await persist();
  return state.settings;
}

// ------------------------------------------------------------------ profiles
export async function createProfile({ display_name, default_trade, lang, selfie_uri, phone, role }) {
  const p = {
    worker_id: uuid(),
    display_name,
    default_trade: default_trade ?? null,
    preferred_language: lang ?? "en",
    selfie_uri: selfie_uri ?? null,
    phone: phone ?? null,          // verified via OTP at public release
    phone_verified: false,
    // schema §4.8 role — drives which interface the worker gets (site
    // managers run the daily log; crew log their own hours + photos).
    role: role ?? "journeyman",
    active: true,
    created_at: new Date().toISOString(),
  };
  state.profiles.push(p);
  return await logIn(p.worker_id);
}

export async function logIn(worker_id) {
  const p = state.profiles.find((x) => x.worker_id === worker_id);
  if (!p) return null;
  state.active_worker_id = worker_id;
  state.settings.recorded_by = p.display_name;
  state.settings.lang = p.preferred_language ?? state.settings.lang;
  await persist();
  return p;
}

export async function logOut() {
  state.active_worker_id = null;
  await persist();
}

export function activeProfile() {
  return state?.profiles.find((x) => x.worker_id === state.active_worker_id) ?? null;
}

export function profiles() {
  return state?.profiles ?? [];
}

export async function addLine(entry) {
  const line = stamp({ line_id: uuid(), ...entry });
  state.lines.push(line);
  state.settings.lastPhase = entry.phase ?? state.settings.lastPhase;
  state.settings.lastArea = entry.area ?? state.settings.lastArea;
  // Adding to a submitted day marks the day amended (PRD §5.1 daily submit).
  const day = state.days[dayKey(entry.work_date)];
  if (day && day.status === "submitted") day.status = "amended";
  await persist();
  return line;
}

// Append-only correction: the old line stays, marked superseded.
export async function amendLine(line_id, patch) {
  const old = state.lines.find((l) => l.line_id === line_id);
  if (!old) return null;
  old.superseded_by = uuid();
  const next = stamp({
    ...old,
    ...patch,
    line_id: old.superseded_by,
    version: (old.version || 1) + 1,
    supersedes: line_id,
  });
  delete next.superseded_by;
  state.lines.push(next);
  await persist();
  return next;
}

export async function addPhoto(photo) {
  const p = stamp({ photo_id: uuid(), ...photo });
  state.photos.push(p);
  await persist();
  return p;
}

// Attach an already-captured photo to a line created later (photo-first flow:
// crews snap now, the site manager fills in details at end of day).
export async function linkPhoto(photo_id, line_id) {
  const p = state.photos.find((x) => x.photo_id === photo_id);
  if (p) {
    p.line_id = line_id;
    await persist();
  }
  return p;
}

export async function addChangeOrder(co) {
  const rec = stamp({ co_id: uuid(), status: "pending", ...co });
  state.change_orders.push(rec);
  await persist();
  return rec;
}

function dayKey(work_date) {
  return `${state.current_project?.id ?? "none"}:${work_date}`;
}

export async function submitDay(work_date) {
  state.days[dayKey(work_date)] = {
    status: "submitted",
    submitted_at: new Date().toISOString(),
    submitted_by: state.settings.recorded_by || "unknown",
  };
  await persist();
  return state.days[dayKey(work_date)];
}

// ---------------------------------------------------------------- selectors
// All day views are scoped to the CURRENT project — switching projects
// switches what Today shows; nothing is ever mixed across jobs.
export function activeLines(work_date) {
  const pid = state.current_project?.id;
  return state.lines.filter(
    (l) => l.work_date === work_date && !l.superseded_by && l.project_id === pid
  );
}

export function photosFor(work_date) {
  const pid = state.current_project?.id;
  return state.photos.filter((p) => p.work_date === work_date && p.project_id === pid);
}

export function dayStatus(work_date) {
  return state.days[dayKey(work_date)]?.status ?? "draft";
}

export function pendingCount() {
  // Everything unsynced counts — the badge the crew watches (Tech Eval §6.3).
  return (
    state.lines.filter((l) => !l.synced_at).length +
    state.photos.filter((p) => !p.synced_at).length +
    state.change_orders.filter((c) => !c.synced_at).length
  );
}

export function todayTotals(work_date = todayStr()) {
  const lines = activeLines(work_date);
  const byClass = { M: 0, F: 0, L: 0, E: 0, S: 0 };
  let hours = 0;
  for (const l of lines) {
    if (l.kind === "labor") {
      byClass.L += Number(l.hours || 0) * Number(l.hourly_rate || 0);
      hours += Number(l.hours || 0);
    } else {
      byClass[l.cost_class] += Number(l.qty || 0) * Number(l.unit_cost || 0);
    }
  }
  const money = Object.values(byClass).reduce((a, b) => a + b, 0);
  return { byClass, hours, money, count: lines.length };
}

export function nextPhotoSeq(work_date) {
  return photosFor(work_date).length + 1;
}

export function nextCoNo() {
  const pid = state.current_project?.id;
  const n = state.change_orders.filter((c) => c.project_id === pid).length + 1;
  return `CO-${String(n).padStart(3, "0")}`;
}

export function getSettings() {
  return state?.settings ?? EMPTY.settings;
}

export function changeOrders() {
  const pid = state.current_project?.id;
  return state.change_orders.filter((c) => c.project_id === pid);
}
