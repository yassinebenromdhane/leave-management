// Portal settings (spec 2.5): language, change password, sign out. Nothing else.
import { PASSWORD_MIN_LENGTH, passwordSchema } from "@leave/shared";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorCode, useChangePassword } from "@/common/api/session";
import { PasswordField } from "@/common/components/PasswordField";
import { SignOutButton } from "@/common/components/SignOutButton";
import { setLanguage } from "@/common/i18n";
import { cn } from "@/lib/utils";
import { Sheet } from "@/ui/Sheet";

const LANGS = [
  { code: "fr", label: "Français" },
  { code: "en", label: "English" },
] as const;

export function SettingsSheet({ onClose, onSignOut, signingOut }: { onClose: () => void; onSignOut: () => void; signingOut?: boolean }) {
  const { t, i18n } = useTranslation();
  const change = useChangePassword();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const lang = i18n.language.startsWith("en") ? "en" : "fr";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(next);
    if (!parsed.success) return setLocalError(parsed.error.issues[0]?.message ?? "errors.generic");
    setLocalError(null);
    try {
      await change.mutateAsync({ currentPassword: current, newPassword: next });
      setSaved(true);
      setOpen(false);
      setCurrent("");
      setNext("");
    } catch {
      // the error is shown from change.error
    }
  }

  return (
    <Sheet title={t("portal.settings.title")} onClose={onClose}>
      <div className="space-y-5 p-4">
        <section className="space-y-2" aria-label={t("portal.settings.language")}>
          <h3 className="font-medium">{t("portal.settings.language")}</h3>
          <div role="radiogroup" aria-label={t("portal.settings.language")} className="inline-flex rounded-md border p-0.5">
            {LANGS.map((l) => (
              <button
                key={l.code}
                type="button"
                role="radio"
                aria-checked={lang === l.code}
                onClick={() => setLanguage(l.code)}
                className={cn("h-11 min-w-16 rounded px-3", lang === l.code ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted")}
              >
                {l.label}
              </button>
            ))}
          </div>
        </section>

        <section className="space-y-2" aria-label={t("portal.settings.password")}>
          {saved ? (
            <p role="status" className="text-status-approved">
              {t("portal.settings.passwordSaved")}
            </p>
          ) : null}
          {open ? (
            <form onSubmit={onSubmit} className="space-y-3" noValidate>
              {change.isError ? (
                <p role="alert" className="text-status-rejected">
                  {t(errorCode(change.error))}
                </p>
              ) : null}
              <PasswordField label={t("auth.currentPassword")} value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
              <PasswordField
                label={t("auth.newPassword")}
                value={next}
                onChange={setNext}
                autoComplete="new-password"
                error={localError ? t(localError, { min: PASSWORD_MIN_LENGTH }) : null}
              />
              <p className="text-meta text-muted-foreground">{t("auth.passwordRule", { min: PASSWORD_MIN_LENGTH })}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setOpen(false)} className="h-11 flex-1 rounded-md border">
                  {t("common.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={change.isPending || !current || !next}
                  className="h-11 flex-1 rounded-md bg-accent font-medium text-accent-foreground disabled:opacity-50"
                >
                  {t("auth.savePassword")}
                </button>
              </div>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSaved(false);
                setOpen(true);
              }}
              className="h-11 w-full rounded-md border px-3 text-start hover:bg-muted"
            >
              {t("portal.settings.changePassword")}
            </button>
          )}
        </section>

        <SignOutButton onSignOut={onSignOut} pending={signingOut} />
      </div>
    </Sheet>
  );
}
