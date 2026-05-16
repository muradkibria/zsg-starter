import { NavLink } from "react-router-dom";
import { LayoutDashboard, Truck, Image, ListMusic, Megaphone, MapPin, BarChart2, ClipboardList, SunMedium } from "lucide-react";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/fleet", label: "Fleet", icon: Truck },
  { to: "/brightness", label: "Brightness", icon: SunMedium },
  { to: "/media", label: "Media", icon: Image },
  { to: "/playlists", label: "Playlists", icon: ListMusic },
  { to: "/campaigns", label: "Campaigns", icon: Megaphone },
  { to: "/zones", label: "Zones", icon: MapPin },
  { to: "/reports", label: "Reports", icon: BarChart2 },
  { to: "/audit", label: "Audit Log", icon: ClipboardList },
];

export function Sidebar() {
  return (
    <aside
      className="w-56 shrink-0 h-screen flex flex-col text-white"
      style={{ background: "linear-gradient(180deg, #062461 0%, #000000 100%)" }}
    >
      <div className="px-4 py-5 border-b border-white/10 flex items-center gap-2.5">
        {/* The full logo is dark-blue on white; we invert + brighten so it reads
            as white on the deep-blue sidebar without needing a separate asset. */}
        <img
          src="/digilite-logo-mark.png"
          alt=""
          className="h-7 w-auto shrink-0"
          style={{ filter: "brightness(0) invert(1)" }}
        />
        <span className="font-semibold text-sm tracking-wide leading-tight">
          The DigiLite Hub
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
                  ? "bg-white/15 text-white font-medium"
                  : "text-white/75 hover:bg-white/10 hover:text-white"
              )
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-white/10 text-[10px] text-white/40 tracking-wide">
        © DigiLite Advertising
      </div>
    </aside>
  );
}
