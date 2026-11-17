// Email templates in French and English (spec: FR + EN from day one).
// Emails never contain medical details or leave notes.
import type { MailMessage } from "./email";

export type MailLang = "fr" | "en";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function layout(paragraphs: string[], link: { url: string; label: string }): string {
  const body = paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("");
  return `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;color:#171717">${body}<p><a href="${escapeHtml(link.url)}" style="display:inline-block;padding:10px 16px;background:#2563eb;color:#fff;border-radius:6px;text-decoration:none">${escapeHtml(link.label)}</a></p><p style="color:#737373;font-size:12px">${escapeHtml(link.url)}</p></body></html>`;
}

export function inviteEmail(lang: MailLang, p: { to: string; name: string; company: string; url: string }): MailMessage {
  const t =
    lang === "en"
      ? {
          subject: `Your leave account at ${p.company || "your company"}`,
          lines: [`Hello ${p.name},`, "You can now check your leave balances and request leave online.", "Choose your password with the link below. It is valid for 48 hours."],
          cta: "Choose my password",
        }
      : {
          subject: `Votre espace congés${p.company ? ` chez ${p.company}` : ""}`,
          lines: [`Bonjour ${p.name},`, "Vous pouvez désormais consulter vos soldes et demander vos congés en ligne.", "Choisissez votre mot de passe avec le lien ci-dessous. Il est valable 48 heures."],
          cta: "Choisir mon mot de passe",
        };
  return {
    to: p.to,
    subject: t.subject,
    text: `${t.lines.join("\n\n")}\n\n${p.url}`,
    html: layout(t.lines, { url: p.url, label: t.cta }),
  };
}

export function resetEmail(lang: MailLang, p: { to: string; name: string; url: string }): MailMessage {
  const t =
    lang === "en"
      ? {
          subject: "Reset your password",
          lines: [`Hello ${p.name},`, "Use the link below to choose a new password. It is valid for 30 minutes and works once.", "If you did not ask for this, ignore this email."],
          cta: "Choose a new password",
        }
      : {
          subject: "Réinitialisation de votre mot de passe",
          lines: [`Bonjour ${p.name},`, "Utilisez le lien ci-dessous pour choisir un nouveau mot de passe. Il est valable 30 minutes et ne fonctionne qu'une fois.", "Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail."],
          cta: "Choisir un nouveau mot de passe",
        };
  return {
    to: p.to,
    subject: t.subject,
    text: `${t.lines.join("\n\n")}\n\n${p.url}`,
    html: layout(t.lines, { url: p.url, label: t.cta }),
  };
}

// ---------- leave decision (spec 4.3 sync rule 4) ----------

export type DecisionMailInput = {
  to: string;
  name: string;
  status: "approved" | "rejected";
  leaveTypeName: string;
  startDate: string; // ISO
  endDate: string; // ISO
  startHalf: "full" | "am" | "pm";
  endHalf: "full" | "am" | "pm";
  rejectReason: string | null;
  url: string;
};

/** ISO date → dd/mm/yyyy (same in fr and en-GB; no time zone involved). */
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

function periodText(lang: MailLang, p: DecisionMailInput): string {
  const half = (h: "full" | "am" | "pm") =>
    h === "am" ? (lang === "en" ? " (morning)" : " (matin)") : h === "pm" ? (lang === "en" ? " (afternoon)" : " (après-midi)") : "";
  if (p.startDate === p.endDate) return `${dmy(p.startDate)}${half(p.startHalf)}`;
  return lang === "en"
    ? `from ${dmy(p.startDate)}${half(p.startHalf)} to ${dmy(p.endDate)}${half(p.endHalf)}`
    : `du ${dmy(p.startDate)}${half(p.startHalf)} au ${dmy(p.endDate)}${half(p.endHalf)}`;
}

/**
 * Approved / rejected notice. Contains the dates, the leave type, the decision and the reject
 * reason only: never the employee's note, attachments or anything medical.
 */
export function decisionEmail(lang: MailLang, p: DecisionMailInput): MailMessage {
  const period = periodText(lang, p);
  const approved = p.status === "approved";
  const t =
    lang === "en"
      ? {
          subject: approved ? "Your leave request was approved" : "Your leave request was declined",
          lines: [
            `Hello ${p.name},`,
            `Your request for ${p.leaveTypeName} ${period} was ${approved ? "approved" : "declined"}.`,
            ...(!approved && p.rejectReason ? [`Reason: ${p.rejectReason}`] : []),
          ],
          cta: "Open my leave",
        }
      : {
          subject: approved ? "Votre demande de congé est acceptée" : "Votre demande de congé est refusée",
          lines: [
            `Bonjour ${p.name},`,
            `Votre demande (${p.leaveTypeName}) ${period} a été ${approved ? "acceptée" : "refusée"}.`,
            ...(!approved && p.rejectReason ? [`Motif : ${p.rejectReason}`] : []),
          ],
          cta: "Voir mes congés",
        };
  return {
    to: p.to,
    subject: t.subject,
    text: `${t.lines.join("\n\n")}\n\n${p.url}`,
    html: layout(t.lines, { url: p.url, label: t.cta }),
  };
}
