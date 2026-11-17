import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: "current-password" | "new-password";
  autoFocus?: boolean;
  error?: string | null;
};

/** Password input with a show/hide toggle (spec 2.5). Props-only. */
export function PasswordField({ label, value, onChange, autoComplete, autoFocus, error }: Props) {
  const { t } = useTranslation();
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-[length:var(--text-meta)] font-medium">
        {label}
      </label>
      <div className="flex items-stretch rounded-md border focus-within:ring-2 focus-within:ring-accent">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-err` : undefined}
          className="h-11 min-w-0 flex-1 rounded-md bg-transparent px-3 text-[15px] outline-none"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          className="h-11 shrink-0 px-3 text-[length:var(--text-meta)] text-muted-foreground hover:text-foreground"
        >
          {visible ? t("auth.hidePassword") : t("auth.showPassword")}
        </button>
      </div>
      {error ? (
        <p id={`${id}-err`} role="alert" className="text-[length:var(--text-meta)] text-status-rejected">
          {error}
        </p>
      ) : null}
    </div>
  );
}
