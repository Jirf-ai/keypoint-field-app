// Local-first store (Tech Eval §6): every write commits to AsyncStorage
// immediately and unconditionally. Sync is a future background reconciliation
// (Supabase tables land as BOBAI engine work) — never a precondition for
// capture. Append-only: corrections write a new version pointing at the old
// one via `supersedes`; nothing is destroyed. Client-generated ids make future
// sync idempotent.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { areasFor, todayStr } from "./schema";
import { lastLocation } from "./location";

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
  // GC team account on this device (business registered + consented; the
  // standing team code workers must use to register). Locked server-side to
  // gc_accounts — this is the local session copy.
  gc_account: null,   // { gc_account_id, gc_code, business_name, phone, email }
  // Multi-project (Jeffrey 2026-07-24): the worker picks their project from
  // Records; everything below partitions by current_project.id (Records uuid).
  current_project: null,      // { id, name, status }
  recent_projects: [],        // most recent first, deduped, capped
  // Team projects (2026-07-27): site managers create projects on-device; crew
  // join a manager's list with a share code. Local-first — these ride the same
  // append-only store and reconcile server-side when sync lands.
  owned_projects: [],         // { id, name, address, status, owner_id, created_at }
  lines: [],          // items + labor, append-only ({kind: 'item'|'labor'})
  photos: [],
  change_orders: [],
  incidents: [],      // SF-02 safety records — any role, append-only
  days: {},           // `${project_id}:${work_date}` -> {status, submitted_at, submitted_by}
  settings: { lang: "en", recorded_by: "", lastPhase: null, lastArea: null, wifiOnlyPhotos: false, remindEndOfDay: false, reminderTime: "17:00" },
};

export async function load() {
  if (state) return state;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    state = raw ? { ...EMPTY, ...JSON.parse(raw) } : { ...EMPTY };
  } catch {
    state = { ...EMPTY };
  }
  // One-time migration: before this change current_project was global. Hand it
  // to whoever is currently logged in so they don't lose their project.
  const me = activeProfile();
  if (me && me.current_project === undefined && state.current_project) {
    me.current_project = state.current_project;
    me.recent_projects = state.recent_projects ?? [];
  }
  applyProfileContext();
  return state;
}

async function persist() {
  // WEB ONLY: AsyncStorage backs onto localStorage, which writes SYNCHRONOUSLY
  // on the main thread — serializing a store that holds base64 selfies/photos
  // freezes the page mid-tap ("cursor stuck"). Batch web writes on a short
  // trailing timer; the browser preview is not the capture instrument. Native
  // keeps the immediate write (async, off-thread) — zero-loss rule intact.
  if (Platform.OS === "web") {
    clearTimeout(persist._t);
    persist._t = setTimeout(doPersist, 250);
    return;
  }
  await doPersist();
}

async function doPersist() {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // Never throw out of a capture path. The in-memory copy stays valid and the
    // next successful persist writes everything (single-blob store).
  }
}

function stamp(entry) {
  return {
    // Location provenance (PRD §7): brand every record with the last known fix.
    // Spread first so an explicit gps on the entry (a photo's precise geotag)
    // always wins over the cached line-level fix.
    ...(lastLocation() ?? {}),
    ...entry,
    project_id: state.current_project?.id ?? null,   // Records uuid
    project_name: state.current_project?.name ?? null,
    recorded_at: new Date().toISOString(),
    recorded_by: state.settings.recorded_by || "unknown",
    captured_offline: true, // v0 is always offline-first; sync reconciles after
    synced_at: null,
    // Honor amendment chains: amendLine passes version/supersedes explicitly.
    // Hard-resetting them here silently flattened every correction to a fresh
    // v1 row — both versions would count as active server-side.
    version: entry.version ?? 1,
    supersedes: entry.supersedes ?? null,
  };
}

const RECENTS_MAX = 6;

// current_project / recent_projects live PER PROFILE (each worker keeps their
// own selection across switches). state.current_project is a mirror of the
// active profile's value so the many direct `state.current_project` reads in
// selectors keep working; applyProfileContext() re-points the mirror on every
// login / switch / set.
function applyProfileContext() {
  const me = activeProfile();
  state.current_project = me?.current_project ?? null;
  state.recent_projects = me?.recent_projects ?? [];
}

export async function setCurrentProject(p) {
  state.current_project = { id: p.id, name: p.name, status: p.status ?? null };
  state.recent_projects = [
    state.current_project,
    ...state.recent_projects.filter((x) => x.id !== p.id),
  ].slice(0, RECENTS_MAX);
  const me = activeProfile();
  if (me) {
    me.current_project = state.current_project;
    me.recent_projects = state.recent_projects;
  }
  await persist();
  return state.current_project;
}

export function currentProject() {
  return state?.current_project ?? null;
}

export function recentProjects() {
  return state?.recent_projects ?? [];
}

// ---------------------------------------------------------- team projects
// A manager's share code is derived from their worker_id so it's stable and
// needs no extra storage. Crew type it to join that manager's project list.
export function shareCodeFor(worker_id) {
  const s = String(worker_id || "").replace(/[^a-z0-9]/gi, "").slice(0, 4).toUpperCase();
  return `KP-${s || "0000"}`;
}

export function myShareCode() {
  const me = activeProfile();
  return me ? shareCodeFor(me.worker_id) : null;
}

// Resolve a share code to its site-manager profile without mutating anything —
// used to validate a crew member's code at signup before the account exists.
export function resolveShareCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase();
  return (state?.profiles ?? []).find((p) => p.role === "site_manager" && shareCodeFor(p.worker_id) === code) ?? null;
}

// Projects the active worker can see: a manager sees the ones they created; a
// crew member sees the ones from managers whose code they've joined.
export function myProjects() {
  const me = activeProfile();
  if (!me) return [];
  const owned = state.owned_projects ?? [];
  if (me.role === "site_manager") return owned.filter((p) => p.owner_id === me.worker_id);
  const joined = me.joined_owner_ids ?? [];
  return owned.filter((p) => joined.includes(p.owner_id));
}

// Site manager creates a project. Client-generated id keeps future sync
// idempotent; the new project is selected immediately. Custom areas (optional)
// give this project its own constrained tag list; empty falls back to the
// generic residential set (schema §4.1 — areas are project-configured).
export async function addOwnedProject({ name, address, status, areas }) {
  const me = activeProfile();
  const cleanAreas = (areas ?? []).map((a) => a.trim()).filter(Boolean);
  const p = {
    id: uuid(),
    name: (name || "").trim(),
    address: (address || "").trim() || null,
    status: status || "active",
    areas: cleanAreas.length ? cleanAreas : null,
    owner_id: me?.worker_id ?? null,
    created_by: me?.display_name ?? null,
    created_at: new Date().toISOString(),
  };
  state.owned_projects = [p, ...(state.owned_projects ?? [])];
  await setCurrentProject(p); // persists
  return p;
}

// The area tag list for the current project: the manager's configured areas if
// they set any, otherwise the phase/name-derived residential fallback. Used by
// every capture form so area tagging always comes from a constrained list.
export function currentAreas() {
  const cur = state?.current_project;
  const owned = (state?.owned_projects ?? []).find((p) => p.id === cur?.id);
  if (owned?.areas?.length) return owned.areas;
  return areasFor(cur?.name);
}

// Crew joins a manager's list by code. Resolves the code to a profile on this
// device (sync resolves it server-side once the backend lands).
export async function joinByCode(rawCode) {
  const me = activeProfile();
  if (!me) return { ok: false, reason: "no_profile" };
  const code = String(rawCode || "").trim().toUpperCase();
  const owner = (state.profiles ?? []).find(
    (p) => p.worker_id !== me.worker_id && p.role === "site_manager" && shareCodeFor(p.worker_id) === code
  );
  if (!owner) return { ok: false, reason: "not_found" };
  me.joined_owner_ids = Array.from(new Set([...(me.joined_owner_ids ?? []), owner.worker_id]));
  await persist();
  const projects = (state.owned_projects ?? []).filter((p) => p.owner_id === owner.worker_id);
  return { ok: true, owner: owner.display_name, code, projects };
}

export async function saveSettings(patch) {
  state.settings = { ...state.settings, ...patch };
  await persist();
  return state.settings;
}

// ------------------------------------------------------------------ profiles
export async function createProfile({ worker_id, display_name, default_trade, lang, selfie_uri, phone, phone_verified, role, gc }) {
  const p = {
    // worker_id may be pre-allocated (OTP signup) so the local profile matches
    // the server-side worker_registrations row; otherwise generate one.
    worker_id: worker_id ?? uuid(),
    display_name,
    default_trade: default_trade ?? null,
    preferred_language: lang ?? "en",
    selfie_uri: selfie_uri ?? null,
    phone: phone ?? null,          // OTP-verified when phone_verified is true
    phone_verified: phone_verified ?? false,
    // schema §4.8 role — drives which interface the worker gets (site
    // managers run the daily log; crew log their own hours + photos).
    role: role ?? "journeyman",
    // Team linkage: workers register under a GC's standing code — the GC's
    // consent is what makes their crew's capture legitimate.
    gc_account_id: gc?.gc_account_id ?? null,
    gc_code: gc?.gc_code ?? null,
    gc_business: gc?.business_name ?? null,
    active: true,
    created_at: new Date().toISOString(),
  };
  state.profiles.push(p);
  return await logIn(p.worker_id);
}

// Cross-device login: restore a phone-verified account from the server onto this
// device and log into it. The selfie stays on the original device (privacy +
// size) — the worker re-takes it here if they want a face on the crew log.
export async function restoreProfile(account, phone) {
  const existing = state.profiles.find((x) => x.worker_id === account.worker_id);
  if (existing) {
    existing.phone_verified = true;
    if (phone && !existing.phone) existing.phone = phone;
    return await logIn(existing.worker_id);
  }
  const p = {
    worker_id: account.worker_id,
    display_name: account.display_name,
    default_trade: account.trade ?? null,
    preferred_language: state.settings.lang ?? "en",
    selfie_uri: null,
    phone: phone ?? null,
    phone_verified: true,
    role: account.role ?? "journeyman",
    gc_account_id: account.gc_account_id ?? null,
    gc_code: account.gc_code ?? null,
    gc_business: account.gc_business ?? null,
    active: true,
    created_at: new Date().toISOString(),
  };
  state.profiles.push(p);
  return await logIn(p.worker_id);
}

// GC session — set after gc-account register/login; cleared never (the code
// is standing and the GC finds it in their profile).
export async function setGcAccount(acct) {
  state.gc_account = acct;
  await persist();
  return acct;
}

export function gcAccount() {
  return state?.gc_account ?? null;
}

export async function logIn(worker_id) {
  const p = state.profiles.find((x) => x.worker_id === worker_id);
  if (!p) return null;
  state.active_worker_id = worker_id;
  state.settings.recorded_by = p.display_name;
  state.settings.lang = p.preferred_language ?? state.settings.lang;
  applyProfileContext(); // restore this worker's own current project + recents
  await persist();
  return p;
}

export async function logOut() {
  state.active_worker_id = null;
  applyProfileContext(); // no active worker → clear the mirror
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
  // Remember the worker's rate — crews type it once, not every day.
  if (entry.kind === "labor" && entry.hourly_rate != null) {
    state.settings.lastRate = String(entry.hourly_rate);
  }
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
  // Correcting a locked day marks it amended (PRD §5.1), same as adding to one.
  const day = state.days[dayKey(next.work_date)];
  if (day && day.status === "submitted") day.status = "amended";
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
// crews snap now, the site manager fills in details at end of day). Clearing
// synced_at re-queues an already-synced photo so the link reaches the server
// (merge upsert on photo_id updates line_id in place).
export async function linkPhoto(photo_id, line_id) {
  const p = state.photos.find((x) => x.photo_id === photo_id);
  if (p) {
    p.line_id = line_id;
    p.synced_at = null;
    await persist();
  }
  return p;
}

// SF-02 — file an incident / near-miss. Every role can; nothing about it is
// gated on the site manager's day, and it deliberately does NOT flip the day to
// "amended" (a safety report is not an edit to the cost log). Append-only like
// everything else: a correction would arrive as a new row with `supersedes`.
export async function addIncident(inc) {
  const me = activeProfile();
  const rec = stamp({
    incident_id: uuid(),
    reported_by: me?.display_name ?? state.settings.recorded_by ?? "unknown",
    reporter_worker_id: me?.worker_id ?? null,
    ...inc,
  });
  state.incidents.push(rec);
  await persist();
  return rec;
}

// Incidents for a day on the current project. Everyone sees the site's safety
// record — an incident is not private the way another worker's wage is.
export function incidentsFor(work_date) {
  const pid = state.current_project?.id;
  return (state.incidents ?? []).filter(
    (i) => i.work_date === work_date && !i.superseded_by && i.project_id === pid
  );
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

// The current (non-superseded) line by id — used to prefill the edit form.
export function lineById(line_id) {
  return state.lines.find((l) => l.line_id === line_id && !l.superseded_by) ?? null;
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
    state.change_orders.filter((c) => !c.synced_at).length +
    (state.incidents ?? []).filter((i) => !i.synced_at).length
  );
}

// ------------------------------------------------------------------- syncing
// Unsynced rows grouped the way sync-field-log wants them: one call per
// project, lines split into items vs labor. Photos go separately (binary
// payloads travel in small chunks — see sync.js).
export function pendingByProject() {
  const groups = {};
  const g = (pid) =>
    (groups[pid] ??= { days: [], items: [], labor: [], change_orders: [], incidents: [] });
  for (const l of state.lines.filter((x) => !x.synced_at && x.project_id)) {
    g(l.project_id)[l.kind === "labor" ? "labor" : "items"].push(l);
  }
  for (const c of state.change_orders.filter((x) => !x.synced_at && x.project_id)) {
    g(c.project_id).change_orders.push(c);
  }
  for (const i of (state.incidents ?? []).filter((x) => !x.synced_at && x.project_id)) {
    g(i.project_id).incidents.push(i);
  }
  // Day statuses ride along for any project already being synced (idempotent
  // upsert server-side, so re-sending submit status every time is harmless).
  for (const [key, day] of Object.entries(state.days)) {
    const i = key.indexOf(":");
    const pid = key.slice(0, i);
    if (groups[pid]) groups[pid].days.push({ work_date: key.slice(i + 1), ...day });
  }
  return groups;
}

export function pendingPhotosByProject() {
  const groups = {};
  for (const p of state.photos.filter((x) => !x.synced_at && x.project_id)) {
    (groups[p.project_id] ??= []).push(p);
  }
  return groups;
}

// Stamp synced_at on the ids the server echoed back; anything it didn't echo
// stays pending and rides the next sync.
export async function markSynced(echo, ts) {
  const items = new Set([...(echo?.items ?? []), ...(echo?.labor ?? [])]);
  const photos = new Set(echo?.photos ?? []);
  const cos = new Set(echo?.change_orders ?? []);
  const incs = new Set(echo?.incidents ?? []);
  for (const l of state.lines) if (items.has(l.line_id)) l.synced_at = ts;
  for (const p of state.photos) if (photos.has(p.photo_id)) p.synced_at = ts;
  for (const c of state.change_orders) if (cos.has(c.co_id)) c.synced_at = ts;
  for (const i of state.incidents ?? []) if (incs.has(i.incident_id)) i.synced_at = ts;
  await persist();
}

function totalsOf(lines) {
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

export function todayTotals(work_date = todayStr()) {
  return totalsOf(activeLines(work_date));
}

// Role-scoped ledger for the Today surface. Crew see only their OWN labor —
// their hours and their wage, nothing about other workers, and no material
// lines (materials and costs are the site manager's view). Site managers see
// the whole day. This is a *view* filter only; activeLines/todayTotals stay
// complete for Review, warnings, and sync.
export function visibleLines(work_date) {
  const all = activeLines(work_date);
  const me = activeProfile();
  if (me?.role === "site_manager") return all;
  const name = me?.display_name;
  return all.filter((l) => l.kind === "labor" && l.worker === name);
}

export function visibleTotals(work_date = todayStr()) {
  return totalsOf(visibleLines(work_date));
}

export function nextPhotoSeq(work_date) {
  return photosFor(work_date).length + 1;
}

// The 7 dates (Mon…Sun) of the calendar week containing `refStr`.
function weekDays(refStr) {
  const d = new Date(refStr + "T12:00:00");
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  const base = new Date(d);
  base.setDate(d.getDate() - dow);
  const p = (n) => String(n).padStart(2, "0");
  const out = [];
  for (let i = 0; i < 7; i++) {
    const x = new Date(base);
    x.setDate(base.getDate() + i);
    out.push(`${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`);
  }
  return out;
}

// Did the active worker log any of their own hours today? Drives the end-of-day
// reminder (CS-02) — no nudge once they've logged.
export function loggedLaborToday(refDate = todayStr()) {
  const name = activeProfile()?.display_name;
  return state.lines.some(
    (l) => l.kind === "labor" && !l.superseded_by && l.worker === name && l.work_date === refDate && Number(l.hours || 0) > 0
  );
}

// OV-01 — who on my crew hasn't logged today. The roster is the crew profiles
// this device knows to be on my team: journeymen who joined my share code, or
// who registered under the same GC team account. "Logged" = at least one labor
// line for the current project today, matched by worker name (the app's identity
// key). Device-local for now; the same shape fills from the server once roster
// sync lands. Site-manager only.
export function crewLogStatus(refDate = todayStr()) {
  const me = activeProfile();
  const pid = state.current_project?.id;
  if (!me || me.role !== "site_manager") return { logged: [], missing: [], total: 0, loggedCount: 0 };
  const roster = (state.profiles ?? []).filter(
    (p) =>
      p.role === "journeyman" &&
      p.worker_id !== me.worker_id &&
      ((p.joined_owner_ids ?? []).includes(me.worker_id) || (p.gc_account_id && p.gc_account_id === me.gc_account_id))
  );
  const hoursFor = (name) =>
    state.lines
      .filter((l) => l.kind === "labor" && !l.superseded_by && l.worker === name && l.project_id === pid && l.work_date === refDate)
      .reduce((sum, l) => sum + Number(l.hours || 0), 0);
  const logged = [];
  const missing = [];
  for (const p of roster) {
    const hours = hoursFor(p.display_name);
    const row = { worker_id: p.worker_id, name: p.display_name, trade: p.default_trade, selfie: p.selfie_uri, hours };
    (hours > 0 ? logged : missing).push(row);
  }
  logged.sort((a, b) => b.hours - a.hours);
  missing.sort((a, b) => a.name.localeCompare(b.name));
  return { logged, missing, total: roster.length, loggedCount: logged.length };
}

// The active worker's own hours for the week containing refDate — the thing the
// crew gets back for logging (CS-01). Across ALL their projects (a pay week is
// not per-job); active versions only, grouped by day, hour type, and project.
export function myWeekHours(refDate = todayStr()) {
  const name = activeProfile()?.display_name;
  const days = weekDays(refDate);
  const idx = Object.fromEntries(days.map((d, i) => [d, i]));
  const rows = days.map((date) => ({ date, hours: 0 }));
  const byType = { regular: 0, overtime: 0, rework: 0 };
  const byProject = {};
  let total = 0;
  for (const l of state.lines) {
    if (l.kind !== "labor" || l.superseded_by || l.worker !== name) continue;
    if (!(l.work_date in idx)) continue;
    const h = Number(l.hours || 0);
    total += h;
    rows[idx[l.work_date]].hours += h;
    if (byType[l.hour_type] != null) byType[l.hour_type] += h;
    const key = l.project_name || l.project_id || "—";
    byProject[key] = (byProject[key] || 0) + h;
  }
  return { days: rows, total, byType, byProject };
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
