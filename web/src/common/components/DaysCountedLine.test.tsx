import { workingDays } from "@leave/shared";
import { render, screen } from "@testing-library/react";
import i18n from "i18next";
import { describe, expect, it } from "vitest";
import { DaysCountedLine, daysCountedText } from "./DaysCountedLine";

const en = i18n.getFixedT("en");
const fr = i18n.getFixedT("fr");

describe("days-counted line", () => {
  it("prints the spec example", () => {
    expect(daysCountedText(en, { days: 4.5, weekendDays: 1, holidayDays: 1 }, "en")).toBe("4.5 working days (1 weekend, 1 public holiday excluded)");
  });

  it("omits the parenthesis when nothing was excluded and handles singular", () => {
    expect(daysCountedText(en, { days: 5, weekendDays: 0, holidayDays: 0 }, "en")).toBe("5 working days");
    expect(daysCountedText(en, { days: 1, weekendDays: 0, holidayDays: 0 }, "en")).toBe("1 working day");
    expect(daysCountedText(en, { days: 8, weekendDays: 2, holidayDays: 0 }, "en")).toBe("8 working days (2 weekends excluded)");
  });

  it("formats in French with a decimal comma", () => {
    expect(daysCountedText(fr, { days: 4.5, weekendDays: 1, holidayDays: 1 }, "fr")).toBe("4,5 jours ouvrés (1 week-end, 1 jour férié exclu(s))");
  });

  it("is driven by the shared workingDays rule", () => {
    // Mon 12 Jan to Mon 19 Jan 2026 with Thu 15 Jan a holiday: 5 days, 2 weekend days, 1 holiday
    const r = workingDays({
      startDate: "2026-01-12",
      endDate: "2026-01-19",
      startHalf: "full",
      endHalf: "full",
      mode: "working",
      workDays: 0b0011111,
      holidays: [{ date: "2026-01-15", isHalfDay: false }],
    });
    expect(daysCountedText(en, r, "en")).toBe("5 working days (2 weekends, 1 public holiday excluded)");
  });

  it("renders a hint before dates are picked and the line afterwards", () => {
    const { rerender } = render(<DaysCountedLine count={null} />);
    expect(screen.getByText("Pick the first and last day.")).toBeTruthy();
    rerender(<DaysCountedLine count={{ days: 2, weekendDays: 0, holidayDays: 0 }} />);
    expect(screen.getByTestId("days-counted").textContent).toBe("2 working days");
  });
});
