// Web pixel vault (2026-07-31). Photo binaries used to live as base64 inside
// the single localStorage blob — so one failed write could silently drop
// everything captured since the last success (the zero-loss cliff behind
// shedPhotoWeight). Pixels now live here, in IndexedDB, keyed by photo_id;
// the blob carries only an "idb:<photo_id>" sentinel. IndexedDB quota is
// orders of magnitude larger than localStorage's ~5MB, and a photo write
// can't take the whole store down with it.
//
// Everything is fail-soft: no IndexedDB (old browser, private mode, native
// platform) → every call resolves null/false and the store falls back to
// inlining pixels in the blob, exactly the pre-vault behavior.
import { Platform } from "react-native";

const DB_NAME = "kaicon-field-pixels";
const STORE = "pixels";

let dbPromise = null;
function openDb() {
  if (Platform.OS !== "web" || typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
        req.onblocked = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

function op(db, mode, fn) {
  return new Promise((resolve) => {
    try {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result === undefined ? true : req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

// → true only when the pixels are durably in the vault.
export async function putPixels(photo_id, dataUri) {
  const db = await openDb();
  if (!db) return false;
  return (await op(db, "readwrite", (s) => s.put(dataUri, photo_id))) != null;
}

export async function getPixels(photo_id) {
  const db = await openDb();
  if (!db) return null;
  const v = await op(db, "readonly", (s) => s.get(photo_id));
  return typeof v === "string" ? v : null;
}

export async function deletePixels(photo_id) {
  const db = await openDb();
  if (db) await op(db, "readwrite", (s) => s.delete(photo_id));
}

export async function clearPixels() {
  const db = await openDb();
  if (db) await op(db, "readwrite", (s) => s.clear());
}
