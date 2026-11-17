import { describe, expect, it } from "vitest";
import { filterEmployees, type PickerEmployee } from "./EmployeePicker";

const mk = (id: string, fullName: string, code: string | null = null): PickerEmployee => ({ id, fullName, employeeCode: code, departmentName: "Ops" });
const all = [mk("1", "Amélie Roux", "A1"), mk("2", "Sami Ben"), mk("3", "Ines Diaz"), mk("4", "Omar Lee"), mk("5", "Paul Roy"), mk("6", "Zoe Kane"), mk("7", "Yann Fox")];

describe("employee type-ahead", () => {
  it("shows the 5 most recent first, then fills alphabetically", () => {
    const r = filterEmployees(all, "", ["6", "3", "99"]);
    expect(r.map((e) => e.id)).toEqual(["6", "3", "1", "2", "4"]);
    expect(r).toHaveLength(5);
  });

  it("matches name or code, ignoring case and accents", () => {
    expect(filterEmployees(all, "amel", []).map((e) => e.id)).toEqual(["1"]);
    expect(filterEmployees(all, "a1", []).map((e) => e.id)).toEqual(["1"]);
    expect(filterEmployees(all, "ro", []).map((e) => e.id)).toEqual(["1", "5"]);
  });
});
