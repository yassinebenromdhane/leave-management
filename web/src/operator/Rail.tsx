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

/** 56 px left rail; expands to labels on hover or keyboard focus (spec 2.1). */
export function Rail({ pagePath }: { pagePath: string }) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t("nav.main")} className="relative hidden w-14 shrink-0 md:block">
      <div className="group absolute inset-y-0 start-0 z-20 w-14 overflow-hidden border-e bg-background transition-[width] duration-150 hover:w-48 hover:shadow-overlay focus-within:w-48 focus-within:shadow-overlay">
        <div className="grid h-12 place-items-center border-b text-[15px] font-bold text-accent" aria-hidden="true">
          L
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
                    "flex h-10 items-center gap-3 rounded-md px-2.5 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-accent",
                    active && "bg-muted font-medium text-foreground",
                  )}
                >
                  <Icon size={18} className="shrink-0" aria-hidden="true" />
                  <span className="whitespace-nowrap">{t(label)}</span>
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
