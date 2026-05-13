import { useEffect } from "react";
import { Outlet } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { initSocket } from "@/lib/socket";
import { api } from "@/lib/api";
import { ShieldAlert } from "lucide-react";

interface SystemStatus {
  writesEnabled: boolean;
  masterWritesEnabled?: boolean;
  isTestBagMode?: boolean;
  testBagAllowlist?: string[];
  writeMode?: "live" | "test-bag" | "off";
  mode: "mock" | "live";
  devUploadCount: number;
}

function DevModeBanner() {
  const { data } = useQuery<SystemStatus>({
    queryKey: ["system-status"],
    queryFn: () => api.get("/system/status"),
    refetchInterval: 60_000,
  });

  if (!data) return null;

  // Fully live — no banner
  if (data.masterWritesEnabled) return null;

  // Test-bag mode: limited live writes to specific bags
  if (data.isTestBagMode) {
    const allowed = data.testBagAllowlist ?? [];
    return (
      <div className="bg-sky-50 border-b border-sky-200 text-sky-900 px-4 py-2 flex items-center gap-2 text-xs">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <strong>TEST-BAG MODE</strong>
        <span>·</span>
        <span>
          Live writes are restricted to {allowed.length} bag{allowed.length !== 1 ? "s" : ""}:{" "}
          <code className="bg-sky-100 px-1 rounded font-mono">{allowed.join(", ")}</code>. All other bags
          are read-only — deploys to them will be blocked.
        </span>
        <span className="ml-auto text-sky-700/80">
          Unset <code className="bg-sky-100 px-1 rounded">COLORLIGHT_TEST_BAG_IDS</code> for fleet-wide writes.
        </span>
      </div>
    );
  }

  // Pure dry-run
  return (
    <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2 flex items-center gap-2 text-xs">
      <ShieldAlert className="h-4 w-4 shrink-0" />
      <strong>DEV MODE</strong>
      <span>·</span>
      <span>
        Colorlight writes are disabled. Uploads land in a dev queue and deploy actions are logged only —
        nothing reaches real bags.
      </span>
      {data.devUploadCount > 0 && (
        <span className="ml-2 px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 font-medium">
          {data.devUploadCount} pending upload{data.devUploadCount !== 1 ? "s" : ""}
        </span>
      )}
      <span className="ml-auto text-amber-700/80">
        Set <code className="bg-amber-100 px-1 rounded">COLORLIGHT_WRITES_ENABLED=true</code> or{" "}
        <code className="bg-amber-100 px-1 rounded">COLORLIGHT_TEST_BAG_IDS=&lt;id&gt;</code> on Railway when ready.
      </span>
    </div>
  );
}

export function AppLayout() {
  useEffect(() => {
    initSocket("");
  }, []);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <DevModeBanner />
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
