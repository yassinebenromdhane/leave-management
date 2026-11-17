import { describe, expect, it } from "vitest";
import { allowedTransitions } from "./status";

describe("status transitions offered in the UI", () => {
  it("offers approved -> pending (the server reverses the ledger entry) and every other move", () => {
    expect(allowedTransitions("approved")).toEqual(["pending", "rejected", "cancelled"]);
    expect(allowedTransitions("pending")).toEqual(["approved", "rejected", "cancelled"]);
    expect(allowedTransitions("rejected")).toEqual(["pending", "approved"]);
  });
});
