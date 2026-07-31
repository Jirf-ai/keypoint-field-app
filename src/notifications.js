// End-of-day reminder (CS-02) — a local nudge to log the day's hours, the habit
// half of the adoption fix (pairs with CS-01's give-back). Local only, no
// backend/push: we keep a rolling 7-day window of one-shot reminders at the
// worker's chosen time and re-sync it whenever the app is used, so TODAY's
// reminder is dropped the moment they log. Native only — web has no equivalent
// local schedule; the whole module no-ops there. Never throws.
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { call } from "./api";
import { STRINGS } from "./i18n";
import { todayStr } from "./schema";
import { activeProfile, clockFor, getSettings, loggedLaborToday, openClock } from "./store";

const HORIZON_DAYS = 7;

// Incident push (2026-07-31): native installs register their Expo push token
// so this worker can be pinged (site managers get incident alerts the moment
// a report syncs). Web has no Expo push — whole thing no-ops there, and any
// native failure (no permission, no EAS project yet) is silently skipped:
// push is a bonus channel, never a blocker. Once per app session.
let _pushRegistered = false;
export async function registerPushToken() {
  if (Platform.OS === "web" || _pushRegistered) return;
  const me = activeProfile();
  if (!me?.worker_id) return;
  try {
    if (!(await ensureReady())) return;
    const projectId = Constants?.expoConfig?.extra?.eas?.projectId;
    const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined))?.data;
    if (!token) return;
    _pushRegistered = true;
    call("push-token", { worker_id: me.worker_id, token }).catch(() => {});
  } catch {
    // Expected until native builds exist — never surface this to the crew.
  }
}

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
  const anythingOn = st.remindEndOfDay || st.remindStartOfDay || clockRunning;
  if (!anythingOn) return true; // cleanly off
  if (!(await ensureReady())) return !st.remindEndOfDay; // only the evening toggle reverts

  const dict = STRINGS[st.lang] ?? STRINGS.en;
  const tr = (k) => dict[k] ?? STRINGS.en[k];
  const now = new Date();
  const at = (timeStr, offsetDays = 0) => {
    const [h, m] = String(timeStr).split(":").map((n) => Number(n) || 0);
    const d = new Date(now);
    d.setDate(now.getDate() + offsetDays);
    d.setHours(h, m, 0, 0);
    return d;
  };
  const schedule = async (titleKey, bodyKey, when) => {
    try {
      await Notifications.scheduleNotificationAsync({
        content: { title: tr(titleKey), body: tr(bodyKey) },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: when },
      });
    } catch {}
  };

  if (clockRunning) {
    // Quit-time nudge; already past quit time → nag again in 30 minutes.
    // Re-armed on every Today landing, so it keeps firing until the day ends.
    let when = at(st.reminderTime || "17:00");
    if (when <= now) when = new Date(now.getTime() + 30 * 60_000);
    await schedule("stillOnClockQ", "stillOnClockBody", when);
  }

  // Morning "Start your day" nudge (2026-07-31). True arrive-at-site geofencing
  // needs background location = native builds; a fixed morning time covers the
  // habit until then. Today's is dropped once a clock exists (running or done).
  if (st.remindStartOfDay) {
    const clockedToday = clockRunning || !!clockFor(todayStr());
    for (let offset = 0; offset < HORIZON_DAYS; offset++) {
      const when = at(st.startReminderTime || "06:30", offset);
      if (when <= now || (offset === 0 && clockedToday)) continue;
      await schedule("startReminderTitle", "startReminderBody", when);
    }
  }

  if (!st.remindEndOfDay) return true;
  const loggedToday = loggedLaborToday();
  for (let offset = 0; offset < HORIZON_DAYS; offset++) {
    const when = at(st.reminderTime || "17:00", offset);
    // Drop today's habit reminder if its time has passed, the crew already
    // logged, or the clock nudge above already covers today.
    if (when <= now || (offset === 0 && (loggedToday || clockRunning))) continue;
    await schedule("reminderTitle", "reminderBody", when);
  }
  return true;
}
