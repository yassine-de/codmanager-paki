import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, User, Bell, Globe, Check, ShoppingCart, AlertTriangle, Info, Eye, EyeOff, Sun, Moon, Search } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useNotifications } from "@/contexts/NotificationContext";
import { useLanguage, type Language } from "@/contexts/LanguageContext";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { usePresenceHeartbeat } from "@/hooks/usePresence";
import { useGlobalAdminSupportNotifications } from "@/hooks/useGlobalSupportNotifications";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SellerSupportChat } from "@/components/SellerSupportChat";
import { SellerAlertsBanner } from "@/components/SellerAlertsBanner";
import { useDataVisibility } from "@/contexts/DataVisibilityContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Input } from "@/components/ui/input";

const languages: { value: Language; label: string; flag: string }[] = [
  { value: "en", label: "English", flag: "🇬🇧" },
  { value: "ar", label: "العربية", flag: "🇸🇦" },
  { value: "fr", label: "Français", flag: "🇫🇷" },
];

const notifTypeIcon = {
  order: ShoppingCart,
  alert: AlertTriangle,
  system: Info,
};

const notifTypeColor = {
  order: "text-primary bg-primary/10",
  alert: "text-warning bg-warning/10",
  system: "text-info bg-info/10",
};

export function AppLayout({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { authUser, signOut } = useAuth();
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useNotifications();
  const { language, setLanguage, t } = useLanguage();
  const { isDataVisible, toggleDataVisibility } = useDataVisibility();
  const { theme, toggleTheme } = useTheme();
  usePresenceHeartbeat();
  useGlobalAdminSupportNotifications();

  const handleLogout = async () => {
    await signOut();
    toast.success(language === "ar" ? "تم تسجيل الخروج" : language === "fr" ? "Déconnexion réussie" : "Logged out successfully");
    navigate("/login", { replace: true });
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          {/* Premium top navbar */}
          <header className="h-14 flex items-center border-b bg-card/80 glass px-4 shrink-0 sticky top-0 z-40">
            <SidebarTrigger className="mr-3 h-8 w-8 text-muted-foreground hover:text-foreground transition-colors" />
            
            {/* Search bar */}
            <div className="hidden sm:flex items-center flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search anything..."
                  className="pl-9 h-9 bg-muted/50 border-0 focus-visible:ring-1 focus-visible:ring-primary/30 text-sm placeholder:text-muted-foreground/60"
                />
              </div>
            </div>

            <div className="ml-auto flex items-center gap-1">
              {authUser && (
                <span className="text-xs font-medium text-muted-foreground hidden lg:block mr-2">
                  {authUser.name}
                </span>
              )}

              {/* Data Visibility Toggle - hidden for agents */}
              {authUser?.role !== 'agent' && (
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all" onClick={toggleDataVisibility}
                title={isDataVisible ? "Hide data" : "Show data"}>
                {isDataVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
              )}

              {/* Dark/Light Mode Toggle */}
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all" onClick={toggleTheme}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>

              {/* Language Switcher */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all">
                    <Globe className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40 rounded-xl shadow-float border-border/60">
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.value}
                      className="text-sm gap-2.5 cursor-pointer rounded-lg"
                      onClick={() => setLanguage(lang.value)}
                    >
                      <span className="text-base">{lang.flag}</span>
                      <span className="flex-1">{lang.label}</span>
                      {language === lang.value && <Check className="h-3.5 w-3.5 text-primary" />}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Notifications */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-all relative">
                    <Bell className="h-4 w-4" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold ring-2 ring-card">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[360px] p-0 rounded-xl shadow-float border-border/60" sideOffset={8}>
                  <div className="flex items-center justify-between px-4 py-3.5 border-b">
                    <h3 className="text-sm font-semibold">{t("notifications")}</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-xs text-primary hover:underline font-medium"
                      >
                        {t("mark_all_read")}
                      </button>
                    )}
                  </div>
                  <ScrollArea className="max-h-[380px]">
                    {notifications.length === 0 ? (
                      <div className="p-10 text-center text-sm text-muted-foreground">
                        {t("no_notifications")}
                      </div>
                    ) : (
                      <div className="divide-y">
                        {notifications.map((n) => {
                          const Icon = notifTypeIcon[n.type];
                          return (
                            <button
                              key={n.id}
                              onClick={() => markAsRead(n.id)}
                              className={cn(
                                "w-full flex items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50",
                                !n.read && "bg-primary/[0.03]"
                              )}
                            >
                              <div className={cn("p-2 rounded-xl mt-0.5 shrink-0", notifTypeColor[n.type])}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={cn("text-sm truncate", !n.read ? "font-semibold" : "font-medium")}>
                                    {n.title}
                                  </span>
                                  {!n.read && (
                                    <span className="w-2 h-2 rounded-full bg-primary shrink-0" />
                                  )}
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{n.message}</p>
                                <p className="text-[11px] text-muted-foreground/50 mt-1">{n.time}</p>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </ScrollArea>
                </PopoverContent>
              </Popover>

              {/* User Menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg ml-1">
                    <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                      <User className="h-4 w-4 text-primary" />
                    </div>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48 rounded-xl shadow-float border-border/60">
                  <DropdownMenuItem className="text-sm gap-2.5 cursor-pointer rounded-lg" onClick={() => navigate('/settings')}>
                    <Settings className="h-4 w-4" /> {t("settings")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-sm gap-2.5 cursor-pointer rounded-lg text-destructive focus:text-destructive" onClick={handleLogout}>
                    <LogOut className="h-4 w-4" /> {t("logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 overflow-auto px-3 py-3 sm:px-4 sm:py-4 lg:px-6 lg:py-5 2xl:px-8">
            <div className="mx-auto w-full max-w-[1500px] 2xl:max-w-[1700px]">
              <SellerAlertsBanner />
              {children}
            </div>
          </main>
        </div>
      </div>
      <SellerSupportChat />
    </SidebarProvider>
  );
}
