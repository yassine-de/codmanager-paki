import { useAuth } from "@/contexts/AuthContext";
import Dashboard from "./Dashboard";
import AgentDashboard from "./AgentDashboard";

const Index = () => {
  const { authUser } = useAuth();
  if (authUser?.role === "agent") return <AgentDashboard />;
  return <Dashboard />;
};

export default Index;
