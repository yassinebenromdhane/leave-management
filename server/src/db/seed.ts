// Idempotent seed: running it twice changes nothing.
// - company_settings defaults (Mon–Fri, leave year starts in January, approved on save, no negatives)
// - the five leave-type presets from spec 1.5
// - a placeholder policy and holiday list. The first country preset is an open spec question,
//   so nothing here is presented as legal fact. Everything is editable in Settings.
import { sql } from "drizzle-orm";
import { WEEK_PRESETS } from "@leave/shared";
import { ensureOperator } from "../auth/accounts";
import { env } from "../env";
import { db, sql as pg } from "./client";
import { companySettings, holiday, leavePolicy, leaveType } from "./schema";

type Locale = "fr" | "en";
const L = (fr: string, en: string) => ({ fr, en });

const LEAVE_TYPE_PRESETS = [
  { code: "paid", name: L("Congé payé", "Paid leave"), color: "blue", isPaid: true, deductsBalance: true, requiresAttachment: false, dayCountMode: "working" },
  { code: "sick", name: L("Maladie", "Sick leave"), color: "rose", isPaid: true, deductsBalance: false, requiresAttachment: true, dayCountMode: "working" },
  { code: "unpaid", name: L("Congé sans solde", "Unpaid leave"), color: "slate", isPaid: false, deductsBalance: false, requiresAttachment: false, dayCountMode: "working" },
  { code: "special", name: L("Congé exceptionnel", "Special leave"), color: "violet", isPaid: true, deductsBalance: false, requiresAttachment: false, dayCountMode: "working" },
  { code: "comp_rest", name: L("Repos compensateur", "Compensatory rest"), color: "teal", isPaid: true, deductsBalance: true, requiresAttachment: false, dayCountMode: "working" },
] as const;

// TODO(spec-open-question): replace with the first country preset once its labour code is checked.
// Only near-universal fixed-date days are seeded so the timeline shading can be exercised.
const PLACEHOLDER_HOLIDAYS = [
  { date: "2026-01-01", name: L("Jour de l'an", "New Year's Day") },
  { date: "2026-05-01", name: L("Fête du travail", "Labour Day") },
  { date: "2027-01-01", name: L("Jour de l'an", "New Year's Day") },
  { date: "2027-05-01", name: L("Fête du travail", "Labour Day") },
];

// TODO(spec-open-question): placeholder accrual rate for paid leave, not a legal value.
const PLACEHOLDER_PAID_POLICY = { accrualMode: "monthly", rateDays: "1.5", effectiveFrom: "2026-01-01" } as const;

async function seed(locale: Locale) {
  await db.transaction(async (tx) => {
    await tx
      .insert(companySettings)
      .values({
        id: 1,
        workDays: WEEK_PRESETS.monFri,
        leaveYearStartMonth: 1,
        defaultSaveStatus: "approved",
        allowNegative: false,
        locale: locale === "fr" ? "fr-FR" : "en-GB",
      })
      .onConflictDoNothing();

    await tx
      .insert(leaveType)
      .values(
        LEAVE_TYPE_PRESETS.map((p, i) => ({
          code: p.code,
          name: p.name[locale],
          color: p.color,
          isPaid: p.isPaid,
          deductsBalance: p.deductsBalance,
          requiresAttachment: p.requiresAttachment,
          dayCountMode: p.dayCountMode,
          sortOrder: i,
        })),
      )
      .onConflictDoNothing({ target: leaveType.code });

    const [paid] = await tx
      .select({ id: leaveType.id })
      .from(leaveType)
      .where(sql`${leaveType.code} = 'paid'`);
    if (paid) {
      await tx
        .insert(leavePolicy)
        .values({ leaveTypeId: paid.id, prorateHireMonth: true, ...PLACEHOLDER_PAID_POLICY })
        .onConflictDoNothing({ target: [leavePolicy.leaveTypeId, leavePolicy.effectiveFrom] });
    }

    await tx
      .insert(holiday)
      .values(PLACEHOLDER_HOLIDAYS.map((h) => ({ date: h.date, name: h.name[locale], source: "preset" as const })))
      .onConflictDoNothing({ target: holiday.date });
  });
}

async function seedOperator() {
  if (!env.OPERATOR_EMAIL || !env.OPERATOR_INITIAL_PASSWORD) {
    console.log("Operator account skipped: set OPERATOR_EMAIL and OPERATOR_INITIAL_PASSWORD in .env");
    return;
  }
  const result = await ensureOperator(env.OPERATOR_EMAIL, env.OPERATOR_INITIAL_PASSWORD);
  console.log(
    result === "created"
      ? "Operator account created (must choose a new password at first login)"
      : "Operator account already exists",
  );
}

try {
  await seed(env.SEED_LOCALE);
  await seedOperator();
  console.log(`Seed complete (locale: ${env.SEED_LOCALE})`);
} finally {
  await pg.end();
}
