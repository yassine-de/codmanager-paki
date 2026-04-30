import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import Dashboard from "./Dashboard";
import AgentDashboard from "./AgentDashboard";

const Index = () => {
  const { authUser } = useAuth();
  if (authUser?.role === "agent") return <AgentDashboard />;
  if (authUser?.role === "follow_up") return <Navigate to="/follow-up/dashboard" replace />;
  return <Dashboard />;
};

export default Index;
