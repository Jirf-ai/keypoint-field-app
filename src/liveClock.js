// The live clock (Jeffrey 2026-08-04). A phone that sleeps in a pocket
// SUSPENDS JavaScript: setInterval stops firing and React never re-renders, so
// whatever was last painted stays frozen on the glass. A crew member who
// tapped Start Day and pocketed the phone reopened it hours later to a frozen
// "0:00" and read it as "the app never recorded my day" — the stamp was
// always right on the server, only the pixels were stale.
//
// Two rules make a readout honest on a real jobsite phone:
//   1. tick on the MINUTE BOUNDARY, so the number flips exactly when it should
//      instead of drifting up to a full period late;
//   2. recompute the INSTANT the app returns to the foreground — never wait on
//      a timer that was suspended along with the page.
//
// Everything time-based on screen (the running day clock, the End Day receipt)
// derives from this so it can never disagree with what gets recorded.
import { useEffect, useState } from "react";
import { Platform } from "react-native";

// A millisecond timestamp that re-renders the caller every minute and
// immediately on every resume. Callers compute elapsed time FROM it, so the
// value on screen is always derived from the real current time.
export function useNow() {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer = null;
    let dead = false;

    const tick = () => {
      if (dead) return;
      setNow(Date.now());
      if (timer) clearTimeout(timer);
      // Re-aim at the next minute boundary every time. A timer that was frozen
      // with the page resumes at an arbitrary offset; re-aiming keeps the flip
      // aligned to the wall clock instead of inheriting the sleep's drift.
      // +250ms so we land just past the boundary, never a hair before it.
      timer = setTimeout(tick, 60_000 - (Date.now() % 60_000) + 250);
    };
    tick();

    // ---- foreground wake: the fix for the frozen frame ----
    if (Platform.OS === "web") {
      const onVis = () => { if (document.visibilityState === "visible") tick(); };
      // visibilitychange covers lock screen / app switch; focus covers tab
      // return; pageshow covers iOS Safari's back-forward cache, which restores
      // a page wholesale WITHOUT firing visibilitychange.
      document.addEventListener("visibilitychange", onVis);
      window.addEventListener("focus", tick);
      window.addEventListener("pageshow", tick);
      return () => {
        dead = true;
        if (timer) clearTimeout(timer);
        document.removeEventListener("visibilitychange", onVis);
        window.removeEventListener("focus", tick);
        window.removeEventListener("pageshow", tick);
      };
    }

    const { AppState } = require("react-native");
    const sub = AppState.addEventListener?.("change", (st) => { if (st === "active") tick(); });
    return () => {
      dead = true;
      if (timer) clearTimeout(timer);
      sub?.remove?.();
    };
  }, []);

  return now;
}

// Whole minutes between an ISO stamp and `now`, floored, never negative — the
// shape every elapsed readout needs. A start stamp in the future (a phone whose
// clock is behind the server's) reads 0 rather than going negative.
export function minutesSince(iso, now) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((now - t) / 60_000));
}

// "1:29" — hours:minutes, the day clock's format. Unchanged from what crews
// already read on the strip.
export function elapsedStr(mins) {
  return `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, "0")}`;
}
