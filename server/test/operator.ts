// Fixtures for operator API tests: a signed-in operator and the leave types the tests use.
import { expect } from "vitest";
import { db } from "../src/db/client";
import { leaveType } from "../src/db/schema";
import { TestClient } from "./client";
import { createOperator, OPERATOR } from "./db";

export const OPERATOR_NEW_PASSWORD = "a-fresh-password";

/** Seeds the operator, signs in and completes the forced first password change. */
export async function signedInOperator(): Promise<TestClient> {
  await createOperator();
  const c = new TestClient();
  expect((await c.signIn(OPERATOR.email, OPERATOR.password)).status).toBe(200);
  const changed = await c.post("/api/session/change-password", {
    currentPassword: OPERATOR.password,
    newPassword: OPERATOR_NEW_PASSWORD,
  });
  expect(changed.status).toBe(200);
  return c;
}

/** paid (deducts), comp (deducts), sick (attachment required, no deduction), unpaid. */
export async function createLeaveTypes() {
  const rows = await db
    .insert(leaveType)
    .values([
      { code: "paid", name: "Paid leave", color: "blue", deductsBalance: true, sortOrder: 0 },
      { code: "comp_rest", name: "Comp rest", color: "teal", deductsBalance: true, sortOrder: 1 },
      { code: "sick", name: "Sick leave", color: "rose", deductsBalance: false, requiresAttachment: true, sortOrder: 2 },
      { code: "unpaid", name: "Unpaid", color: "slate", deductsBalance: false, isPaid: false, sortOrder: 3 },
    ])
    .returning();
  const by = (code: string) => rows.find((r) => r.code === code)!;
  return { paid: by("paid"), comp: by("comp_rest"), sick: by("sick"), unpaid: by("unpaid") };
}

export async function json<T = Record<string, unknown>>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Gives the employee a portal login (temporary password flow) and returns a signed-in client. */
export async function signedInEmployee(op: TestClient, employeeId: string): Promise<TestClient> {
  const issued = await json<{ temporaryPassword: string; loginIdentifier: string }>(
    await op.post(`/api/operator/employees/${employeeId}/temporary-password`),
  );
  const c = new TestClient();
  expect((await c.signIn(issued.loginIdentifier, issued.temporaryPassword)).status).toBe(200);
  const changed = await c.post("/api/session/change-password", {
    currentPassword: issued.temporaryPassword,
    newPassword: "employee-new-pass",
  });
  expect(changed.status).toBe(200);
  return c;
}
