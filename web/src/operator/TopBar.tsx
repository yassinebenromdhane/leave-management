import { Download, LogOut, Plus, Search, UsersRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { todayIso, monthBounds } from "@/common/lib/date";
import { formatDay } from "@/common/lib/format";
import { downloadReport } from "./reports/download";
import { getExportFormat } from "./reports/exportFormat";
import { useSessionUser, useSignOut } from "@/common/api/session";
import { useMediaQuery } from "@/common/hooks/useMediaQuery";
import { setLanguage } from "@/common/i18n";
import { useOperatorUi } from "./OperatorContext";
import { cn } from "@/lib/utils";
import { useDrawerNav } from "./useDrawerNav";
import { DepartmentSelect, PeriodNav, ZoomSwitch } from "./workspace/controls";

export function TopBar({ workspace }: { workspace: boolean }) {
  const { t, i18n } = useTranslation();
  const { search, setSearch, searchRef, panelOpen, setPanelOpen, overlayOpen, setOverlayOpen } = useOperatorUi();
  const wide = useMediaQuery("(min-width: 1280px)");
  const whosOutOpen = wide ? panelOpen : overlayOpen;
  const nav = useDrawerNav();
  const navigate = useNavigate();
  const session = useSessionUser();
  const signOut = useSignOut();
  const lang = i18n.language.startsWith("en") ? "en" : "fr";
  const format = getExportFormat();
  const month = formatDay(todayIso(), i18n.language, { month: "long", year: "numeric" });
  const exportLabel = t("topbar.exportTitle", { month, format: format.toUpperCase() });
  // Spec 1.6: one click = the current month's payroll summary in the last-used format.
  const exportMonth = () => {
    const { from, to } = monthBounds(todayIso());
    downloadReport("payroll", from, to, getExportFormat());
  };

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <div className="relative min-w-0 flex-1 md:max-w-[14rem] xl:max-w-sm">
        <Search size={14} className="pointer-events-none absolute start-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              e.currentTarget.blur();
            }
          }}
          aria-label={t("topbar.search")}
          placeholder={t("topbar.search")}
          className="h-8 w-full rounded-md border bg-muted/40 ps-8 pe-8 placeholder:text-muted-foreground focus:bg-background max-md:h-11"
        />
        <kbd className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 rounded border bg-background px-1 text-meta text-muted-foreground max-md:hidden">/</kbd>
      </div>
      {workspace ? (
        <>
          <DepartmentSelect className="hidden lg:block" />
          <PeriodNav className="hidden lg:flex" />
          <ZoomSwitch className="max-md:hidden" />
          <div className="flex-1 max-md:hidden" />
          <button
            type="button"
            onClick={() => (wide ? setPanelOpen(!panelOpen) : setOverlayOpen(!overlayOpen))}
            aria-pressed={whosOutOpen}
            aria-label={t("whosOut.toggle")}
            title={t("whosOut.toggle")}
            className={cn("grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted max-md:hidden", whosOutOpen && "bg-muted text-foreground")}
          >
            <UsersRound size={16} aria-hidden="true" />
          </button>
        </>
      ) : null}
      <button
        type="button"
        onClick={exportMonth}
        title={exportLabel}
        aria-label={exportLabel}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border px-3 hover:bg-muted max-md:hidden"
      >
        <Download size={14} aria-hidden="true" />
        {t("topbar.export")}
      </button>
      <button
        type="button"
        onClick={() => nav.open("/leave/new")}
        className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 font-medium text-accent-foreground max-md:hidden"
      >
        <Plus size={14} aria-hidden="true" />
        {t("topbar.logLeave")}
        <kbd className="ms-1 rounded bg-white/20 px-1 text-meta">C</kbd>
      </button>
      <button
        type="button"
        onClick={() => setLanguage(lang === "fr" ? "en" : "fr")}
        aria-label={t("topbar.switchLanguage")}
        className="h-8 rounded-md px-2 text-meta font-medium text-muted-foreground hover:bg-muted max-md:h-11"
      >
        {lang === "fr" ? "EN" : "FR"}
      </button>
      <span className="hidden text-meta text-muted-foreground lg:inline">{session.data?.name}</span>
      <button
        type="button"
        onClick={() => signOut.mutate(undefined, { onSettled: () => navigate("/login") })}
        disabled={signOut.isPending}
        aria-label={t("auth.signOut")}
        title={t("auth.signOut")}
        className="grid h-8 w-8 place-items-center rounded-md text-muted-foreground hover:bg-muted max-md:h-11 max-md:w-11"
      >
        <LogOut size={16} aria-hidden="true" />
      </button>
    </header>
  );
}
