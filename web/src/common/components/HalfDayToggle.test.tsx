import { isValidHalfCombination } from "@leave/shared";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HalfDayToggle, halfOptions, normalizeHalves } from "./HalfDayToggle";

describe("HalfDayToggle options", () => {
  it("single day: full, morning, afternoon; multi-day: first full/pm, last full/am", () => {
    expect(halfOptions("single")).toEqual(["full", "am", "pm"]);
    expect(halfOptions("first")).toEqual(["full", "pm"]);
    expect(halfOptions("last")).toEqual(["full", "am"]);
  });

  it("every offered multi-day combination is valid for the shared rule", () => {
    for (const s of halfOptions("first")) {
      for (const e of halfOptions("last")) {
        expect(isValidHalfCombination({ startDate: "2026-01-12", endDate: "2026-01-14", startHalf: s, endHalf: e })).toBe(true);
      }
    }
  });

  it("every offered single-day option is valid when start and end halves match", () => {
    for (const h of halfOptions("single")) {
      expect(isValidHalfCombination({ startDate: "2026-01-12", endDate: "2026-01-12", startHalf: h, endHalf: h })).toBe(true);
    }
  });

  it("normalizes impossible combinations when the range changes", () => {
    // single AM day extended to several days: the first day cannot be morning-only
    expect(normalizeHalves("2026-01-12", "2026-01-14", "am", "am")).toEqual({ startHalf: "full", endHalf: "am" });
    // multi-day with a PM last day collapses to full
    expect(normalizeHalves("2026-01-12", "2026-01-14", "pm", "pm")).toEqual({ startHalf: "pm", endHalf: "full" });
    // multi-day shrunk to one day: both ends take the first half
    expect(normalizeHalves("2026-01-12", "2026-01-12", "pm", "full")).toEqual({ startHalf: "pm", endHalf: "pm" });
    // an already valid pair is untouched
    expect(normalizeHalves("2026-01-12", "2026-01-14", "pm", "am")).toEqual({ startHalf: "pm", endHalf: "am" });
  });
});

describe("HalfDayToggle rendering", () => {
  it("renders only the allowed choices and reports the click", () => {
    const onChange = vi.fn();
    render(<HalfDayToggle position="first" label="First day" value="full" onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual(["Full day", "Afternoon"]);
    expect(radios[0]!.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(radios[1]!);
    expect(onChange).toHaveBeenCalledWith("pm");
  });
});
