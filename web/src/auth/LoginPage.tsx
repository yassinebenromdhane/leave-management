// One login screen for both surfaces (spec 2.5): identifier (email or employee code), password
// with show toggle, "Keep me signed in", "Forgot password?". No sign-up, no magic links.
import { useId, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { errorCode, useSignIn } from "@/common/api/session";
import { AuthCard, FormAlert, PrimaryButton } from "@/common/components/AuthCard";
import { PasswordField } from "@/common/components/PasswordField";

export default function LoginPage({ surface }: { surface: "operator" | "portal" }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const signIn = useSignIn();
  const idField = useId();
  const rememberId = useId();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(surface === "portal");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    try {
      const result = await signIn.mutateAsync({ identifier, password, rememberMe });
      navigate(result.role === "employee" ? "/me" : "/", { replace: true });
    } catch {
      setPassword("");
    }
  }

  return (
    <AuthCard title={surface === "portal" ? t("auth.portalTitle") : t("auth.operatorTitle")}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        {signIn.isError ? <FormAlert>{t(errorCode(signIn.error))}</FormAlert> : null}
        <div className="flex flex-col gap-1">
          <label htmlFor={idField} className="text-[length:var(--text-meta)] font-medium">
            {surface === "portal" ? t("auth.identifier") : t("auth.email")}
          </label>
          <input
            id={idField}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
            className="h-11 rounded-md border bg-transparent px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
        <PasswordField label={t("auth.password")} value={password} onChange={setPassword} autoComplete="current-password" />
        <div className="flex items-center justify-between gap-2">
          <label htmlFor={rememberId} className="flex min-h-11 cursor-pointer items-center gap-2">
            <input
              id={rememberId}
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="size-4"
            />
            {t("auth.rememberMe")}
          </label>
          <Link to="/forgot-password" className="flex min-h-11 items-center text-accent hover:underline">
            {t("auth.forgotPassword")}
          </Link>
        </div>
        <PrimaryButton disabled={signIn.isPending || !identifier || !password}>
          {signIn.isPending ? t("common.loading") : t("auth.signIn")}
        </PrimaryButton>
      </form>
    </AuthCard>
  );
}
