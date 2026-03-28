import { LayoutDashboard, ShoppingCart, Package, BarChart3, Package2, BoxIcon, Settings, Users, ChevronDown, Link2, CheckSquare, Store, DollarSign, PhoneForwarded, FileText, FileSpreadsheet, Calculator, Headphones, Play, ListChecks, BadgeDollarSign, MessageSquare } from "lucide-react";
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

const getNavItems = (orderCount: number, sourcingUnseen: number, adminSourcingUnseen: number, productUnseen: number) => [
  { title: "dashboard", url: "/", icon: LayoutDashboard },
  { title: "orders", url: "/orders", icon: ShoppingCart, badge: orderCount, permission: "access_to_orders", sellerVisible: true },
  { title: "products", url: "/products", icon: BoxIcon, permission: "access_to_products", sellerVisible: true, badge: productUnseen > 0 ? productUnseen : undefined },
  { title: "confirmations", url: "/confirmations", icon: Package, permission: "access_to_confirmations" },
  { title: "sourcing", url: "/sourcing", icon: Package2, permission: "access_to_sourcing", badge: adminSourcingUnseen > 0 ? adminSourcingUnseen : undefined },
  { title: "Support", url: "/support", icon: MessageSquare, permission: "access_to_settings" },
  { title: "invoices", url: "/invoices", icon: FileText, permission: "access_to_settings", sellerVisible: true },
  { title: "sourcing", url: "/seller-sourcing", icon: Package2, sellerOnly: true, badge: sourcingUnseen > 0 ? sourcingUnseen : undefined },
  { title: "sheets", url: "/sheets", icon: FileSpreadsheet, sellerOnly: true },
  { title: "simulation", url: "/simulation", icon: Calculator, sellerOnly: true },
  { title: "settings", url: "/seller-settings", icon: Settings, sellerOnly: true },
  { title: "My Dashboard", url: "/agent-dashboard", icon: LayoutDashboard, agentOnly: true },
  { title: "Process Orders", url: "/agent-orders", icon: Play, agentOnly: true },
  { title: "Confirmed Orders", url: "/agent-confirmed", icon: ListChecks, agentOnly: true },
];

const analyticsSubItems = [
  { title: "confirmation", url: "/analytics/confirmation", icon: CheckSquare, permission: "access_to_analytics" },
  { title: "delivery", url: "/analytics/delivery", icon: Package, permission: "access_to_analytics" },
  { title: "seller", url: "/analytics/seller", icon: Store, permission: "access_to_analytics" },
  { title: "finance", url: "/analytics/finance", icon: DollarSign, permission: "access_to_analytics" },
  { title: "follow_up", url: "/analytics/follow-up", icon: PhoneForwarded, permission: "access_to_analytics" },
];

const settingsSubItems = [
  { title: "users", url: "/users", icon: Users, permission: "access_to_users" },
  { title: "Rates", url: "/rates", icon: BadgeDollarSign, permission: "access_to_settings" },
  { title: "integrations", url: "/integrations", icon: Link2, permission: "access_to_settings" },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { hasPermission, authUser } = useAuth();
  const { t } = useLanguage();
  const isSeller = authUser?.role === "seller";
  const isAgent = authUser?.role === "agent";

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

  // Fetch unseen sourcing requests count for sellers
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

  // Fetch unseen sourcing requests count for admins (seller validated/cancelled)
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

  // Fetch unseen products count for sellers
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

  const navItems = getNavItems(orderCount, sourcingUnseen, adminSourcingUnseen, productUnseen);

  const visibleItems = navItems.filter((item: any) => {
    if (item.agentOnly) return isAgent;
    if (item.sellerOnly) return isSeller;
    if (isAgent) return false;
    if (isSeller) return !item.permission || item.sellerVisible;
    return !item.permission || hasPermission(item.permission);
  });
  const visibleAnalyticsItems = analyticsSubItems.filter((item) => hasPermission(item.permission));
  const showAnalytics = visibleAnalyticsItems.length > 0;
  const isAnalyticsActive = location.pathname.startsWith("/analytics");

  const visibleSettingsItems = settingsSubItems.filter((item) => hasPermission(item.permission));
  const showSettings = hasPermission("access_to_settings") || hasPermission("access_to_users");
  const isSettingsActive = ["/settings", "/users", "/integrations", "/rates"].some((p) =>
    location.pathname.startsWith(p)
  );

  return (
    <Sidebar collapsible="icon">
      <SidebarContent className="pt-4">
        <div className={`px-3 pb-4 ${collapsed ? 'px-1.5' : ''}`}>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-sidebar-primary flex items-center justify-center shrink-0">
              <Package className="w-3.5 h-3.5 text-sidebar-primary-foreground" />
            </div>
            {!collapsed && (
              <span className="text-sm font-semibold text-sidebar-accent-foreground tracking-tight">
                COD Manager
              </span>
            )}
          </div>
        </div>

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleItems.map((item) => {
                const isActive = item.url === '/'
                  ? location.pathname === '/'
                  : location.pathname.startsWith(item.url);
                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild isActive={isActive} className="h-8 text-xs">
                      <NavLink
                        to={item.url}
                        end={item.url === '/'}
                        className="hover:bg-sidebar-accent/60"
                        activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      >
                        <item.icon className="mr-1.5 h-3.5 w-3.5" />
                        {!collapsed && <span className="flex-1">{t(item.title)}</span>}
                        {!collapsed && item.badge != null && (
                          <span className="ml-auto inline-flex items-center justify-center rounded-md bg-primary px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary-foreground">
                            {item.badge}
                          </span>
                        )}
                        {collapsed && item.badge != null && (
                          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 rounded-full bg-primary text-[9px] font-bold text-primary-foreground flex items-center justify-center">
                            {item.badge > 9 ? "9+" : item.badge}
                          </span>
                        )}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}

              {/* Analytics dropdown */}
              {showAnalytics && (
                <Collapsible defaultOpen={isAnalyticsActive} className="group/analytics">
                  <SidebarMenuItem>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuButton
                        isActive={isAnalyticsActive}
                        className="h-8 text-xs cursor-pointer"
                      >
                        <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{t("analytics")}</span>
                            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/analytics:rotate-180" />
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
                              <SidebarMenuSubButton asChild isActive={isSubActive} className="text-xs h-7">
                                <NavLink
                                  to={sub.url}
                                  className="hover:bg-sidebar-accent/60"
                                  activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                >
                                  <sub.icon className="mr-1.5 h-3 w-3" />
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
                        className="h-8 text-xs cursor-pointer"
                      >
                        <Settings className="mr-1.5 h-3.5 w-3.5" />
                        {!collapsed && (
                          <>
                            <span className="flex-1">{t("settings")}</span>
                            <ChevronDown className="ml-auto h-3.5 w-3.5 transition-transform group-data-[state=open]/collapsible:rotate-180" />
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
                              <SidebarMenuSubButton asChild isActive={isSubActive} className="text-xs h-7">
                                <NavLink
                                  to={sub.url}
                                  className="hover:bg-sidebar-accent/60"
                                  activeClassName="bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                >
                                  <sub.icon className="mr-1.5 h-3 w-3" />
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
      </SidebarContent>
    </Sidebar>
  );
}
