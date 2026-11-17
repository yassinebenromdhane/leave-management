import type { ReactNode } from "react";

/** One sentence and one action (spec 2.3). */
export function EmptyState({ message, actionLabel, onAction, icon }: { message: string; actionLabel?: string; onAction?: () => void; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-16 text-center">
      {icon}
      <p className="text-muted-foreground">{message}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className="h-9 rounded-md border px-3 hover:bg-muted max-md:h-11">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
