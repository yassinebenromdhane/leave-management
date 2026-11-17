// Transactional email over SMTP (Brevo), sent with Nodemailer (stack §1).
// Without SMTP_HOST outside production, messages are printed to the console (development)
// or kept in memory (tests). Email failures never roll back a business change: callers log
// and record them.
import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";

export type MailMessage = { to: string; subject: string; text: string; html: string };

/** Messages captured in tests (NODE_ENV=test). */
export const testOutbox: MailMessage[] = [];

let transporter: Transporter | undefined;

function getTransporter(): Transporter | undefined {
  if (!env.SMTP_HOST) return undefined;
  transporter ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
  });
  return transporter;
}

export async function sendMail(message: MailMessage): Promise<void> {
  if (env.NODE_ENV === "test") {
    testOutbox.push(message);
    return;
  }
  const transport = getTransporter();
  if (!transport) {
    if (env.NODE_ENV === "production") throw new Error("SMTP is not configured (SMTP_HOST missing)");
    console.info(`[email:dev] to=${message.to} subject="${message.subject}"\n${message.text}\n`);
    return;
  }
  await transport.sendMail({ from: env.MAIL_FROM, ...message });
}
