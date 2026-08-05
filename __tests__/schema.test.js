// Policy math and validation — the numbers crews get paid on. Pure functions
// only; anything touching the store or RN stays out of this suite.
import {
  CLOCK_POLICY,
  computeClockHours,
  defaultClassForPhase,
  laborWarnings,
  lineWarnings,
  projectCode,
  todayStr,
  validateIncident,
  validateLabor,
  validateLineItem,
} from "../src/schema";

const mins = (h, m = 0) => h * 60 + m;
// computeClockHours takes ISO strings; day type (weekday/weekend) comes from
// the START stamp's LOCAL date, so anchors are built in local time — the
// tests mean the same thing in any timezone.
// 2026-07-31 = Friday (weekday policy), 2026-08-01 = Saturday (weekend).
const spanFrom = (y, mo, d, totalMin) => {
  const start = new Date(y, mo - 1, d, 6, 0, 0);
  const end = new Date(start.getTime() + totalMin * 60_000);
  return computeClockHours(start.toISOString(), end.toISOString());
};
const span = (totalMin) => spanFrom(2026, 7, 31, totalMin);    // Friday
const wkspan = (totalMin) => spanFrom(2026, 8, 1, totalMin);   // Saturday

describe("computeClockHours — the End Day receipt (policy 2026-08-04)", () => {
  test("weekday 9h12m − 30m lunch rounds 8.75 but RECORDS the 8h cap, all regular", () => {
    const c = span(mins(9, 12));
    expect(c.elapsedMin).toBe(552);
    expect(c.lunchMin).toBe(30);
    expect(c.netMin).toBe(522);
    expect(c.hours).toBe(8);      // internal cap — weekday OT does not exist
    expect(c.regular).toBe(8);
    expect(c.overtime).toBe(0);
    expect(c.capped).toBe(true);
  });

  test("weekday under the cap records true rounded time, uncapped", () => {
    const c = span(mins(7, 26)); // zhang's real 8/4 shape
    expect(c.hours).toBe(7);
    expect(c.regular).toBe(7);
    expect(c.overtime).toBe(0);
    expect(c.capped).toBe(false);
  });

  test("short day: under the 6h lunch threshold deducts nothing", () => {
    const c = span(mins(4));
    expect(c.lunchMin).toBe(0);
    expect(c.hours).toBe(4);
    expect(c.overtime).toBe(0);
  });

  test("exactly 6h on the clock is NOT over the threshold", () => {
    expect(span(mins(6)).lunchMin).toBe(0);
    expect(span(mins(6, 1)).lunchMin).toBe(CLOCK_POLICY.lunchMinutes);
  });

  test("rounds to the NEAREST quarter hour, both directions", () => {
    expect(span(mins(4, 7)).hours).toBe(4);      // 4:07 → down
    expect(span(mins(4, 8)).hours).toBe(4.25);   // 4:08 → up
    expect(span(mins(4, 22)).hours).toBe(4.25);  // 4:22 → down
    expect(span(mins(4, 23)).hours).toBe(4.5);   // 4:23 → up
  });

  test("exactly 8h net on a weekday: all regular, cap untouched", () => {
    const c = span(mins(8, 30)); // − 30 lunch = 8:00
    expect(c.hours).toBe(8);
    expect(c.regular).toBe(8);
    expect(c.overtime).toBe(0);
    expect(c.capped).toBe(false);
  });

  test("sub-15-minute day rounds to 0 — writes no line", () => {
    expect(span(7).hours).toBe(0);
  });

  test("clock running backwards (device clock skew) clamps to 0, never negative", () => {
    const start = new Date(2026, 6, 31, 8, 0, 0);
    const end = new Date(2026, 6, 31, 7, 0, 0);
    const c = computeClockHours(start.toISOString(), end.toISOString());
    expect(c.elapsedMin).toBe(0);
    expect(c.hours).toBe(0);
    expect(c.overtime).toBe(0);
  });

  test("forgotten 14h weekday clock still records only the 8h cap", () => {
    const c = span(mins(14)); // − 30 lunch = 13:30 rounded
    expect(c.hours).toBe(8);
    expect(c.regular).toBe(8);
    expect(c.overtime).toBe(0);
    expect(c.capped).toBe(true);
  });

  test("SATURDAY is all overtime — payroll pays 150%, the app just classifies", () => {
    const c = wkspan(mins(6));
    expect(c.hours).toBe(6);
    expect(c.regular).toBe(0);
    expect(c.overtime).toBe(6);
    expect(c.capped).toBe(false);
  });

  test("weekend day caps at 12 recorded hours", () => {
    const c = wkspan(mins(14)); // − 30 lunch = 13:30 rounded
    expect(c.hours).toBe(12);
    expect(c.regular).toBe(0);
    expect(c.overtime).toBe(12);
    expect(c.capped).toBe(true);
  });

  test("Sunday classifies like Saturday", () => {
    const c = spanFrom(2026, 8, 2, mins(9)); // Sunday, − 30 lunch = 8.5
    expect(c.regular).toBe(0);
    expect(c.overtime).toBe(8.5);
  });

  test("split arithmetic is exact on both day types (float dust)", () => {
    for (let m = 0; m < mins(16); m += 13) {
      for (const f of [span, wkspan]) {
        const { hours, regular, overtime } = f(m);
        expect(regular + overtime).toBeCloseTo(hours, 10);
        expect(String(overtime)).not.toMatch(/\d{10,}/);
      }
    }
  });
});

describe("validateLabor — blocks stop a save", () => {
  const good = {
    trade: "laborer", hours: 8, hourly_rate: 45, hour_type: "regular",
    work_date: "2026-07-30", phase: "framing", area: "Interior",
  };
  test("valid entry passes", () => expect(validateLabor(good)).toEqual([]));
  test("zero hours blocked", () => expect(validateLabor({ ...good, hours: 0 })).toContain("V3_qty"));
  test("rate is NOT required (2026-08-04: hours only — Payroll owns comp)", () => {
    expect(validateLabor({ ...good, hourly_rate: null })).toEqual([]);
    expect(validateLabor({ ...good, hourly_rate: undefined })).toEqual([]);
  });
  test("future date blocked", () =>
    expect(validateLabor({ ...good, work_date: "2999-01-01" })).toContain("V5_future"));
  test("unknown hour type blocked", () =>
    expect(validateLabor({ ...good, hour_type: "double" })).toContain("V_hour_type"));
  test("missing trade/phase/area each block", () => {
    expect(validateLabor({ ...good, trade: null })).toContain("V_trade");
    expect(validateLabor({ ...good, phase: null })).toContain("V_phase");
    expect(validateLabor({ ...good, area: null })).toContain("V_area");
  });
});

describe("laborWarnings — flag but never block", () => {
  const line = (worker, hours) => ({ kind: "labor", worker, hours });
  test("over 16h same worker same day warns V9", () => {
    const existing = [line("Ana", 9)];
    expect(laborWarnings({ worker: "Ana", hours: 8, hour_type: "regular" }, existing)).toContain("V9_hours");
    expect(laborWarnings({ worker: "Ana", hours: 7, hour_type: "regular" }, existing)).toEqual([]);
  });
  test("superseded lines don't count toward the 16h", () => {
    const existing = [{ ...line("Ana", 9), superseded_by: "x" }];
    expect(laborWarnings({ worker: "Ana", hours: 8, hour_type: "regular" }, existing)).toEqual([]);
  });
  test("rework without a note warns", () => {
    expect(laborWarnings({ worker: "Ana", hours: 1, hour_type: "rework", note: "" }, [])).toContain("V10_rework_note");
    expect(laborWarnings({ worker: "Ana", hours: 1, hour_type: "rework", note: "redo trim" }, [])).toEqual([]);
  });
});

describe("validateLineItem / lineWarnings", () => {
  const good = {
    cost_class: "M", unit: "EA", qty: 2, unit_cost: 10,
    work_date: "2026-07-30", description: "2x4 studs", phase: "framing", area: "Interior",
  };
  test("valid item passes", () => expect(validateLineItem(good)).toEqual([]));
  test("labor class L is not a line-item class", () =>
    expect(validateLineItem({ ...good, cost_class: "L" })).toContain("V1_cost_class"));
  test("free-text unit rejected", () =>
    expect(validateLineItem({ ...good, unit: "bunch" })).toContain("V2_unit"));
  test("duplicate same description+qty+phase warns", () => {
    const existing = [{ kind: "item", description: "2X4 Studs", qty: 2, phase: "framing" }];
    expect(lineWarnings(good, existing)).toContain("V8_duplicate");
  });
});

describe("validateIncident — deliberately the shortest block list", () => {
  test("type + description is enough", () =>
    expect(validateIncident({ incident_type: "near_miss", description: "ladder slip", work_date: "2026-07-30" })).toEqual([]));
  test("no photo never blocks", () =>
    expect(validateIncident({ incident_type: "injury", description: "cut hand", work_date: "2026-07-30", photo_count: 0 })).toEqual([]));
});

describe("small helpers", () => {
  test("defaultClassForPhase nudges by phase, falls back to M", () => {
    expect(defaultClassForPhase("demo")).toBe("E");
    expect(defaultClassForPhase("fixtures")).toBe("F");
    expect(defaultClassForPhase("framing")).toBe("M");
  });
  test("projectCode from address-style and free-form names", () => {
    expect(projectCode("123 Main St, Oakland")).toBe("123-MAI");
    expect(projectCode("Bao Residence")).toBe("BAORES");
    expect(projectCode("")).toBe("PROJ");
  });
  test("todayStr is a YYYY-MM-DD local date", () =>
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/));
});
