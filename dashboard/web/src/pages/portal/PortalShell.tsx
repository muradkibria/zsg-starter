// The client portal's frame: DigiLite's mark, who's signed in, and sign out.
// Deliberately plain: a client comes here for their campaign and its reports.

import { Link, Outlet } from "react-router";
import { LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";

export default function PortalShell() {
  const { client, signOut } = useAuth();
  return (
    <div className="flex h-full flex-col overflow-y-auto bg-paper">
      <header className="sticky top-0 z-20 border-b border-rule bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[880px] items-center gap-3 px-4 md:px-8">
          <Link to="/portal" className="flex items-center gap-2.5 no-underline">
            <img src="/digilite-mark.png" alt="" className="size-8" />
            <span className="font-display text-xl font-bold tracking-wide text-navy">DigiLite</span>
          </Link>
          <span className="hidden h-5 w-px bg-rule sm:block" aria-hidden="true" />
          <span className="hidden text-[13px] font-semibold tracking-wide text-muted sm:block">Client portal</span>
          <div className="ml-auto flex min-w-0 items-center gap-2">
            {client && <span className="truncate text-sm font-semibold text-ink">{client.name}</span>}
            <button
              onClick={() => void signOut()}
              className="inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-semibold text-muted hover:bg-paper-2 hover:text-ink"
            >
              <LogOut className="size-4" />
              <span className="hidden sm:inline">Sign out</span>
              <span className="sr-only sm:hidden">Sign out</span>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="mx-auto w-full max-w-[880px] px-4 py-6 text-xs text-muted md:px-8">
        Questions about a campaign or a report? Contact your DigiLite account manager.
      </footer>
    </div>
  );
}
