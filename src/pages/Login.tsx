import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Package, LogIn, Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);
  const { user, loading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) {
      navigate("/", { replace: true });
    }
  }, [user, loading, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      toast.error("Remplis tous les champs");
      return;
    }
    setIsLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Connexion réussie");
    }
    setIsLoading(false);
  };

  const seedAll = async () => {
    setIsSeeding(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("manage-users", {
        body: { action: "seed-all" },
      });

      if (fnError) {
        toast.error("Erreur lors de l'initialisation");
        console.error(fnError);
        setIsSeeding(false);
        return;
      }

      if (data?.error) {
        toast.error(data.error);
        setIsSeeding(false);
        return;
      }

      toast.success("Tous les utilisateurs ont été créés !");
      setEmail("adil@codmanager.com");
      setPassword("Am!n2019");
    } catch (err) {
      console.error(err);
      toast.error("Erreur lors de l'initialisation");
    }
    setIsSeeding(false);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Subtle background pattern */}
      <div className="fixed inset-0 bg-[radial-gradient(hsl(var(--border))_1px,transparent_1px)] [background-size:32px_32px] opacity-40" />
      
      <div className="relative z-10 w-full max-w-sm">
        <Card className="rounded-2xl shadow-float border-border/60">
          <CardHeader className="text-center pb-2 pt-8">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-primary flex items-center justify-center mb-4 shadow-elevated">
              <Package className="w-7 h-7 text-primary-foreground" />
            </div>
            <CardTitle className="text-xl">COD Manager</CardTitle>
            <CardDescription className="text-sm mt-1">Sign in to your account</CardDescription>
          </CardHeader>
          <CardContent className="px-6 pb-8">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-sm font-medium">Email</Label>
                <Input
                  className="h-11 rounded-xl text-sm"
                  type="email"
                  placeholder="email@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label className="text-sm font-medium">Password</Label>
                <Input
                  className="h-11 rounded-xl text-sm"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full h-11 rounded-xl text-sm font-semibold gap-2 shadow-soft" disabled={isLoading}>
                {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
                Sign in
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Login;
