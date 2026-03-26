import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppLayout } from "@/components/AppLayout";
import Login from "./pages/Login";
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
import SettingsPage from "./pages/Settings";
import Users from "./pages/Users";
import Integrations from "./pages/Integrations";
import Invoices from "./pages/Invoices";
import SellerSheets from "./pages/SellerSheets";
import SellerSourcing from "./pages/SellerSourcing";
import Simulation from "./pages/Simulation";
import SellerSettings from "./pages/SellerSettings";
import AgentDashboard from "./pages/AgentDashboard";
import AgentOrders from "./pages/AgentOrders";
import AgentConfirmedOrders from "./pages/AgentConfirmedOrders";
import NotFound from "./pages/NotFound";
import { Loader2 } from "lucide-react";

const queryClient = new QueryClient();

function ProtectedRoute({ children, permission }: { children: React.ReactNode; permission?: string }) {
  const { user, loading, hasPermission } = useAuth();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
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
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
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
        <Route path="/settings" element={<ProtectedRoute permission="access_to_settings"><SettingsPage /></ProtectedRoute>} />
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
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </AppLayout>
  );
}

import { LanguageProvider } from "@/contexts/LanguageContext";
import { NotificationProvider } from "@/contexts/NotificationContext";

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <LanguageProvider>
          <NotificationProvider>
            <AuthProvider>
              <AppRoutes />
            </AuthProvider>
          </NotificationProvider>
        </LanguageProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
