// Idempotent seed: running it twice changes nothing.
// - company_settings defaults (Mon–Fri, leave year starts in January, approved on save, no negatives)
// - the five leave-type presets from spec 1.5
// - the Tunisia preset: public holidays (lunar ones as unconfirmed estimates) and a default paid
//   leave policy of 22 days a year earned monthly. Everything is editable in Settings; the rate is
//   the operator's figure, not a statement of the law.
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

// Country preset: TUNISIA (decided with the operator, Nov 2026). Editable in Settings → Holidays.
// Fixed-date public holidays, every year:
const TN_FIXED = [
  { md: "01-01", name: L("Jour de l'an", "New Year's Day") },
  { md: "03-20", name: L("Fête de l'Indépendance", "Independence Day") },
  { md: "04-09", name: L("Journée des Martyrs", "Martyrs' Day") },
  { md: "05-01", name: L("Fête du Travail", "Labour Day") },
  { md: "07-25", name: L("Fête de la République", "Republic Day") },
  { md: "08-13", name: L("Fête de la Femme", "Women's Day") },
  { md: "10-15", name: L("Fête de l'Évacuation", "Evacuation Day") },
  { md: "12-17", name: L("Fête de la Révolution", "Revolution Day") },
];
// Religious holidays follow the lunar calendar: these are ESTIMATED dates, seeded unconfirmed
// ("date to confirm" in the UI) until the official announcement; the operator moves them then.
const TN_LUNAR_ESTIMATES = [
  { date: "2027-03-10", name: L("Aïd el-Fitr", "Eid al-Fitr") },
  { date: "2027-03-11", name: L("Aïd el-Fitr (2e jour)", "Eid al-Fitr (day 2)") },
  { date: "2027-05-17", name: L("Aïd el-Idha", "Eid al-Adha") },
  { date: "2027-05-18", name: L("Aïd el-Idha (2e jour)", "Eid al-Adha (day 2)") },
  { date: "2027-06-06", name: L("Ras el-Am el-Hijri", "Islamic New Year") },
  { date: "2027-08-15", name: L("Mouled", "Prophet's Birthday") },
];
const TN_HOLIDAYS = [
  ...[2026, 2027].flatMap((y) => TN_FIXED.map((h) => ({ date: `${y}-${h.md}`, name: h.name, isConfirmed: true }))),
  ...TN_LUNAR_ESTIMATES.map((h) => ({ ...h, isConfirmed: false })),
];

// Paid leave default: 22 days per leave year, earned monthly (operator's figure, Nov 2026). An
// editable company default, not a statement of Tunisian law: check the labour code / collective
// agreement that applies and change it in Settings → Accrual.
const DEFAULT_PAID_POLICY = { accrualMode: "monthly", rateDays: "22.0", effectiveFrom: "2026-01-01" } as const;

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
        .values({ leaveTypeId: paid.id, prorateHireMonth: true, ...DEFAULT_PAID_POLICY })
        .onConflictDoNothing({ target: [leavePolicy.leaveTypeId, leavePolicy.effectiveFrom] });
    }

    await tx
      .insert(holiday)
      .values(TN_HOLIDAYS.map((h) => ({ date: h.date, name: h.name[locale], isConfirmed: h.isConfirmed, source: "preset" as const })))
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
