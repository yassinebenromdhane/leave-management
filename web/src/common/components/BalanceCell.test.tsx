import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BalanceCell, balanceTone } from "./BalanceCell";

describe("balance cell colouring", () => {
  it("red below 0, amber below 2, normal otherwise", () => {
    expect(balanceTone(-0.5)).toBe("negative");
    expect(balanceTone(0)).toBe("low");
    expect(balanceTone(1.5)).toBe("low");
    expect(balanceTone(2)).toBe("ok");
    expect(balanceTone(12)).toBe("ok");
  });

  it("applies the token classes to the main figure and shows taken and pending", () => {
    const { rerender } = render(<BalanceCell available={-1} taken={8} pending={2} />);
    expect(screen.getByTestId("balance-main").className).toContain("text-balance-negative");
    expect(screen.getByText("8 taken · 2 pending")).toBeTruthy();
    rerender(<BalanceCell available={1.5} taken={0} pending={0} />);
    expect(screen.getByTestId("balance-main").className).toContain("text-balance-low");
    expect(screen.getByTestId("balance-main").textContent).toBe("1.5");
    rerender(<BalanceCell available={10} taken={0} pending={0} />);
    expect(screen.getByTestId("balance-main").className).not.toContain("text-balance");
  });
});
