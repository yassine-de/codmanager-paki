import { Outlet, useLocation } from "react-router-dom";
import { NavLink } from "@/components/NavLink";
import { LayoutDashboard, Inbox, CheckCircle2, FileText, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const tabs = [
  { to: "/whatsapp", label: "Overview", icon: LayoutDashboard, end: true },
  { to: "/whatsapp/inbox", label: "Inbox", icon: Inbox },
  { to: "/whatsapp/confirmations", label: "Confirmations", icon: CheckCircle2 },
  { to: "/whatsapp/templates", label: "Templates", icon: FileText },
  { to: "/whatsapp/settings", label: "Settings", icon: SettingsIcon },
];

export default function WhatsappLayout() {
  const location = useLocation();
  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">WhatsApp Automation</h1>
        <p className="text-sm text-muted-foreground">
          Manage WhatsApp confirmations, templates and integration settings.
        </p>
      </div>
      <div className="border-b border-border">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const active = t.end
              ? location.pathname === t.to
              : location.pathname.startsWith(t.to);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.end}
                className={cn(
                  "inline-flex items-center gap-2 px-3.5 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <t.icon className="h-4 w-4 opacity-80" />
                {t.label}
              </NavLink>
            );
          })}
        </div>
      </div>
      <Outlet />
    </div>
  );
}
