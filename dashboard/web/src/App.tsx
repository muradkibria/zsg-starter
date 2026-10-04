import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, RequireAuth } from "@/lib/auth";
import { FeedbackProvider } from "@/components/feedback";
import { AppShell } from "@/components/layout";
import { Spinner } from "@/components/ui";
import LoginPage from "@/pages/auth/LoginPage";

const FleetMapPage = lazy(() => import("@/pages/fleet/FleetMapPage"));
const AlertsPage = lazy(() => import("@/pages/fleet/AlertsPage"));
const MorePage = lazy(() => import("@/pages/fleet/MorePage"));
const BagsPage = lazy(() => import("@/pages/bags/BagsPage"));
const BagPage = lazy(() => import("@/pages/bags/BagPage"));
const RidersPage = lazy(() => import("@/pages/riders/RidersPage"));
const RiderPage = lazy(() => import("@/pages/riders/RiderPage"));
const EndAssignmentPage = lazy(() => import("@/pages/riders/EndAssignmentPage"));
const LoopsPage = lazy(() => import("@/pages/loops/LoopsPage"));
const LoopEditorPage = lazy(() => import("@/pages/loops/LoopEditorPage"));
const SchedulesPage = lazy(() => import("@/pages/schedules/SchedulesPage"));
const PayrollPage = lazy(() => import("@/pages/payroll/PayrollPage"));
const ExportsPage = lazy(() => import("@/pages/exports/ExportsPage"));
const CampaignsPage = lazy(() => import("@/pages/campaigns/CampaignsPage"));
const CampaignPage = lazy(() => import("@/pages/campaigns/CampaignPage"));
const ReportsPage = lazy(() => import("@/pages/reports/ReportsPage"));
const ReportPage = lazy(() => import("@/pages/reports/ReportPage"));
const ZonesPage = lazy(() => import("@/pages/zones/ZonesPage"));
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});

const s = (el: React.ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <AppShell />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Navigate to="/map" replace /> },
      { path: "map", element: s(<FleetMapPage />) },
      { path: "alerts", element: s(<AlertsPage />) },
      { path: "more", element: s(<MorePage />) },
      { path: "bags", element: s(<BagsPage />) },
      { path: "bags/:id", element: s(<BagPage />) },
      { path: "riders", element: s(<RidersPage />) },
      { path: "riders/:id", element: s(<RiderPage />) },
      { path: "riders/:id/end", element: s(<EndAssignmentPage />) },
      { path: "loops", element: s(<LoopsPage />) },
      { path: "loops/:id", element: s(<LoopEditorPage />) },
      { path: "schedules", element: s(<SchedulesPage />) },
      { path: "payroll", element: s(<PayrollPage />) },
      { path: "exports", element: s(<ExportsPage />) },
      { path: "campaigns", element: s(<CampaignsPage />) },
      { path: "campaigns/:id", element: s(<CampaignPage />) },
      { path: "reports", element: s(<ReportsPage />) },
      { path: "reports/:id", element: s(<ReportPage />) },
      { path: "zones", element: s(<ZonesPage />) },
      { path: "settings", element: s(<SettingsPage />) },
      { path: "*", element: <Navigate to="/map" replace /> },
    ],
  },
]);

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <FeedbackProvider>
          <RouterProvider router={router} />
        </FeedbackProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
