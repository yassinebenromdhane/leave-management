import type { ReactNode } from "react";

/** Centred card for sign-in and password screens; a 480 px column on desktop. Props-only. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="flex min-h-full items-start justify-center px-4 py-12 sm:items-center">
      <div className="w-full max-w-[400px] rounded-lg border bg-background p-6 shadow-overlay">
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle ? <p className="mt-1 text-muted-foreground">{subtitle}</p> : null}
        <div className="mt-6">{children}</div>
      </div>
    </main>
  );
}

export function PrimaryButton({ children, disabled }: { children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="submit"
      disabled={disabled}
      className="h-11 w-full rounded-md bg-accent px-4 text-[15px] font-medium text-accent-foreground disabled:opacity-60"
    >
      {children}
    </button>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="rounded-md border border-status-rejected/40 bg-status-rejected/5 px-3 py-2 text-status-rejected">
      {children}
    </p>
  );
}
