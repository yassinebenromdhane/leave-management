import { cn } from "@/lib/utils";

/** Loading placeholder: skeletons, never spinners (spec 2.3). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse rounded bg-muted", className)} />;
}

export function SkeletonRows({ rows = 6, cols = 5, label }: { rows?: number; cols?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="divide-y">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex h-9 items-center gap-4 px-3">
          {Array.from({ length: cols }, (_, j) => (
            <Skeleton key={j} className={cn("h-3", j === 0 ? "w-32" : "w-20")} />
          ))}
        </div>
      ))}
    </div>
  );
}
