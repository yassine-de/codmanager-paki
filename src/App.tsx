import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Login from "./pages/Login";
import LandingPage from "./pages/LandingPage";
import Index from "./pages/Index";
import Orders from "./pages/Orders";
import OrderDetail from "./pages/OrderDetail";
import Confirmations from "./pages/Confirmations";
import Sourcing from "./pages/Sourcing";
import Products from "./pages/Products";
import ProductDetail from "./pages/ProductDetail";
import ConfirmationAnalytics from "./pages/ConfirmationAnalytics";
import SellerAnalytics from "./pages/SellerAnalytics";
import FinanceAnalytics from "./pages/FinanceAnalytics";
import FollowUpAnalytics from "./pages/FollowUpAnalytics";
import DeliveryAnalytics from "./pages/DeliveryAnalytics";
import AgentMonitoring from "./pages/AgentMonitoring";
import SettingsPage from "./pages/Settings";
import Users from "./pages/Users";
import Integrations from "./pages/Integrations";
import Invoices from "./pages/Invoices";
import SellerSheets from "./pages/SellerSheets";
import SellerSourcing from "./pages/SellerSourcing";
import Simulation from "./pages/Simulation";
import SellerSettings from "./pages/SellerSettings";
import RatesManagement from "./pages/RatesManagement";
import AgentDashboard from "./pages/AgentDashboard";
import AgentOrders from "./pages/AgentOrders";
import AgentConfirmedOrders from "./pages/AgentConfirmedOrders";
import Support from "./pages/Support";
import Alerts from "./pages/Alerts";
import Adjustments from "./pages/Adjustments";
import SystemHealth from "./pages/SystemHealth";
import FollowUps from "./pages/FollowUps";
import WhatsappLayout from "./pages/whatsapp/WhatsappLayout";
import WhatsappOverview from "./pages/whatsapp/WhatsappOverview";
import WhatsappInbox from "./pages/whatsapp/WhatsappInbox";
import WhatsappConfirmations from "./pages/whatsapp/WhatsappConfirmations";
import WhatsappTemplates from "./pages/whatsapp/WhatsappTemplates";
import WhatsappAI from "./pages/whatsapp/WhatsappAI";
import WhatsappSettings from "./pages/whatsapp/WhatsappSettings";
import WhatsappAutomations from "./pages/whatsapp/WhatsappAutomations";
import WhatsappAutomationBuilder from "./pages/whatsapp/WhatsappAutomationBuilder";
import WhatsappCampaigns from "./pages/whatsapp/WhatsappCampaigns";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

const queryClient = new QueryClient();

/* Full-page skeleton that mimics sidebar + header + content */
function AppSkeleton() {
  return (
    <div className="min-h-screen flex w-full">
      {/* Sidebar skeleton */}
      <div className="w-[260px] border-r bg-sidebar p-4 space-y-4 hidden md:block">
        <div className="flex items-center gap-2.5 mb-6">
          <Skeleton className="w-8 h-8 rounded-xl" />
          <div>
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-2.5 w-16 mt-1" />
          </div>
        </div>
        <Skeleton className="h-2.5 w-16 mb-2" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-lg" />
        ))}
      </div>
      {/* Main area */}
      <div className="flex-1 flex flex-col">
        <div className="h-14 border-b bg-card/80 px-4 flex items-center gap-3">
          <Skeleton className="h-8 w-8 rounded-lg" />
          <Skeleton className="h-9 w-64 rounded-lg hidden sm:block" />
          <div className="ml-auto flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-8 rounded-lg" />
            ))}
          </div>
        </div>
        <div className="flex-1 p-6">
          <Skeleton className="h-8 w-48 mb-2" />
          <Skeleton className="h-4 w-64 mb-8" />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[180px] rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-[100px] rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, loading, hasPermission } = useAuth();

  if (loading) {
    return null; // AppRoutes already shows skeleton
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (permission && !hasPermission(permission)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  if (loading) {
    return <AppSkeleton />;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    );
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<ProtectedRoute><Index /></ProtectedRoute>} />
        <Route path="/orders" element={<ProtectedRoute><Orders /></ProtectedRoute>} />
        <Route path="/orders/:id" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
        <Route path="/confirmations" element={<ProtectedRoute permission="access_to_confirmations"><Confirmations /></ProtectedRoute>} />
        <Route path="/sourcing" element={<ProtectedRoute permission="access_to_sourcing"><Sourcing /></ProtectedRoute>} />
        <Route path="/products" element={<ProtectedRoute><Products /></ProtectedRoute>} />
        <Route path="/products/:id" element={<ProtectedRoute><ProductDetail /></ProtectedRoute>} />
        <Route path="/analytics" element={<ProtectedRoute permission="access_to_analytics"><ConfirmationAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/confirmation" element={<ProtectedRoute permission="access_to_analytics"><ConfirmationAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/delivery" element={<ProtectedRoute permission="access_to_analytics"><DeliveryAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/seller" element={<ProtectedRoute permission="access_to_analytics"><SellerAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/finance" element={<ProtectedRoute permission="access_to_analytics"><FinanceAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/follow-up" element={<ProtectedRoute permission="access_to_analytics"><FollowUpAnalytics /></ProtectedRoute>} />
        <Route path="/analytics/agent-monitoring" element={<ProtectedRoute permission="access_to_analytics"><AgentMonitoring /></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute permission="access_to_settings"><SettingsPage /></ProtectedRoute>} />
        <Route path="/rates" element={<ProtectedRoute permission="access_to_settings"><RatesManagement /></ProtectedRoute>} />
        <Route path="/integrations" element={<ProtectedRoute permission="access_to_settings"><Integrations /></ProtectedRoute>} />
        <Route path="/users" element={<ProtectedRoute permission="access_to_users"><Users /></ProtectedRoute>} />
        <Route path="/invoices" element={<ProtectedRoute><Invoices /></ProtectedRoute>} />
        <Route path="/sheets" element={<ProtectedRoute><SellerSheets /></ProtectedRoute>} />
        <Route path="/seller-sourcing" element={<ProtectedRoute><SellerSourcing /></ProtectedRoute>} />
        <Route path="/simulation" element={<ProtectedRoute><Simulation /></ProtectedRoute>} />
        <Route path="/seller-settings" element={<ProtectedRoute><SellerSettings /></ProtectedRoute>} />
        <Route path="/agent-dashboard" element={<ProtectedRoute><AgentDashboard /></ProtectedRoute>} />
        <Route path="/agent-orders" element={<ProtectedRoute><AgentOrders /></ProtectedRoute>} />
        <Route path="/agent-confirmed" element={<ProtectedRoute><AgentConfirmedOrders /></ProtectedRoute>} />
        <Route path="/support" element={<ProtectedRoute permission="access_to_settings"><Support /></ProtectedRoute>} />
        <Route path="/alerts" element={<ProtectedRoute permission="access_to_settings"><Alerts /></ProtectedRoute>} />
        <Route path="/adjustments" element={<ProtectedRoute permission="access_to_settings"><Adjustments /></ProtectedRoute>} />
        <Route path="/system-health" element={<ProtectedRoute permission="access_to_settings"><SystemHealth /></ProtectedRoute>} />
        <Route path="/follow-ups" element={<ProtectedRoute><FollowUps /></ProtectedRoute>} />
        <Route path="/whatsapp" element={<ProtectedRoute permission="access_to_settings"><WhatsappLayout /></ProtectedRoute>}>
          <Route index element={<WhatsappOverview />} />
          <Route path="inbox" element={<WhatsappInbox />} />
          <Route path="confirmations" element={<WhatsappConfirmations />} />
          <Route path="automations" element={<WhatsappAutomations />} />
          <Route path="campaigns" element={<WhatsappCampaigns />} />
          <Route path="templates" element={<WhatsappTemplates />} />
          <Route path="ai" element={<WhatsappAI />} />
          <Route path="settings" element={<WhatsappSettings />} />
        </Route>
        <Route path="/whatsapp/automations/:id" element={<ProtectedRoute permission="access_to_settings"><WhatsappAutomationBuilder /></ProtectedRoute>} />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationProvider } from "@/contexts/NotificationContext";
import { DataVisibilityProvider } from "@/contexts/DataVisibilityContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <TooltipProvider>
        <Sonner />
        <BrowserRouter>
          <LanguageProvider>
            <NotificationProvider>
              <DataVisibilityProvider>
                <AuthProvider>
                  <AppRoutes />
                </AuthProvider>
              </DataVisibilityProvider>
            </NotificationProvider>
          </LanguageProvider>
        </BrowserRouter>
      </TooltipProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
