import { lazy, Suspense } from "react";
import { createBrowserRouter, Route, RouterProvider, Routes } from "react-router";
import RequireRole from "./auth/RequireRole";

// Two surfaces, two lazy chunks: the portal bundle never contains operator code.
const OperatorShell = lazy(() => import("./operator/OperatorShell"));
const PortalShell = lazy(() => import("./portal/PortalShell"));
const LoginPage = lazy(() => import("./auth/LoginPage"));
const SetPasswordPage = lazy(() => import("./auth/SetPasswordPage"));
const ForgotPasswordPage = lazy(() => import("./auth/ForgotPasswordPage"));

function AppRoutes() {
  return (
    <Suspense fallback={null}>
      <Routes>
        <Route path="/login" element={<LoginPage surface="operator" />} />
        <Route path="/me/login" element={<LoginPage surface="portal" />} />
        <Route path="/set-password" element={<SetPasswordPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route
          path="/me/*"
          element={
            <RequireRole role="employee">
              <PortalShell />
            </RequireRole>
          }
        />
        <Route
          path="/*"
          element={
            <RequireRole role="operator">
              <OperatorShell />
            </RequireRole>
          }
        />
      </Routes>
    </Suspense>
  );
}

// A data router (not <BrowserRouter>) so screens can use useBlocker: the leave drawer asks before
// the browser Back button or a link throws away unsaved changes. The route tree itself stays in
// <Routes> components under one splat route.
const router = createBrowserRouter([{ path: "*", element: <AppRoutes /> }]);

export default function App() {
  return <RouterProvider router={router} />;
}
