import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Save, Truck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";

type FulfillmentMode = "carrier_managed" | "self_fulfilled";

interface Carrier {
  id: string;
  code: string;
  name: string;
  enabled: boolean;
  fulfillment_mode: FulfillmentMode;
  supports_cod: boolean;
  supports_tracking: boolean;
  supports_labels: boolean;
  supports_load_sheet: boolean;
  supports_cancel: boolean;
  priority: number;
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

const emptyCarrier = {
  code: "",
  name: "",
  fulfillment_mode: "carrier_managed" as FulfillmentMode,
  priority: "100",
};

export default function CarrierManagement() {
  const queryClient = useQueryClient();
  const [carrierForm, setCarrierForm] = useState(emptyCarrier);
  const [ruleForm, setRuleForm] = useState({
    name: "",
    carrier_id: "",
    fulfillment_mode: "carrier_default",
    priority: "100",
    criteria: "{\n  \"city\": [],\n  \"max_cod_amount\": null,\n  \"seller_ids\": []\n}",
  });

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

  const carrierById = useMemo(() => {
    const map = new Map<string, Carrier>();
    carriers.forEach((carrier) => map.set(carrier.id, carrier));
    return map;
  }, [carriers]);

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["carrier-management-carriers"] });
    queryClient.invalidateQueries({ queryKey: ["carrier-management-rules"] });
  };

  const updateCarrier = async (id: string, patch: Partial<Carrier>) => {
    const { error } = await supabase.from("carriers" as any).update(patch).eq("id", id);
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
    setRuleForm((current) => ({ ...current, name: "" }));
    toast.success("Shipping rule created");
    refresh();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Truck className="h-5 w-5 text-primary" />
            Carriers
          </h1>
          <p className="text-xs text-muted-foreground mt-0.5">Manage shipping companies, priority and routing criteria.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-4">
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
                  <TableHead className="h-9 text-xs w-24">Priority</TableHead>
                  <TableHead className="h-9 text-xs w-24">Enabled</TableHead>
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
                        <SelectTrigger className="h-8 text-xs w-[160px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="carrier_managed">Carrier managed</SelectItem>
                          <SelectItem value="self_fulfilled">Self fulfilled</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {carrier.supports_cod && <Badge variant="secondary" className="text-[10px]">COD</Badge>}
                        {carrier.supports_tracking && <Badge variant="secondary" className="text-[10px]">Tracking</Badge>}
                        {carrier.supports_labels && <Badge variant="secondary" className="text-[10px]">Labels</Badge>}
                        {carrier.supports_load_sheet && <Badge variant="secondary" className="text-[10px]">Load sheet</Badge>}
                        {carrier.supports_cancel && <Badge variant="secondary" className="text-[10px]">Cancel</Badge>}
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
              <Input className="h-8 text-xs font-mono" value={carrierForm.code} onChange={(e) => setCarrierForm({ ...carrierForm, code: e.target.value })} placeholder="postex" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input className="h-8 text-xs" value={carrierForm.name} onChange={(e) => setCarrierForm({ ...carrierForm, name: e.target.value })} placeholder="PostEx" />
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

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-4">
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
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingRules ? (
                  <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">Loading rules...</TableCell></TableRow>
                ) : rules.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-sm text-muted-foreground">No routing rules yet.</TableCell></TableRow>
                ) : rules.map((rule) => (
                  <TableRow key={rule.id}>
                    <TableCell>
                      <div className="font-medium text-sm">{rule.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[420px]">{JSON.stringify(rule.criteria || {})}</div>
                    </TableCell>
                    <TableCell className="text-sm">{carrierById.get(rule.carrier_id)?.name || "-"}</TableCell>
                    <TableCell className="text-xs">{rule.fulfillment_mode || "carrier default"}</TableCell>
                    <TableCell className="text-sm">{rule.priority}</TableCell>
                    <TableCell><Switch checked={rule.enabled} onCheckedChange={async (enabled) => {
                      const { error } = await supabase.from("shipping_rules" as any).update({ enabled }).eq("id", rule.id);
                      if (error) toast.error(error.message); else refresh();
                    }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card className="border-border/60">
          <CardHeader className="py-3">
            <CardTitle className="text-sm">Add Routing Rule</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input className="h-8 text-xs" value={ruleForm.name} onChange={(e) => setRuleForm({ ...ruleForm, name: e.target.value })} placeholder="High COD Lahore" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Priority</Label>
                <Input className="h-8 text-xs" type="number" value={ruleForm.priority} onChange={(e) => setRuleForm({ ...ruleForm, priority: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">Carrier</Label>
                <Select value={ruleForm.carrier_id} onValueChange={(carrier_id) => setRuleForm({ ...ruleForm, carrier_id })}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select carrier" /></SelectTrigger>
                  <SelectContent>
                    {carriers.map((carrier) => <SelectItem key={carrier.id} value={carrier.id}>{carrier.name}</SelectItem>)}
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
    </div>
  );
}
