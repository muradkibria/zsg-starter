import { NavLink, Outlet, useLocation } from "react-router";
import clsx from "clsx";
import {
  Bell,
  CalendarClock,
  ClipboardList,
  Download,
  FileText,
  LayoutGrid,
  LogOut,
  Map as MapIcon,
  Megaphone,
  MoreHorizontal,
  Settings,
  ShoppingBag,
  CircleDashed,
  Users,
  Wallet,
} from "lucide-react";
import type { Permission } from "@digilite/shared";
import { ROLE_LABEL } from "@digilite/shared";
import { useAuth } from "@/lib/auth";
import { useFleet, useLiveUpdates } from "@/lib/queries";
import { Avatar } from "./ui";
import { ColorlightStatusRow } from "./ColorlightStatus";

export interface NavItem {
  to: string;
  label: string;
  icon: typeof MapIcon;
  perm: Permission;
  group?: "main" | "commercial" | "admin";
}

export const NAV: NavItem[] = [
  { to: "/map", label: "Fleet map", icon: MapIcon, perm: "fleet.view", group: "main" },
  { to: "/bags", label: "Bags", icon: ShoppingBag, perm: "fleet.view", group: "main" },
  { to: "/riders", label: "Riders", icon: Users, perm: "riders.view", group: "main" },
  { to: "/loops", label: "Ads & loops", icon: LayoutGrid, perm: "loops.edit", group: "main" },
  { to: "/schedules", label: "Schedules", icon: CalendarClock, perm: "schedules.edit", group: "main" },
  { to: "/exports", label: "Exports", icon: Download, perm: "exports.run", group: "main" },
  { to: "/payroll", label: "Payroll", icon: Wallet, perm: "payroll.view", group: "main" },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone, perm: "campaigns.view", group: "commercial" },
  { to: "/reports", label: "Client reports", icon: FileText, perm: "campaigns.view", group: "commercial" },
  { to: "/zones", label: "Zones", icon: CircleDashed, perm: "fleet.view", group: "admin" },
  { to: "/settings", label: "Settings", icon: Settings, perm: "settings.view", group: "admin" },
];

function SideNav() {
  const { user, can, signOut } = useAuth();
  const { data: fleet } = useFleet();
  const attention = fleet?.attention.filter((a) => a.severity !== "info").length ?? 0;
  const groups: NavItem["group"][] = ["main", "commercial", "admin"];
  return (
    <nav aria-label="Main" className="hidden w-[224px] shrink-0 flex-col border-r border-rule bg-paper px-3.5 py-6 md:flex">
      <NavLink to="/map" className="mb-6 flex items-center gap-2.5 px-2 no-underline">
        <img src="/digilite-mark.png" alt="" className="size-[30px]" />
        <span className="font-display text-xl font-bold tracking-wide text-navy">DigiLite</span>
      </NavLink>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {groups.map((g, gi) => {
          const items = NAV.filter((n) => n.group === g && can(n.perm));
          if (!items.length) return null;
          return (
            <div key={g} className="flex flex-col gap-0.5">
              {gi > 0 && <div className="mx-2 my-3 h-px bg-rule" />}
              {items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  className={({ isActive }) =>
                    clsx(
                      "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm no-underline",
                      isActive ? "bg-navy font-semibold text-white" : "text-ink hover:bg-paper-2",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <n.icon className="size-[18px]" strokeWidth={1.8} />
                      <span className="flex-1">{n.label}</span>
                      {n.to === "/map" && attention > 0 && (
                        <span
                          className={clsx(
                            "num flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold",
                            isActive ? "bg-white text-navy" : "bg-st-idle text-white",
                          )}
                          aria-label={`${attention} things need attention`}
                        >
                          {attention}
                        </span>
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          );
        })}
      </div>
      <ColorlightStatusRow sync={fleet?.sync} className="mt-3" />
      {user && (
        <div className="mt-1 flex items-center gap-2.5 border-t border-rule px-2 pt-3">
          <Avatar name={user.name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold">{user.name}</div>
            <div className="text-[11px] text-muted">{ROLE_LABEL[user.role]}</div>
          </div>
          <button onClick={() => void signOut()} aria-label="Sign out" className="rounded-lg p-2 text-muted hover:bg-paper-2 hover:text-ink">
            <LogOut className="size-4" />
          </button>
        </div>
      )}
    </nav>
  );
}

const MOBILE_TABS = [
  { to: "/map", label: "Map", icon: MapIcon },
  { to: "/bags", label: "Bags", icon: ShoppingBag },
  { to: "/riders", label: "Riders", icon: Users },
  { to: "/alerts", label: "Alerts", icon: Bell },
  { to: "/more", label: "More", icon: MoreHorizontal },
];

function MobileTabBar() {
  const { data: fleet } = useFleet();
  const attention = fleet?.attention.filter((a) => a.severity !== "info").length ?? 0;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex border-t border-rule bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      {MOBILE_TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          className={({ isActive }) =>
            clsx("relative flex h-16 flex-1 flex-col items-center justify-center gap-1 text-[11px] font-semibold no-underline", isActive ? "text-navy" : "text-muted")
          }
        >
          <t.icon className="size-[22px]" strokeWidth={1.8} />
          {t.label}
          {t.to === "/alerts" && attention > 0 && (
            <span className="num absolute top-2 left-[calc(50%+6px)] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-st-idle px-1 text-[10px] font-bold text-white">
              {attention}
            </span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

export function AppShell() {
  useLiveUpdates();
  const loc = useLocation();
  const fullBleed = loc.pathname === "/map" || loc.pathname.startsWith("/map/");
  return (
    <div className="flex h-full">
      <SideNav />
      <main className={clsx("min-w-0 flex-1", fullBleed ? "relative h-full overflow-hidden pb-16 md:pb-0" : "h-full overflow-y-auto pb-20 md:pb-0")}>
        <Outlet />
      </main>
      <MobileTabBar />
    </div>
  );
}

export { ClipboardList };
