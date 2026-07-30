// Phone-OTP auth for the Field app (backend: worker-auth edge function).
// send-otp texts a 6-digit code (dev/pilot mode returns it in `dev_code` when no
// SMS provider is configured); verify-otp proves ownership and, given a worker
// payload, registers the worker to the phone. A no-worker verify returns the
// verified accounts on that phone so a NEW device can restore the login.
import { call } from "./api";

export async function sendOtp(phone) {
  return call("worker-auth", { action: "send-otp", phone });
}

export async function verifyOtp(phone, code, worker) {
  return call("worker-auth", { action: "verify-otp", phone, code, ...(worker ? { worker } : {}) });
}

// Everyone registered under the team code — the SM's pick-a-crew-member list
// for record-for-someone-else (hard identity by worker_id, no spelling drift).
export async function fetchTeamRoster(gc_code) {
  return call("worker-auth", { action: "roster", gc_code });
}

// Client-generated worker id, pre-allocated before verify so the same id is used
// server-side (worker-auth) and locally (createProfile) — one stable identity.
export function newWorkerId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
