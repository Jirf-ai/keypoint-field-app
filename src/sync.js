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
const ROW_TIMEOUT = 30_000;    // rows are tiny — a hung request must not wedge the queue
const PHOTO_TIMEOUT = 120_000; // ~1MB photo chunks on site cellular are legitimately slow

let inFlight = null;

// The last thing that went wrong (network, server rejection) — null after a
// clean pass with an empty queue. Surfaceable in Settings if crews need it;
// today it mainly feeds console diagnostics.
let lastError = null;
export function lastSyncError() {
  return lastError;
}

// Auto-retry with backoff (30s → 5min cap): a failed pass used to sit dead
// until the next manual trigger — crews saw a stuck badge and assumed the
// app "just doesn't send". Any natural trigger clears the timer and resets
// the clock; a clean pass resets the backoff.
let retryTimer = null;
let retryDelay = 30_000;
function scheduleRetry() {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (pendingCount() > 0) syncNow();
  }, retryDelay);
  retryDelay = Math.min(retryDelay * 2, 300_000);
}

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
    if (retryTimer) {
      clearTimeout(retryTimer); // a natural trigger supersedes the backoff timer
      retryTimer = null;
    }
    inFlight = run()
      .catch(() => pendingCount()) // belt-and-braces; run() isolates its own failures
      .finally(() => {
        inFlight = null;
        ping();
      });
    ping();
  }
  return inFlight;
}

async function run() {
  let failures = 0;
  const fail = (where, detail) => {
    failures++;
    lastError = `${where}: ${detail}`;
    console.warn(`field-sync ${where}`, detail);
  };

  // Rows first (cheap, one call per project)… Each project is isolated: one
  // poisoned project (server error, dead uuid) used to abort the WHOLE run —
  // including every photo of every healthy project — forever.
  for (const [project_id, g] of Object.entries(pendingByProject())) {
    try {
      const res = await call("sync-field-log", {
        project_id,
        days: g.days,
        items: g.items.map(stripLocal),
        labor: g.labor.map(stripLocal),
        change_orders: g.change_orders.map(stripLocal),
        // Incidents ride the rows pass (before photos) so an incident photo's
        // incident_id FK resolves server-side on the very next chunk.
        incidents: g.incidents.map(stripLocal),
        // Day-clock stamps — attendance evidence, tiny rows.
        clock_events: g.clock_events.map(stripLocal),
      }, { timeoutMs: ROW_TIMEOUT });
      if (res.ok && res.synced) {
        await markSynced(res.synced, res.synced_at);
        // Per-row server rejections stay pending and retry — but silently
        // swallowing them hid real schema/FK problems for days. Say something.
        if (res.failed?.length) fail(`rows ${project_id}`, `server rejected ${res.failed.length} row(s): ${res.failed[0].kind} — ${res.failed[0].error}`);
        ping();
      } else if (!res.ok) throw new Error(`http ${res.status}`);
    } catch (e) {
      fail(`rows ${project_id}`, String(e?.message ?? e));
    }
  }

  // Wi-Fi-only gate (PRD §9.1 — crew personal data plans). Rows synced above are
  // tiny; photos are the bandwidth cost. If the crew opted into Wi-Fi-only and
  // we're on cellular, hold the photos — they stay pending and ride the next
  // sync once there's Wi-Fi. No data is lost, only deferred (not a failure:
  // no retry timer, the next foreground/Wi-Fi trigger picks them up).
  if (!(getSettings().wifiOnlyPhotos && (await onCellular()))) {
    // …then photos, binary included, a few at a time. Chunks are isolated the
    // same way projects are: one bad chunk no longer strands the ones behind it.
    for (const [project_id, photos] of Object.entries(pendingPhotosByProject())) {
      for (let i = 0; i < photos.length; i += PHOTO_CHUNK) {
        try {
          const chunk = await Promise.all(photos.slice(i, i + PHOTO_CHUNK).map(photoPayload));
          const res = await call("sync-field-log", { project_id, photos: chunk.map((c) => c.row) }, { timeoutMs: PHOTO_TIMEOUT });
          if (res.ok && res.synced) {
            // A photo whose pixels could not be read THIS pass syncs metadata
            // now but must stay pending so the binary retries — stamping it
            // synced here is how pilot day 1 orphaned pixels that still
            // existed on the device.
            const retry = new Set(chunk.filter((c) => c.retryPixels).map((c) => c.row.photo_id));
            if (retry.size) fail(`photos ${project_id}`, `${retry.size} photo(s) had unreadable pixels — metadata sent, binary will retry`);
            const synced = retry.size
              ? { ...res.synced, photos: (res.synced.photos ?? []).filter((id) => !retry.has(id)) }
              : res.synced;
            await markSynced(synced, res.synced_at);
            ping();
          } else if (!res.ok) throw new Error(`http ${res.status}`);
        } catch (e) {
          fail(`photos ${project_id}`, String(e?.message ?? e));
        }
      }
    }
  }

  if (failures === 0) {
    retryDelay = 30_000; // clean pass — backoff starts fresh next time
    if (pendingCount() === 0) lastError = null;
  } else {
    scheduleRetry();
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
  if (p.deleted) return { row, retryPixels: false };
  const b64 = await readB64(p.uri);
  if (b64) {
    row.b64 = b64;
    return { row, retryPixels: false };
  }
  // No binary this pass. A dead blob: URI is truly unrecoverable — sync the
  // metadata alone and let it count as done (the record surviving beats losing
  // the row with the pixels, 2026-07-30 decision). But an idb:/file:/content:
  // uri can fail transiently (IndexedDB under pressure, momentary file-read
  // error): sync metadata now, KEEP the photo pending so the pixels retry.
  const retryPixels = typeof p.uri === "string" && /^(idb:|file:|content:)/.test(p.uri);
  return { row, retryPixels };
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
