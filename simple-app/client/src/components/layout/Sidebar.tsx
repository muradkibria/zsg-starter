import { NavLink } from "react-router-dom";
import { LayoutDashboard, Truck, Image, Megaphone, MapPin, BarChart2, ClipboardList, SunMedium } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/fleet", label: "Fleet", icon: Truck },
  { to: "/brightness", label: "Brightness", icon: SunMedium },
  { to: "/media", label: "Media", icon: Image },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/zones", label: "Zones", icon: MapPin },
  { to: "/reports", label: "Reports", icon: BarChart2 },
  { to: "/audit", label: "Audit Log", icon: ClipboardList },
];

export function Sidebar() {
  return (
    <aside className="w-56 shrink-0 border-r bg-sidebar h-screen flex flex-col">
      <div className="px-4 py-5 border-b">
        <span className="font-semibold text-sm tracking-wide text-sidebar-foreground">
          DigiLite CMS
        </span>
      </div>
      <nav className="flex-1 px-2 py-4 space-y-0.5 overflow-y-auto">
        {nav.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                  : "text-sidebar-foreground hover:bg-sidebar-accent/60"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
