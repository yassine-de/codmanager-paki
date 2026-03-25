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
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-12 h-12 rounded-xl bg-primary flex items-center justify-center mb-3">
            <Package className="w-6 h-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-lg">COD Manager</CardTitle>
          <CardDescription className="text-xs">Connectez-vous à votre compte</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLogin} className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                className="h-9 text-xs"
                type="email"
                placeholder="email@gmail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Mot de passe</Label>
              <Input
                className="h-9 text-xs"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <Button type="submit" className="w-full h-9 text-xs gap-1.5" disabled={isLoading}>
              {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
              Se connecter
            </Button>
          </form>
          <div className="mt-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              className="w-full text-xs h-8"
              onClick={seedAll}
              disabled={isSeeding}
            >
              {isSeeding ? <Loader2 className="h-3 w-3 animate-spin mr-1.5" /> : null}
              Initialiser tous les utilisateurs
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
