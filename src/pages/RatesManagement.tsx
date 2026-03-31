import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Loader2, Phone, Truck, DollarSign, UserCheck, Save, ChevronRight, Percent } from "lucide-react";
import { toast } from "sonner";

// --- Types ---
interface SellerRateValues {
  dropped_order_rate: number;
  confirmed_order_rate: number;
  shipping_rate_1kg: number;
  shipping_rate_2kg: number;
  shipping_rate_3kg: number;
  cod_fee_percentage: number;
}

interface AgentRateValues {
  agent_commission_confirmed: number;
  agent_commission_delivered: number;
}

const defaultSellerRates: SellerRateValues = {
  dropped_order_rate: 0,
  confirmed_order_rate: 0,
  shipping_rate_1kg: 0,
  shipping_rate_2kg: 0,
  shipping_rate_3kg: 0,
  cod_fee_percentage: 0,
};

const defaultAgentRates: AgentRateValues = {
  agent_commission_confirmed: 0,
  agent_commission_delivered: 0,
};

// --- Reusable Input ---
function RateInput({ label, value, onChange, helper, prefix = "$" }: { label: string; value: number; onChange: (v: number) => void; helper?: string; prefix?: string }) {
  const [localValue, setLocalValue] = useState(String(value));

  useEffect(() => {
    setLocalValue(String(value));
  }, [value]);

  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium text-muted-foreground">{label}</Label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">{prefix}</span>
        <Input
          type="text"
          inputMode="decimal"
          value={localValue}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === "" || /^[0-9]*\.?[0-9]*$/.test(raw)) {
              setLocalValue(raw);
              const v = parseFloat(raw);
              onChange(isNaN(v) || v < 0 ? 0 : v);
            }
          }}
          onBlur={() => {
            const v = parseFloat(localValue);
            const final = isNaN(v) || v < 0 ? 0 : v;
            setLocalValue(String(final));
            onChange(final);
          }}
          className="pl-7 h-9 text-sm"
          placeholder="0.00"
        />
      </div>
      {helper && <p className="text-[10px] text-muted-foreground/70">{helper}</p>}
    </div>
  );
}

// --- Person selector ---
function PersonSelector({ people, selectedId, onSelect, emptyText }: { people: any[]; selectedId: string | null; onSelect: (id: string) => void; emptyText: string }) {
  return (
    <Card>
      <CardContent className="space-y-1 pt-4">
        {people.length === 0 && (
          <p className="text-xs text-muted-foreground py-4 text-center">{emptyText}</p>
        )}
        {people.map((p: any) => (
          <button
            key={p.user_id}
            onClick={() => onSelect(p.user_id)}
            className={`w-full flex items-center justify-between rounded-lg px-3 py-2.5 text-left transition-colors ${
              selectedId === p.user_id
                ? "bg-primary/10 border border-primary/20"
                : "hover:bg-muted/50 border border-transparent"
            }`}
          >
            <div>
              <p className="text-sm font-medium">{p.name}</p>
              <p className="text-xs text-muted-foreground">{p.email}</p>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </CardContent>
    </Card>
  );
}

// --- Mode Toggle ---
function ModeToggle({ label, description, isPerEntity, onToggle, entityLabel }: { label: string; description: string; isPerEntity: boolean; onToggle: (v: boolean) => void; entityLabel: string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-sm font-medium">{label}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs font-medium ${!isPerEntity ? "text-primary" : "text-muted-foreground"}`}>Global</span>
          <Switch checked={isPerEntity} onCheckedChange={onToggle} />
          <span className={`text-xs font-medium ${isPerEntity ? "text-primary" : "text-muted-foreground"}`}>Per {entityLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

export default function RatesManagement() {
  const queryClient = useQueryClient();

  // --- Seller rates state ---
  const [isPerSeller, setIsPerSeller] = useState(false);
  const [selectedSellerId, setSelectedSellerId] = useState<string | null>(null);
  const [sellerRates, setSellerRates] = useState<SellerRateValues>(defaultSellerRates);

  // --- Agent rates state ---
  const [isPerAgent, setIsPerAgent] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [agentRates, setAgentRates] = useState<AgentRateValues>(defaultAgentRates);

  // --- Fetch modes ---
  const { data: sellerModeData } = useQuery({
    queryKey: ["rates-mode"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "rates_mode").maybeSingle();
      return data?.value || "global";
    },
  });

  const { data: agentModeData } = useQuery({
    queryKey: ["agent-rates-mode"],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", "agent_rates_mode").maybeSingle();
      return data?.value || "global";
    },
  });

  useEffect(() => { if (sellerModeData) setIsPerSeller(sellerModeData === "per_seller"); }, [sellerModeData]);
  useEffect(() => { if (agentModeData) setIsPerAgent(agentModeData === "per_agent"); }, [agentModeData]);

  // --- Fetch sellers & agents ---
  const { data: sellers = [] } = useQuery({
    queryKey: ["rates-sellers"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "seller");
      if (!roles?.length) return [];
      const { data: profiles } = await supabase.from("profiles").select("user_id, name, email").in("user_id", roles.map(r => r.user_id));
      return profiles || [];
    },
  });

  const { data: agents = [] } = useQuery({
    queryKey: ["rates-agents"],
    queryFn: async () => {
      const { data: roles } = await supabase.from("user_roles").select("user_id").eq("role", "agent");
      if (!roles?.length) return [];
      const { data: profiles } = await supabase.from("profiles").select("user_id, name, email").in("user_id", roles.map(r => r.user_id));
      return profiles || [];
    },
  });

  // --- Seller rate target ---
  const sellerTarget = isPerSeller ? selectedSellerId : null;

  const { data: sellerRateData, isLoading: sellerLoading } = useQuery({
    queryKey: ["rate-settings", sellerTarget],
    queryFn: async () => {
      let q = supabase.from("rate_settings").select("*");
      if (sellerTarget) q = q.eq("seller_id", sellerTarget);
      else q = q.is("seller_id", null);
      const { data } = await q.maybeSingle();
      return data;
    },
    enabled: !isPerSeller || !!selectedSellerId,
  });

  useEffect(() => {
    if (sellerRateData) {
      setSellerRates({
        dropped_order_rate: sellerRateData.dropped_order_rate ?? 0,
        confirmed_order_rate: sellerRateData.confirmed_order_rate ?? 0,
        shipping_rate_1kg: sellerRateData.shipping_rate_1kg ?? 0,
        shipping_rate_2kg: sellerRateData.shipping_rate_2kg ?? 0,
        shipping_rate_3kg: sellerRateData.shipping_rate_3kg ?? 0,
        cod_fee_percentage: sellerRateData.cod_fee_per_delivery ?? 0,
      });
    } else {
      setSellerRates(defaultSellerRates);
    }
  }, [sellerRateData]);

  // --- Agent rate target ---
  const agentTarget = isPerAgent ? selectedAgentId : null;

  const { data: agentRateData, isLoading: agentLoading } = useQuery({
    queryKey: ["agent-rate-settings", agentTarget],
    queryFn: async () => {
      let q = supabase.from("rate_settings").select("*");
      // For agent rates, use a convention: seller_id stores agent_id when is_global=false for agent context
      // We'll use a separate approach: query where agent target matches
      // Actually we need to distinguish. Let's use a naming convention in the data:
      // For agent global: seller_id IS NULL and is_global=true — but that conflicts with seller global.
      // Better approach: we'll add a "rate_type" concept. But for now, let's use a workaround:
      // Agent rates will have seller_id = 'agent_global' marker or actual agent_id
      // Actually, let's just query with a special marker. We'll store agent rates with 
      // a special convention using the existing table.
      // 
      // Simplest: we store agent rates as separate rows. We'll identify them by checking
      // if the seller_id matches an agent user_id. For global agent rates, we'll use
      // a special app_settings key.
      //
      // Better: add a rate_type column. Let me just use the existing structure smartly.
      // Global seller rate: seller_id IS NULL, is_global=true
      // Per-seller rate: seller_id = <seller_uuid>, is_global=false  
      // Global agent rate: we need a different row. Let's query with a dummy marker.
      // 
      // Actually the cleanest way without schema change: store agent rates in app_settings as JSON.
      // But that's hacky. Let me add a rate_type column via migration.
      //
      // For now, I'll just use the rate_settings table with a convention:
      // Agent rates: seller_id will store the agent_id (or null for global agent rate)
      // But we need to distinguish from seller rates. We need a migration.
      
      // Temporarily return null - will fix with migration
      return null;
    },
    enabled: false, // disabled until migration
  });

  // Save seller rates
  const saveSellerMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        dropped_order_rate: sellerRates.dropped_order_rate,
        confirmed_order_rate: sellerRates.confirmed_order_rate,
        shipping_rate_1kg: sellerRates.shipping_rate_1kg,
        shipping_rate_2kg: sellerRates.shipping_rate_2kg,
        shipping_rate_3kg: sellerRates.shipping_rate_3kg,
        cod_fee_per_delivery: sellerRates.cod_fee_percentage,
      };
      if (sellerRateData?.id) {
        const { error } = await supabase.from("rate_settings").update(payload).eq("id", sellerRateData.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rate_settings").insert({
          ...payload,
          agent_commission_confirmed: 0,
          agent_commission_delivered: 0,
          seller_id: sellerTarget,
          is_global: !sellerTarget,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Seller rates saved");
      queryClient.invalidateQueries({ queryKey: ["rate-settings"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to save"),
  });

  // Save mode helper
  const saveMode = async (key: string, value: string) => {
    const { data: existing } = await supabase.from("app_settings").select("id").eq("key", key).maybeSingle();
    if (existing) {
      await supabase.from("app_settings").update({ value }).eq("key", key);
    } else {
      await supabase.from("app_settings").insert({ key, value });
    }
  };

  const sellerModeMutation = useMutation({
    mutationFn: (mode: string) => saveMode("rates_mode", mode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["rates-mode"] }),
  });

  const agentModeMutation = useMutation({
    mutationFn: (mode: string) => saveMode("agent_rates_mode", mode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agent-rates-mode"] }),
  });

  const handleSellerModeToggle = (perSeller: boolean) => {
    setIsPerSeller(perSeller);
    setSelectedSellerId(null);
    sellerModeMutation.mutate(perSeller ? "per_seller" : "global");
  };

  const handleAgentModeToggle = (perAgent: boolean) => {
    setIsPerAgent(perAgent);
    setSelectedAgentId(null);
    agentModeMutation.mutate(perAgent ? "per_agent" : "global");
  };

  // --- Agent rates using app_settings JSON (simple approach without migration) ---
  const agentRateKey = isPerAgent && selectedAgentId ? `agent_rates_${selectedAgentId}` : "agent_rates_global";

  const { data: agentRateRaw, isLoading: agentRatesLoading } = useQuery({
    queryKey: ["agent-rates", agentRateKey],
    queryFn: async () => {
      const { data } = await supabase.from("app_settings").select("value").eq("key", agentRateKey).maybeSingle();
      if (data?.value) {
        try { return JSON.parse(data.value); } catch { return null; }
      }
      return null;
    },
    enabled: !isPerAgent || !!selectedAgentId,
  });

  useEffect(() => {
    if (agentRateRaw) {
      setAgentRates({
        agent_commission_confirmed: agentRateRaw.agent_commission_confirmed ?? 0,
        agent_commission_delivered: agentRateRaw.agent_commission_delivered ?? 0,
      });
    } else {
      setAgentRates(defaultAgentRates);
    }
  }, [agentRateRaw]);

  const saveAgentMutation = useMutation({
    mutationFn: async () => {
      const value = JSON.stringify(agentRates);
      const { data: existing } = await supabase.from("app_settings").select("id").eq("key", agentRateKey).maybeSingle();
      if (existing) {
        const { error } = await supabase.from("app_settings").update({ value }).eq("key", agentRateKey);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("app_settings").insert({ key: agentRateKey, value });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success("Agent commission saved");
      queryClient.invalidateQueries({ queryKey: ["agent-rates"] });
    },
    onError: (err: any) => toast.error(err.message || "Failed to save"),
  });

  const showSellerRates = !isPerSeller || !!selectedSellerId;
  const showAgentRates = !isPerAgent || !!selectedAgentId;

  return (
    <div className="space-y-8 p-4 md:p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Rates Management</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Control all business rates, commissions, and fees in one place.
        </p>
      </div>

      {/* ============ SELLER SECTION ============ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-1 rounded-full bg-primary" />
          <h2 className="text-lg font-semibold">Seller Rates</h2>
        </div>

        <ModeToggle
          label="Seller Rate Mode"
          description={isPerSeller ? "Custom rates per seller" : "Same rates for all sellers"}
          isPerEntity={isPerSeller}
          onToggle={handleSellerModeToggle}
          entityLabel="Seller"
        />

        {isPerSeller && (
          <PersonSelector
            people={sellers}
            selectedId={selectedSellerId}
            onSelect={setSelectedSellerId}
            emptyText="No sellers found"
          />
        )}

        {showSellerRates && (
          <>
            {sellerLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {/* Call Center */}
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
                      value={sellerRates.dropped_order_rate}
                      onChange={(v) => setSellerRates(p => ({ ...p, dropped_order_rate: v }))}
                      helper="Before confirmation — cost when order enters system"
                    />
                    <RateInput
                      label="Confirmed Order Rate"
                      value={sellerRates.confirmed_order_rate}
                      onChange={(v) => setSellerRates(p => ({ ...p, confirmed_order_rate: v }))}
                      helper="After confirmation — cost per confirmed order"
                    />
                  </CardContent>
                </Card>

                {/* Shipping */}
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
                    <RateInput label="1 KG" value={sellerRates.shipping_rate_1kg} onChange={(v) => setSellerRates(p => ({ ...p, shipping_rate_1kg: v }))} helper="After delivery — shipping cost for 1kg" />
                    <RateInput label="2 KG" value={sellerRates.shipping_rate_2kg} onChange={(v) => setSellerRates(p => ({ ...p, shipping_rate_2kg: v }))} helper="After delivery — shipping cost for 2kg" />
                    <RateInput label="3 KG" value={sellerRates.shipping_rate_3kg} onChange={(v) => setSellerRates(p => ({ ...p, shipping_rate_3kg: v }))} helper="After delivery — shipping cost for 3kg" />
                  </CardContent>
                </Card>

                {/* COD — now percentage */}
                <Card>
                  <CardHeader className="pb-3">
                    <div className="flex items-center gap-2">
                      <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
                        <Percent className="h-4 w-4 text-amber-500" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">COD Fees</CardTitle>
                        <CardDescription className="text-[10px]">Cash on delivery percentage</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <RateInput
                      label="COD Fee Percentage"
                      value={sellerRates.cod_fee_percentage}
                      onChange={(v) => setSellerRates(p => ({ ...p, cod_fee_percentage: v }))}
                      helper="After delivery — percentage of order total"
                      prefix="%"
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {!sellerLoading && (
              <div className="flex justify-end">
                <Button onClick={() => saveSellerMutation.mutate()} disabled={saveSellerMutation.isPending} className="gap-2">
                  {saveSellerMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Seller Rates
                </Button>
              </div>
            )}
          </>
        )}
      </div>

      <Separator />

      {/* ============ AGENT SECTION ============ */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <div className="h-6 w-1 rounded-full bg-purple-500" />
          <h2 className="text-lg font-semibold">Agent Commission</h2>
        </div>

        <ModeToggle
          label="Agent Rate Mode"
          description={isPerAgent ? "Custom commission per agent" : "Same commission for all agents"}
          isPerEntity={isPerAgent}
          onToggle={handleAgentModeToggle}
          entityLabel="Agent"
        />

        {isPerAgent && (
          <PersonSelector
            people={agents}
            selectedId={selectedAgentId}
            onSelect={setSelectedAgentId}
            emptyText="No agents found"
          />
        )}

        {showAgentRates && (
          <>
            {agentRatesLoading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
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
                      value={agentRates.agent_commission_confirmed}
                      onChange={(v) => setAgentRates(p => ({ ...p, agent_commission_confirmed: v }))}
                      helper="After confirmation — agent earns per confirmed order"
                    />
                    <RateInput
                      label="Commission per Delivered Order"
                      value={agentRates.agent_commission_delivered}
                      onChange={(v) => setAgentRates(p => ({ ...p, agent_commission_delivered: v }))}
                      helper="After delivery — agent earns per delivered order"
                    />
                  </CardContent>
                </Card>
              </div>
            )}

            {!agentRatesLoading && (
              <div className="flex justify-end">
                <Button onClick={() => saveAgentMutation.mutate()} disabled={saveAgentMutation.isPending} className="gap-2">
                  {saveAgentMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save Agent Commission
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
