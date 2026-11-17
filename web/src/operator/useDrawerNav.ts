// Drawers are routes over the current page (spec 2.1): /leave/new, /leave/:id, /employees/:id.
// Opening one records the page behind it in router state, so the page stays rendered and the
// browser Back button closes the drawer.
import { useLocation, useNavigate } from "react-router";

type Background = { pathname: string; search: string };

/** The page a pathname belongs to: drawer URLs map to the page shown behind them. */
export function fallbackPage(pathname: string): string {
  if (pathname.startsWith("/leave")) return "/";
  if (/^\/employees\/.+/.test(pathname)) return "/employees";
  return pathname;
}

export function useBackground(): Background | undefined {
  const location = useLocation();
  return (location.state as { background?: Background } | null)?.background;
}

export function useDrawerNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const background = useBackground();
  return {
    open: (to: string) =>
      navigate(to, { state: { background: background ?? { pathname: location.pathname, search: location.search } } }),
    close: () => (background ? navigate(-1) : navigate(fallbackPage(location.pathname), { replace: true })),
  };
}
