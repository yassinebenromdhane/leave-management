import { db } from "../db/client";
import { companySettings } from "../db/schema";
import type { MailLang } from "../services/emailTemplates";

/** Email language and company name come from company_settings (single row). */
export async function companyMailContext(): Promise<{ lang: MailLang; company: string }> {
  const [row] = await db
    .select({ locale: companySettings.locale, name: companySettings.name })
    .from(companySettings)
    .limit(1);
  return { lang: row?.locale.toLowerCase().startsWith("en") ? "en" : "fr", company: row?.name ?? "" };
}
