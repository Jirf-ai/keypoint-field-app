// Location provenance (PRD §7 — every record carries "at what location").
// One foreground, on-demand fix, cached briefly and shared by every capture:
// photos geotag with it, and stamp() brands each line/labor/CO with the last
// known fix. Native uses expo-location; web uses navigator.geolocation so the
// browser build tags location too. Foreground only — no background tracking
// (PRD §9.1). Never throws: no permission / no fix simply yields null.
import { Platform } from "react-native";
import * as Location from "expo-location";

let cached = null; // { gps_lat, gps_lng, at }

const round = (n) => Number(n.toFixed(6));

// Synchronous read for stamp() — returns the last cached fix (or null). Does
// not trigger a lookup; refreshLocation() keeps the cache warm.
export function lastLocation() {
  return cached ? { gps_lat: cached.gps_lat, gps_lng: cached.gps_lng } : null;
}

// Get (or reuse) a foreground fix. Reuses a cached fix younger than maxAgeMs so
// landing on Today repeatedly doesn't hammer the GPS. Pass maxAgeMs: 0 to force.
export async function refreshLocation({ maxAgeMs = 120000 } = {}) {
  if (cached && Date.now() - cached.at < maxAgeMs) return lastLocation();
  try {
    if (Platform.OS === "web") {
      if (typeof navigator === "undefined" || !navigator.geolocation) return lastLocation();
      const pos = await new Promise((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: false, maximumAge: 60000, timeout: 8000 })
      );
      cached = { gps_lat: round(pos.coords.latitude), gps_lng: round(pos.coords.longitude), at: Date.now() };
      return lastLocation();
    }
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") return lastLocation();
    const pos = (await Location.getLastKnownPositionAsync()) ?? (await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
    if (pos) cached = { gps_lat: round(pos.coords.latitude), gps_lng: round(pos.coords.longitude), at: Date.now() };
    return lastLocation();
  } catch {
    return lastLocation();
  }
}
