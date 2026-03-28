import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Phone, Truck, DollarSign, UserCheck, Save, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface RateValues {
  dropped_order_rate: number;
  confirmed_order_rate: number;
  shipping_rate_1kg: number;
  shipping_rate_2kg: number;
  shipping_rate_3kg: number;
  cod_fee_per_delivery: number;
  agent_commission_confirmed: number;
  agent_commission_delivered: number;
}

const defaultRates: RateValues = {
  dropped_order_rate: 0,
  confirmed_order_rate: 0,
  shipping_rate_1kg: 0,
  shipping_rate_2kg: 0,
  shipping_rate_3kg: 0,
  cod_fee_per_delivery: 0,
  agent_commission_confirmed: 0,
  agent_commission_delivered: 0,
};

function RateInput({ label, value, onChange, helper }: { label: string; value: number; onChange: (v: number) => void; helper?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">$</span>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={value || ""}
          onChange={(e) => {
            const v = parseFloat(e.target.value);
            onChange(isNaN(v) || v < 0 ? 0 : v);
          }}
          className="pl-7 h-9 text-sm"
          placeholder="0.00"
        />
      </div>
      {helper && <p className="text-[10px] text-muted-foreground/70">{helper}</p>}
    </div>
  );
}

export default function RatesManagement() {
  const queryClient = useQueryClient();
  const [isPerSeller, setIsPerSeller] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [rates, setRates] = useState<RateValues>(defaultRates);

  // Fetch mode from app_settings
  const { data: modeData } = useQuery({
    queryKey: ["rates-mode"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "rates_mode").maybeSingle();
      return data?.value || "global";
    },
  });

  useEffect(() => {
    if (modeData) setIsPerSeller(modeData === "per_seller");
  }, [modeData]);

  // Fetch sellers
  const { data: sellers = [] } = useQuery({
    queryKey: ["rates-sellers"],
    queryFn: async () => {
      const { data: sellerRoles } = await supabase.from("user_roles").select("user_id").eq("role", "seller");
      if (!sellerRoles?.length) return [];
      const ids = sellerRoles.map((r) => r.user_id);
      const { data: profiles } = await supabase.from("profiles").select("user_id, name, email").in("user_id", ids);
      return profiles || [];
    },
  });

  // Current target seller_id (null for global)
  const targetSellerId = isPerSeller ? selectedSellerId : null;

  // Fetch rates for current target
  const { data: rateData, isLoading } = useQuery({
    queryKey: ["rate-settings", targetSellerId],
    queryFn: async () => {
      let q = supabase.from("rate_settings").select("*");
      if (targetSellerId) {
        q = q.eq("seller_id", targetSellerId);
      } else {
        q = q.is("seller_id", null);
      }
      const { data } = await q.maybeSingle();
      return data;
    },
    enabled: !isPerSeller || !!selectedSellerId,
  });

  useEffect(() => {
    if (rateData) {
      setRates({
        dropped_order_rate: rateData.dropped_order_rate ?? 0,
        confirmed_order_rate: rateData.confirmed_order_rate ?? 0,
        shipping_rate_1kg: rateData.shipping_rate_1kg ?? 0,
        shipping_rate_2kg: rateData.shipping_rate_2kg ?? 0,
        shipping_rate_3kg: rateData.shipping_rate_3kg ?? 0,
        cod_fee_per_delivery: rateData.cod_fee_per_delivery ?? 0,
        agent_commission_confirmed: rateData.agent_commission_confirmed ?? 0,
        agent_commission_delivered: rateData.agent_commission_delivered ?? 0,
      });
    } else {
      setRates(defaultRates);
    }
  }, [rateData]);

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      if (rateData?.id) {
        const { error } = await supabase.from("rate_settings").update(rates).eq("id", rateData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rate_settings").insert({
          ...rates,
          seller_id: targetSellerId,
          is_global: !targetSellerId,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Rates saved successfully");
      queryClient.invalidateQueries({ queryKey: ["rate-settings"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to save rates"),
  });

  // Save mode
  const modeMutation = useMutation({
    mutationFn: async (mode: string) => {
      const { data: existing } = await supabase.from("app_settings").select("id").eq("key", "rates_mode").maybeSingle();
      if (existing) {
        await supabase.from("app_settings").update({ value: mode }).eq("key", "rates_mode");
      } else {
        await supabase.from("app_settings").insert({ key: "rates_mode", value: mode });
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rates-mode"] }),
  });

  const handleModeToggle = (perSeller: boolean) => {
    setIsPerSeller(perSeller);
    setSelectedSellerId(null);
    modeMutation.mutate(perSeller ? "per_seller" : "global");
  };

  const updateRate = (key: keyof RateValues, value: number) => {
    setRates((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="space-y-6 p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rates Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Control all business rates, commissions, and fees in one place.
        </p>
      </div>

      {/* Mode Toggle */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div>
            <p className="text-sm font-medium">Rate Mode</p>
            <p className="text-xs text-muted-foreground">
              {isPerSeller ? "Custom rates per seller" : "Same rates for all sellers"}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium ${!isPerSeller ? "text-primary" : "text-muted-foreground"}`}>Global</span>
            <Switch checked={isPerSeller} onCheckedChange={handleModeToggle} />
            <span className={`text-xs font-medium ${isPerSeller ? "text-primary" : "text-muted-foreground"}`}>Per Seller</span>
          </div>
        </CardContent>
      </Card>

      {/* Seller List (Per Seller mode) */}
      {isPerSeller && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Select Seller</CardTitle>
            <CardDescription className="text-xs">Choose a seller to configure custom rates</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {sellers.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No sellers found</p>
            )}
            {sellers.map((seller: any) => (
              <button
                key={seller.user_id}
                onClick={() => setSelectedSellerId(seller.user_id)}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
                  selectedSellerId === seller.user_id
                    ? "bg-primary/10 border border-primary/20"
                    : "hover:bg-muted/50 border border-transparent"
                }`}
              >
                <div>
                  <p className="text-sm font-medium">{seller.name}</p>
                  <p className="text-xs text-muted-foreground">{seller.email}</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Rate Cards - only show when we have a valid target */}
      {(!isPerSeller || selectedSellerId) && (
        <>
          {isLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {/* Call Center Rate */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                      <Phone className="h-4 w-4 text-blue-500" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">Call Center Rate</CardTitle>
                      <CardDescription className="text-[10px]">Order processing costs</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <RateInput
                    label="Dropped Order Rate"
                    value={rates.dropped_order_rate}
                    onChange={(v) => updateRate("dropped_order_rate", v)}
                    helper="Before confirmation — cost when order enters system"
                  />
                  <RateInput
                    label="Confirmed Order Rate"
                    value={rates.confirmed_order_rate}
                    onChange={(v) => updateRate("confirmed_order_rate", v)}
                    helper="After confirmation — cost per confirmed order"
                  />
                </CardContent>
              </Card>

              {/* Shipping Rate */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-green-500/10 flex items-center justify-center">
                      <Truck className="h-4 w-4 text-green-500" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">Shipping Rate</CardTitle>
                      <CardDescription className="text-[10px]">Weight-based shipping costs</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <RateInput
                    label="1 KG"
                    value={rates.shipping_rate_1kg}
                    onChange={(v) => updateRate("shipping_rate_1kg", v)}
                    helper="After delivery — shipping cost for 1kg"
                  />
                  <RateInput
                    label="2 KG"
                    value={rates.shipping_rate_2kg}
                    onChange={(v) => updateRate("shipping_rate_2kg", v)}
                    helper="After delivery — shipping cost for 2kg"
                  />
                  <RateInput
                    label="3 KG"
                    value={rates.shipping_rate_3kg}
                    onChange={(v) => updateRate("shipping_rate_3kg", v)}
                    helper="After delivery — shipping cost for 3kg"
                  />
                </CardContent>
              </Card>

              {/* COD Fees */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                      <DollarSign className="h-4 w-4 text-amber-500" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">COD Fees</CardTitle>
                      <CardDescription className="text-[10px]">Cash on delivery charges</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <RateInput
                    label="Flat Fee per Delivered Order"
                    value={rates.cod_fee_per_delivery}
                    onChange={(v) => updateRate("cod_fee_per_delivery", v)}
                    helper="After delivery — charged per delivered order"
                  />
                </CardContent>
              </Card>

              {/* Agent Commission */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-2">
                    <div className="h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center">
                      <UserCheck className="h-4 w-4 text-purple-500" />
                    </div>
                    <div>
                      <CardTitle className="text-sm">Agent Commission</CardTitle>
                      <CardDescription className="text-[10px]">Agent earnings per order</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <RateInput
                    label="Commission per Confirmed Order"
                    value={rates.agent_commission_confirmed}
                    onChange={(v) => updateRate("agent_commission_confirmed", v)}
                    helper="After confirmation — agent earns per confirmed order"
                  />
                  <RateInput
                    label="Commission per Delivered Order"
                    value={rates.agent_commission_delivered}
                    onChange={(v) => updateRate("agent_commission_delivered", v)}
                    helper="After delivery — agent earns per delivered order"
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* Save Button */}
          {!isLoading && (
            <div className="flex justify-end">
              <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save Rates
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
