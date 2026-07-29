// Kaicon Field — schema constants, verbatim from Kaicon_Field_Schema v0.1.
// The app captures; it computes nothing beyond qty × cost display math (which
// the schema itself defines as a computed column).

// Phone verification gate (decided Jeffrey 2026-07-24; turned ON 2026-07-28 when
// phone-OTP landed): the create-account flow captures a phone number and shows
// the confirmation-code step ONLY when this is true.
//
// TRUE since the worker-auth edge function shipped — signup and cross-device
// login both go through a real OTP. NOTE the second half of the original
// condition is still outstanding: no SMS provider is configured on the project,
// so worker-auth runs in dev/pilot mode and hands the code back in its response
// (the app prefills it). That is "bypass on our terms" — good for a supervised
// pilot, NOT proof of phone ownership. Setting the TWILIO_* secrets flips it to
// real texts with no code change and no redeploy.
export const REQUIRE_PHONE_VERIFICATION = true;

// §4.1 project — the pilot. v1 is one project at a time (PRD §4 non-goals).
export const PROJECT = {
  project_id: "1257-INSP",
  name: "Bao Residence — 1257 Inspiration Point",
  address: "1257 Inspiration Point, West Covina, CA 91791",
  apn: "8493-056-020",
  permits: ["B25-1199", "B25-1200"],
  gc_of_record: "L'Or Constructions Inc.",
  gc_license: "CSLB #1156094",
  pm_entity: "KPKB OC LLC",
  start_date: "2026-07-30",
  areas: ["Main 1F", "Main 2F", "Gazebo", "Sitework"],
  budget_by_class: { M: 55734.88, F: 0, L: 133006.0, E: 0, S: 4550.0 },
};

// §2 cost classification. Labor lives on its own sheet/entry type (always L).
export const COST_CLASSES = ["M", "F", "E", "S"];

// Sensible cost_class default by phase (PRD Appendix #2 mitigation: "required
// field, single tap, sensible default by phase"). Most residential line items
// are bulk material (M) — so M is the fallback, and only the phases that are
// clearly fixture- or equipment-led get a different nudge. Always a suggestion,
// never a lock: the user can retap the grid. Keeps 100% cost_class coverage
// without making the crew think about classification on a typical line.
const PHASE_CLASS = {
  mobilization: "E", demo: "E",           // temp power, dumpsters, rentals
  hvac: "F", windows_doors: "F", fixtures: "F", // installed as-is
};
export function defaultClassForPhase(phase) {
  return PHASE_CLASS[phase] ?? "M";
}

// §7 phases — default residential sequence + the 1257 gazebo parallel track.
export const PHASES = [
  "mobilization", "demo", "foundation", "framing", "roofing",
  "rough_electrical", "rough_plumbing", "hvac", "inspection_rough",
  "insulation", "drywall", "exterior", "windows_doors", "finish_carpentry",
  "painting", "flooring", "fixtures", "sitework", "inspection_final",
  "punch_list", "gazebo",
];

// §5 units — constrained set; free text is not accepted.
export const UNITS = [
  "EA", "PC", "SET", "PR", "LF", "FT", "IN", "SF", "SQ", "CY", "CF", "GAL",
  "LB", "TON", "HR", "DAY", "WK", "MO", "BOX", "BDL", "ROLL", "SHT", "BAG",
  "TUBE", "LS",
];

// §6 trades with localized labels (en / es / zh).
export const TRADES = [
  { code: "laborer", en: "Laborer", es: "Peón", zh: "小工" },
  { code: "carpenter", en: "Carpenter", es: "Carpintero", zh: "木工" },
  { code: "concrete", en: "Concrete", es: "Concretero", zh: "混凝土工" },
  { code: "framer", en: "Framer", es: "Enmarcador", zh: "框架工" },
  { code: "roofer", en: "Roofer", es: "Techador", zh: "屋面工" },
  { code: "electrician", en: "Electrician", es: "Electricista", zh: "电工" },
  { code: "plumber", en: "Plumber", es: "Plomero", zh: "水管工" },
  { code: "hvac", en: "HVAC", es: "HVAC", zh: "暖通工" },
  { code: "drywaller", en: "Drywaller", es: "Yesero", zh: "石膏板工" },
  { code: "painter", en: "Painter", es: "Pintor", zh: "油漆工" },
  { code: "tile", en: "Tile Setter", es: "Azulejero", zh: "瓷砖工" },
  { code: "flooring", en: "Flooring", es: "Instalador de pisos", zh: "地板工" },
  { code: "finish_carp", en: "Finish Carpenter", es: "Carpintero de acabados", zh: "细木工" },
  { code: "foreman", en: "Foreman", es: "Capataz", zh: "工头" },
];

export const HOUR_TYPES = ["regular", "overtime", "rework"];

// Areas are project-configured (schema §4.1). The 1257 pilot has its own; any
// other Records project falls back to a generic residential set until per-
// project config syncs from the backend.
export const DEFAULT_AREAS = ["Interior", "Exterior", "Garage", "Sitework"];
export function areasFor(projectName) {
  const n = (projectName ?? "").toLowerCase();
  if (n.includes("1257") || n.includes("bao") || n.includes("inspiration")) {
    return PROJECT.areas;
  }
  return DEFAULT_AREAS;
}

// SF-02 — incident / near-miss types. A constrained enum (not free text) so
// safety records aggregate across jobs the way the reason codes do. Order is
// the order the crew sees: the two that matter most first.
export const INCIDENT_TYPES = ["injury", "near_miss", "property", "other"];

export const CO_REASONS = [
  "owner_request", "unforeseen_condition", "design_change",
  "code_requirement", "error_omission",
];
export const CO_STATUS = ["pending", "approved", "rejected", "completed"];

// Photo naming convention (§4.5): {project_id-short}-{YYYYMMDD}-{seq}.jpg
export function photoFilename(dateStr, seq) {
  const ymd = dateStr.replaceAll("-", "");
  return `1257-${ymd}-${String(seq).padStart(3, "0")}.jpg`;
}

export function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------------------------------------------------------------- validation
// §8 — blocks stop a save; warnings flag but NEVER prevent capture.

export function validateLineItem(l) {
  const blocks = [];
  if (!COST_CLASSES.includes(l.cost_class)) blocks.push("V1_cost_class");
  if (!l.unit || !UNITS.includes(l.unit)) blocks.push("V2_unit");
  if (!(Number(l.qty) > 0)) blocks.push("V3_qty");
  if (!(Number(l.unit_cost) >= 0) || l.unit_cost === "" || l.unit_cost == null) blocks.push("V4_unit_cost");
  if (l.work_date > todayStr()) blocks.push("V5_future");
  if (!l.description || !l.description.trim()) blocks.push("V_description");
  if (!l.phase) blocks.push("V_phase");
  if (!l.area) blocks.push("V_area");
  return blocks;
}

export function validateLabor(l) {
  const blocks = [];
  if (!l.trade) blocks.push("V_trade");
  if (!(Number(l.hours) > 0)) blocks.push("V3_qty");
  if (!(Number(l.hourly_rate) >= 0) || l.hourly_rate === "" || l.hourly_rate == null) blocks.push("V4_unit_cost");
  if (!HOUR_TYPES.includes(l.hour_type)) blocks.push("V_hour_type");
  if (l.work_date > todayStr()) blocks.push("V5_future");
  if (!l.phase) blocks.push("V_phase");
  if (!l.area) blocks.push("V_area");
  return blocks;
}

// SF-02. Deliberately the shortest block list in the file: a safety record that
// is hard to file is a safety record that doesn't get filed. Type and a
// description are all that's required — the photo is urged, never demanded
// (a worker helping someone up should not be blocked by a camera).
export function validateIncident(i) {
  const blocks = [];
  if (!INCIDENT_TYPES.includes(i.incident_type)) blocks.push("V_incident_type");
  if (!i.description || !i.description.trim()) blocks.push("V_description");
  if (i.work_date > todayStr()) blocks.push("V5_future");
  return blocks;
}

export function incidentWarnings(i) {
  const warns = [];
  if (!i.photo_count) warns.push("V11_incident_photo");
  return warns;
}

// Warnings (never block). `lines` = existing entries for the same work_date.
export function lineWarnings(l, lines) {
  const warns = [];
  const dup = (lines || []).some(
    (x) =>
      x.kind === "item" &&
      !x.superseded_by &&
      x.description?.trim().toLowerCase() === l.description?.trim().toLowerCase() &&
      Number(x.qty) === Number(l.qty) &&
      x.phase === l.phase
  );
  if (dup) warns.push("V8_duplicate");
  return warns;
}

export function laborWarnings(l, lines) {
  const warns = [];
  if (l.hour_type === "rework" && !(l.note || "").trim()) warns.push("V10_rework_note");
  const sameWorker = (lines || [])
    .filter((x) => x.kind === "labor" && !x.superseded_by && x.worker === l.worker)
    .reduce((n, x) => n + Number(x.hours || 0), 0);
  if (sameWorker + Number(l.hours || 0) > 16) warns.push("V9_hours");
  return warns;
}
