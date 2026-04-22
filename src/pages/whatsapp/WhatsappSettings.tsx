import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Save, Activity, Send, CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { toast } from "sonner";

type Check = { name: string; ok: boolean; detail?: string };
type TestResult = { ok: boolean; checks: Check[]; duration_ms?: number } | null;

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
  const [accessToken, setAccessToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<TestResult>(null);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  if (isLoading || !form) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const save = async () => {
    setBusy(true);
    const { id, ...payload } = form;
    if (accessToken.trim()) {
      (payload as any).access_token = accessToken.trim();
    }
    const { error } = await supabase
      .from("whatsapp_settings")
      .update(payload)
      .eq("id", id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setAccessToken("");
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: ["wts-settings"] });
  };

  const testConnection = async () => {
    if (!form.phone_number_id?.trim()) {
      toast.error("Enter Phone Number ID first");
      return;
    }
    if (!form.access_token?.trim() && !accessToken.trim()) {
      toast.error("Enter Access Token first");
      return;
    }
    setBusy(true);
    // Auto-save current form (incl. token) so the function can read fresh values from DB
    const { id, ...payload } = form;
    if (accessToken.trim()) (payload as any).access_token = accessToken.trim();
    const { error: saveErr } = await supabase
      .from("whatsapp_settings")
      .update(payload)
      .eq("id", id);
    if (saveErr) {
      setBusy(false);
      toast.error(saveErr.message);
      return;
    }
    if (accessToken.trim()) setAccessToken("");
    qc.invalidateQueries({ queryKey: ["wts-settings"] });

    const { data, error } = await supabase.functions.invoke("whatsapp-test", {
      body: { mode: "connection" },
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      setTestResult(null);
      return;
    }
    if (data?.checks) {
      setTestResult({ ok: !!data.ok, checks: data.checks, duration_ms: data.duration_ms });
      if (data.ok) toast.success("Connection OK");
      else toast.error("Connection failed");
    } else if (data?.ok) {
      toast.success("Connection OK");
    } else {
      toast.error(data?.error ?? "Failed");
    }
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
        <CardHeader><CardTitle className="text-base">WhatsApp Cloud API</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Phone Number ID</Label>
            <Input value={form.phone_number_id ?? ""} onChange={(e) => set("phone_number_id", e.target.value)} placeholder="e.g. 1234567890" />
          </div>
          <div>
            <Label>Business Account ID (WABA ID)</Label>
            <Input value={form.waba_id ?? ""} onChange={(e) => set("waba_id", e.target.value)} placeholder="e.g. 9876543210" />
          </div>
          <div>
            <Label>Access Token</Label>
            <Input
              type="password"
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="EAAG... (paste new token to update)"
            />
            <div className="text-[11px] text-muted-foreground mt-1">
              {form.access_token
                ? "✓ Token saved. Leave empty to keep it, or paste a new one to replace."
                : "No token saved yet. Paste your Meta WhatsApp Cloud API access token."}
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={busy} size="sm">
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={busy} size="sm">
              {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Activity className="h-4 w-4 mr-2" />}
              Test connection
            </Button>
          </div>

          {testResult && (
            <div className="mt-3 rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className={`text-sm font-medium flex items-center gap-1.5 ${testResult.ok ? "text-primary" : "text-destructive"}`}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {testResult.ok ? "All checks passed" : "Some checks failed"}
                </div>
                {testResult.duration_ms != null && (
                  <span className="text-[11px] text-muted-foreground">{testResult.duration_ms}ms</span>
                )}
              </div>
              <ul className="space-y-1.5">
                {testResult.checks.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs">
                    {c.ok ? (
                      <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                    )}
                    <div className="min-w-0">
                      <div className="font-medium">{c.name}</div>
                      {c.detail && <div className="text-muted-foreground">{c.detail}</div>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Webhook</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Callback URL</Label>
            <Input readOnly value={webhookUrl} />
          </div>
          <div>
            <Label>Verify Token</Label>
            <Input value={form.webhook_secret ?? ""} onChange={(e) => set("webhook_secret", e.target.value)} placeholder="any random string" />
            <div className="text-[11px] text-muted-foreground mt-1">
              Configure this same value in Meta as the verify token.
            </div>
          </div>
          <div className="flex gap-2 pt-2">
            <Button onClick={save} disabled={busy} size="sm">
              <Save className="h-4 w-4 mr-2" /> Save
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={busy} size="sm">
              <Activity className="h-4 w-4 mr-2" /> Test connection
            </Button>
          </div>
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
