// Operator UI state shared by the top bar, the shortcuts and the workspace: search + filters
// (sessionStorage), period anchor, zoom and view (localStorage), Who's-out panel.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { todayIso } from "@/common/lib/date";
import { readStorage, writeStorage } from "@/common/lib/storage";
import { EMPTY_FILTERS, loadFilters, saveFilters, type Filters } from "./workspace/filters";
import { periodRange, shiftAnchor, type Zoom } from "./workspace/timelineModel";

export type WorkspaceView = "timeline" | "list";

type OperatorUi = {
  search: string;
  setSearch: (value: string) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  filters: Filters;
  updateFilters: (patch: Partial<Filters> | ((f: Filters) => Filters)) => void;
  clearFilters: () => void;
  today: string;
  anchor: string;
  period: { from: string; to: string };
  zoom: Zoom;
  setZoom: (z: Zoom) => void;
  goToday: () => void;
  shift: (dir: 1 | -1) => void;
  view: WorkspaceView;
  setView: (v: WorkspaceView) => void;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  /** Below 1280 px the panel is an overlay opened from a top-bar button. */
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean) => void;
};

const Ctx = createContext<OperatorUi | null>(null);

const readChoice = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  const v = readStorage(key);
  return allowed.includes(v as T) ? (v as T) : fallback;
};

export function OperatorProvider({ children }: { children: ReactNode }) {
  const searchRef = useRef<HTMLInputElement>(null);
  const today = useMemo(() => todayIso(), []);
  const [filters, setFilters] = useState<Filters>(loadFilters);
  const [anchor, setAnchor] = useState(today);
  const [zoom, setZoomState] = useState<Zoom>(() => readChoice("leave.zoom", ["week", "month"] as const, "month"));
  const [view, setViewState] = useState<WorkspaceView>(() => readChoice("leave.view", ["timeline", "list"] as const, "timeline"));
  const [panelOpen, setPanelState] = useState(() => readStorage("leave.whosOut") !== "closed");

  const [overlayOpen, setOverlayOpen] = useState(false);

  useEffect(() => saveFilters(filters), [filters]);

  const updateFilters = useCallback((patch: Partial<Filters> | ((f: Filters) => Filters)) => {
    setFilters((f) => (typeof patch === "function" ? patch(f) : { ...f, ...patch }));
  }, []);
  const clearFilters = useCallback(() => setFilters(EMPTY_FILTERS), []);
  const setSearch = useCallback((search: string) => setFilters((f) => ({ ...f, search })), []);
  const setZoom = useCallback((z: Zoom) => {
    setZoomState(z);
    writeStorage("leave.zoom", z);
  }, []);
  const setView = useCallback((v: WorkspaceView) => {
    setViewState(v);
    writeStorage("leave.view", v);
  }, []);
  const setPanelOpen = useCallback((open: boolean) => {
    setPanelState(open);
    writeStorage("leave.whosOut", open ? "open" : "closed");
  }, []);
  const goToday = useCallback(() => setAnchor(today), [today]);
  const shift = useCallback((dir: 1 | -1) => setAnchor((a) => shiftAnchor(a, zoom, dir)), [zoom]);

  const period = useMemo(() => periodRange(anchor, zoom), [anchor, zoom]);

  const value = useMemo<OperatorUi>(
    () => ({
      search: filters.search,
      setSearch,
      searchRef,
      filters,
      updateFilters,
      clearFilters,
      today,
      anchor,
      period,
      zoom,
      setZoom,
      goToday,
      shift,
      view,
      setView,
      panelOpen,
      setPanelOpen,
      overlayOpen,
      setOverlayOpen,
    }),
    [filters, setSearch, updateFilters, clearFilters, today, anchor, period, zoom, setZoom, goToday, shift, view, setView, panelOpen, setPanelOpen, overlayOpen],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useOperatorUi(): OperatorUi {
  const v = useContext(Ctx);
  if (!v) throw new Error("OperatorProvider missing");
  return v;
}
