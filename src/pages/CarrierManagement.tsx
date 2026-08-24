import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Copy, DollarSign, MapPin, Package, Plus, Route, Save, Scale, ShieldCheck, SlidersHorizontal, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";

type FulfillmentMode = "carrier_managed" | "self_fulfilled";
type RuleType = "city" | "seller" | "cod" | "weight" | "capability" | "custom";

interface Carrier {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  fulfillment_mode: FulfillmentMode;
  supports_cod: boolean;
  supports_tracking: boolean;
  supports_bulk_tracking: boolean;
  supports_labels: boolean;
  supports_load_sheet: boolean;
  supports_cancel: boolean;
  supports_payment_status?: boolean;
  priority: number;
  settings?: Record<string, unknown>;
  created_at: string;
}

interface ShippingRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  carrier_id: string;
  fulfillment_mode: FulfillmentMode | null;
  criteria: Record<string, unknown>;
}

interface CarrierCity {
  id: string;
  carrier_id: string;
  city_name: string;
  aliases?: string[] | null;
}

interface UnmatchedCarrierCity {
  id: string;
  carrier_id: string;
  fallback_carrier_id: string | null;
  input_city: string;
  normalized_city: string;
  reason: string | null;
  last_order_id: string | null;
  last_system_id: number | null;
  occurrence_count: number;
  status: string;
  last_seen_at: string;
}

const emptyCarrier = {
  code: "",
  name: "",
  fulfillment_mode: "carrier_managed" as FulfillmentMode,
  priority: "100",
};

const defaultRuleCriteria = "{\n  \"city\": [],\n  \"seller_ids\": [],\n  \"min_cod_amount\": null,\n  \"max_cod_amount\": null,\n  \"min_weight\": null,\n  \"max_weight\": null,\n  \"requires_labels\": false,\n  \"requires_tracking\": true,\n  \"fallback_carrier_code\": null\n}";

const ruleTemplates: Record<RuleType, string> = {
  city: "{\n  \"city\": [\"LAHORE\"],\n  \"fallback_carrier_code\": \"postex\"\n}",
  seller: "{\n  \"seller_ids\": [\"seller-id-here\"],\n  \"city\": [],\n  \"fallback_carrier_code\": \"postex\"\n}",
  cod: "{\n  \"min_cod_amount\": 0,\n  \"max_cod_amount\": 8000,\n  \"fallback_carrier_code\": \"postex\"\n}",
  weight: "{\n  \"min_weight\": 0,\n  \"max_weight\": 1,\n  \"fallback_carrier_code\": \"postex\"\n}",
  capability: "{\n  \"requires_labels\": true,\n  \"requires_tracking\": true,\n  \"requires_cod\": true,\n  \"fallback_carrier_code\": \"postex\"\n}",
  custom: defaultRuleCriteria,
};

const parseList = (value: string) => value.split(",").map((item) => item.trim()).filter(Boolean);

const stringifyCriteria = (criteria: Record<string, unknown>) => JSON.stringify(criteria, null, 2);

function capabilityBadges(carrier: Carrier) {
  return [
    carrier.supports_cod && "COD",
    carrier.supports_tracking && "Tracking",
    carrier.supports_bulk_tracking && "Bulk tracking",
    carrier.supports_labels && "Labels",
    carrier.supports_load_sheet && "Load sheet",
    carrier.supports_cancel && "Cancel",
    carrier.supports_payment_status && "Payments",
  ].filter(Boolean) as string[];
}

export default function CarrierManagement() {
  const queryClient = useQueryClient();
  const [carrierForm, setCarrierForm] = useState(emptyCarrier);
  const [ruleType, setRuleType] = useState<RuleType>("city");
  const [ruleForm, setRuleForm] = useState({
    name: "",
    carrier_id: "",
    fulfillment_mode: "carrier_default",
    priority: "100",
    cities: "",
    sellers: "",
    min_cod_amount: "",
    max_cod_amount: "",
    min_weight: "",
    max_weight: "",
    fallback_carrier_code: "",
    requires_labels: false,
    requires_tracking: true,
    criteria: ruleTemplates.city,
  });
  const [aliasTargets, setAliasTargets] = useState<Record<string, string>>({});

  const { data: carriers = [], isLoading: loadingCarriers } = useQuery({
    queryKey: ["carrier-management-carriers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carriers" as any)
        .select("*")
        .order("priority", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as Carrier[];
    },
  });

  const { data: activeCarrierCode = "postex" } = useQuery({
    queryKey: ["carrier-management-active-carrier"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings" as any)
        .select("value")
        .eq("key", "active_carrier_code")
        .maybeSingle();
      if (error) throw error;
      return data?.value || "postex";
    },
  });

  const { data: rules = [], isLoading: loadingRules } = useQuery({
    queryKey: ["carrier-management-rules"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("shipping_rules" as any)
        .select("*")
        .order("priority", { ascending: true })
        .order("name", { ascending: true });
      if (error) throw error;
      return (data || []) as ShippingRule[];
    },
  });

  const { data: cityRows = [] } = useQuery({
    queryKey: ["carrier-management-city-coverage"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carrier_city_cache" as any)
        .select("id, carrier_id, city_name, aliases")
        .order("city_name", { ascending: true })
        .limit(2500);
      if (error) throw error;
      return (data || []) as CarrierCity[];
    },
  });

  const { data: unmatchedCities = [], isLoading: loadingUnmatched } = useQuery({
    queryKey: ["carrier-management-unmatched-cities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("carrier_city_unmatched" as any)
        .select("*")
        .eq("status", "open")
        .order("last_seen_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as UnmatchedCarrierCity[];
    },
  });

  const carrierById = useMemo(() => {
    const map = new Map<string, Carrier>();
    carriers.forEach((carrier) => map.set(carrier.id, carrier));
    return map;
  }, [carriers]);

  const carrierByCode = useMemo(() => {
    const map = new Map<string, Carrier>();
    carriers.forEach((carrier) => map.set(carrier.code, carrier));
    return map;
  }, [carriers]);

  const activeCarrier = activeCarrierCode ? carrierByCode.get(activeCarrierCode) : null;
  const enabledCarriers = carriers.filter((carrier) => carrier.enabled);

  const cityCoverage = useMemo(() => {
    const cityMap = new Map<string, Set<string>>();
    cityRows.forEach((row) => {
      if (!row.city_name) return;
      const key = String(row.city_name).trim().toUpperCase();
      if (!cityMap.has(key)) cityMap.set(key, new Set());
      const carrier = carrierById.get(row.carrier_id);
      if (carrier) cityMap.get(key)?.add(carrier.code);
    });
    return Array.from(cityMap.entries())
      .map(([city, carrierCodes]) => ({ city, carrierCodes: Array.from(carrierCodes).sort() }))
      .sort((a, b) => a.city.localeCompare(b.city));
  }, [carrierById, cityRows]);

  const routingStats = useMemo(() => {
    const enabledRules = rules.filter((rule) => rule.enabled);
    const cityRules = enabledRules.filter((rule) => Array.isArray(rule.criteria?.city) && (rule.criteria.city as unknown[]).length > 0);
    const fallbackRules = enabledRules.filter((rule) => Boolean(rule.criteria?.fallback_carrier_code));
    return {
      enabledRules: enabledRules.length,
      cityRules: cityRules.length,
      fallbackRules: fallbackRules.length,
      coveredCities: cityCoverage.length,
    };
  }, [cityCoverage.length, rules]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["carrier-management-carriers"] });
    queryClient.invalidateQueries({ queryKey: ["carrier-management-rules"] });
    queryClient.invalidateQueries({ queryKey: ["carrier-management-active-carrier"] });
    queryClient.invalidateQueries({ queryKey: ["carrier-management-city-coverage"] });
    queryClient.invalidateQueries({ queryKey: ["carrier-management-unmatched-cities"] });
  };

  const updateCarrier = async (id: string, patch: Partial<Carrier>) => {
    const { error } = await supabase.from("carriers" as any).update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Carrier updated");
    refresh();
  };

  const createCarrier = async () => {
    if (!carrierForm.code.trim() || !carrierForm.name.trim()) {
      toast.error("Carrier code and name are required");
      return;
    }
    const { error } = await supabase.from("carriers" as any).insert({
      code: carrierForm.code.trim().toLowerCase(),
      name: carrierForm.name.trim(),
      fulfillment_mode: carrierForm.fulfillment_mode,
      priority: Number(carrierForm.priority) || 100,
      enabled: true,
      supports_cod: true,
      supports_tracking: true,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setCarrierForm(emptyCarrier);
    toast.success("Carrier created");
    refresh();
  };

  const updateActiveCarrier = async (code: string) => {
    const selected = carrierByCode.get(code);
    if (selected && !selected.enabled) {
      toast.error("Disabled carriers cannot be the default carrier");
      return;
    }
    const { error } = await supabase.from("app_settings" as any).upsert(
      { key: "active_carrier_code", value: code, is_public: false, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Default carrier set to ${selected?.name || code}`);
    refresh();
  };

  const applyRuleTemplate = (nextType: RuleType) => {
    setRuleType(nextType);
    setRuleForm((current) => ({ ...current, criteria: ruleTemplates[nextType] }));
  };

  const buildCriteriaFromForm = () => {
    const criteria: Record<string, unknown> = {};
    const cities = parseList(ruleForm.cities);
    const sellers = parseList(ruleForm.sellers);
    if (cities.length > 0) criteria.city = cities;
    if (sellers.length > 0) criteria.seller_ids = sellers;
    if (ruleForm.min_cod_amount) criteria.min_cod_amount = Number(ruleForm.min_cod_amount);
    if (ruleForm.max_cod_amount) criteria.max_cod_amount = Number(ruleForm.max_cod_amount);
    if (ruleForm.min_weight) criteria.min_weight = Number(ruleForm.min_weight);
    if (ruleForm.max_weight) criteria.max_weight = Number(ruleForm.max_weight);
    if (ruleForm.requires_labels) criteria.requires_labels = true;
    if (ruleForm.requires_tracking) criteria.requires_tracking = true;
    if (ruleForm.fallback_carrier_code) criteria.fallback_carrier_code = ruleForm.fallback_carrier_code;
    return criteria;
  };

  const copyBuilderToJson = () => {
    setRuleForm((current) => ({ ...current, criteria: stringifyCriteria(buildCriteriaFromForm()) }));
    toast.success("Criteria JSON updated");
  };

  const createRule = async () => {
    if (!ruleForm.name.trim() || !ruleForm.carrier_id) {
      toast.error("Rule name and carrier are required");
      return;
    }
    let criteria: Record<string, unknown>;
    try {
      criteria = JSON.parse(ruleForm.criteria || "{}");
    } catch {
      toast.error("Criteria must be valid JSON");
      return;
    }
    const { error } = await supabase.from("shipping_rules" as any).insert({
      name: ruleForm.name.trim(),
      carrier_id: ruleForm.carrier_id,
      fulfillment_mode: ruleForm.fulfillment_mode === "carrier_default" ? null : ruleForm.fulfillment_mode,
      priority: Number(ruleForm.priority) || 100,
      enabled: true,
      criteria,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setRuleForm((current) => ({ ...current, name: "", priority: "100" }));
    toast.success("Shipping rule created");
    refresh();
  };

  const deleteRule = async (id: string) => {
    const { error } = await supabase.from("shipping_rules" as any).delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Rule deleted");
    refresh();
  };

  const addCityAlias = async (unmatched: UnmatchedCarrierCity) => {
    const targetCityId = aliasTargets[unmatched.id];
    if (!targetCityId) {
      toast.error("Select a carrier city first");
      return;
    }

    const targetCity = cityRows.find((row) => row.id === targetCityId);
    if (!targetCity) {
      toast.error("Selected carrier city was not found");
      return;
    }

    const existingAliases = Array.isArray(targetCity.aliases) ? targetCity.aliases : [];
    const nextAliases = Array.from(new Set([...existingAliases, unmatched.input_city.trim()].filter(Boolean)));
    const { error: aliasError } = await supabase
      .from("carrier_city_cache" as any)
      .update({ aliases: nextAliases, cached_at: new Date().toISOString() })
      .eq("id", targetCity.id);
    if (aliasError) {
      toast.error(aliasError.message);
      return;
    }

    const { data: userResult } = await supabase.auth.getUser();
    const { error: unmatchedError } = await supabase
      .from("carrier_city_unmatched" as any)
      .update({
        status: "resolved",
        resolved_by: userResult?.user?.id || null,
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", unmatched.id);
    if (unmatchedError) {
      toast.error(unmatchedError.message);
      return;
    }

    toast.success(`Alias added: ${unmatched.input_city} -> ${targetCity.city_name}`);
    setAliasTargets((current) => {
      const next = { ...current };
      delete next[unmatched.id];
      return next;
    });
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <Truck className="h-5 w-5 text-primary" />
            Carrier Configuration
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Control default carrier, city routing, fallback rules and shipping capabilities.</p>
        </div>
        <div className="flex items-center gap-2 rounded-md border bg-background px-3 py-2">
          <Label className="text-xs font-semibold text-muted-foreground">Default carrier</Label>
          <Select value={activeCarrierCode} onValueChange={updateActiveCarrier}>
            <SelectTrigger className="h-8 w-[190px] text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {carriers.map((carrier) => (
                <SelectItem key={carrier.id} value={carrier.code} disabled={!carrier.enabled}>
                  {carrier.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatusCard icon={<ShieldCheck className="h-4 w-4" />} label="Default carrier" value={activeCarrier?.name || activeCarrierCode || "-"} detail="Used when no routing rule matches" />
        <StatusCard icon={<Route className="h-4 w-4" />} label="Enabled rules" value={routingStats.enabledRules} detail={`${routingStats.cityRules} city rules, ${routingStats.fallbackRules} fallbacks`} />
        <StatusCard icon={<MapPin className="h-4 w-4" />} label="Covered cities" value={routingStats.coveredCities} detail="From carrier city cache" />
        <StatusCard icon={<Truck className="h-4 w-4" />} label="Enabled carriers" value={enabledCarriers.length} detail={`${carriers.length} configured carriers`} />
      </div>

      <Tabs defaultValue="carriers" className="space-y-4">
        <TabsList className="h-9">
          <TabsTrigger value="carriers" className="text-xs">Carriers</TabsTrigger>
          <TabsTrigger value="rules" className="text-xs">Routing Rules</TabsTrigger>
          <TabsTrigger value="cities" className="text-xs">City Coverage</TabsTrigger>
          <TabsTrigger value="safety" className="text-xs">Fallbacks</TabsTrigger>
        </TabsList>

        <TabsContent value="carriers" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_360px]">
            <Card className="border-border/60">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Shipping Companies</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Carrier</TableHead>
                      <TableHead className="h-9 text-xs">Mode</TableHead>
                      <TableHead className="h-9 text-xs">Capabilities</TableHead>
                      <TableHead className="h-9 w-24 text-xs">Priority</TableHead>
                      <TableHead className="h-9 w-24 text-xs">Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingCarriers ? (
                      <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Loading carriers...</TableCell></TableRow>
                    ) : carriers.length === 0 ? (
                      <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No carriers configured.</TableCell></TableRow>
                    ) : carriers.map((carrier) => (
                      <TableRow key={carrier.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{carrier.name}</div>
                          <div className="text-[11px] text-muted-foreground font-mono">{carrier.code}</div>
                        </TableCell>
                        <TableCell>
                          <Select value={carrier.fulfillment_mode} onValueChange={(value: FulfillmentMode) => updateCarrier(carrier.id, { fulfillment_mode: value })}>
                            <SelectTrigger className="h-8 w-[160px] text-xs"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="carrier_managed">Carrier managed</SelectItem>
                              <SelectItem value="self_fulfilled">Self fulfilled</SelectItem>
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {capabilityBadges(carrier).map((capability) => <Badge key={capability} variant="secondary" className="text-[10px]">{capability}</Badge>)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Input
                            className="h-8 text-xs"
                            type="number"
                            defaultValue={carrier.priority}
                            onBlur={(event) => updateCarrier(carrier.id, { priority: Number(event.currentTarget.value) || 100 })}
                          />
                        </TableCell>
                        <TableCell>
                          <Switch checked={carrier.enabled} onCheckedChange={(enabled) => updateCarrier(carrier.id, { enabled })} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Add Carrier</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Code</Label>
                  <Input className="h-8 text-xs font-mono" value={carrierForm.code} onChange={(e) => setCarrierForm({ ...carrierForm, code: e.target.value })} placeholder="mnp" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Name</Label>
                  <Input className="h-8 text-xs" value={carrierForm.name} onChange={(e) => setCarrierForm({ ...carrierForm, name: e.target.value })} placeholder="M&P" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Mode</Label>
                    <Select value={carrierForm.fulfillment_mode} onValueChange={(value: FulfillmentMode) => setCarrierForm({ ...carrierForm, fulfillment_mode: value })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="carrier_managed">Carrier managed</SelectItem>
                        <SelectItem value="self_fulfilled">Self fulfilled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Priority</Label>
                    <Input className="h-8 text-xs" type="number" value={carrierForm.priority} onChange={(e) => setCarrierForm({ ...carrierForm, priority: e.target.value })} />
                  </div>
                </div>
                <Button size="sm" className="w-full gap-1.5" onClick={createCarrier}>
                  <Plus className="h-3.5 w-3.5" /> Add carrier
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="rules" className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_460px]">
            <Card className="border-border/60">
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Routing Rules</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="h-9 text-xs">Rule</TableHead>
                      <TableHead className="h-9 text-xs">Carrier</TableHead>
                      <TableHead className="h-9 text-xs">Mode</TableHead>
                      <TableHead className="h-9 text-xs">Priority</TableHead>
                      <TableHead className="h-9 text-xs">Enabled</TableHead>
                      <TableHead className="h-9 w-14 text-xs"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {loadingRules ? (
                      <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">Loading rules...</TableCell></TableRow>
                    ) : rules.length === 0 ? (
                      <TableRow><TableCell colSpan={6} className="text-sm text-muted-foreground">No routing rules yet.</TableCell></TableRow>
                    ) : rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="font-medium text-sm">{rule.name}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <RuleBadge icon={<MapPin className="h-3 w-3" />} label={Array.isArray(rule.criteria?.city) ? `${(rule.criteria.city as unknown[]).length} cities` : "Any city"} />
                            {rule.criteria?.max_cod_amount ? <RuleBadge icon={<DollarSign className="h-3 w-3" />} label={`COD <= ${rule.criteria.max_cod_amount}`} /> : null}
                            {rule.criteria?.max_weight ? <RuleBadge icon={<Scale className="h-3 w-3" />} label={`Weight <= ${rule.criteria.max_weight}`} /> : null}
                            {rule.criteria?.requires_labels ? <RuleBadge icon={<Package className="h-3 w-3" />} label="Labels required" /> : null}
                            {rule.criteria?.fallback_carrier_code ? <RuleBadge icon={<ShieldCheck className="h-3 w-3" />} label={`Fallback ${rule.criteria.fallback_carrier_code}`} /> : null}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm">{carrierById.get(rule.carrier_id)?.name || "-"}</TableCell>
                        <TableCell className="text-xs">{rule.fulfillment_mode || "carrier default"}</TableCell>
                        <TableCell className="text-sm">{rule.priority}</TableCell>
                        <TableCell>
                          <Switch checked={rule.enabled} onCheckedChange={async (enabled) => {
                            const { error } = await supabase.from("shipping_rules" as any).update({ enabled, updated_at: new Date().toISOString() }).eq("id", rule.id);
                            if (error) toast.error(error.message); else refresh();
                          }} />
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => deleteRule(rule.id)} title="Delete rule">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card className="border-border/60">
              <CardHeader className="py-3">
                <CardTitle className="flex items-center gap-2 text-sm">
                  <SlidersHorizontal className="h-4 w-4 text-primary" />
                  Add Routing Rule
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Rule type</Label>
                    <Select value={ruleType} onValueChange={(value: RuleType) => applyRuleTemplate(value)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="city">City routing</SelectItem>
                        <SelectItem value="seller">Seller override</SelectItem>
                        <SelectItem value="cod">COD amount</SelectItem>
                        <SelectItem value="weight">Weight</SelectItem>
                        <SelectItem value="capability">Capability</SelectItem>
                        <SelectItem value="custom">Custom JSON</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Priority</Label>
                    <Input className="h-8 text-xs" type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Name</Label>
                    <Input className="h-8 text-xs" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="Lahore to M&P" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Carrier</Label>
                    <Select value={ruleForm.carrier_id} onValueChange={(carrier_id) => setRuleForm({ ...ruleForm, carrier_id })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select carrier" /></SelectTrigger>
                      <SelectContent>
                        {carriers.map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Cities</Label>
                    <Input className="h-8 text-xs" value={ruleForm.cities} onChange={(e) => setRuleForm({ ...ruleForm, cities: e.target.value })} placeholder="LAHORE, KARACHI" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Seller IDs</Label>
                    <Input className="h-8 text-xs" value={ruleForm.sellers} onChange={(e) => setRuleForm({ ...ruleForm, sellers: e.target.value })} placeholder="seller uuid, seller uuid" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <NumberInput label="Min COD" value={ruleForm.min_cod_amount} onChange={(value) => setRuleForm({ ...ruleForm, min_cod_amount: value })} />
                  <NumberInput label="Max COD" value={ruleForm.max_cod_amount} onChange={(value) => setRuleForm({ ...ruleForm, max_cod_amount: value })} />
                  <NumberInput label="Min weight" value={ruleForm.min_weight} onChange={(value) => setRuleForm({ ...ruleForm, min_weight: value })} />
                  <NumberInput label="Max weight" value={ruleForm.max_weight} onChange={(value) => setRuleForm({ ...ruleForm, max_weight: value })} />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Fallback carrier</Label>
                    <Select value={ruleForm.fallback_carrier_code || "none"} onValueChange={(value) => setRuleForm({ ...ruleForm, fallback_carrier_code: value === "none" ? "" : value })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No fallback</SelectItem>
                        {carriers.map((carrier) => <SelectItem key={carrier.id} value={carrier.code}>{carrier.name}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Mode override</Label>
                    <Select value={ruleForm.fulfillment_mode} onValueChange={(fulfillment_mode) => setRuleForm({ ...ruleForm, fulfillment_mode })}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="carrier_default">Carrier default</SelectItem>
                        <SelectItem value="carrier_managed">Carrier managed</SelectItem>
                        <SelectItem value="self_fulfilled">Self fulfilled</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 rounded-md border p-2">
                  <ToggleLine label="Requires labels" checked={ruleForm.requires_labels} onChange={(requires_labels) => setRuleForm({ ...ruleForm, requires_labels })} />
                  <ToggleLine label="Requires tracking" checked={ruleForm.requires_tracking} onChange={(requires_tracking) => setRuleForm({ ...ruleForm, requires_tracking })} />
                </div>

                <Button type="button" variant="outline" size="sm" className="w-full gap-1.5" onClick={copyBuilderToJson}>
                  <Copy className="h-3.5 w-3.5" /> Generate criteria JSON
                </Button>

                <div className="space-y-1.5">
                  <Label className="text-xs">Criteria JSON</Label>
                  <Textarea className="min-h-[140px] text-xs font-mono" value={ruleForm.criteria} onChange={(e) => setRuleForm({ ...ruleForm, criteria: e.target.value })} />
                </div>
                <Button size="sm" className="w-full gap-1.5" onClick={createRule}>
                  <Save className="h-3.5 w-3.5" /> Save rule
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="cities" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader className="py-3">
              <CardTitle className="text-sm">City Coverage</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-xs">City</TableHead>
                    <TableHead className="h-9 text-xs">Available Carriers</TableHead>
                    <TableHead className="h-9 text-xs">Recommended Rule</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {cityCoverage.slice(0, 400).map((row) => (
                    <TableRow key={row.city}>
                      <TableCell className="text-sm font-medium">{row.city}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {row.carrierCodes.map((code) => <Badge key={code} variant={code === activeCarrierCode ? "default" : "secondary"} className="text-[10px]">{carrierByCode.get(code)?.name || code}</Badge>)}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.carrierCodes.length > 1 ? "Use routing rule if one carrier performs better here" : "Fallback needed if this carrier is down"}
                      </TableCell>
                    </TableRow>
                  ))}
                  {cityCoverage.length === 0 && <TableRow><TableCell colSpan={3} className="text-sm text-muted-foreground">No city cache loaded yet.</TableCell></TableRow>}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="safety" className="space-y-4">
          <Card className="border-border/60">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <MapPin className="h-4 w-4 text-primary" />
                Unmatched Carrier Cities
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="h-9 text-xs">Input City</TableHead>
                    <TableHead className="h-9 text-xs">Carrier</TableHead>
                    <TableHead className="h-9 text-xs">Fallback</TableHead>
                    <TableHead className="h-9 text-xs">Last Order</TableHead>
                    <TableHead className="h-9 text-xs">Count</TableHead>
                    <TableHead className="h-9 text-xs">Add Alias To</TableHead>
                    <TableHead className="h-9 w-24 text-xs"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingUnmatched ? (
                    <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">Loading unmatched cities...</TableCell></TableRow>
                  ) : unmatchedCities.length === 0 ? (
                    <TableRow><TableCell colSpan={7} className="text-sm text-muted-foreground">No unmatched city fallbacks right now.</TableCell></TableRow>
                  ) : unmatchedCities.map((row) => {
                    const carrier = carrierById.get(row.carrier_id);
                    const fallbackCarrier = row.fallback_carrier_id ? carrierById.get(row.fallback_carrier_id) : null;
                    const carrierCities = cityRows.filter((city) => city.carrier_id === row.carrier_id);
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div className="text-sm font-medium">{row.input_city}</div>
                          {row.reason && <div className="text-[11px] text-muted-foreground">{row.reason}</div>}
                        </TableCell>
                        <TableCell className="text-sm">{carrier?.name || row.carrier_id}</TableCell>
                        <TableCell className="text-sm">{fallbackCarrier?.name || "-"}</TableCell>
                        <TableCell className="text-xs">
                          {row.last_order_id || "-"}
                          {row.last_system_id ? <span className="ml-1 text-muted-foreground">#{row.last_system_id}</span> : null}
                        </TableCell>
                        <TableCell className="text-sm">{row.occurrence_count}</TableCell>
                        <TableCell>
                          <Select value={aliasTargets[row.id] || ""} onValueChange={(value) => setAliasTargets((current) => ({ ...current, [row.id]: value }))}>
                            <SelectTrigger className="h-8 min-w-[190px] text-xs"><SelectValue placeholder="Select carrier city" /></SelectTrigger>
                            <SelectContent>
                              {carrierCities.map((city) => (
                                <SelectItem key={city.id} value={city.id}>{city.city_name}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => addCityAlias(row)}>
                            Add alias
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="py-3">
              <CardTitle className="flex items-center gap-2 text-sm">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Routing Safety Rules
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <SafetyItem title="Default carrier first" detail="If no rule matches, the system should keep using the configured default carrier." />
              <SafetyItem title="Coverage check" detail="A carrier should only be selected when the destination city exists in its city cache." />
              <SafetyItem title="Fallback carrier" detail="Every important city or COD rule should define a fallback carrier for API failures." />
              <SafetyItem title="Manual override" detail="Admin-selected carrier on a single order should override automatic routing." />
              <SafetyItem title="Capability guard" detail="Self-fulfilled orders should require label support before a carrier can be selected." />
              <SafetyItem title="PostEx protected" detail="Keep active_carrier_code on postex until M&P booking, tracking and labels are tested end to end." />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function StatusCard({ icon, label, value, detail }: { icon: React.ReactNode; label: string; value: React.ReactNode; detail: string }) {
  return (
    <Card className="border-border/60">
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-1 text-xl font-bold">{value}</p>
          <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
        </div>
        <div className="rounded-md bg-primary/10 p-2 text-primary">{icon}</div>
      </CardContent>
    </Card>
  );
}

function RuleBadge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Badge variant="secondary" className="gap-1 text-[10px]">
      {icon}
      {label}
    </Badge>
  );
}

function NumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input className="h-8 text-xs" type="number" value={value} onChange={(event) => onChange(event.target.value)} />
    </div>
  );
}

function ToggleLine({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <Label className="text-xs">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function SafetyItem({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
        {title}
      </div>
      <Separator className="my-2" />
      <p className="text-xs leading-5 text-muted-foreground">{detail}</p>
    </div>
  );
}
