import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Save, Activity, Send } from "lucide-react";
import { toast } from "sonner";

export default function WhatsappSettings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["wts-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_settings")
        .select("*")
        .eq("singleton", true)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<any>(null);
  const [testPhone, setTestPhone] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (isLoading || !form) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const save = async () => {
    setBusy(true);
    const { id, ...payload } = form;
    const { error } = await supabase
      .from("whatsapp_settings")
      .update(payload)
      .eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["wts-settings"] });
  };

  const testConnection = async () => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-test", {
      body: { mode: "connection" },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else if (data?.ok) toast.success("Connection OK");
    else toast.error(data?.error ?? "Failed");
  };

  const sendTest = async () => {
    if (!testPhone) {
      toast.error("Enter a phone number");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-test", {
      body: { mode: "message", phone: testPhone },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else if (data?.ok) toast.success("Test message sent");
    else toast.error(data?.error ?? "Failed");
  };

  const set = (k: string, v: any) => setForm({ ...form, [k]: v });
  const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/whatsapp-webhook`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader><CardTitle className="text-base">Provider</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Provider</Label>
            <Input value={form.provider_name} onChange={(e) => set("provider_name", e.target.value)} />
          </div>
          <div>
            <Label>API base URL</Label>
            <Input value={form.api_base_url} onChange={(e) => set("api_base_url", e.target.value)} />
          </div>
          <div>
            <Label>Phone Number ID</Label>
            <Input value={form.phone_number_id ?? ""} onChange={(e) => set("phone_number_id", e.target.value)} />
          </div>
          <div>
            <Label>WABA ID</Label>
            <Input value={form.waba_id ?? ""} onChange={(e) => set("waba_id", e.target.value)} />
          </div>
          <div>
            <Label>Sender number (display)</Label>
            <Input value={form.sender_number ?? ""} onChange={(e) => set("sender_number", e.target.value)} placeholder="+92..." />
          </div>
          <div className="text-[11px] text-muted-foreground">
            Access token is stored as the secret <code>WHATSAPP_META_ACCESS_TOKEN</code>.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Behaviour</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Default country code</Label>
              <Input value={form.default_country_code} onChange={(e) => set("default_country_code", e.target.value)} />
            </div>
            <div>
              <Label>Max retries</Label>
              <Input type="number" value={form.max_retries} onChange={(e) => set("max_retries", parseInt(e.target.value || "0"))} />
            </div>
          </div>
          <div>
            <Label>Webhook verify token</Label>
            <Input value={form.webhook_secret ?? ""} onChange={(e) => set("webhook_secret", e.target.value)} placeholder="any random string" />
            <div className="text-[11px] text-muted-foreground mt-1">
              Configure this same value in Meta as the verify token.
            </div>
          </div>
          <div>
            <Label>Webhook URL</Label>
            <Input readOnly value={webhookUrl} />
          </div>
          {[
            ["integration_enabled", "Integration enabled"],
            ["sending_enabled", "Sending enabled"],
            ["receiving_enabled", "Receiving enabled"],
            ["auto_book_shipping", "Auto-book shipping on confirm (push to ORIO)"],
          ].map(([k, label]) => (
            <div key={k} className="flex items-center justify-between border rounded-lg px-3 py-2">
              <Label className="text-sm font-normal">{label}</Label>
              <Switch checked={!!form[k]} onCheckedChange={(v) => set(k, v)} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader><CardTitle className="text-base">Actions</CardTitle></CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <Button onClick={save} disabled={busy}><Save className="h-4 w-4 mr-2" /> Save</Button>
          <Button variant="outline" onClick={testConnection} disabled={busy}>
            <Activity className="h-4 w-4 mr-2" /> Test connection
          </Button>
          <div className="flex items-end gap-2">
            <div>
              <Label>Test phone</Label>
              <Input value={testPhone} onChange={(e) => setTestPhone(e.target.value)} placeholder="+92300..." />
            </div>
            <Button variant="outline" onClick={sendTest} disabled={busy}>
              <Send className="h-4 w-4 mr-2" /> Send test
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
