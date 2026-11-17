// Route gate: sends signed-out users to the right login, the wrong role to its own surface,
// and accounts with a temporary password to the forced change screen.
import type { ReactNode } from "react";
import { Navigate } from "react-router";
import { useSessionUser } from "@/common/api/session";
import ChangePasswordPage from "./ChangePasswordPage";

export default function RequireRole({ role, children }: { role: "operator" | "employee"; children: ReactNode }) {
  const session = useSessionUser();
  if (session.isPending) return null; // no full-screen spinner (spec 2.3)
  const u = session.data;
  if (!u) return <Navigate to={role === "employee" ? "/me/login" : "/login"} replace />;
  if (u.role !== role) return <Navigate to={u.role === "employee" ? "/me" : "/"} replace />;
  if (u.mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}
