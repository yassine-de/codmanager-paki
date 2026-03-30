import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Settings, LogOut, User, Bell, Globe, Check, ShoppingCart, AlertTriangle, Info, Eye, EyeOff, Sun, Moon } from "lucide-react";
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
          <header className="h-11 flex items-center border-b bg-card px-3 shrink-0">
            <SidebarTrigger className="mr-3 h-7 w-7" />
            <div className="ml-auto flex items-center gap-1.5">
              {authUser && (
                <span className="text-xs text-muted-foreground hidden sm:block mr-1">
                  {authUser.name}
                </span>
              )}

              {/* Data Visibility Toggle */}
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={toggleDataVisibility}
                title={isDataVisible ? "Hide data" : "Show data"}>
                {isDataVisible ? <Eye className="h-4 w-4 text-muted-foreground" /> : <EyeOff className="h-4 w-4 text-muted-foreground" />}
              </Button>

              {/* Dark/Light Mode Toggle */}
              <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full" onClick={toggleTheme}
                title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
                {theme === "dark" ? <Sun className="h-4 w-4 text-muted-foreground" /> : <Moon className="h-4 w-4 text-muted-foreground" />}
              </Button>

              {/* Language Switcher */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
                    <Globe className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {languages.map((lang) => (
                    <DropdownMenuItem
                      key={lang.value}
                      className="text-xs gap-2 cursor-pointer"
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
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full relative">
                    <Bell className="h-4 w-4 text-muted-foreground" />
                    {unreadCount > 0 && (
                      <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold animate-bounce">
                        {unreadCount}
                      </span>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[340px] p-0" sideOffset={8}>
                  <div className="flex items-center justify-between px-4 py-3 border-b">
                    <h3 className="text-sm font-semibold">{t("notifications")}</h3>
                    {unreadCount > 0 && (
                      <button
                        onClick={markAllAsRead}
                        className="text-[11px] text-primary hover:underline font-medium"
                      >
                        {t("mark_all_read")}
                      </button>
                    )}
                  </div>
                  <ScrollArea className="max-h-[360px]">
                    {notifications.length === 0 ? (
                      <div className="p-8 text-center text-sm text-muted-foreground">
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
                                "w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50",
                                !n.read && "bg-primary/5"
                              )}
                            >
                              <div className={cn("p-1.5 rounded-lg mt-0.5 shrink-0", notifTypeColor[n.type])}>
                                <Icon className="h-3.5 w-3.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={cn("text-xs font-medium truncate", !n.read && "font-semibold")}>
                                    {n.title}
                                  </span>
                                  {!n.read && (
                                    <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
                                  )}
                                </div>
                                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{n.message}</p>
                                <p className="text-[10px] text-muted-foreground/60 mt-1">{n.time}</p>
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
                  <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full bg-primary/10">
                    <User className="h-4 w-4 text-primary" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  <DropdownMenuItem className="text-xs gap-2 cursor-pointer" onClick={() => navigate('/settings')}>
                    <Settings className="h-3.5 w-3.5" /> {t("settings")}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="text-xs gap-2 cursor-pointer text-destructive focus:text-destructive" onClick={handleLogout}>
                    <LogOut className="h-3.5 w-3.5" /> {t("logout")}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>
          <main className="flex-1 overflow-auto p-4">
            <SellerAlertsBanner />
            {children}
          </main>
        </div>
      </div>
      <SellerSupportChat />
    </SidebarProvider>
  );
}
