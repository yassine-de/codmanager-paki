import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { User, Mail, Phone, CreditCard, Wallet, Star, Loader2, Save, Settings } from "lucide-react";

interface PaymentMethod {
  id?: string;
  method: "cih" | "binance";
  is_default: boolean;
  cih_account_name?: string;
  cih_rib?: string;
  binance_id?: string;
  binance_wallet_address?: string;
}

export default function SellerSettings() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();

  const { data: paymentMethods, isLoading } = useQuery({
    queryKey: ["seller-payment-methods", authUser?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("seller_payment_methods")
        .select("*")
        .eq("user_id", authUser!.id);
      if (error) throw error;
      return data as PaymentMethod[];
    },
    enabled: !!authUser,
  });

  const [cihEnabled, setCihEnabled] = useState(false);
  const [binanceEnabled, setBinanceEnabled] = useState(false);
  const [cihDefault, setCihDefault] = useState(false);
  const [binanceDefault, setBinanceDefault] = useState(false);
  const [cihAccountName, setCihAccountName] = useState("");
  const [cihRib, setCihRib] = useState("");
  const [binanceId, setBinanceId] = useState("");
  const [binanceWallet, setBinanceWallet] = useState("");

  useEffect(() => {
    if (paymentMethods) {
      const cih = paymentMethods.find((p) => p.method === "cih");
      const binance = paymentMethods.find((p) => p.method === "binance");

      if (cih) {
        setCihEnabled(true);
        setCihDefault(cih.is_default);
        setCihAccountName(cih.cih_account_name || "");
        setCihRib(cih.cih_rib || "");
      }
      if (binance) {
        setBinanceEnabled(true);
        setBinanceDefault(binance.is_default);
        setBinanceId(binance.binance_id || "");
        setBinanceWallet(binance.binance_wallet_address || "");
      }

      if (!cih && !binance) {
        setCihEnabled(true);
        setCihDefault(true);
      }
    }
  }, [paymentMethods]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!authUser) throw new Error("Not authenticated");
      if (!cihEnabled && !binanceEnabled) {
        throw new Error("At least one payment method must be enabled");
      }
      if (!cihDefault && !binanceDefault) {
        throw new Error("Please select a default payment method");
      }

      await supabase
        .from("seller_payment_methods")
        .delete()
        .eq("user_id", authUser.id);

      const toInsert: any[] = [];
      if (cihEnabled) {
        toInsert.push({
          user_id: authUser.id,
          method: "cih",
          is_default: cihDefault,
          cih_account_name: cihAccountName || null,
          cih_rib: cihRib || null,
        });
      }
      if (binanceEnabled) {
        toInsert.push({
          user_id: authUser.id,
          method: "binance",
          is_default: binanceDefault,
          binance_id: binanceId || null,
          binance_wallet_address: binanceWallet || null,
        });
      }

      if (toInsert.length > 0) {
        const { error } = await supabase
          .from("seller_payment_methods")
          .insert(toInsert);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["seller-payment-methods"] });
      toast.success("Payment settings saved successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to save settings");
    },
  });

  const handleSetDefault = (method: "cih" | "binance") => {
    if (method === "cih") {
      setCihDefault(true);
      setBinanceDefault(false);
    } else {
      setBinanceDefault(true);
      setCihDefault(false);
    }
  };

  const handleToggleCih = (enabled: boolean) => {
    setCihEnabled(enabled);
    if (!enabled && cihDefault && binanceEnabled) {
      setCihDefault(false);
      setBinanceDefault(true);
    }
    if (enabled && !binanceEnabled) {
      setCihDefault(true);
    }
  };

  const handleToggleBinance = (enabled: boolean) => {
    setBinanceEnabled(enabled);
    if (!enabled && binanceDefault && cihEnabled) {
      setBinanceDefault(false);
      setCihDefault(true);
    }
    if (enabled && !cihEnabled) {
      setBinanceDefault(true);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
          <Settings className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-foreground tracking-tight">Settings</h1>
          <p className="text-xs text-muted-foreground">Your profile and payment preferences</p>
        </div>
      </div>

      {/* Profile Info */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
            <User className="h-4 w-4 text-muted-foreground" />
            Personal Information
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <User className="h-3 w-3" /> Name
              </Label>
              <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-foreground">
                {authUser?.name || "—"}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Phone className="h-3 w-3" /> Phone
              </Label>
              <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-foreground">
                {authUser?.phone || "—"}
              </div>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs text-muted-foreground flex items-center gap-1.5">
                <Mail className="h-3 w-3" /> Email
              </Label>
              <div className="h-9 px-3 flex items-center rounded-md border border-border bg-muted/40 text-sm text-foreground">
                {authUser?.email || "—"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Payment Options */}
      <Card className="shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium flex items-center gap-2 text-foreground">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            Payment Methods
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Enable one or more methods. The default method will appear on your invoices.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* CIH */}
          <div className={`rounded-xl border p-4 space-y-3 transition-all duration-200 ${cihEnabled ? "border-primary/20 bg-primary/[0.03] shadow-sm" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${cihEnabled ? "bg-primary/10" : "bg-muted"}`}>
                  <CreditCard className={`h-4 w-4 ${cihEnabled ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">CIH Bank</span>
                    {cihDefault && (
                      <Badge variant="secondary" className="text-[10px] gap-0.5 px-1.5 py-0 h-4 font-normal">
                        <Star className="h-2.5 w-2.5" /> Default
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">Bank transfer</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {cihEnabled && !cihDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px] h-7 text-muted-foreground hover:text-foreground"
                    onClick={() => handleSetDefault("cih")}
                  >
                    Set as default
                  </Button>
                )}
                <Switch
                  checked={cihEnabled}
                  onCheckedChange={handleToggleCih}
                  disabled={cihEnabled && !binanceEnabled}
                />
              </div>
            </div>
            {cihEnabled && (
              <>
                <Separator className="bg-border/60" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Account Holder Name</Label>
                    <Input
                      placeholder="Full name"
                      value={cihAccountName}
                      onChange={(e) => setCihAccountName(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">RIB</Label>
                    <Input
                      placeholder="Bank account number"
                      value={cihRib}
                      onChange={(e) => setCihRib(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Binance */}
          <div className={`rounded-xl border p-4 space-y-3 transition-all duration-200 ${binanceEnabled ? "border-primary/20 bg-primary/[0.03] shadow-sm" : "border-border bg-card"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${binanceEnabled ? "bg-warning/10" : "bg-muted"}`}>
                  <Wallet className={`h-4 w-4 ${binanceEnabled ? "text-warning" : "text-muted-foreground"}`} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-foreground">Binance</span>
                    {binanceDefault && (
                      <Badge variant="secondary" className="text-[10px] gap-0.5 px-1.5 py-0 h-4 font-normal">
                        <Star className="h-2.5 w-2.5" /> Default
                      </Badge>
                    )}
                  </div>
                  <span className="text-[11px] text-muted-foreground">Crypto payment</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {binanceEnabled && !binanceDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-[11px] h-7 text-muted-foreground hover:text-foreground"
                    onClick={() => handleSetDefault("binance")}
                  >
                    Set as default
                  </Button>
                )}
                <Switch
                  checked={binanceEnabled}
                  onCheckedChange={handleToggleBinance}
                  disabled={binanceEnabled && !cihEnabled}
                />
              </div>
            </div>
            {binanceEnabled && (
              <>
                <Separator className="bg-border/60" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Binance ID</Label>
                    <Input
                      placeholder="Your Binance ID"
                      value={binanceId}
                      onChange={(e) => setBinanceId(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Wallet Address</Label>
                    <Input
                      placeholder="Wallet address"
                      value={binanceWallet}
                      onChange={(e) => setBinanceWallet(e.target.value)}
                      className="h-9 text-sm"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full h-10 font-medium"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Settings
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
