// Server-side header and value dictionary for exported files (spec 1.6). The only place export
// wording lives; chosen by company_settings.locale (fr* → fr, otherwise en).
export type ExportLang = "fr" | "en";

export const langOf = (locale: string): ExportLang => (locale.toLowerCase().startsWith("fr") ? "fr" : "en");

const DICT = {
  fr: {
    sheet: { payroll: "Synthèse paie", leaveDetail: "Détail des congés" },
    col: {
      employeeCode: "Matricule",
      fullName: "Salarié",
      department: "Service",
      unpaidDays: "Jours non payés",
      balanceStart: "{type} – solde début",
      balanceEnd: "{type} – solde fin",
      leaveType: "Type",
      startDate: "Début",
      endDate: "Fin",
      startHalf: "Demi-journée début",
      endHalf: "Demi-journée fin",
      days: "Jours (total)",
      daysInPeriod: "Jours sur la période",
      status: "Statut",
      note: "Note",
      attachment: "Justificatif",
      source: "Origine",
    },
    status: { pending: "En attente", approved: "Approuvé", rejected: "Refusé", cancelled: "Annulé" },
    half: { full: "Journée", am: "Matin", pm: "Après-midi" },
    source: { operator: "RH", portal: "Portail" },
    bool: { true: "Oui", false: "Non" },
  },
  en: {
    sheet: { payroll: "Payroll summary", leaveDetail: "Leave detail" },
    col: {
      employeeCode: "Employee code",
      fullName: "Employee",
      department: "Department",
      unpaidDays: "Unpaid days",
      balanceStart: "{type} – opening balance",
      balanceEnd: "{type} – closing balance",
      leaveType: "Type",
      startDate: "Start",
      endDate: "End",
      startHalf: "Start half",
      endHalf: "End half",
      days: "Days (total)",
      daysInPeriod: "Days in period",
      status: "Status",
      note: "Note",
      attachment: "Attachment",
      source: "Source",
    },
    status: { pending: "Pending", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" },
    half: { full: "Full day", am: "Morning", pm: "Afternoon" },
    source: { operator: "HR", portal: "Portal" },
    bool: { true: "Yes", false: "No" },
  },
} as const;

export type ColumnLabel = keyof (typeof DICT)["en"]["col"];
export type SheetName = keyof (typeof DICT)["en"]["sheet"];
export type ValueDict = "status" | "half" | "source";

export const colLabel = (lang: ExportLang, key: ColumnLabel, params: { type?: string } = {}): string =>
  DICT[lang].col[key].replace("{type}", params.type ?? "");

export const sheetLabel = (lang: ExportLang, key: SheetName): string => DICT[lang].sheet[key];

export const valueLabel = (lang: ExportLang, dict: ValueDict, value: string): string =>
  (DICT[lang][dict] as Record<string, string>)[value] ?? value;

export const boolLabel = (lang: ExportLang, value: boolean): string => DICT[lang].bool[value ? "true" : "false"];
