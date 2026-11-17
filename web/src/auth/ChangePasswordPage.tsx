// Forced password change at first login with a temporary or initial password (spec 2.5).
import { PASSWORD_MIN_LENGTH, passwordSchema } from "@leave/shared";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { errorCode, useChangePassword, useSignOut } from "@/common/api/session";
import { AuthCard, FormAlert, PrimaryButton } from "@/common/components/AuthCard";
import { PasswordField } from "@/common/components/PasswordField";

export default function ChangePasswordPage() {
  const { t } = useTranslation();
  const change = useChangePassword();
  const signOut = useSignOut();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = passwordSchema.safeParse(newPassword);
    if (!parsed.success) {
      setLocalError(parsed.error.issues[0]?.message ?? "errors.generic");
      return;
    }
    setLocalError(null);
    await change.mutateAsync({ currentPassword, newPassword }).catch(() => undefined);
  }

  return (
    <AuthCard title={t("auth.changePasswordTitle")} subtitle={t("auth.changePasswordSubtitle")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {change.isError ? <FormAlert>{t(errorCode(change.error))}</FormAlert> : null}
        <PasswordField label={t("auth.currentPassword")} value={currentPassword} onChange={setCurrent} autoComplete="current-password" autoFocus />
        <PasswordField
          label={t("auth.newPassword")}
          value={newPassword}
          onChange={setNew}
          autoComplete="new-password"
          error={localError ? t(localError, { min: PASSWORD_MIN_LENGTH }) : null}
        />
        <p className="text-[length:var(--text-meta)] text-muted-foreground">{t("auth.passwordRule", { min: PASSWORD_MIN_LENGTH })}</p>
        <PrimaryButton disabled={change.isPending || !currentPassword || !newPassword}>
          {change.isPending ? t("common.loading") : t("auth.savePassword")}
        </PrimaryButton>
        <button type="button" onClick={() => signOut.mutate()} className="min-h-11 text-muted-foreground hover:text-foreground">
          {t("auth.signOut")}
        </button>
      </form>
    </AuthCard>
  );
}
