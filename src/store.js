// Local-first store (Tech Eval §6): every write commits to AsyncStorage
// immediately and unconditionally. Sync is a future background reconciliation
// (Supabase tables land as BOBAI engine work) — never a precondition for
// capture. Append-only: corrections write a new version pointing at the old
// one via `supersedes`; nothing is destroyed. Client-generated ids make future
// sync idempotent.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { call } from "./api";
import { areasFor, todayStr } from "./schema";
import { lastLocation } from "./location";
import { clearPixels, deletePixels, getPixels, putPixels } from "./photoStore";
import { shrinkDataUri } from "./util";

const KEY = "kaicon-field:v1";

// Web pixel vault (2026-07-31): photo binaries live in IndexedDB (photoStore),
// the blob carries "idb:<photo_id>" sentinels. In MEMORY a photo's uri is
// always the real data URI (hydrated at load) so every consumer — thumbnails,
// viewer, sync's readB64 — is untouched. The set tracks which photos are
// confirmed in the vault; only those get sentinel-ized at persist, so a failed
// vault write falls back to inlining (the pre-vault behavior).
const IDB_PREFIX = "idb:";
const pixelsInIdb = new Set();

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
  // Batch-capture crash net (2026-08-01): picked-but-not-yet-uploaded photos.
  // Survive a force-quit / page reload; discarded on any NORMAL exit from the
  // photo screen, so the visible Upload-commits contract is unchanged.
  photo_drafts: [],   // { draft_id, work_date, project_id, uri, picked_at }
  change_orders: [],
  incidents: [],      // SF-02 safety records — any role, append-only
  // Start Day / End Day (2026-07-31): append-only clock events, the worker's
  // attendance stamps. Ride the sync spine like every other row
  // (field_clock_events server-side).
  clock_events: [],   // { clock_id, event: 'start'|'end', work_date, worker_id, at }
  // Server team roster (worker_registrations under our GC), cached so the
  // record-for-someone-else picker works offline. Refreshed opportunistically.
  team_roster: [],    // { worker_id, display_name, role, trade }
  days: {},           // `${project_id}:${work_date}` -> {status, submitted_at, submitted_by}
  settings: { lang: "en", recorded_by: "", lastPhase: null, lastArea: null, wifiOnlyPhotos: false, remindEndOfDay: false, reminderTime: "17:00", remindStartOfDay: false, startReminderTime: "06:30" },
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
  await hydratePixels();
  // WEB: ask the browser to mark this origin's storage PERSISTENT — a pilot
  // phone filling up with other apps' data must not evict our blob + pixel
  // vault (eviction is the "app reset" behind the timer/photo losses).
  // Chrome grants silently for installed PWAs; best-effort everywhere else.
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    try { navigator.storage?.persist?.().catch(() => {}); } catch { /* old browser */ }
  }
  return state;
}

// Web: rehydrate vault sentinels into memory, and migrate legacy inline data
// URIs INTO the vault so the next persist writes a pixel-free blob. Fail-soft
// throughout — a missing vault entry degrades to a blank thumbnail, never a
// lost record (the metadata row survives, and the server may hold the binary).
async function hydratePixels() {
  if (Platform.OS !== "web") return;
  // Drafts ride the same vault, keyed by draft_id.
  const rows = [
    ...state.photos.map((p) => [p, p.photo_id]),
    ...(state.photo_drafts ?? []).map((d) => [d, d.draft_id]),
  ];
  for (const [p, id] of rows) {
    if (typeof p.uri !== "string") continue;
    if (p.uri.startsWith(IDB_PREFIX)) {
      const pix = await getPixels(id);
      if (pix) {
        p.uri = pix;
        pixelsInIdb.add(id);
      }
    } else if (p.uri.startsWith("data:image")) {
      if (await putPixels(id, p.uri)) pixelsInIdb.add(id);
    }
  }
}

// The blob written to AsyncStorage: same state, minus pixels that are safely
// in the vault. Profile selfies stay inline on purpose (small, identity).
function blobSnapshot() {
  if (Platform.OS !== "web") return state;
  const sentinel = (row, id) =>
    pixelsInIdb.has(id) && typeof row.uri === "string" && row.uri.startsWith("data:image")
      ? { ...row, uri: IDB_PREFIX + id }
      : row;
  return {
    ...state,
    photos: state.photos.map((p) => sentinel(p, p.photo_id)),
    photo_drafts: (state.photo_drafts ?? []).map((d) => sentinel(d, d.draft_id)),
  };
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
    await AsyncStorage.setItem(KEY, JSON.stringify(blobSnapshot()));
  } catch {
    // Never throw out of a capture path. The in-memory copy stays valid and the
    // next successful persist writes everything (single-blob store).
    //
    // WEB: with pixels in the IndexedDB vault the blob is small, so quota
    // failures should be rare — but a vault-less browser still inlines
    // pixels, so keep the old rescue: shed image weight and retry (synced
    // photos first — the server already holds their binary).
    if (Platform.OS !== "web") return;
    if (await shedPhotoWeight()) {
      try {
        await AsyncStorage.setItem(KEY, JSON.stringify(blobSnapshot()));
      } catch (e) {
        console.error("field-store: persist still failing after photo shrink", e);
      }
    }
  }
}

// WEB: the debounced write above trades 250ms of exposure for a smooth UI —
// but a tap followed immediately by pocketing the phone (punch-in, lock) can
// kill the tab before the timeout fires, and the write is gone. Flush the
// pending write the moment the page hides; pagehide + visibilitychange cover
// lock screen, tab switch, and home button.
if (Platform.OS === "web" && typeof window !== "undefined") {
  const flush = () => {
    if (!persist._t) return;
    clearTimeout(persist._t);
    persist._t = null;
    doPersist();
  };
  window.addEventListener("pagehide", flush);
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
  }
}

async function shedPhotoWeight() {
  let changed = false;
  // Drafts count as unsynced (they're the only copy in existence).
  const rows = [
    ...state.photos.map((p) => [p, p.photo_id, !!p.synced_at]),
    ...(state.photo_drafts ?? []).map((d) => [d, d.draft_id, false]),
  ];
  for (const [p, id, synced] of rows) {
    if (typeof p.uri !== "string" || !p.uri.startsWith("data:image")) continue;
    // Synced → a thumbnail is all the phone still owes the user. Unsynced →
    // the binary is still the only copy in existence; shrink, never drop.
    const smaller = synced
      ? await shrinkDataUri(p.uri, 320, 0.5)
      : await shrinkDataUri(p.uri, 1024, 0.55);
    if (smaller) {
      p.uri = smaller;
      changed = true;
      // Keep the vault copy in step with the shrunk in-memory copy.
      if (pixelsInIdb.has(id)) await putPixels(id, smaller);
    }
  }
  return changed;
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
  // The server remembers every pick (worker-auth v7 field_worker_projects) so
  // a wipe + phone restore reseeds the drawer — the list used to be
  // device-local and vanished with the device data (Jeffrey 2026-07-31).
  // Fire-and-forget: an offline pick is simply remembered next time.
  if (me?.worker_id && p.id) {
    call("worker-auth", { action: "remember-project", worker_id: me.worker_id, project_id: p.id }).catch(() => {});
  }
  return state.current_project;
}

// Reseed after a phone-number account restore: the server's project memory
// (my-projects, most-recent first) refills the drawer and lands the worker on
// the project they last worked — no re-searching (Jeffrey 2026-07-31).
export async function seedRestoredProjects(projects) {
  const me = activeProfile();
  const rows = (projects ?? []).map((p) => ({ id: p.id, name: p.name, status: p.status ?? null }));
  if (!me || rows.length === 0) return;
  if (me.role === "site_manager") {
    // SMs get real list rows back (copy-code chip, ✕ housekeeping).
    const owned = state.owned_projects ?? (state.owned_projects = []);
    for (const r of rows) {
      if (!owned.find((x) => x.id === r.id)) {
        owned.push({ ...r, address: null, areas: null, owner_id: me.worker_id, created_by: me.display_name, created_at: new Date().toISOString() });
      }
    }
  }
  // Everyone gets their recents back; crew's drawer list rides on these.
  state.recent_projects = [
    ...rows,
    ...(state.recent_projects ?? []).filter((x) => !rows.find((r) => r.id === x.id)),
  ].slice(0, RECENTS_MAX);
  me.recent_projects = state.recent_projects;
  await setCurrentProject(rows[0]); // persists
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

// Punctuation-blind code key: crew type letters/numbers only — "KP8E79",
// "kp 8e79" and "KP-8E79" all match (workers shouldn't need the hyphen key).
function codeKey(s) {
  return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Resolve a share code to its site-manager profile without mutating anything —
// used to validate a crew member's code at signup before the account exists.
export function resolveShareCode(rawCode) {
  const code = codeKey(rawCode);
  return (state?.profiles ?? []).find((p) => p.role === "site_manager" && codeKey(shareCodeFor(p.worker_id)) === code) ?? null;
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
export async function addOwnedProject({ id, name, address, status, areas }) {
  const me = activeProfile();
  const cleanAreas = (areas ?? []).map((a) => a.trim()).filter(Boolean);
  // Projects are CONFIRMED against Records, never invented on-device (Jeffrey
  // 2026-07-30): `id` is the Records uuid, so every captured line reconciles
  // server-side. Re-confirming an already-listed project just updates it.
  const existing = id ? (state.owned_projects ?? []).find((x) => x.id === id) : null;
  if (existing) {
    if (cleanAreas.length) existing.areas = cleanAreas;
    await setCurrentProject(existing); // persists
    return existing;
  }
  const p = {
    id: id ?? uuid(),
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

// Remove a project from THIS account's list (drawer housekeeping — Jeffrey
// 2026-07-30: finished jobs get tidied away). Local-list only: everything
// submitted stays on the server, and the project comes back via search.
export async function removeProjectFromList(project_id) {
  state.owned_projects = (state.owned_projects ?? []).filter((p) => p.id !== project_id);
  state.recent_projects = (state.recent_projects ?? []).filter((p) => p.id !== project_id);
  const me = activeProfile();
  if (me) {
    me.recent_projects = state.recent_projects;
    if (me.current_project?.id === project_id) me.current_project = null;
  }
  if (state.current_project?.id === project_id) state.current_project = null;
  await persist();
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
  const code = codeKey(rawCode);
  const owner = (state.profiles ?? []).find(
    (p) => p.worker_id !== me.worker_id && p.role === "site_manager" && codeKey(shareCodeFor(p.worker_id)) === code
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

// Wipe EVERYTHING this device holds — profiles, projects, captured lines/photos,
// settings — and drop the persisted blob. For handing a test/demo device to the
// next person, or a factory reset. Cancels any pending debounced web write so it
// can't resurrect the old blob, then writes the empty state immediately. Fresh
// deep-cloned EMPTY so no array/object is shared with the constant.
export async function clearAllLocal() {
  clearTimeout(persist._t);
  state = JSON.parse(JSON.stringify(EMPTY));
  applyProfileContext();
  pixelsInIdb.clear();
  await clearPixels(); // wipe the pixel vault along with the blob
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Best effort — the in-memory reset already makes the app act fresh; the next
    // persist overwrites the blob with the empty state anyway.
  }
  return state;
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
  // Vault the pixels BEFORE the blob write — only a confirmed vault copy lets
  // persist swap the uri for a sentinel; otherwise it inlines (old behavior).
  if (Platform.OS === "web" && typeof p.uri === "string" && p.uri.startsWith("data:image")) {
    if (await putPixels(p.photo_id, p.uri)) pixelsInIdb.add(p.photo_id);
  }
  state.photos.push(p);
  // A photo added to a submitted day is new record too — mark the day
  // amended so "Submit more!" lights back up (Jeffrey 2026-07-30).
  const day = state.days[dayKey(p.work_date)];
  if (day && day.status === "submitted") day.status = "amended";
  await persist();
  return p;
}

// Fix a photo's tags after the fact (crew proof strip, Jeffrey 2026-07-31):
// caption / phase / area only — the pixels are evidence and never change.
// Clearing synced_at re-queues it so the server copy carries the new tags
// (same merge-upsert-on-photo_id path linkPhoto uses). Editing a submitted
// day's photo marks the day amended, same as adding one.
export async function updatePhotoMeta(photo_id, { caption, phase, area, photo_kind }) {
  const p = state.photos.find((x) => x.photo_id === photo_id);
  if (!p) return null;
  if (caption !== undefined) p.caption = caption?.trim() || null;
  if (phase !== undefined) p.phase = phase;
  if (area !== undefined) p.area = area;
  if (photo_kind !== undefined) p.photo_kind = photo_kind;
  p.synced_at = null;
  const day = state.days[dayKey(p.work_date)];
  if (day && day.status === "submitted") day.status = "amended";
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

// ---------------------------------------------------------- photo drafts
// Crash net for batch capture (2026-08-01): picked photos used to live only
// in component state until the explicit Upload tap — answering a call could
// reload the PWA and eat the whole batch. Drafts persist the picked pixels
// immediately; the photo screen restores them on its next mount. The visible
// contract is UNCHANGED: Upload commits, ✕ / Cancel / leaving the screen
// discards (the screen clears drafts on unmount) — only an unexpected death
// (force-quit, reload, eviction) leaves them behind to be recovered.
export async function addPhotoDrafts(work_date, uris) {
  const rows = [];
  for (const uri of uris) {
    const d = {
      draft_id: uuid(),
      work_date,
      project_id: state.current_project?.id ?? null,
      uri,
      picked_at: new Date().toISOString(),
    };
    if (Platform.OS === "web" && typeof uri === "string" && uri.startsWith("data:image")) {
      if (await putPixels(d.draft_id, uri)) pixelsInIdb.add(d.draft_id);
    }
    rows.push(d);
  }
  state.photo_drafts = [...(state.photo_drafts ?? []), ...rows];
  await persist();
  return rows;
}

export function photoDrafts(work_date) {
  const pid = state?.current_project?.id ?? null;
  return (state?.photo_drafts ?? []).filter((d) => d.work_date === work_date && d.project_id === pid);
}

export async function removePhotoDraft(draft_id) {
  state.photo_drafts = (state.photo_drafts ?? []).filter((d) => d.draft_id !== draft_id);
  pixelsInIdb.delete(draft_id);
  await deletePixels(draft_id);
  await persist();
}

export async function clearPhotoDrafts(work_date) {
  const pid = state?.current_project?.id ?? null;
  const gone = (state?.photo_drafts ?? []).filter((d) => d.work_date === work_date && d.project_id === pid);
  if (!gone.length) return;
  const goneIds = new Set(gone.map((d) => d.draft_id));
  state.photo_drafts = state.photo_drafts.filter((d) => !goneIds.has(d.draft_id));
  for (const id of goneIds) {
    pixelsInIdb.delete(id);
    await deletePixels(id);
  }
  await persist();
}

// ------------------------------------------------------- multi-context merge
// WEB: an installed PWA and a browser tab (Android Chrome shares profile
// storage) both hold this blob IN MEMORY and write it whole — the last writer
// used to clobber rows the other context appended. The `storage` event fires
// here whenever ANOTHER context writes the key: adopt every append-only row
// we don't have (ids are client UUIDs, so a union is always safe) plus any
// sync/supersede/tombstone stamps we're missing; our next persist then
// carries both sides. Never deletes, never overwrites newer with older.
export async function mergeExternalState(ext) {
  if (!state || !ext || typeof ext !== "object") return false;
  let changed = false;
  const unions = [
    ["lines", "line_id"],
    ["photos", "photo_id"],
    ["photo_drafts", "draft_id"],
    ["change_orders", "co_id"],
    ["incidents", "incident_id"],
    ["clock_events", "clock_id"],
    ["profiles", "worker_id"],
  ];
  for (const [key, idKey] of unions) {
    const theirs = Array.isArray(ext[key]) ? ext[key] : [];
    if (!theirs.length) continue;
    const ours = state[key] ?? (state[key] = []);
    const byId = new Map(ours.map((r) => [r[idKey], r]));
    for (const row of theirs) {
      const id = row?.[idKey];
      if (!id) continue;
      const mine = byId.get(id);
      if (!mine) {
        ours.push(row);
        byId.set(id, row);
        changed = true;
        continue;
      }
      // Same row on both sides: adopt one-way stamps we're missing.
      if (!mine.synced_at && row.synced_at) { mine.synced_at = row.synced_at; changed = true; }
      if (!mine.superseded_by && row.superseded_by) { mine.superseded_by = row.superseded_by; changed = true; }
      if (row.deleted && !mine.deleted) { mine.deleted = true; mine.uri = null; mine.line_id = null; changed = true; }
    }
  }
  // Day statuses: adopt entries we lack; a submit beats our lingering draft.
  for (const [k, day] of Object.entries(ext.days ?? {})) {
    const mine = state.days[k];
    if (!mine) { state.days[k] = day; changed = true; }
    else if (mine.status === "draft" && day?.status && day.status !== "draft") { state.days[k] = day; changed = true; }
  }
  if (changed) await persist();
  return changed;
}

if (Platform.OS === "web" && typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key !== KEY || !e.newValue || !state) return;
    try {
      mergeExternalState(JSON.parse(e.newValue)).then((changed) => {
        // Adopted photos may carry idb: sentinels — the vault is shared, so
        // hydrate them into real pixels for thumbnails and sync.
        if (changed) hydratePixels();
      });
    } catch { /* a torn write parses as garbage — our copy stands */ }
  });
}

// ------------------------------------------------------------------ day clock
// Start Day / End Day: hours come solely from these stamps (schema CLOCK_POLICY
// turns a span into a labor line at End Day — see EndDayScreen). Append-only
// like everything else; the start stamp is attendance evidence in its own right
// even if the day is never confirmed.
export async function clockStart(work_date) {
  const me = activeProfile();
  const ev = stamp({
    clock_id: uuid(),
    event: "start",
    work_date,
    worker_id: me?.worker_id ?? null,
    worker: me?.display_name ?? state.settings.recorded_by ?? "unknown",
    at: new Date().toISOString(),
  });
  state.clock_events = [...(state.clock_events ?? []), ev];
  await persist();
  return ev;
}

export async function clockEnd(startEvent) {
  const ev = stamp({
    clock_id: uuid(),
    event: "end",
    work_date: startEvent.work_date, // a forgotten clock closes on ITS day, not today
    worker_id: startEvent.worker_id,
    worker: startEvent.worker,
    starts: startEvent.clock_id,
    at: new Date().toISOString(),
  });
  // An overnight forget means state.current_project may have moved on; the end
  // stamp must land on the project the start opened.
  ev.project_id = startEvent.project_id;
  ev.project_name = startEvent.project_name;
  state.clock_events = [...(state.clock_events ?? []), ev];
  await persist();
  return ev;
}

// The active worker's dangling start on the current project — today's, or an
// older one they forgot to close (oldest first, so forgotten days resolve in
// order before today can start). Null when nothing is running.
export function openClock() {
  const me = activeProfile();
  const pid = state.current_project?.id;
  if (!me || !pid) return null;
  const evs = (state.clock_events ?? []).filter(
    (e) => e.worker_id === me.worker_id && e.project_id === pid
  );
  const closed = new Set(evs.filter((e) => e.event === "end").map((e) => e.starts));
  const open = evs.filter((e) => e.event === "start" && !closed.has(e.clock_id));
  open.sort((a, b) => (a.at < b.at ? -1 : 1));
  return open[0] ?? null;
}

// Server → device rehydration (2026-08-01): a wiped/evicted device loses
// clock_events with the rest of the blob, so a worker who logged back in saw
// their running punch-in "reset" — while the server (field_clock_events) still
// held the open start. Merge the server's stamps back in: dedupe on clock_id,
// and arrivals are stamped synced (they ARE the server copy — they must never
// re-enter the pending queue). The timer resumes from the original `at`.
export async function mergeClockEvents(rows) {
  const evs = state.clock_events ?? (state.clock_events = []);
  const have = new Set(evs.map((e) => e.clock_id));
  let added = 0;
  for (const r of rows ?? []) {
    if (!r?.clock_id || have.has(r.clock_id)) continue;
    if (r.event !== "start" && r.event !== "end") continue;
    evs.push({
      clock_id: r.clock_id,
      event: r.event,
      work_date: r.work_date,
      worker_id: r.worker_id,
      worker: r.worker_name ?? activeProfile()?.display_name ?? null,
      starts: r.starts ?? null,
      at: r.at,
      project_id: r.project_id ?? null,
      project_name: r.project_name ?? null,
      recorded_at: r.recorded_at ?? r.at,
      recorded_by: r.recorded_by ?? null,
      captured_offline: false,
      version: 1,
      supersedes: null,
      synced_at: r.at,
    });
    have.add(r.clock_id);
    added++;
  }
  if (added) await persist();
  return added;
}

// Pull the active worker's recent stamps from the server and merge. Fired on
// app launch and after a phone-number restore; best-effort — offline simply
// means the device-local view stands until the next launch.
export async function pullClockEvents(worker_id) {
  const wid = worker_id ?? activeProfile()?.worker_id;
  if (!wid) return 0;
  try {
    const r = await call("worker-auth", { action: "my-clock-events", worker_id: wid });
    if (r?.ok && Array.isArray(r.events)) return await mergeClockEvents(r.events);
  } catch { /* offline — local view stands */ }
  return 0;
}

// Server → device rehydration for the worker's OWN labor lines (2026-08-02):
// "My hours" read only device-local rows, so a wiped device — or hours
// recorded for the worker elsewhere (SM's phone, a manual re-entry) — showed
// a 0.0 week while the server held every row. Merge the server's recent rows
// for this worker: dedupe by line_id, arrivals are pre-synced, and append-only
// amend chains are honored (a row's `supersedes` marks the older version
// superseded here too, so nothing double-counts).
export async function mergeLaborLines(rows) {
  const lines = state.lines ?? (state.lines = []);
  const byId = new Map(lines.map((l) => [l.line_id, l]));
  let added = 0;
  for (const r of rows ?? []) {
    const id = r?.labor_id ?? r?.line_id;
    if (!id || byId.has(id)) continue;
    const line = {
      line_id: id,
      kind: "labor",
      cost_class: "L",
      work_date: r.work_date,
      trade: r.trade ?? null,
      worker: r.worker_name ?? r.worker ?? null,
      worker_id: r.worker_id ?? null,
      hours: Number(r.hours) || 0,
      hour_type: r.hour_type ?? "regular",
      hourly_rate: r.hourly_rate == null ? null : Number(r.hourly_rate),
      phase: r.phase ?? null,
      area: r.area ?? null,
      note: r.note ?? null,
      clock_id: r.clock_id ?? null,
      project_id: r.project_id ?? null,
      project_name: r.project_name ?? null,
      recorded_at: r.recorded_at ?? null,
      recorded_by: r.recorded_by ?? null,
      captured_offline: false,
      version: r.version ?? 1,
      supersedes: r.supersedes ?? null,
      synced_at: r.recorded_at ?? new Date().toISOString(),
    };
    lines.push(line);
    byId.set(id, line);
    added++;
  }
  if (added) {
    // Re-link amend chains across the union: any version pointing at an older
    // one marks it superseded locally, whichever side each row arrived from.
    for (const l of lines) {
      if (!l.supersedes) continue;
      const old = byId.get(l.supersedes);
      if (old && !old.superseded_by) old.superseded_by = l.line_id;
    }
    await persist();
  }
  return added;
}

// Launch/restore rehydration bundle: the worker's clock stamps AND their own
// labor lines come back together. Best-effort — offline just means the local
// view stands until the next launch.
export async function pullWorkerData(worker_id) {
  const wid = worker_id ?? activeProfile()?.worker_id;
  if (!wid) return 0;
  const [clocks, labor] = await Promise.all([
    pullClockEvents(wid),
    (async () => {
      try {
        const r = await call("worker-auth", { action: "my-labor", worker_id: wid });
        if (r?.ok && Array.isArray(r.labor)) return await mergeLaborLines(r.labor);
      } catch { /* offline — local view stands */ }
      return 0;
    })(),
  ]);
  return clocks + labor;
}

// Today's completed span for the strip's "day recorded" state. Latest pair wins.
export function clockFor(work_date) {
  const me = activeProfile();
  const pid = state.current_project?.id;
  if (!me || !pid) return null;
  const evs = (state.clock_events ?? []).filter(
    (e) => e.worker_id === me.worker_id && e.project_id === pid && e.work_date === work_date
  );
  const end = evs.filter((e) => e.event === "end").sort((a, b) => (a.at < b.at ? 1 : -1))[0];
  if (!end) return null;
  const start = evs.find((e) => e.clock_id === end.starts);
  return start ? { start, end } : null;
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
  return state.photos.filter((p) => p.work_date === work_date && p.project_id === pid && !p.deleted);
}

// Delete a shot (mistake / pocket photo — Jeffrey 2026-07-31). The pixels go
// NOW, locally and (via the tombstone the next sync sends) from the server
// bucket; the row survives with deleted_at as the audit trail but leaves
// every surface. Deleting from a submitted day marks it amended.
export async function deletePhoto(photo_id) {
  const p = state.photos.find((x) => x.photo_id === photo_id);
  if (!p) return;
  p.deleted = true;
  p.uri = null; // drop the local binary immediately
  p.line_id = null;
  p.synced_at = null; // queue the tombstone for the server
  pixelsInIdb.delete(photo_id);
  await deletePixels(photo_id); // the vault copy goes with it
  const day = state.days[dayKey(p.work_date)];
  if (day && day.status === "submitted") day.status = "amended";
  await persist();
}

export function dayStatus(work_date) {
  return state.days[dayKey(work_date)]?.status ?? "draft";
}

// Latest submission time for the day (ISO) — re-submits overwrite it, so the
// Today banner always shows the most recent send.
export function daySubmittedAt(work_date) {
  return state.days[dayKey(work_date)]?.submitted_at ?? null;
}

// ------------------------------------------------------------- team roster
export function teamRoster() {
  return state.team_roster ?? [];
}

export async function setTeamRoster(workers) {
  state.team_roster = (workers ?? []).filter((w) => w?.worker_id && w?.display_name);
  await persist();
}

export function pendingCount() {
  // Everything unsynced counts — the badge the crew watches (Tech Eval §6.3).
  return (
    state.lines.filter((l) => !l.synced_at).length +
    state.photos.filter((p) => !p.synced_at).length +
    state.change_orders.filter((c) => !c.synced_at).length +
    (state.incidents ?? []).filter((i) => !i.synced_at).length +
    (state.clock_events ?? []).filter((e) => !e.synced_at).length
  );
}

// ------------------------------------------------------------------- syncing
// Unsynced rows grouped the way sync-field-log wants them: one call per
// project, lines split into items vs labor. Photos go separately (binary
// payloads travel in small chunks — see sync.js).
export function pendingByProject() {
  const groups = {};
  const g = (pid) =>
    (groups[pid] ??= { days: [], items: [], labor: [], change_orders: [], incidents: [], clock_events: [] });
  for (const l of state.lines.filter((x) => !x.synced_at && x.project_id)) {
    g(l.project_id)[l.kind === "labor" ? "labor" : "items"].push(l);
  }
  for (const c of state.change_orders.filter((x) => !x.synced_at && x.project_id)) {
    g(c.project_id).change_orders.push(c);
  }
  for (const i of (state.incidents ?? []).filter((x) => !x.synced_at && x.project_id)) {
    g(i.project_id).incidents.push(i);
  }
  for (const e of (state.clock_events ?? []).filter((x) => !x.synced_at && x.project_id)) {
    g(e.project_id).clock_events.push(e);
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
  const clocks = new Set(echo?.clock_events ?? []);
  for (const l of state.lines) if (items.has(l.line_id)) l.synced_at = ts;
  for (const p of state.photos) if (photos.has(p.photo_id)) p.synced_at = ts;
  for (const c of state.change_orders) if (cos.has(c.co_id)) c.synced_at = ts;
  for (const i of state.incidents ?? []) if (incs.has(i.incident_id)) i.synced_at = ts;
  for (const e of state.clock_events ?? []) if (clocks.has(e.clock_id)) e.synced_at = ts;
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
  // Roster = server registrations under our GC (synced via worker-auth
  // `roster`) merged with device-local profiles; local wins on collision
  // because it carries the selfie. Server coverage means crew who registered
  // on THEIR OWN phones show up here too.
  const byId = new Map();
  for (const w of state.team_roster ?? []) {
    if (w.role === "journeyman" && w.worker_id !== me.worker_id) {
      byId.set(w.worker_id, { worker_id: w.worker_id, display_name: w.display_name, default_trade: w.trade ?? null, selfie_uri: null });
    }
  }
  for (const p of state.profiles ?? []) {
    if (
      p.role === "journeyman" &&
      p.worker_id !== me.worker_id &&
      ((p.joined_owner_ids ?? []).includes(me.worker_id) || (p.gc_account_id && p.gc_account_id === me.gc_account_id))
    ) {
      byId.set(p.worker_id, p);
    }
  }
  const roster = [...byId.values()];
  // Hours match by hard identity first (entries picked from the roster carry
  // worker_id), name-string as the fallback for typed-in workers.
  const hoursFor = (w) =>
    state.lines
      .filter(
        (l) =>
          l.kind === "labor" && !l.superseded_by && l.project_id === pid && l.work_date === refDate &&
          (l.worker_id === w.worker_id || l.worker === w.display_name)
      )
      .reduce((sum, l) => sum + Number(l.hours || 0), 0);
  const logged = [];
  const missing = [];
  for (const p of roster) {
    const hours = hoursFor(p);
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
