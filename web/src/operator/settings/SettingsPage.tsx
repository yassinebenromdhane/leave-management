// Settings (spec 1.5): Company, Leave types, Accrual, Public holidays. Under 768 px every tab is
// read-only (spec 2.4): values are shown, editing controls are hidden or disabled.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/common/api/settings";
import { EmptyState } from "@/common/components/EmptyState";
import { useMediaQuery } from "@/common/hooks/useMediaQuery";
import { errorMessage } from "@/common/lib/errorMessage";
import { cn } from "@/lib/utils";
import { SkeletonRows } from "@/ui/Skeleton";
import { AccrualTab } from "./AccrualTab";
import { CompanyTab } from "./CompanyTab";
import { HolidaysTab } from "./HolidaysTab";
import { LeaveTypesTab } from "./LeaveTypesTab";

const TABS = ["company", "types", "accrual", "holidays"] as const;
type Tab = (typeof TABS)[number];

export default function SettingsPage({ forceReadOnly }: { forceReadOnly?: boolean } = {}) {
  const { t } = useTranslation();
  const narrow = useMediaQuery("(max-width: 767px)");
  const readOnly = forceReadOnly ?? narrow;
  const [tab, setTab] = useState<Tab>("company");
  const settings = useSettings();

  return (
    <section className="flex h-full flex-col">
      <div className="flex min-h-12 shrink-0 flex-wrap items-center gap-3 border-b px-4">
        <h1 className="text-[15px] font-semibold">{t("nav.settings")}</h1>
        <div role="tablist" aria-label={t("nav.settings")} className="flex gap-1 overflow-x-auto">
          {TABS.map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              id={`settings-tab-${k}`}
              aria-selected={tab === k}
              aria-controls="settings-panel"
              onClick={() => setTab(k)}
              className={cn("h-8 whitespace-nowrap rounded-md px-3 max-md:h-11", tab === k ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60")}
            >
              {t(`settings.tabs.${k}`)}
            </button>
          ))}
        </div>
      </div>
      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className="min-h-0 flex-1 overflow-auto p-4">
        {readOnly ? (
          <p className="mb-4 rounded-md border bg-muted/40 px-3 py-2 text-meta text-muted-foreground" role="note">
            {t("settings.readOnlyNote")}
          </p>
        ) : null}
        {settings.isPending ? (
          <SkeletonRows label={t("common.loading")} cols={4} rows={8} />
        ) : settings.isError ? (
          <EmptyState message={errorMessage(t, settings.error)} actionLabel={t("common.retry")} onAction={() => void settings.refetch()} />
        ) : (
          <fieldset disabled={readOnly} className="contents">
            {tab === "company" ? <CompanyTab company={settings.data.company} departments={settings.data.departments} readOnly={readOnly} /> : null}
            {tab === "types" ? <LeaveTypesTab leaveTypes={settings.data.leaveTypes} readOnly={readOnly} /> : null}
            {tab === "accrual" ? <AccrualTab leaveTypes={settings.data.leaveTypes} policies={settings.data.policies} readOnly={readOnly} /> : null}
            {tab === "holidays" ? <HolidaysTab readOnly={readOnly} /> : null}
          </fieldset>
        )}
      </div>
    </section>
  );
}
