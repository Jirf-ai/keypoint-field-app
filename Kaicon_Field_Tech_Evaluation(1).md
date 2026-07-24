# Kaicon Field — Technology Evaluation

**Version** 0.1 (Draft for review)
**Owner** Franc Huang
**Reviewers** Jeffrey Liao, Raymond Huang
**Date** July 24, 2026
**Decision needed by** Mid-August 2026 (to hit a September alpha)

---

## 1. What we are choosing for

Kaicon Field is a field data capture app for construction crews. The technology decision is driven by five requirements, in priority order:

| # | Requirement | Why it dominates |
|---|---|---|
| R1 | **Offline-first, zero data loss** | Framing interiors and hillside lots have no signal. Losing a day's capture ends adoption. |
| R2 | **iOS and Android from day one** | A large share of the trades run Android. iOS-only excludes them and biases the first dataset. |
| R3 | **Reliable camera** | Photos are half the evidentiary value of a daily log. |
| R4 | **Small team velocity** | One primary engineer. Time-to-first-real-data matters more than architectural purity. |
| R5 | **Low device burden** | Personal phones, personal data plans. App size and bandwidth are adoption factors. |

Everything below is evaluated against these five, not against general merit.

---

## 2. Options

### Option A — React Native (Expo)

JavaScript/TypeScript, one codebase, native modules via Expo's managed APIs.

**For**
- Single codebase covers R2 immediately
- Expo provides camera, filesystem, location, background sync without writing native code
- TypeScript end-to-end means shared types with the Supabase backend and the web dashboard — the schema is defined once
- Over-the-air updates: field bug fixes ship without an app store review cycle, which matters enormously during a pilot
- Largest hiring pool if the team grows
- Raymond's existing JS/TS work carries over

**Against**
- Camera performance is good, not native-class — burst capture and heavy image processing are weaker
- Debugging native-layer issues requires ejecting or writing native modules, which erases some of the velocity advantage
- App size runs larger than native (~25–40 MB vs ~15–25 MB)
- Dependency on Expo's release cadence for SDK upgrades

**Offline story:** mature. WatermelonDB or SQLite via `expo-sqlite`, with a sync layer to Supabase. Well-trodden path.

---

### Option B — Native (Swift + Kotlin)

Two codebases, full platform access.

**For**
- Best possible camera, background sync, and battery behavior
- Smallest app footprint
- No framework layer to debug through
- Platform features available the day they ship

**Against**
- **Two codebases, one engineer.** Either double the work or ship iOS-only and violate R2.
- Slowest path to first real data — the thing this project is actually optimizing for
- Every schema change is implemented twice
- No over-the-air updates; every field fix waits on app review

**Assessment:** correct choice for a mature product with a platform team. Wrong choice for a pilot that needs data in eight weeks with one engineer.

---

### Option C — Progressive Web App

Browser-based, installable, no app store.

**For**
- Fastest to build; reuses web skills and any existing web dashboard work
- No app store review at all — deploy continuously
- Zero install friction: send a link
- Smallest footprint

**Against**
- **Offline reliability is the weak point, and R1 is our top requirement.** iOS Safari evicts IndexedDB and cache storage under storage pressure, and a PWA that quietly loses a week of offline captures is the exact failure this app cannot have.
- Camera access via `getUserMedia` is materially worse than native capture — no reliable EXIF, weaker control, poorer low-light handling
- Background sync on iOS is unreliable; sync happens only when the app is foregrounded
- No push notifications on iOS below recent versions, and support remains uneven
- Feels like a website to users, which undermines credibility with contractors

**Assessment:** the offline and camera weaknesses hit R1 and R3 directly. Viable for the PM dashboard, not for field capture.

---

### Option D — Flutter

Dart, single codebase, custom rendering engine.

**For**
- Genuinely good cross-platform performance
- Excellent offline libraries (Drift/SQLite)
- Consistent rendering across platforms

**Against**
- Dart is a new language for the team — direct hit on R4
- No type sharing with the TypeScript backend; the schema gets defined twice in different languages
- Smaller hiring pool locally than React Native

**Assessment:** strong technology, wrong fit for this team's existing skills and stack.

---

## 3. Comparison

| Criterion | Weight | RN/Expo | Native | PWA | Flutter |
|---|---|---|---|---|---|
| R1 Offline reliability | ●●● | Strong | Strongest | **Weak** | Strong |
| R2 iOS + Android | ●●● | Strong | Weak (2×) | Strong | Strong |
| R3 Camera | ●● | Good | Strongest | **Weak** | Good |
| R4 Team velocity | ●●● | **Strongest** | Weak | Strong | Weak |
| R5 Device burden | ● | Moderate | Best | Best | Moderate |
| Type sharing with backend | ●● | **Yes** | No | Yes | No |
| OTA field fixes | ●● | **Yes** | No | Yes | Limited |
| Time to first real data | ●●● | **~6–8 wks** | ~14–20 wks | ~4 wks | ~10–12 wks |

---

## 4. Recommendation

**React Native with Expo.**

The decisive factors are R4 and R2 together: one engineer, both platforms, data needed within weeks. React Native is the only option that satisfies both without compromising R1 the way a PWA does.

Native is the better long-term technology and may be the right migration once the product is proven and the team is larger. Choosing it now would mean either an iOS-only pilot — biasing the first dataset toward the least representative users — or a timeline that misses most of the 1257 project.

The camera gap versus native is real but acceptable: this app needs documentary photographs with reliable metadata, not computational photography.

---

## 5. Proposed stack

| Layer | Choice | Rationale |
|---|---|---|
| Framework | Expo (React Native), TypeScript | R2 + R4 |
| Local database | WatermelonDB over SQLite | Built for offline-first sync; performs well with large local datasets |
| Sync | Custom sync layer → Supabase | Matches the existing data spine |
| Backend | Supabase (Postgres, Auth, Storage, Realtime) | Already the platform's data spine; `pgvector` and `pg_net` already in use |
| Photo storage | Supabase Storage, client-side compression | Bandwidth is a user cost (R5) |
| Auth | Supabase Auth, phone OTP | Crews have phone numbers, not necessarily email |
| i18n | `i18next` | English / Spanish / Chinese per PRD §8 |
| Distribution | TestFlight + internal APK → stores at v1 | Own crews absorb early defects |
| Error tracking | Sentry | Field failures are invisible without it |

### Why WatermelonDB over plain SQLite

Sync is where offline apps fail, and WatermelonDB is built around the sync problem rather than treating it as an afterthought: it tracks record-level changes, supports a pull/push protocol out of the box, and handles conflict resolution explicitly. Rolling our own on plain SQLite means rebuilding all of that, and sync bugs are precisely the class of defect that destroys field trust (PRD §13.3).

---

## 6. Sync design — the part that must not fail

R1 is the highest-priority requirement, so it deserves explicit design rather than being left to the library.

**Model:** local-first. Every write commits to the local database immediately and unconditionally. Sync is a background reconciliation, never a precondition for capture.

**Rules**

1. **Never block capture on network.** The UI does not know or care whether the device is online.
2. **Never delete local data until the server confirms receipt.** Confirmation means a server-acknowledged write, not an HTTP 200 from a proxy.
3. **Surface pending state.** A visible count of unsynced records. Silence is what makes users distrust an app.
4. **Conflicts preserve both versions.** Last-write-wins is unacceptable for cost data. On conflict, retain both, flag for PM resolution.
5. **Append-only on the server.** Amendments create new versions (schema §4.3 `version` / `supersedes`), so a botched sync can never destroy a prior record.
6. **Idempotent writes.** Client-generated UUIDs mean a retried sync cannot create duplicates.

**Test before alpha:** airplane mode for a full working day, force-quit mid-capture, restart the device, then reconnect. Zero loss is the pass condition, and this test runs before crews ever see the app.

---

## 7. Effort estimate

Assumes one full-time engineer with React Native familiarity.

| Phase | Scope | Estimate |
|---|---|---|
| Setup | Expo, Supabase schema, auth, CI | 1 week |
| Core capture | Line items, labor, validation | 2 weeks |
| Offline + sync | WatermelonDB, sync layer, conflict handling | 2 weeks |
| Photos | Capture, compression, upload queue | 1 week |
| Change orders + submit | CO entry, daily review, submit flow | 1 week |
| i18n | Three languages including trade and phase terms | 0.5 week |
| Hardening | Sync testing, error handling, device testing | 1.5 weeks |
| **Alpha total** | | **~9 weeks** |

Beta additions — PM dashboard, refinement from pilot feedback — add roughly 4 weeks.

**Timeline reality:** a September alpha requires a start in early August. The 1257 project begins July 30, which is why the interim spreadsheet capture (PRD §10.1) is not optional. Even the fastest technology choice misses the first six weeks of the pilot.

---

## 8. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Sync bug loses field data | **Severe** — permanent trust loss | §6 rules; airplane-mode testing before crews see it |
| Crew doesn't adopt | Severe — no data pipeline | Spanish at P0, sub-3-minute flow, site manager accountable |
| Expo SDK limits a needed capability | Moderate | Expo supports custom native modules without full ejection |
| Photo storage costs scale badly | Moderate | Client compression, retention policy (schema S3) |
| Android device fragmentation | Moderate | Test on low-end devices, not just flagships |
| Engineer availability | Moderate | Interim spreadsheet keeps data flowing regardless |

---

## 9. Decisions requested

| # | Decision | Owner |
|---|---|---|
| D1 | Approve React Native / Expo | Raymond |
| D2 | Approve WatermelonDB + Supabase sync architecture | Raymond |
| D3 | Confirm Spanish is P0, not P1 | Franc |
| D4 | Confirm the alpha ships to own crews only, not customers | Franc |
| D5 | Confirm the engineering start date and staffing | Franc / Raymond |
| D6 | Resolve the L'Or data-use question before capture begins | Franc / counsel |

D6 is a prerequisite for the pilot, not a technology decision — but it blocks the data, so it belongs on this list.
