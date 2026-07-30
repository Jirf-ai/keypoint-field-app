# Project invites — identity first, then membership ("lobby" model)

Status: PROPOSED — Jeffrey 2026-07-29, for Raymond's review. Nothing here is
built. Written the night before the 1257 pilot; explicitly NOT for the pilot.

## Why

Three facts about what's on `main` today, all verified against the code:

1. **Crew cannot register on their own phones.** `create()` in AuthScreen
   requires `resolveShareCode(mgrCode)`, which matches against the profiles
   stored on *this device*. A crew member's fresh phone has no site-manager
   profile on it, so the correct code still fails. The only device where the
   check passes is the manager's own phone.
2. **The Jul-28 identity work already contradicts that gate.** Phone-OTP +
   cross-device restore moved identity to the server (`worker_registrations`).
   An account restored onto a new phone has no local profiles to validate a
   manager code against. The Jul-27 gate and the Jul-28 identity layer can't
   both be right; the identity layer is the keeper.
3. **Nothing gates capture.** The Records typeahead in ProjectPicker is not
   role-gated, `setCurrentProject()` does no membership check, and
   `sync-field-log` writes whatever `project_id` it is handed. "Joining" a
   manager today only copies a device-local project list into the picker.

So the `KP-` manager code is currently neither an identity gate that works nor
a project gate at all. This spec replaces it with the thing its own comments
promise ("sync resolves it server-side once the backend lands") — scoped to
projects rather than managers.

## The model (Discord shape)

- **Account = identity.** Name, phone (OTP-verified), selfie, role, trade.
  Created first, standalone. Already built — this is exactly the Jul-28 flow.
- **Project = server/lobby.** The canonical Records project row.
- **Invite = the gate.** A site manager mints an invite for a project; crew
  redeem it (code or link) to become members; membership is a server row that
  capture and sync can check. Invites expire and can be revoked — a code
  derived from `worker_id` can do neither, forever.

The GC team code is untouched: it stays the server-validated registration
gate and the consent carrier. Invites answer a different question —
"may this worker log against this project" — which today nothing answers.

## Schema (BOBAI spine, one migration)

```sql
create table project_invites (
  invite_code   text primary key,            -- short, human-typeable: 6 chars,
                                             -- crockford base32, no 0/O/1/I
  project_id    uuid not null references projects(id),
  gc_account_id uuid references gc_accounts(id),
  created_by    text not null,               -- minting SM's worker_id
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,                 -- null = no expiry
  max_uses      int,                         -- null = unlimited
  uses          int not null default 0,
  revoked_at    timestamptz
);

create table project_members (
  project_id  uuid not null references projects(id),
  worker_id   text not null,
  role        text not null,                 -- site_manager | journeyman
  joined_via  text references project_invites(invite_code),
  terms_version text,                        -- per-worker terms acceptance
  terms_accepted_at timestamptz,             -- lives HERE, at the join
  joined_at   timestamptz not null default now(),
  primary key (project_id, worker_id)
);
```

RLS on, no policies (service-role access only), same as the other field tables.

## Endpoints (one new function, `project-invite`, verify_jwt false)

- `{action:"create", project_id, worker_id}` → mints code, returns
  `{invite_code, link}` where link =
  `https://jirf-ai.github.io/keypoint-field-app/?join=CODE`.
  Pilot-tier auth: `worker_id` must be a registered site manager
  (`worker_registrations.role`). Real auth rides the future session token.
- `{action:"redeem", invite_code, worker_id, accept_terms?, terms_version?}` →
  validates (exists, not revoked, not expired, under max_uses), upserts
  `project_members`, increments `uses`, returns the project row
  `{id, name, status}` ready for `setCurrentProject`. Idempotent per
  (project, worker) — re-redeeming is a no-op, not an error.
- `{action:"revoke", invite_code, worker_id}` → sets `revoked_at`.

## Client changes

1. **Signup:** drop the `resolveShareCode` gate and the button's
   `mgrCode` clause; the field becomes an optional invite-code box that
   redeems after `finishCreate()` (replacing today's local `joinByCode`).
2. **JoinListScreen:** point `join()` at `project-invite redeem` instead of
   local resolution. The screen's UI barely changes.
3. **Invite link:** on app load, read `?join=` from the URL; if no profile
   yet, stash it and auto-redeem right after signup — so a texted link is the
   entire onboarding for a crew member.
4. **SM "Invite crew":** surface in ProjectPicker where the share code sits
   today — shows the code, a copy button for the link. (Native share sheet
   later.)
5. **Project picker for crew:** `myProjects()` = memberships (server truth,
   cached for offline). Records typeahead becomes SM-only — closing the
   ungated-capture hole. Crew with zero memberships see "ask your site
   manager for an invite."
6. **sync-field-log (phase 2, separate deploy):** reject rows whose
   (`project_id`, worker) lacks a membership. Deploy log-only first, enforce
   after a clean week — never brick a phone mid-day.

## What this deliberately keeps of Raymond's work

Identity flow: untouched. GC registration + consent: untouched.
JoinListScreen: kept, re-pointed. Share-code UI real estate: reused.
The only *removal* is the device-local `resolveShareCode` check, which
cross-device login already obsoleted.

## Open questions for Raymond

1. Manager-scoped (`KP-`, join everything the SM owns) vs project-scoped
   invites — this spec argues project-scoped; disagree?
2. Should redeeming require OTP-verified phone (`phone_verified`) or is a
   registered worker_id enough for the pilot tier?
3. Terms text for per-worker acceptance at join — Franc/counsel to supply;
   schema carries `terms_version` from day one so early joins are stampable.
4. Invite defaults: expiry 14d, max_uses null — sane?
5. Device-local projects (AddProjectScreen) — do they survive as SM-private
   scratch space, or does everything become a Records project + invite?

## Sizing

Migration + `project-invite` function + client wiring ≈ one focused day,
most of it client. No new auth machinery — rides `worker-auth` as-is.
