// /set-password?token=…&kind=invite|reset: invite link (48 h) and reset link (30 min, single use).
import { PASSWORD_MIN_LENGTH, passwordSchema } from "@leave/shared";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import { errorCode, useResetPassword } from "@/common/api/session";
import { AuthCard, FormAlert, PrimaryButton } from "@/common/components/AuthCard";
import { PasswordField } from "@/common/components/PasswordField";

export default function SetPasswordPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const isInvite = params.get("kind") === "invite";
  const reset = useResetPassword();
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
    await reset.mutateAsync({ token, newPassword }).catch(() => undefined);
  }

  if (reset.isSuccess) {
    return (
      <AuthCard title={t("auth.passwordSetTitle")} subtitle={t("auth.passwordSetSubtitle")}>
        <div className="flex flex-col gap-3">
          <Link to="/me/login" className="flex h-11 items-center justify-center rounded-md bg-accent font-medium text-accent-foreground">
            {t("auth.goToPortal")}
          </Link>
          <Link to="/login" className="flex min-h-11 items-center justify-center text-muted-foreground hover:text-foreground">
            {t("auth.goToOperator")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  const expired = reset.isError && errorCode(reset.error) === "auth.errors.invalidToken";

  return (
    <AuthCard title={isInvite ? t("auth.inviteTitle") : t("auth.resetTitle")} subtitle={t("auth.passwordRule", { min: PASSWORD_MIN_LENGTH })}>
      {!token || expired ? (
        <FormAlert>{t("auth.linkExpired")}</FormAlert>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          {reset.isError ? <FormAlert>{t(errorCode(reset.error))}</FormAlert> : null}
          <PasswordField
            label={t("auth.newPassword")}
            value={newPassword}
            onChange={setNew}
            autoComplete="new-password"
            autoFocus
            error={localError ? t(localError, { min: PASSWORD_MIN_LENGTH }) : null}
          />
          <PrimaryButton disabled={reset.isPending || !newPassword}>
            {reset.isPending ? t("common.loading") : t("auth.savePassword")}
          </PrimaryButton>
        </form>
      )}
    </AuthCard>
  );
}
