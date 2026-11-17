// Operator shell (spec 2.1): rail, top bar, the current page, and drawers routed over it.
import { Plus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { ShortcutSheet } from "@/common/components/ShortcutSheet";
import { useShortcuts } from "@/common/hooks/useShortcuts";
import { ToastProvider } from "@/common/toast/ToastProvider";
import EmployeeDrawer from "./employees/EmployeeDrawer";
import EmployeesPage from "./employees/EmployeesPage";
import LeaveDrawer from "./leave/LeaveDrawer";
import { LiveSync } from "./LiveSync";
import { OperatorProvider, useOperatorUi } from "./OperatorContext";
import { BottomNav, Rail } from "./Rail";
import ReportsPage from "./reports/ReportsPage";
import SettingsPage from "./settings/SettingsPage";
import { TopBar } from "./TopBar";
import { fallbackPage, useBackground, useDrawerNav } from "./useDrawerNav";
import WorkspacePage from "./WorkspacePage";

function Layout() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const nav = useDrawerNav();
  const background = useBackground();
  const { searchRef, goToday, shift, setZoom } = useOperatorUi();
  const [helpOpen, setHelpOpen] = useState(false);

  // The page behind a drawer: the recorded background, or the natural parent on a direct visit.
  const pagePath = background?.pathname ?? fallbackPage(location.pathname);
  const pageLocation = background ?? { pathname: pagePath, search: "" };

  useShortcuts({
    c: () => {
      if (location.pathname !== "/leave/new") nav.open("/leave/new");
    },
    e: () => {
      const input = document.getElementById("quick-add-name");
      if (location.pathname === "/employees" && input) input.focus();
      else navigate("/employees", { state: { focusQuickAdd: true } });
    },
    "/": () => searchRef.current?.focus(),
    "?": () => setHelpOpen(true),
  });

  // Period / zoom keys act on the workspace only, and stay inert while a drawer is open over it.
  const drawerOpen = /^\/(leave|employees\/.+)/.test(location.pathname);
  useShortcuts(
    { t: goToday, arrowleft: () => shift(-1), arrowright: () => shift(1), w: () => setZoom("week"), m: () => setZoom("month") },
    pagePath === "/" && !drawerOpen,
  );

  return (
    <div className="flex h-full">
      <Rail pagePath={pagePath} />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar workspace={pagePath === "/"} />
        <main className="min-h-0 flex-1 overflow-auto">
          <Routes location={pageLocation}>
            <Route path="/" element={<WorkspacePage />} />
            <Route path="/employees" element={<EmployeesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        <BottomNav pagePath={pagePath} />
      </div>
      <button
        type="button"
        onClick={() => nav.open("/leave/new")}
        aria-label={t("topbar.logLeave")}
        className="fixed bottom-20 end-4 z-20 grid h-14 w-14 place-items-center rounded-full bg-accent text-accent-foreground shadow-overlay md:hidden"
      >
        <Plus size={22} aria-hidden="true" />
      </button>
      <Routes>
        <Route path="/leave/new" element={<LeaveDrawer />} />
        <Route path="/leave/:id" element={<LeaveDrawer />} />
        <Route path="/employees/:id" element={<EmployeeDrawer />} />
        <Route path="*" element={null} />
      </Routes>
      {helpOpen ? <ShortcutSheet onClose={() => setHelpOpen(false)} /> : null}
    </div>
  );
}

export default function OperatorShell() {
  return (
    <OperatorProvider>
      <ToastProvider>
        <LiveSync />
        <Layout />
      </ToastProvider>
    </OperatorProvider>
  );
}
