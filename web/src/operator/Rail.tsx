import { BarChart3, CalendarDays, Settings, Users, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { cn } from "@/lib/utils";

export const NAV_ITEMS: Array<{ to: string; label: string; icon: LucideIcon }> = [
  { to: "/", label: "nav.workspace", icon: CalendarDays },
  { to: "/employees", label: "nav.employees", icon: Users },
  { to: "/reports", label: "nav.reports", icon: BarChart3 },
  { to: "/settings", label: "nav.settings", icon: Settings },
];

/**
 * 56 px left rail; expands to labels on hover or keyboard focus (spec 2.1). The expanded panel
 * overlays the page (absolute, z-[25]) rather than pushing it, so the timeline never reflows.
 * Collapsed: labels are fully transparent (not merely clipped), icons centred in the 56 px column.
 */
export function Rail({ pagePath }: { pagePath: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.main")} className="relative z-[25] hidden w-14 shrink-0 md:block">
      <div className="group absolute inset-y-0 start-0 w-14 overflow-hidden border-e bg-background transition-[width,box-shadow] duration-200 ease-out hover:w-52 hover:shadow-overlay focus-within:w-52 focus-within:shadow-overlay motion-reduce:transition-none">
        <div className="flex h-14 items-center border-b px-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-[15px] font-bold text-accent-foreground shadow-card" aria-hidden="true">
            L
          </span>
        </div>
        <ul className="space-y-1 p-1.5">
          {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
            const active = to === "/" ? pagePath === "/" : pagePath.startsWith(to);
            return (
              <li key={to}>
                <Link
                  to={to}
                  aria-label={t(label)}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "relative flex h-10 items-center gap-3 rounded-lg px-[13px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent",
                    active && "bg-accent-soft font-medium text-accent hover:bg-accent-soft hover:text-accent",
                  )}
                >
                  {active ? <span aria-hidden="true" className="absolute inset-y-2 -start-1.5 w-[3px] rounded-e-full bg-accent" /> : null}
                  <Icon size={18} className="shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 motion-reduce:transition-none">
                    {t(label)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

/** Bottom tab bar under 768 px. */
export function BottomNav({ pagePath }: { pagePath: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.main")} className="flex shrink-0 border-t md:hidden">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
        const active = to === "/" ? pagePath === "/" : pagePath.startsWith(to);
        return (
          <Link
            key={to}
            to={to}
            aria-current={active ? "page" : undefined}
            className={cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-meta text-muted-foreground", active && "font-medium text-accent")}
          >
            <Icon size={18} aria-hidden="true" />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
