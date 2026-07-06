import { Fragment } from "react";
import { LayoutDashboard, ShoppingCart, Package, BarChart3, Package2, BoxIcon, Settings, Users, ChevronDown, Link2, CheckSquare, Store, DollarSign, PhoneForwarded, FileText, FileSpreadsheet, Calculator, Play, ListChecks, BadgeDollarSign, MessageSquare, Megaphone, ArrowUpDown, Activity, ClipboardCheck, Inbox, CheckCircle2, Zap, Sparkles, Send, Warehouse, Truck, PackageCheck, Boxes, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useLanguage } from "@/contexts/LanguageContext";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

const getNavItems = (orderCount: number, sourcingUnseen: number, adminSourcingUnseen: number, productUnseen: number, supportUnread: number, agentNewOrders: number, pendingAdjustments: number, followUpPending: number) => [
  { title: "dashboard", url: "/", icon: LayoutDashboard },
  { title: "orders", url: "/orders", icon: ShoppingCart, badge: orderCount, permission: "access_to_orders", sellerVisible: true },
  { title: "analytics", url: "/seller-analytics", icon: BarChart3, sellerOnly: true, beta: true },
  { title: "Follow Ups", url: "/follow-ups", icon: ClipboardCheck, adminOnly: true },
  { title: "products", url: "/products", icon: BoxIcon, permission: "access_to_products", sellerVisible: true, badge: productUnseen > 0 ? productUnseen : undefined },
  { title: "Warehouse", url: "/warehouse", icon: Warehouse, warehouseVisible: true },
  
  { title: "sourcing", url: "/sourcing", icon: Package2, permission: "access_to_sourcing", badge: adminSourcingUnseen > 0 ? adminSourcingUnseen : undefined },
  { title: "Support", url: "/support", icon: MessageSquare, permission: "access_to_settings", badge: supportUnread > 0 ? supportUnread : undefined },
  { title: "Alerts", url: "/alerts", icon: Megaphone, permission: "access_to_settings" },
  { title: "invoices", url: "/invoices", icon: FileText, permission: "access_to_settings", sellerVisible: true },
  { title: "Adjustments", url: "/adjustments", icon: ArrowUpDown, permission: "access_to_settings", badge: pendingAdjustments > 0 ? pendingAdjustments : undefined },
  { title: "sourcing", url: "/seller-sourcing", icon: Package2, sellerOnly: true, badge: sourcingUnseen > 0 ? sourcingUnseen : undefined },
  { title: "sheets", url: "/sheets", icon: FileSpreadsheet, sellerOnly: true },
  { title: "simulation", url: "/simulation", icon: Calculator, sellerOnly: true },
  { title: "settings", url: "/seller-settings", icon: Settings, sellerOnly: true },
  { title: "My Dashboard", url: "/agent-dashboard", icon: LayoutDashboard, agentOnly: true },
  { title: "Process Orders", url: "/agent-orders", icon: Play, agentOnly: true, badge: agentNewOrders > 0 ? agentNewOrders : undefined },
  { title: "Confirmed Orders", url: "/agent-confirmed", icon: ListChecks, agentOnly: true },
  { title: "WhatsApp Inbox", url: "/agent-whatsapp", icon: MessageSquare, permission: "access_to_whatsapp_inbox" },
  { title: "Dashboard", url: "/follow-up/dashboard", icon: LayoutDashboard, followUpOnly: true },
  { title: "Follow Ups", url: "/follow-up/queue", icon: ClipboardCheck, followUpOnly: true, badge: followUpPending > 0 ? followUpPending : undefined },
  { title: "Control", url: "/follow-up/control", icon: ListChecks, followUpOnly: true },
];

const analyticsSubItems = [
  { title: "confirmation", url: "/analytics/confirmation", icon: CheckSquare, permission: "access_to_analytics" },
  { title: "delivery", url: "/analytics/delivery", icon: Package, permission: "access_to_analytics" },
  { title: "seller", url: "/analytics/seller", icon: Store, permission: "access_to_analytics" },
  { title: "finance", url: "/analytics/finance", icon: DollarSign, permission: "access_to_analytics" },
  { title: "follow_up", url: "/analytics/follow-up", icon: PhoneForwarded, permission: "access_to_analytics" },
  { title: "Agent Monitoring", url: "/analytics/agent-monitoring", icon: Activity, permission: "access_to_analytics" },
];

const settingsSubItems = [
  { title: "users", url: "/users", icon: Users, permission: "access_to_users" },
  { title: "Rates", url: "/rates", icon: BadgeDollarSign, permission: "access_to_settings" },
  { title: "integrations", url: "/integrations", icon: Link2, permission: "access_to_settings" },
  { title: "Carriers", url: "/carriers", icon: Truck, permission: "access_to_settings" },
  { title: "System Health", url: "/system-health", icon: Activity, permission: "access_to_settings" },
];

const getWhatsappSubItems = (inboxUnread: number) => [
  { title: "Overview", url: "/whatsapp", icon: LayoutDashboard, end: true },
  { title: "Inbox", url: "/whatsapp/inbox", icon: Inbox, badge: inboxUnread > 0 ? inboxUnread : undefined },
  { title: "Confirmations", url: "/whatsapp/confirmations", icon: CheckCircle2 },
  { title: "Campaigns", url: "/whatsapp/campaigns", icon: Send },
  { title: "Automations", url: "/whatsapp/automations", icon: Zap },
  { title: "Templates", url: "/whatsapp/templates", icon: FileText },
  { title: "AI", url: "/whatsapp/ai", icon: Sparkles },
  { title: "Settings", url: "/whatsapp/settings", icon: Settings },
];

const warehouseSubItems = [
  { title: "Dashboard", url: "/warehouse/dashboard", icon: LayoutDashboard },
  { title: "Receiving", url: "/warehouse/receiving", icon: PackageCheck },
  { title: "Inventory", url: "/warehouse/inventory", icon: Boxes },
  { title: "Dispatch Center", url: "/warehouse/dispatch", icon: Truck },
  { title: "Returns", url: "/warehouse/returns", icon: RotateCcw },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { hasPermission, authUser, loading: authLoading } = useAuth();
  const { t } = useLanguage();
  const isSeller = authUser?.role === "seller";
  const isAgent = authUser?.role === "agent";
  const isFollowUp = authUser?.role === "follow_up";
  const isWarehouse = authUser?.role === "warehouse_agent" || authUser?.role === "warehouse_manager";
  const isWarehouseManager = authUser?.role === "warehouse_manager";

  const { data: orderCount = 0 } = useQuery({
    queryKey: ["sidebar-order-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true });
      if (error) throw error;
      return count || 0;
    },
    refetchInterval: 30000,
  });

  const { data: sourcingUnseen = 0 } = useQuery({
    queryKey: ["seller-sourcing-unseen", authUser?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("sourcing_requests")
        .select("*", { count: "exact", head: true })
        .eq("seller_seen", false);
      if (error) throw error;
      return count || 0;
    },
    enabled: isSeller && !!authUser,
    refetchInterval: 15000,
  });

  const isAdmin = authUser?.role === "admin";
  const { data: adminSourcingUnseen = 0 } = useQuery({
    queryKey: ["admin-sourcing-unseen"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("sourcing_requests")
        .select("*", { count: "exact", head: true })
        .eq("admin_seen", false);
      if (error) throw error;
      return count || 0;
    },
    enabled: isAdmin && !!authUser,
    refetchInterval: 15000,
  });

  const { data: productUnseen = 0 } = useQuery({
    queryKey: ["seller-product-unseen", authUser?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("products")
        .select("*", { count: "exact", head: true })
        .eq("seller_seen", false);
      if (error) throw error;
      return count || 0;
    },
    enabled: isSeller && !!authUser,
    refetchInterval: 15000,
  });

  const { data: supportUnread = 0 } = useQuery({
    queryKey: ["admin-support-unread"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("support_messages")
        .select("*", { count: "exact", head: true })
        .eq("sender_type", "seller")
        .is("read_at", null);
      if (error) throw error;
      return count || 0;
    },
    enabled: isAdmin && !!authUser,
    refetchInterval: 10000,
  });

  const { data: agentNewOrders = 0 } = useQuery({
    queryKey: ["agent-new-orders-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("confirmation_status", "new")
        .is("agent_id", null);
      if (error) throw error;
      return count || 0;
    },
    enabled: isAgent && !!authUser,
    refetchInterval: 15000,
  });

  const { data: pendingAdjustments = 0 } = useQuery({
    queryKey: ["pending-adjustments-count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("invoice_adjustments")
        .select("*", { count: "exact", head: true })
        .eq("status", "pending");
      if (error) throw error;
      return count || 0;
    },
    enabled: isAdmin && !!authUser,
    refetchInterval: 15000,
  });

  const { data: whatsappInboxUnread = 0 } = useQuery({
    queryKey: ["whatsapp-inbox-unread-msgs"],
    queryFn: async () => {
      // Get all conversations with their last_read_at
      const { data: convs, error: convErr } = await supabase
        .from("whatsapp_conversations")
        .select("id, last_read_at")
        .limit(1000);
      if (convErr) throw convErr;
      if (!convs || convs.length === 0) return 0;

      // Fetch recent inbound messages (cap to last 1000 to keep light)
      const { data: msgs, error: msgErr } = await supabase
        .from("whatsapp_messages")
        .select("conversation_id, created_at, direction")
        .eq("direction", "inbound")
        .order("created_at", { ascending: false })
        .limit(1000);
      if (msgErr) throw msgErr;

      const readMap = new Map<string, string | null>();
      convs.forEach((c: any) => readMap.set(c.id, c.last_read_at));

      // Count CONVERSATIONS (contacts) with unread inbound — not total unread messages.
      const unreadConvs = new Set<string>();
      (msgs || []).forEach((m: any) => {
        if (!readMap.has(m.conversation_id)) return;
        if (unreadConvs.has(m.conversation_id)) return;
        const lastRead = readMap.get(m.conversation_id);
        if (!lastRead || new Date(m.created_at) > new Date(lastRead)) {
          unreadConvs.add(m.conversation_id);
        }
      });
      return unreadConvs.size;
    },
    enabled: isAdmin && !!authUser,
    refetchInterval: 10000,
  });

  const { data: followUpPending = 0 } = useQuery({
    queryKey: ["follow-up-pending-count", authUser?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("orders")
        .select("*", { count: "exact", head: true })
        .eq("follow_up_assigned_to", authUser!.id);
      if (error) throw error;
      return count || 0;
    },
    enabled: isFollowUp && !!authUser,
    refetchInterval: 15000,
  });

  const navItems = getNavItems(orderCount, sourcingUnseen, adminSourcingUnseen, productUnseen, supportUnread, agentNewOrders, pendingAdjustments, followUpPending);
  const whatsappSubItems = getWhatsappSubItems(whatsappInboxUnread);
  const visibleWarehouseSubItems = isWarehouseManager
    ? warehouseSubItems.filter((sub) => sub.url !== "/warehouse/dashboard")
    : warehouseSubItems;

  const WHATSAPP_ALLOWED_EMAILS = ["eshaehsan@gmail.com"];
  const hasWhatsappException = WHATSAPP_ALLOWED_EMAILS.includes(authUser?.email ?? "");

  const visibleItems = navItems.filter((item: any) => {
    if (item.followUpOnly) return isFollowUp;
    if (item.warehouseVisible) return isAdmin || isWarehouse;
    if (item.agentOnly) return isAgent;
    if (item.sellerOnly) return isSeller;
    if (item.adminOnly) return isAdmin;
    if (item.adminAgentOnly) return isAdmin || isAgent;
    if (isFollowUp) return false;
    if (isWarehouseManager) return item.url === "/" || item.warehouseVisible;
    if (isWarehouse) return item.warehouseVisible;
    if (isAgent) return item.permission === "access_to_whatsapp_inbox" && hasWhatsappException;
    if (isSeller) return !item.permission || item.sellerVisible;
    return !item.permission || hasPermission(item.permission);
  });
  const visibleAnalyticsItems = analyticsSubItems.filter((item) => hasPermission(item.permission));
  const showAnalytics = visibleAnalyticsItems.length > 0;
  const isAnalyticsActive = location.pathname.startsWith("/analytics");

  const visibleSettingsItems = settingsSubItems.filter((item) => hasPermission(item.permission));
  const showSettings = hasPermission("access_to_settings") || hasPermission("access_to_users");
  const isSettingsActive = ["/settings", "/users", "/integrations", "/rates", "/system-health"].some((p) =>
    location.pathname.startsWith(p)
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="pt-5 gap-1">
        {/* Logo */}
        <div className={`px-4 pb-6 ${collapsed ? 'px-2' : ''}`}>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-sidebar-primary flex items-center justify-center shrink-0 shadow-soft">
              <Package className="w-4 h-4 text-sidebar-primary-foreground" />
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="text-sm font-bold text-sidebar-accent-foreground tracking-tight leading-none">
                  COD Manager
                </span>
                <span className="text-[10px] text-sidebar-foreground/50 mt-0.5">Business Suite</span>
              </div>
            )}
          </div>
        </div>

        {/* Navigation label */}
        {!collapsed && (
          <div className="px-4 mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-sidebar-foreground/40">
              Navigation
            </span>
          </div>
        )}

        {authLoading ? (
          <SidebarGroup>
            <SidebarGroupContent>
              <div className="space-y-2 px-2">
                {Array.from({ length: 6 }).map((_, i) => (
                  <Skeleton key={i} className="h-9 w-full rounded-lg" />
                ))}
              </div>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = item.url === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.url);
                if (item.url === "/" && isWarehouseManager) {
                  const isDashboardActive = location.pathname === "/warehouse/dashboard";
                  return (
                    <SidebarMenuItem key="warehouse-dashboard-main">
                      <SidebarMenuButton asChild isActive={isDashboardActive} className="h-9 text-[13px] rounded-lg transition-all duration-150">
                        <NavLink
                          to="/warehouse/dashboard"
                          className="hover:bg-sidebar-accent/70"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        >
                          <LayoutDashboard className="mr-2 h-4 w-4 opacity-70" />
                          {!collapsed && <span className="flex-1">Dashboard</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                }
                if (item.url === "/warehouse") {
                  const isWarehouseActive = location.pathname.startsWith("/warehouse");
                  return (
                    <Collapsible key={item.url} defaultOpen={isWarehouseActive} className="group/warehouse">
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton
                            isActive={isWarehouseActive}
                            className="h-9 text-[13px] cursor-pointer rounded-lg"
                          >
                            <Warehouse className="mr-2 h-4 w-4 opacity-70" />
                            {!collapsed && (
                              <>
                                <span className="flex-1">Warehouse</span>
                                <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/warehouse:rotate-180 opacity-50" />
                              </>
                            )}
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {visibleWarehouseSubItems.map((sub) => {
                              const isSubActive = location.pathname.startsWith(sub.url);
                              return (
                                <SidebarMenuSubItem key={sub.url}>
                                  <SidebarMenuSubButton asChild isActive={isSubActive} className="text-[13px] h-8 rounded-lg">
                                    <NavLink
                                      to={sub.url}
                                      className="hover:bg-sidebar-accent/70"
                                      activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                    >
                                      <sub.icon className="mr-2 h-3.5 w-3.5 opacity-60" />
                                      <span className="flex-1">{sub.title}</span>
                                    </NavLink>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              );
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  );
                }
                return (
                  <Fragment key={item.url}>
                    <SidebarMenuItem>
                      <SidebarMenuButton asChild isActive={isActive} className="h-9 text-[13px] rounded-lg transition-all duration-150">
                        <NavLink
                          to={item.url}
                          end={item.url === '/'}
                          className="hover:bg-sidebar-accent/70"
                          activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                        >
                          <item.icon className="mr-2 h-4 w-4 opacity-70" />
                          {!collapsed && <span className="flex-1">{t(item.title)}</span>}
                          {!collapsed && item.badge != null && (
                            <span className="ml-auto inline-flex items-center justify-center rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground min-w-[20px]">
                              {item.badge.toLocaleString()}
                            </span>
                          )}
                          {!collapsed && (item as any).beta && (
                            <span className="ml-auto inline-flex items-center justify-center rounded-md bg-violet-500/20 text-violet-500 px-1.5 py-0.5 text-[9px] font-bold leading-none tracking-wide border border-violet-500/30">
                              BETA
                            </span>
                          )}
                          {collapsed && item.badge != null && (
                            <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center ring-2 ring-sidebar">
                              {item.badge > 9 ? "9+" : item.badge}
                            </span>
                          )}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>

                    {/* WhatsApp Automation dropdown — injected right after Follow Ups */}
                    {item.url === '/follow-ups' && isAdmin && (
                      <Collapsible defaultOpen={location.pathname.startsWith("/whatsapp")} className="group/whatsapp">
                        <SidebarMenuItem>
                          <CollapsibleTrigger asChild>
                            <SidebarMenuButton
                              isActive={location.pathname.startsWith("/whatsapp")}
                              className="h-9 text-[13px] cursor-pointer rounded-lg"
                            >
                              <MessageSquare className="mr-2 h-4 w-4 opacity-70" />
                              {!collapsed && (
                                <>
                                  <span className="flex-1">WhatsApp</span>
                                  {whatsappInboxUnread > 0 && (
                                    <span className="ml-1 inline-flex items-center justify-center rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground min-w-[20px]">
                                      {whatsappInboxUnread.toLocaleString()}
                                    </span>
                                  )}
                                  <ChevronDown className="ml-2 h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/whatsapp:rotate-180 opacity-50" />
                                </>
                              )}
                              {collapsed && whatsappInboxUnread > 0 && (
                                <span className="ml-auto inline-flex items-center justify-center rounded-md bg-primary/90 px-1 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground min-w-[18px]">
                                  {whatsappInboxUnread > 9 ? "9+" : whatsappInboxUnread}
                                </span>
                              )}
                            </SidebarMenuButton>
                          </CollapsibleTrigger>
                          <CollapsibleContent>
                            <SidebarMenuSub>
                              {whatsappSubItems.map((sub) => {
                                const isSubActive = sub.end
                                  ? location.pathname === sub.url
                                  : location.pathname.startsWith(sub.url);
                                return (
                                  <SidebarMenuSubItem key={sub.url}>
                                    <SidebarMenuSubButton asChild isActive={isSubActive} className="text-[13px] h-8 rounded-lg">
                                      <NavLink
                                        to={sub.url}
                                        end={sub.end}
                                        className="hover:bg-sidebar-accent/70"
                                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                      >
                                        <sub.icon className="mr-2 h-3.5 w-3.5 opacity-60" />
                                        <span className="flex-1">{sub.title}</span>
                                        {(sub as any).badge != null && (
                                          <span className="ml-auto inline-flex items-center justify-center rounded-md bg-primary/90 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground min-w-[20px]">
                                            {(sub as any).badge.toLocaleString()}
                                          </span>
                                        )}
                                      </NavLink>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                );
                              })}
                            </SidebarMenuSub>
                          </CollapsibleContent>
                        </SidebarMenuItem>
                      </Collapsible>
                    )}
                  </Fragment>
                );
              })}

              {/* Analytics dropdown */}
              {showAnalytics && (
                <Collapsible defaultOpen={isAnalyticsActive} className="group/analytics">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={isAnalyticsActive}
                        className="h-9 text-[13px] cursor-pointer rounded-lg"
                      >
                        <BarChart3 className="mr-2 h-4 w-4 opacity-70" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{t("analytics")}</span>
                            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/analytics:rotate-180 opacity-50" />
                          </>
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleAnalyticsItems.map((sub) => {
                          const isSubActive = location.pathname === sub.url;
                          return (
                            <SidebarMenuSubItem key={sub.title}>
                              <SidebarMenuSubButton asChild isActive={isSubActive} className="text-[13px] h-8 rounded-lg">
                                <NavLink
                                  to={sub.url}
                                  className="hover:bg-sidebar-accent/70"
                                  activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                >
                                  <sub.icon className="mr-2 h-3.5 w-3.5 opacity-60" />
                                  <span>{t(sub.title)}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}

              {/* Settings dropdown */}
              {showSettings && (
                <Collapsible defaultOpen={isSettingsActive} className="group/collapsible">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={isSettingsActive}
                        className="h-9 text-[13px] cursor-pointer rounded-lg"
                      >
                        <Settings className="mr-2 h-4 w-4 opacity-70" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{t("settings")}</span>
                            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180 opacity-50" />
                          </>
                        )}
                      </SidebarMenuButton>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {visibleSettingsItems.map((sub) => {
                          const isSubActive = location.pathname.startsWith(sub.url);
                          return (
                            <SidebarMenuSubItem key={sub.title}>
                              <SidebarMenuSubButton asChild isActive={isSubActive} className="text-[13px] h-8 rounded-lg">
                                <NavLink
                                  to={sub.url}
                                  className="hover:bg-sidebar-accent/70"
                                  activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                >
                                  <sub.icon className="mr-2 h-3.5 w-3.5 opacity-60" />
                                  <span>{t(sub.title)}</span>
                                </NavLink>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          );
                        })}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </SidebarMenuItem>
                </Collapsible>
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}
