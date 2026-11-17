// "Forgot password?": always shows the same confirmation (no account enumeration).
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { useForgotPassword } from "@/common/api/session";
import { AuthCard, PrimaryButton } from "@/common/components/AuthCard";

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const forgot = useForgotPassword();
  const emailId = useId();
  const [email, setEmail] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await forgot.mutateAsync({ email }).catch(() => undefined);
  }

  return (
    <AuthCard title={t("auth.forgotTitle")} subtitle={forgot.isSuccess ? undefined : t("auth.forgotSubtitle")}>
      {forgot.isSuccess ? (
        <p role="status">{t("auth.forgotSent")}</p>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-1">
            <label htmlFor={emailId} className="text-[length:var(--text-meta)] font-medium">
              {t("auth.email")}
            </label>
            <input
              id={emailId}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              autoFocus
              className="h-11 rounded-md border bg-transparent px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent"
            />
          </div>
          <PrimaryButton disabled={forgot.isPending || !email.includes("@")}>{t("auth.sendLink")}</PrimaryButton>
          <p className="text-[length:var(--text-meta)] text-muted-foreground">{t("auth.noEmailHint")}</p>
        </form>
      )}
      <Link to="/me/login" className="mt-4 flex min-h-11 items-center text-accent hover:underline">
        {t("auth.backToSignIn")}
      </Link>
    </AuthCard>
  );
}
