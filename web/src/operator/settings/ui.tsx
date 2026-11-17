// Small form primitives shared by the Settings tabs. Native controls keep focus and keyboard behaviour.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export const inputCls = "h-8 w-full rounded-md border bg-background px-2 disabled:bg-muted/50 max-md:h-11";

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-meta font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-meta text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export function Check({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  return (
    <label className="flex min-h-8 items-start gap-2 max-md:min-h-11">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--accent)]" />
      <span>
        {label}
        {hint ? <span className="block text-meta text-muted-foreground">{hint}</span> : null}
      </span>
    </label>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="mb-3 text-[15px] font-semibold">{children}</h2>;
}

export function PrimaryButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={cn("h-8 rounded-md bg-accent px-3 font-medium text-accent-foreground disabled:opacity-60 max-md:h-11", rest.className)}>
      {children}
    </button>
  );
}

export function GhostButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} className={cn("h-8 rounded-md border px-3 hover:bg-muted disabled:opacity-60 max-md:h-11", rest.className)}>
      {children}
    </button>
  );
}
