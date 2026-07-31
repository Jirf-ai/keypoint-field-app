// End-of-day reminder (CS-02) — a local nudge to log the day's hours, the habit
// half of the adoption fix (pairs with CS-01's give-back). Local only, no
// backend/push: we keep a rolling 7-day window of one-shot reminders at the
// worker's chosen time and re-sync it whenever the app is used, so TODAY's
// reminder is dropped the moment they log. Native only — web has no equivalent
// local schedule; the whole module no-ops there. Never throws.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { STRINGS } from "./i18n";
import { getSettings, loggedLaborToday, openClock } from "./store";

const HORIZON_DAYS = 7;

// Show the banner even if the app is foregrounded (older key kept for back-compat).
if (Platform.OS !== "web") {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldShowAlert: true,
        shouldPlaySound: false,
        shouldSetBadge: false,
      }),
    });
  } catch {}
}

async function ensureReady() {
  if (Platform.OS === "web") return false;
  try {
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
    if (status !== "granted") return false;
    if (Platform.OS === "android") {
      await Notifications.setNotificationChannelAsync("reminders", {
        name: "Reminders",
        importance: Notifications.AndroidImportance?.DEFAULT ?? 3,
      });
    }
    return true;
  } catch {
    return false;
  }
}

// Reconcile the scheduled reminders with current settings + today's log state.
// Returns false only when reminders are ON but couldn't be scheduled (no
// permission, or web) — the caller uses that to revert the toggle.
//
// Day clock (2026-07-31): a running clock arms a "Still on the clock?" nudge at
// the worker's quit time — the main defense against the forgotten-timer day.
// It does NOT require the remindEndOfDay opt-in: an open clock is state the
// worker created by tapping Start Day, so nudging about it is expected.
export async function syncReminders() {
  if (Platform.OS === "web") return !getSettings().remindEndOfDay;
  try {
    await Notifications.cancelAllScheduledNotificationsAsync(); // app owns this namespace
  } catch {}
  const st = getSettings();
  const clockRunning = !!openClock();
  if (!st.remindEndOfDay && !clockRunning) return true; // cleanly off
  if (!(await ensureReady())) return !st.remindEndOfDay; // only the setting reverts

  const [h, m] = String(st.reminderTime || "17:00").split(":").map((n) => Number(n) || 0);
  const dict = STRINGS[st.lang] ?? STRINGS.en;
  const now = new Date();

  if (clockRunning) {
    // Quit-time nudge; already past quit time → nag again in 30 minutes.
    // Re-armed on every Today landing, so it keeps firing until the day ends.
    const when = new Date(now);
    when.setHours(h, m, 0, 0);
    if (when <= now) when.setTime(now.getTime() + 30 * 60_000);
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: dict.stillOnClockQ ?? STRINGS.en.stillOnClockQ,
          body: dict.stillOnClockBody ?? STRINGS.en.stillOnClockBody,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    } catch {}
  }

  if (!st.remindEndOfDay) return true;
  const title = dict.reminderTitle ?? STRINGS.en.reminderTitle;
  const body = dict.reminderBody ?? STRINGS.en.reminderBody;
  const loggedToday = loggedLaborToday();

  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const when = new Date(now);
    when.setDate(now.getDate() + offset);
    when.setHours(h, m, 0, 0);
    // Drop today's habit reminder if its time has passed, the crew already
    // logged, or the clock nudge above already covers today.
    if (offset === 0 && (when <= now || loggedToday || clockRunning)) continue;
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title, body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    } catch {}
  }
  return true;
}
