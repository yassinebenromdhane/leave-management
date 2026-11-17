// Test helpers: reset tables between tests and build fixtures.
import { sql } from "drizzle-orm";
import { ensureOperator } from "../src/auth/accounts";
import { db } from "../src/db/client";
import { companySettings, department, employee } from "../src/db/schema";

export async function resetDb(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  if (!new URL(url).pathname.endsWith("_test")) throw new Error("resetDb refused: not a _test database");
  await db.execute(sql`
    truncate table "session", "account", "verification", "user",
      notification, attachment, ledger_entry, leave_request, leave_policy,
      audit_log, holiday, employee, leave_type, department, company_settings
    restart identity cascade`);
  await db.insert(companySettings).values({ id: 1, name: "Test Co", locale: "en-GB" });
}

export const OPERATOR = { email: "hr@test.local", password: "operator-initial-pw" } as const;

export async function createOperator(): Promise<void> {
  await ensureOperator(OPERATOR.email, OPERATOR.password);
}

export async function createEmployee(over: Partial<typeof employee.$inferInsert> = {}) {
  const [dept] = await db
    .insert(department)
    .values({ name: `Dept ${Math.random().toString(36).slice(2, 8)}` })
    .returning();
  const [emp] = await db
    .insert(employee)
    .values({
      fullName: "Ines Test",
      departmentId: dept!.id,
      hireDate: "2024-01-01",
      email: "ines@test.local",
      employeeCode: "EMP-001",
      ...over,
    })
    .returning();
  return emp!;
}
