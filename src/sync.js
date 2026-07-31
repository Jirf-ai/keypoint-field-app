// Background reconciliation (Tech Eval §6): push unsynced local rows to the
// sync-field-log engine function. Sync is NEVER a precondition for capture —
// it runs after the fact, silently, and simply retries whatever the server
// didn't acknowledge. Single-flight so overlapping triggers (app open, back
// to Today, badge tap, submit) collapse into one run.
//
// Server-side the daily-log table is field_daily_logs (plain field_logs is
// the legacy video-log table) — but this module never needs to know; it just
// speaks the sync-field-log request shape.
import { File } from "expo-file-system";
import NetInfo from "@react-native-community/netinfo";
import { call } from "./api";
import {
  getSettings,
  markSynced,
  pendingByProject,
  pendingCount,
  pendingPhotosByProject,
} from "./store";

const PHOTO_CHUNK = 3; // ~0.5MB each at quality 0.6 → keeps requests small

let inFlight = null;

// Sync-activity feed for the UI: fires on start, after every acknowledged
// chunk, and on finish — the Today badge counts down live and shows the
// "updating" spinner while a drain is running, so a crew member knows the
// app is working and not done (Jeffrey, 2026-07-30).
const listeners = new Set();
export function onSyncActivity(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
export function isSyncing() {
  return !!inFlight;
}
function ping() {
  for (const cb of [...listeners]) {
    try { cb(); } catch { /* UI callback must never kill a sync */ }
  }
}

export function syncNow() {
  if (!inFlight) {
    inFlight = run()
      .catch(() => pendingCount()) // offline / server down: try again later
      .finally(() => {
        inFlight = null;
        ping();
      });
    ping();
  }
  return inFlight;
}

async function run() {
  // Rows first (cheap, one call per project)…
  for (const [project_id, g] of Object.entries(pendingByProject())) {
    const res = await call("sync-field-log", {
      project_id,
      days: g.days,
      items: g.items.map(stripLocal),
      labor: g.labor.map(stripLocal),
      change_orders: g.change_orders.map(stripLocal),
      // Incidents ride the rows pass (before photos) so an incident photo's
      // incident_id FK resolves server-side on the very next chunk.
      incidents: g.incidents.map(stripLocal),
    });
    if (res.ok && res.synced) { await markSynced(res.synced, res.synced_at); ping(); }
    else if (!res.ok) throw new Error(`sync ${res.status}`);
  }
  // Wi-Fi-only gate (PRD §9.1 — crew personal data plans). Rows synced above are
  // tiny; photos are the bandwidth cost. If the crew opted into Wi-Fi-only and
  // we're on cellular, hold the photos — they stay pending and ride the next
  // sync once there's Wi-Fi. No data is lost, only deferred.
  if (getSettings().wifiOnlyPhotos && (await onCellular())) return pendingCount();

  // …then photos, binary included, a few at a time.
  for (const [project_id, photos] of Object.entries(pendingPhotosByProject())) {
    for (let i = 0; i < photos.length; i += PHOTO_CHUNK) {
      const chunk = await Promise.all(photos.slice(i, i + PHOTO_CHUNK).map(photoPayload));
      const res = await call("sync-field-log", { project_id, photos: chunk });
      if (res.ok && res.synced) { await markSynced(res.synced, res.synced_at); ping(); }
      else if (!res.ok) throw new Error(`sync ${res.status}`);
    }
  }
  return pendingCount();
}

// True only when we're sure the connection is cellular — unknown/wifi/ethernet
// (and web, where there's no cellular concept) never hold photos back.
async function onCellular() {
  try {
    const st = await NetInfo.fetch();
    return st?.type === "cellular";
  } catch {
    return false;
  }
}

// Client rows carry local-only fields; the server whitelists anyway, but the
// photo `uri` in particular can be a multi-MB data URI — never send it raw.
function stripLocal(r) {
  const { kind, project_name, superseded_by, synced_at, uri, ...rest } = r;
  return rest;
}

async function photoPayload(p) {
  const row = stripLocal(p);
  // Tombstone: no pixels travel with a deletion — the server removes its
  // storage object and stamps deleted_at.
  if (p.deleted) return row;
  const b64 = await readB64(p.uri);
  if (b64) row.b64 = b64;
  // No recoverable binary (dead blob: URI etc.) → sync metadata alone; the
  // record surviving beats losing the row along with the pixels.
  return row;
}

async function readB64(uri) {
  if (!uri) return null;
  if (uri.startsWith("data:")) return uri; // web store keeps data URIs
  try {
    const f = new File(uri);
    return f.base64Sync ? f.base64Sync() : await f.base64();
  } catch {
    return null;
  }
}
