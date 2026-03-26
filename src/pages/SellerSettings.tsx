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
import { User, Mail, Phone, CreditCard, Wallet, Star, Loader2, Save } from "lucide-react";

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

  // Fetch payment methods
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

      // If neither exists yet, default CIH on
      if (!cih && !binance) {
        setCihEnabled(true);
        setCihDefault(true);
      }
    }
  }, [paymentMethods]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!authUser) throw new Error("Not authenticated");

      // At least one must be enabled
      if (!cihEnabled && !binanceEnabled) {
        throw new Error("يجب تفعيل طريقة دفع واحدة على الأقل");
      }

      // At least one must be default
      if (!cihDefault && !binanceDefault) {
        throw new Error("يجب اختيار طريقة دفع افتراضية");
      }

      // Delete existing
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
      toast.success("تم حفظ إعدادات الدفع بنجاح");
    },
    onError: (err: any) => {
      toast.error(err.message || "خطأ أثناء الحفظ");
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
      <div>
        <h1 className="text-2xl font-bold text-foreground">الإعدادات</h1>
        <p className="text-sm text-muted-foreground mt-1">معلوماتك الشخصية وإعدادات الدفع</p>
      </div>

      {/* Profile Info */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4" />
            المعلومات الشخصية
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <User className="h-3.5 w-3.5" /> الاسم
            </Label>
            <Input value={authUser?.name || ""} disabled className="bg-muted/50" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Mail className="h-3.5 w-3.5" /> البريد الإلكتروني
            </Label>
            <Input value={authUser?.email || ""} disabled className="bg-muted/50" />
          </div>
          <div className="space-y-2">
            <Label className="text-muted-foreground flex items-center gap-1.5 text-xs">
              <Phone className="h-3.5 w-3.5" /> رقم الهاتف
            </Label>
            <Input value={authUser?.phone || ""} disabled className="bg-muted/50" />
          </div>
        </CardContent>
      </Card>

      {/* Payment Options */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base flex items-center gap-2">
            <Wallet className="h-4 w-4" />
            طرق الدفع
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            اختر طريقة أو أكثر. الطريقة الافتراضية هي التي تظهر في الفاتورة.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* CIH */}
          <div className={`rounded-lg border p-4 space-y-4 transition-colors ${cihEnabled ? "border-primary/30 bg-primary/5" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CreditCard className="h-5 w-5 text-primary" />
                <span className="font-medium text-sm">CIH Bank</span>
                {cihDefault && (
                  <Badge variant="secondary" className="text-[10px] gap-1 px-1.5">
                    <Star className="h-2.5 w-2.5" /> افتراضي
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                {cihEnabled && !cihDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => handleSetDefault("cih")}
                  >
                    تعيين كافتراضي
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
                <Separator />
                <div className="grid gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">اسم صاحب الحساب</Label>
                    <Input
                      placeholder="الاسم الكامل"
                      value={cihAccountName}
                      onChange={(e) => setCihAccountName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">RIB</Label>
                    <Input
                      placeholder="رقم الحساب البنكي (RIB)"
                      value={cihRib}
                      onChange={(e) => setCihRib(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Binance */}
          <div className={`rounded-lg border p-4 space-y-4 transition-colors ${binanceEnabled ? "border-primary/30 bg-primary/5" : "border-border"}`}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Wallet className="h-5 w-5 text-amber-500" />
                <span className="font-medium text-sm">Binance</span>
                {binanceDefault && (
                  <Badge variant="secondary" className="text-[10px] gap-1 px-1.5">
                    <Star className="h-2.5 w-2.5" /> افتراضي
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-3">
                {binanceEnabled && !binanceDefault && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-7"
                    onClick={() => handleSetDefault("binance")}
                  >
                    تعيين كافتراضي
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
                <Separator />
                <div className="grid gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Binance ID</Label>
                    <Input
                      placeholder="Binance ID"
                      value={binanceId}
                      onChange={(e) => setBinanceId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Wallet Address</Label>
                    <Input
                      placeholder="عنوان المحفظة"
                      value={binanceWallet}
                      onChange={(e) => setBinanceWallet(e.target.value)}
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="w-full"
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            حفظ الإعدادات
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
