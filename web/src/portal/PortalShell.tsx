// Employee portal at /me (spec 1.7, 2.5): phone first, a centred 480 px column on desktop.
// Header (greeting + settings), routed pages, the pinned "Request leave" button and the tab bar.
// This chunk must never import anything from operator/ (guarded by a test).
import { Plus, Settings } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router";
import { usePortalDashboard, usePortalReference, usePortalTeam } from "@/common/api/portal";
import { useSessionUser, useSignOut } from "@/common/api/session";
import { todayIso } from "@/common/lib/date";
import { useLeaveEvents } from "@/common/realtime/useLeaveEvents";
import { ToastProvider } from "@/common/toast/ToastProvider";
import { TabBar } from "./components/TabBar";
import { SettingsSheet } from "./components/SettingsSheet";
import HomePage from "./HomePage";
import MyLeavesPage from "./MyLeavesPage";
import { outbox } from "./offline/outbox";
import { useOutboxFlush } from "./offline/useOutbox";
import RequestSheet from "./RequestSheet";
import TeamPage from "./TeamPage";
import { twoWeeks } from "./weeks";

function Layout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useSessionUser();
  const signOut = useSignOut();
  const dashboard = usePortalDashboard();
  const reference = usePortalReference(); // warms the cache so the sheet also opens offline
  const { from, to } = twoWeeks(todayIso());
  const team = usePortalTeam(from, to);
  const [requestOpen, setRequestOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useLeaveEvents("portal"); // decided / changed → dashboard + leaves + ledger refetch
  // Queued submits belong to this user only; they go out when the browser is back online.
  useOutboxFlush(session.data?.userId);

  const teamVisible = team.data?.scope !== "off";
  const name = dashboard.data?.me.fullName ?? session.data?.name ?? "";
  const showCta = !location.pathname.startsWith("/me/team");

  return (
    <div className="mx-auto flex h-full w-full max-w-[480px] flex-col md:border-x">
      <header className="flex min-h-14 shrink-0 items-center gap-2 border-b ps-4 pe-1 pt-[env(safe-area-inset-top)]">
        <h1 className="min-w-0 flex-1 truncate text-[15px] font-semibold">{t("portal.greeting", { name })}</h1>
        <button
          type="button"
          onClick={() => setSettingsOpen(true)}
          aria-label={t("portal.settings.title")}
          className="grid h-11 w-11 place-items-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <Settings size={20} aria-hidden="true" />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        <Routes>
          <Route index element={<HomePage />} />
          <Route path="leaves" element={<MyLeavesPage />} />
          <Route path="team" element={team.data && !teamVisible ? <Navigate to="/me" replace /> : <TeamPage />} />
          <Route path="*" element={<Navigate to="/me" replace />} />
        </Routes>
      </main>

      {showCta ? (
        <div className="shrink-0 border-t bg-background px-4 py-2">
          <button
            type="button"
            disabled={!reference.data}
            onClick={() => setRequestOpen(true)}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-accent text-[15px] font-medium text-accent-foreground disabled:opacity-50"
          >
            <Plus size={18} aria-hidden="true" />
            {t("portal.request.cta")}
          </button>
        </div>
      ) : null}
      <TabBar teamVisible={teamVisible} />

      {requestOpen && reference.data ? <RequestSheet reference={reference.data} onClose={() => setRequestOpen(false)} /> : null}
      {settingsOpen ? (
        <SettingsSheet
          onClose={() => setSettingsOpen(false)}
          signingOut={signOut.isPending}
          onSignOut={() => {
            outbox.setOwner(null); // shared device: nothing queued survives a sign-out
            signOut.mutate(undefined, { onSettled: () => navigate("/me/login") });
          }}
        />
      ) : null}
    </div>
  );
}

export default function PortalShell() {
  return (
    <ToastProvider regionClassName="max-md:bottom-36 md:bottom-36 md:items-center md:ps-4">
      <Layout />
    </ToastProvider>
  );
}
