// The live day-clock readout. These are the pure helpers behind the strip a
// crew member stares at all day — the useNow hook that drives them is exercised
// on a real device (a frozen page cannot be simulated in jsdom).
//
// Regression under test (Jeffrey 2026-08-04): the timer must CONTINUE from the
// morning start stamp. It may never restart at zero, and it may never go
// backwards, whatever state the phone woke up in.
import { elapsedStr, minutesSince } from "../src/liveClock";

const START = "2026-08-04T15:27:11.276Z"; // Robert's real 8:27am PT punch-in
const at = (iso, plusMin) => new Date(iso).getTime() + plusMin * 60_000;

describe("minutesSince — elapsed from the start stamp", () => {
  test("the morning stamp keeps counting: 8:27am start, 10:00am now → 92m", () => {
    expect(minutesSince(START, at(START, 92))).toBe(92);
  });

  test("a full workday accumulates rather than wrapping", () => {
    expect(minutesSince(START, at(START, 9 * 60 + 12))).toBe(552);
  });

  test("floors to whole minutes — 59s in is still 0", () => {
    expect(minutesSince(START, new Date(START).getTime() + 59_000)).toBe(0);
    expect(minutesSince(START, new Date(START).getTime() + 60_000)).toBe(1);
  });

  test("a start stamp in the future reads 0, never a negative timer", () => {
    // A phone whose clock trails the server's can receive a start stamp dated
    // slightly ahead of its own now. Clamp instead of rendering "-1:-3".
    expect(minutesSince(START, at(START, -10))).toBe(0);
  });

  test("an unparseable stamp reads 0 rather than NaN on the glass", () => {
    expect(minutesSince(undefined, Date.now())).toBe(0);
    expect(minutesSince("not a date", Date.now())).toBe(0);
  });

  test("survives the ISO shapes both sources produce", () => {
    // Local taps write Date.toISOString() (…Z); the server's rehydrated rows
    // arrive from PostgREST as +00:00. Both must resolve to the same instant.
    const z = "2026-08-04T15:27:11.276Z";
    const offset = "2026-08-04T15:27:11.276+00:00";
    const now = at(z, 45);
    expect(minutesSince(offset, now)).toBe(minutesSince(z, now));
    expect(minutesSince(offset, now)).toBe(45);
  });
});

describe("elapsedStr — the H:MM face on the strip", () => {
  test("formats the way the crew already reads it", () => {
    expect(elapsedStr(0)).toBe("0:00");
    expect(elapsedStr(1)).toBe("0:01");
    expect(elapsedStr(92)).toBe("1:32");
    expect(elapsedStr(552)).toBe("9:12");
  });

  test("past twelve hours it keeps climbing — the timer never caps", () => {
    expect(elapsedStr(13 * 60 + 5)).toBe("13:05");
  });
});
