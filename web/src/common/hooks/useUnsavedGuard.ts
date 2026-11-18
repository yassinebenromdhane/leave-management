// Guards a form with unsaved changes against leaving by navigation: browser Back / Forward, a link,
// or any other route change asks first (the caller shows its "discard changes?" dialog), and a
// reload or tab close gets the browser's own prompt. Intentional exits call allowLeave() first.
// Needs a data router (App.tsx uses createBrowserRouter).
import { useEffect, useRef } from "react";
import { useBlocker } from "react-router";

export type UnsavedGuard = {
  /** A navigation is on hold, waiting for the user's answer. */
  blocked: boolean;
  /** Let the held navigation go (changes discarded). */
  proceed: () => void;
  /** Cancel the held navigation (stay on the form). */
  stay: () => void;
  /** Mark the next exit as intentional (saved, deleted, discard confirmed). */
  allowLeave: () => void;
};

export function useUnsavedGuard(dirty: boolean): UnsavedGuard {
  const leaving = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  return {
    blocked: blocker.state === "blocked",
    proceed: () => {
      leaving.current = true;
      if (blocker.state === "blocked") blocker.proceed();
    },
    stay: () => {
      if (blocker.state === "blocked") blocker.reset();
    },
    allowLeave: () => {
      leaving.current = true;
    },
  };
}
