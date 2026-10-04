// Mobile "More" menu: every section not on the tab bar.

import { Link } from "react-router";
import { ChevronRight, LogOut } from "lucide-react";
import { ROLE_LABEL } from "@digilite/shared";
import { NAV } from "@/components/layout";
import { useAuth } from "@/lib/auth";
import { Avatar, Page, PageHeader } from "@/components/ui";
import { ColorlightStatusRow } from "@/components/ColorlightStatus";
import { useFleet } from "@/lib/queries";

export default function MorePage() {
  const { user, can, signOut } = useAuth();
  const items = NAV.filter((n) => !["/map", "/bags", "/riders"].includes(n.to) && can(n.perm));
  const { data: fleet } = useFleet();
  return (
    <Page width="narrow">
      <PageHeader title="More" />
      {user && (
        <div className="card flex items-center gap-3 p-4">
          <Avatar name={user.name} size={44} />
          <div className="flex-1">
            <div className="font-semibold">{user.name}</div>
            <div className="text-sm text-muted">
              {ROLE_LABEL[user.role]} · {user.email}
            </div>
          </div>
        </div>
      )}
      <div className="card p-1.5">
        <ColorlightStatusRow sync={fleet?.sync} className="min-h-12 text-[14px]" />
      </div>
      <nav className="card overflow-hidden">
        {items.map((n) => (
          <Link key={n.to} to={n.to} className="flex min-h-14 items-center gap-3 border-b border-rule-soft px-4 text-ink no-underline last:border-b-0">
            <n.icon className="size-5 text-muted" strokeWidth={1.8} />
            <span className="flex-1 text-[15px] font-medium">{n.label}</span>
            <ChevronRight className="size-5 text-caption" />
          </Link>
        ))}
      </nav>
      <button onClick={() => void signOut()} className="card flex min-h-14 items-center gap-3 px-4 text-left text-[15px] font-medium text-red-ink">
        <LogOut className="size-5" /> Sign out
      </button>
    </Page>
  );
}
