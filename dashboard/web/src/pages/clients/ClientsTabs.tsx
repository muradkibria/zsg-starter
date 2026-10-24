// The Clients section's heading and tabs: Reports (building a client's report)
// and Portal access (the logins clients use to see their own reports).

import { NavLink } from "react-router";
import clsx from "clsx";
import { useAuth } from "@/lib/auth";

export function ClientsTabs({ sub }: { sub: string }) {
  const { can } = useAuth();
  const tabs = [{ to: "/clients", label: "Reports", end: true }, ...(can("clients.edit") ? [{ to: "/clients/portal", label: "Portal access", end: false }] : [])];
  return (
    <header className="flex flex-col gap-3">
      <div>
        <h1 className="m-0 font-display text-[28px] font-semibold leading-tight tracking-[-0.02em] md:text-[32px]">Clients</h1>
        <p className="m-0 mt-1.5 text-sm text-muted">{sub}</p>
      </div>
      {tabs.length > 1 && (
        <nav aria-label="Clients" className="flex gap-6 overflow-x-auto border-b border-rule">
          {tabs.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                clsx(
                  "-mb-px shrink-0 border-b-2 pb-3 text-sm no-underline max-md:pt-3",
                  isActive ? "border-navy font-semibold text-ink" : "border-transparent font-medium text-muted hover:text-ink",
                )
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      )}
    </header>
  );
}
