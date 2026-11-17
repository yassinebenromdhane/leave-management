// Bottom tab bar: Home, My leaves, Team (hidden when the operator turned team visibility off).
import { CalendarDays, Home, Users } from "lucide-react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router";
import { cn } from "@/lib/utils";

export function TabBar({ teamVisible }: { teamVisible: boolean }) {
  const { t } = useTranslation();
  const tabs = [
    { to: "/me", end: true, label: t("portal.tabs.home"), icon: Home },
    { to: "/me/leaves", end: false, label: t("portal.tabs.leaves"), icon: CalendarDays },
    ...(teamVisible ? [{ to: "/me/team", end: false, label: t("portal.tabs.team"), icon: Users }] : []),
  ];
  return (
    <nav aria-label={t("portal.tabs.label")} className="flex border-t bg-background pb-[env(safe-area-inset-bottom)]">
      {tabs.map(({ to, end, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          className={({ isActive }) =>
            cn("flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-meta", isActive ? "font-medium text-accent" : "text-muted-foreground hover:text-foreground")
          }
        >
          <Icon size={20} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
