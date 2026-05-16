import { useLocation } from "react-router-dom";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

const titles: Record<string, string> = {
  "/": "Dashboard",
  "/fleet": "Fleet",
  "/media": "Media Library",
  "/playlists": "Playlists",
  "/campaigns": "Campaigns",
  "/zones": "Zone Management",
  "/brightness": "Brightness Schedule",
  "/reports": "Reports",
  "/audit": "Audit Log",
};

export function Header() {
  const { pathname } = useLocation();

  return (
    <header className="h-14 border-b flex items-center justify-between px-6 shrink-0 bg-background">
      <h1 className="text-sm font-medium">{titles[pathname] ?? "The DigiLite Hub"}</h1>
      <Avatar className="h-7 w-7">
        <AvatarFallback className="text-xs">DL</AvatarFallback>
      </Avatar>
    </header>
  );
}
