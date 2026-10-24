import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, RouterProvider, useLocation, useParams } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, RequireAuth, RequireClient } from "@/lib/auth";
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
const ClientsPage = lazy(() => import("@/pages/clients/ClientsPage"));
const PortalShell = lazy(() => import("@/pages/portal/PortalShell"));
const PortalHome = lazy(() => import("@/pages/portal/PortalHome"));
const PortalCampaignPage = lazy(() => import("@/pages/portal/PortalCampaignPage"));
const PortalReportPage = lazy(() => import("@/pages/portal/PortalReportPage"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: true },
  },
});

/** Send an old address to its new one, keeping the report's settings in the query. */
function MovedTo({ to }: { to: string }) {
  const { id = "" } = useParams();
  const { search } = useLocation();
  return <Navigate to={to.replace(":id", id) + search} replace />;
}

const s = (el: React.ReactNode) => <Suspense fallback={<Spinner />}>{el}</Suspense>;

const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    // The client portal: clients only, their own campaigns and reports.
    path: "/portal",
    element: <RequireClient>{s(<PortalShell />)}</RequireClient>,
    children: [
      { index: true, element: s(<PortalHome />) },
      { path: "campaigns/:id", element: s(<PortalCampaignPage />) },
      { path: "campaigns/:id/report", element: s(<PortalReportPage />) },
      { path: "*", element: <Navigate to="/portal" replace /> },
    ],
  },
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
      { path: "clients", element: s(<ReportsPage />) },
      { path: "clients/portal", element: s(<ClientsPage />) },
      { path: "clients/reports/:id", element: s(<ReportPage />) },
      // Old addresses, kept working for saved links.
      { path: "reports", element: <MovedTo to="/clients" /> },
      { path: "reports/:id", element: <MovedTo to="/clients/reports/:id" /> },
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
