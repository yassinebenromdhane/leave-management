import { useTranslation } from "react-i18next";

/** Props-only sign-out button; the shell owns the mutation. */
export function SignOutButton({ onSignOut, pending }: { onSignOut: () => void; pending?: boolean }) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onSignOut}
      disabled={pending}
      className="min-h-11 rounded-md border px-3 text-muted-foreground hover:text-foreground"
    >
      {t("auth.signOut")}
    </button>
  );
}
