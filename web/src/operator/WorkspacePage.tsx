// Workspace (spec 2.1): KPI row, Timeline | List, Who's out panel. Data and derivations live in
// workspace/useWorkspaceData; this component only arranges them and wires drawer navigation.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { EmptyState } from "@/common/components/EmptyState";
import { useShortcuts } from "@/common/hooks/useShortcuts";
import { useMediaQuery } from "@/common/hooks/useMediaQuery";
import { errorMessage } from "@/common/lib/errorMessage";
import { SkeletonRows } from "@/ui/Skeleton";
import { useOperatorUi } from "./OperatorContext";
import { useDrawerNav } from "./useDrawerNav";
import { Agenda } from "./workspace/Agenda";
import { groupByDay } from "./workspace/agendaModel";
import { DepartmentSelect, PeriodNav, Segmented, StatusSelect, TypeSelect, ZoomSwitch } from "./workspace/controls";
import { hasActiveFilters, toggleKpi } from "./workspace/filters";
import { KpiRow } from "./workspace/KpiRow";
import { ListView } from "./workspace/ListView";
import { Timeline } from "./workspace/Timeline";
import { barGeometry } from "./workspace/timelineModel";
import { useWorkspaceData } from "./workspace/useWorkspaceData";
import { WhosOutPanel } from "./workspace/WhosOutPanel";
import type { WorkspaceView } from "./OperatorContext";

export default function WorkspacePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const nav = useDrawerNav();
  const ui = useOperatorUi();
  const { filters, updateFilters, clearFilters, period, zoom, view, setView, panelOpen, overlayOpen, setOverlayOpen } = ui;
  const data = useWorkspaceData();
  const wide = useMediaQuery("(min-width: 1280px)");
  const mobile = useMediaQuery("(max-width: 767px)");

  useShortcuts({ escape: () => setOverlayOpen(false) }, overlayOpen && !wide);

  const openLeave = (id: string) => {
    if (!id.startsWith("tmp-")) nav.open(`/leave/${id}`);
  };
  const createFor = (employeeId: string, date: string) => nav.open(`/leave/new?employee=${employeeId}&start=${date}&end=${date}`);

  const filtered = hasActiveFilters(filters);
  const listRows = filters.kpi ? data.visible : data.inPeriod;
  const periodHasLeaves = useMemo(
    () => data.all.some((l) => (l.status === "pending" || l.status === "approved") && barGeometry(l, period.from, period.to) !== null),
    [data.all, period],
  );
  const agendaDays = useMemo(() => groupByDay(data.inPeriod, period.from, period.to, data.ctx), [data.inPeriod, period, data.ctx]);

  const noMatch = <EmptyState message={t("workspace.noMatch")} actionLabel={t("workspace.clearFilters")} onAction={clearFilters} />;

  let body;
  if (data.loading) {
    body = view === "timeline" && !mobile ? <Timeline groups={[]} columns={data.columns} from={period.from} to={period.to} zoom={zoom} loading onOpenLeave={openLeave} onCreate={createFor} /> : <SkeletonRows label={t("common.loading")} cols={5} />;
  } else if (data.error) {
    body = <EmptyState message={errorMessage(t, data.error)} actionLabel={t("common.retry")} onAction={data.refetch} />;
  } else if (data.employees.length === 0) {
    body = <EmptyState message={t("employees.empty")} actionLabel={t("workspace.goEmployees")} onAction={() => navigate("/employees")} />;
  } else if (!periodHasLeaves && !filtered) {
    body = <EmptyState message={t("workspace.empty")} actionLabel={t("topbar.logLeave")} onAction={() => nav.open("/leave/new")} />;
  } else if (view === "list") {
    body = listRows.length === 0 ? noMatch : <ListView rows={listRows} />;
  } else if (mobile) {
    body = agendaDays.length === 0 ? noMatch : <Agenda days={agendaDays} today={ui.today} onOpenLeave={openLeave} />;
  } else {
    body = data.groups.length === 0 ? noMatch : <Timeline groups={data.groups} columns={data.columns} from={period.from} to={period.to} zoom={zoom} loading={false} onOpenLeave={openLeave} onCreate={createFor} />;
  }

  const whosOut = <WhosOutPanel leaves={data.scoped} ctx={data.ctx} onOpenLeave={openLeave} />;

  return (
    <section className="relative flex h-full min-h-0 flex-col" aria-label={t("nav.workspace")}>
      <KpiRow kpis={data.kpis} active={filters.kpi} onToggle={(k) => updateFilters((f) => toggleKpi(f, k))} loading={data.loading} />
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
        <Segmented<WorkspaceView>
          value={view}
          onChange={setView}
          label={t("view.label")}
          options={[
            { value: "timeline", label: t("view.timeline") },
            { value: "list", label: t("view.list") },
          ]}
        />
        <TypeSelect />
        <StatusSelect />
        <div className="contents lg:hidden">
          <DepartmentSelect />
          <PeriodNav />
        </div>
        <ZoomSwitch className="md:hidden" />
        {filtered ? (
          <button type="button" onClick={clearFilters} className="h-8 rounded-md px-2 text-meta text-accent hover:bg-muted max-md:h-11">
            {t("filters.clear")}
          </button>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">{body}</div>
        {wide && panelOpen ? <div className="w-[280px] shrink-0 border-s">{whosOut}</div> : null}
      </div>
      {!wide && !mobile && overlayOpen ? (
        <div className="absolute end-2 top-2 z-30 flex max-h-[70%] w-[300px] flex-col rounded-md border shadow-overlay">{whosOut}</div>
      ) : null}
    </section>
  );
}
