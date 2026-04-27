import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Dashboard } from "@/pages/Dashboard";
import { Fleet } from "@/pages/Fleet";
import { Media } from "@/pages/Media";
import { Campaigns } from "@/pages/Campaigns";
import { Zones } from "@/pages/Zones";
import { Reports } from "@/pages/Reports";
import { Audit } from "@/pages/Audit";
import { BrightnessSchedule } from "@/pages/BrightnessSchedule";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/media" element={<Media />} />
            <Route path="/campaigns" element={<Campaigns />} />
            <Route path="/zones" element={<Zones />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/audit" element={<Audit />} />
            <Route path="/brightness" element={<BrightnessSchedule />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
