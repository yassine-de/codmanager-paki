import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Trash2, Plus, X, Type, Image as ImageIcon, Video as VideoIcon, FileText,
  Send, RefreshCw, CheckCircle2, Clock, XCircle, Smartphone, Loader2,
} from "lucide-react";
import { toast } from "sonner";

const TYPES = [
  { value: "first_message", label: "First message" },
  { value: "reminder", label: "Reminder" },
  { value: "more_info", label: "More info" },
  { value: "cancel_recovery", label: "Cancel recovery" },
];
const CATEGORIES = [
  { value: "UTILITY", label: "Utility" },
  { value: "MARKETING", label: "Marketing" },
  { value: "AUTHENTICATION", label: "Authentication" },
];
const HEADER_TYPES = [
  { value: "NONE", label: "None", icon: X },
  { value: "TEXT", label: "Text", icon: Type },
  { value: "IMAGE", label: "Image", icon: ImageIcon },
  { value: "VIDEO", label: "Video", icon: VideoIcon },
  { value: "DOCUMENT", label: "Document", icon: FileText },
];

const emptyForm = {
  name: "",
  type: "first_message",
  language: "en",
  category: "UTILITY",
  meta_template_name: "",
  header_type: "NONE",
  header_text: "",
  header_media_url: "",
  body: "",
  footer: "",
  buttons: [] as any[],
  active: true,
};

function StatusBadge({ status }: { status?: string }) {
  const s = (status || "LOCAL").toUpperCase();
  const map: Record<string, { cls: string; icon: any; label: string }> = {
    LOCAL: { cls: "bg-muted text-muted-foreground", icon: Clock, label: "Draft" },
    PENDING: { cls: "bg-amber-500/15 text-amber-600 border-amber-500/30", icon: Clock, label: "Pending" },
    APPROVED: { cls: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30", icon: CheckCircle2, label: "Approved" },
    REJECTED: { cls: "bg-destructive/15 text-destructive border-destructive/30", icon: XCircle, label: "Rejected" },
    PAUSED: { cls: "bg-muted text-muted-foreground", icon: Clock, label: "Paused" },
    DISABLED: { cls: "bg-muted text-muted-foreground", icon: XCircle, label: "Disabled" },
  };
  const v = map[s] || map.LOCAL;
  const Icon = v.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${v.cls}`}>
      <Icon className="h-3 w-3" /> {v.label}
    </span>
  );
}

function renderPreview(text: string) {
  if (!text) return <span className="text-muted-foreground italic">Message body…</span>;
  const parts = text.split(/(\{\{[a-zA-Z0-9_]+\}\})/g);
  return parts.map((p, i) =>
    /\{\{[a-zA-Z0-9_]+\}\}/.test(p)
      ? <span key={i} className="text-emerald-600 font-medium">{p}</span>
      : <span key={i}>{p}</span>
  );
}

export default function WhatsappTemplates() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["wts-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const variables = useMemo(() => {
    const set = new Set<string>();
    const re = /\{\{([a-zA-Z0-9_]+)\}\}/g;
    [form.header_text, form.body, form.footer].forEach((t) => {
      let m;
      while ((m = re.exec(t || ""))) set.add(m[1]);
    });
    return Array.from(set);
  }, [form.header_text, form.body, form.footer]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const insertVar = (target: "header_text" | "body" | "footer", name: string) => {
    if (!name.trim()) return;
    set(target, (form[target] || "") + ` {{${name.trim()}}}`);
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm);
    setOpen(true);
  };
  const openEdit = (t: any) => {
    setEditingId(t.id);
    setForm({
      name: t.name,
      type: t.type,
      language: t.language,
      category: t.category || "UTILITY",
      meta_template_name: t.meta_template_name || "",
      header_type: t.header_type || "NONE",
      header_text: t.header_text || "",
      header_media_url: t.header_media_url || "",
      body: t.body || "",
      footer: t.footer || "",
      buttons: t.buttons || [],
      active: t.active,
    });
    setOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast.error("Name and body are required");
      return;
    }
    setBusy(true);
    let id = editingId;
    if (editingId) {
      const { error } = await supabase
        .from("whatsapp_templates")
        .update({ ...form, sync_status: "LOCAL" })
        .eq("id", editingId);
      if (error) { setBusy(false); toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .insert(form)
        .select("id")
        .single();
      if (error || !data) { setBusy(false); toast.error(error?.message || "Failed"); return; }
      id = data.id;
    }
    setBusy(false);
    setOpen(false);
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
    toast.success("Template saved");

    // Auto-submit to Meta in background
    if (id) {
      submitToMeta(id, true);
    }
  };

  const submitToMeta = async (id: string, silent = false) => {
    if (!silent) setBusy(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-templates-sync", {
      body: { mode: "submit", template_id: id },
    });
    if (!silent) setBusy(false);
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
    if (error || !data?.ok) {
      toast.error(`Meta: ${data?.error || error?.message || "Submission failed"}`);
    } else {
      toast.success("Submitted to Meta — awaiting approval");
    }
  };

  const refreshAll = async () => {
    setRefreshing(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-templates-sync", {
      body: { mode: "refresh" },
    });
    setRefreshing(false);
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
    if (error || !data?.ok) toast.error(data?.error || error?.message || "Refresh failed");
    else toast.success(`Synced ${data.updated}/${data.total} templates`);
  };

  const remove = async (id: string) => {
    const { data, error } = await supabase.functions.invoke("whatsapp-templates-sync", {
      body: { mode: "delete", template_id: id },
    });
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
    if (error || !data?.ok) toast.error(data?.error || error?.message || "Delete failed");
    else toast.success("Deleted");
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from("whatsapp_templates").update({ active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
  };

  const addButton = (type: "QUICK_REPLY" | "URL" | "PHONE_NUMBER") => {
    if ((form.buttons || []).length >= 3) return toast.error("Max 3 buttons");
    const base: any = { type, text: type === "URL" ? "Visit" : type === "PHONE_NUMBER" ? "Call" : "Reply" };
    if (type === "URL") base.url = "https://";
    if (type === "PHONE_NUMBER") base.phone_number = "+92";
    set("buttons", [...(form.buttons || []), base]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Message Templates</h2>
          <p className="text-xs text-muted-foreground">
            All templates are submitted to Meta for approval before they can be sent.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={refreshAll} disabled={refreshing}>
            {refreshing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Refresh from Meta
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-2" /> New template
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{editingId ? "Edit Template" : "Create New Template"}</DialogTitle>
                <p className="text-xs text-muted-foreground">
                  Build your WhatsApp message template with dynamic variables
                </p>
              </DialogHeader>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                {/* LEFT: tabs */}
                <Tabs defaultValue="basic">
                  <TabsList className="grid grid-cols-4 w-full">
                    <TabsTrigger value="basic">Basic Info</TabsTrigger>
                    <TabsTrigger value="content">Content</TabsTrigger>
                    <TabsTrigger value="buttons">Buttons</TabsTrigger>
                    <TabsTrigger value="vars">Variables</TabsTrigger>
                  </TabsList>

                  <TabsContent value="basic" className="space-y-3 pt-3">
                    <div>
                      <Label>Internal Name *</Label>
                      <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Order Confirmation" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Category *</Label>
                        <Select value={form.category} onValueChange={(v) => set("category", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label>Type</Label>
                        <Select value={form.type} onValueChange={(v) => set("type", v)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Language</Label>
                        <Input value={form.language} onChange={(e) => set("language", e.target.value)} placeholder="en, ur, en_US" />
                      </div>
                      <div>
                        <Label>Meta template name</Label>
                        <Input
                          value={form.meta_template_name}
                          onChange={(e) => set("meta_template_name", e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "_"))}
                          placeholder="auto from name"
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="content" className="space-y-3 pt-3">
                    <div>
                      <Label>Header <span className="text-xs text-muted-foreground">Optional</span></Label>
                      <div className="flex gap-2 flex-wrap mt-1">
                        {HEADER_TYPES.map((h) => {
                          const Icon = h.icon;
                          const active = form.header_type === h.value;
                          return (
                            <Button
                              key={h.value}
                              size="sm"
                              type="button"
                              variant={active ? "default" : "outline"}
                              onClick={() => set("header_type", h.value)}
                            >
                              <Icon className="h-3.5 w-3.5 mr-1" /> {h.label}
                            </Button>
                          );
                        })}
                      </div>
                      {form.header_type === "TEXT" && (
                        <Input
                          className="mt-2"
                          value={form.header_text}
                          onChange={(e) => set("header_text", e.target.value)}
                          placeholder="Header text (max 60 chars)"
                          maxLength={60}
                        />
                      )}
                      {["IMAGE", "VIDEO", "DOCUMENT"].includes(form.header_type) && (
                        <Input
                          className="mt-2"
                          value={form.header_media_url}
                          onChange={(e) => set("header_media_url", e.target.value)}
                          placeholder="Sample media URL (publicly accessible)"
                        />
                      )}
                    </div>

                    <div>
                      <div className="flex items-center justify-between">
                        <Label>Message *</Label>
                        <span className="text-[10px] text-muted-foreground">{(form.body || "").length} / 1024</span>
                      </div>
                      <Textarea
                        rows={6}
                        value={form.body}
                        onChange={(e) => set("body", e.target.value)}
                        placeholder="Type your message here. Use {{customer_name}}, {{order_id}}, etc."
                        maxLength={1024}
                      />
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Type <code className="bg-muted px-1 rounded">{`{{variable_name}}`}</code> to add dynamic content
                      </div>
                    </div>

                    <div>
                      <Label>Footer <span className="text-xs text-muted-foreground">Optional</span></Label>
                      <Input
                        value={form.footer}
                        onChange={(e) => set("footer", e.target.value)}
                        placeholder="e.g. Reply STOP to unsubscribe"
                        maxLength={60}
                      />
                    </div>
                  </TabsContent>

                  <TabsContent value="buttons" className="space-y-3 pt-3">
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" onClick={() => addButton("QUICK_REPLY")}>+ Quick reply</Button>
                      <Button size="sm" variant="outline" onClick={() => addButton("URL")}>+ URL</Button>
                      <Button size="sm" variant="outline" onClick={() => addButton("PHONE_NUMBER")}>+ Call</Button>
                    </div>
                    {(form.buttons || []).length === 0 && (
                      <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                        No buttons. Add up to 3 (Quick reply, URL or Call).
                      </div>
                    )}
                    {(form.buttons || []).map((b: any, i: number) => (
                      <div key={i} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <Badge variant="outline" className="text-[10px]">{b.type}</Badge>
                          <Button size="icon" variant="ghost" onClick={() =>
                            set("buttons", form.buttons.filter((_: any, j: number) => j !== i))
                          }>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </div>
                        <Input
                          value={b.text}
                          maxLength={25}
                          onChange={(e) => {
                            const next = [...form.buttons];
                            next[i] = { ...b, text: e.target.value };
                            set("buttons", next);
                          }}
                          placeholder="Button label"
                        />
                        {b.type === "URL" && (
                          <Input
                            value={b.url || ""}
                            onChange={(e) => {
                              const next = [...form.buttons];
                              next[i] = { ...b, url: e.target.value };
                              set("buttons", next);
                            }}
                            placeholder="https://example.com/{{1}}"
                          />
                        )}
                        {b.type === "PHONE_NUMBER" && (
                          <Input
                            value={b.phone_number || ""}
                            onChange={(e) => {
                              const next = [...form.buttons];
                              next[i] = { ...b, phone_number: e.target.value };
                              set("buttons", next);
                            }}
                            placeholder="+92300..."
                          />
                        )}
                      </div>
                    ))}
                  </TabsContent>

                  <TabsContent value="vars" className="space-y-3 pt-3">
                    <p className="text-xs text-muted-foreground">
                      Variables detected from your content. Insert them anywhere using <code className="bg-muted px-1 rounded">{`{{name}}`}</code>.
                    </p>
                    {variables.length === 0 ? (
                      <div className="text-xs text-muted-foreground border border-dashed rounded-lg p-4 text-center">
                        No variables yet.
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {variables.map((v) => (
                          <Badge key={v} variant="secondary" className="text-[11px]">{`{{${v}}}`}</Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      {["customer_name", "order_id", "product_name", "price", "city", "address"].map((v) => (
                        <Badge key={v} variant="outline" className="text-[10px] cursor-pointer"
                          onClick={() => insertVar("body", v)}>
                          + {`{{${v}}}`}
                        </Badge>
                      ))}
                    </div>
                  </TabsContent>
                </Tabs>

                {/* RIGHT: preview */}
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
                    <Smartphone className="h-3.5 w-3.5" /> LIVE PREVIEW
                  </div>
                  <div className="rounded-2xl border bg-muted/30 p-3">
                    <div className="rounded-xl bg-emerald-600 text-white px-3 py-2 text-xs font-medium">
                      Business
                      <div className="text-[10px] opacity-80">Online</div>
                    </div>
                    <div className="mt-3 max-w-[80%] rounded-lg bg-background border p-2 text-xs space-y-1.5 shadow-sm">
                      {form.header_type === "TEXT" && form.header_text && (
                        <div className="font-semibold">{renderPreview(form.header_text)}</div>
                      )}
                      {form.header_type === "IMAGE" && (
                        <div className="bg-muted rounded h-24 flex items-center justify-center text-muted-foreground">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                      {form.header_type === "VIDEO" && (
                        <div className="bg-muted rounded h-24 flex items-center justify-center text-muted-foreground">
                          <VideoIcon className="h-6 w-6" />
                        </div>
                      )}
                      {form.header_type === "DOCUMENT" && (
                        <div className="bg-muted rounded p-2 flex items-center gap-2 text-muted-foreground">
                          <FileText className="h-4 w-4" /> document.pdf
                        </div>
                      )}
                      <div className="whitespace-pre-wrap">{renderPreview(form.body)}</div>
                      {form.footer && (
                        <div className="text-[10px] text-muted-foreground pt-1">{form.footer}</div>
                      )}
                      <div className="text-[9px] text-muted-foreground text-right">12:00</div>
                    </div>
                    {(form.buttons || []).length > 0 && (
                      <div className="mt-1.5 space-y-1">
                        {form.buttons.map((b: any, i: number) => (
                          <div key={i} className="rounded-lg bg-background border text-center text-[11px] py-1.5 text-emerald-600 font-medium">
                            {b.text || "Button"}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t">
                <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
                <Button onClick={save} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
                  {editingId ? "Save & resubmit" : "Create & submit to Meta"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Templates list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">All templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && templates.length === 0 && (
            <div className="text-sm text-muted-foreground py-8 text-center">No templates yet.</div>
          )}
          {templates.map((t: any) => (
            <div key={t.id} className="border rounded-lg p-3 space-y-2 hover:bg-muted/30 transition-colors">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{t.name}</span>
                    <StatusBadge status={t.sync_status} />
                    <Badge variant="outline" className="text-[10px]">{t.category || "UTILITY"}</Badge>
                    <Badge variant="outline" className="text-[10px]">{t.language}</Badge>
                  </div>
                  {t.meta_template_name && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      Meta name: <code>{t.meta_template_name}</code>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Switch checked={t.active} onCheckedChange={(v) => toggleActive(t.id, v)} />
                  {(t.sync_status === "LOCAL" || t.sync_status === "REJECTED") && (
                    <Button size="sm" variant="outline" onClick={() => submitToMeta(t.id)}>
                      <Send className="h-3.5 w-3.5 mr-1" /> Submit
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => openEdit(t)}>Edit</Button>
                  <Button size="icon" variant="ghost" onClick={() => remove(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              {t.rejection_reason && (
                <div className="text-[11px] text-destructive bg-destructive/10 rounded p-2">
                  <strong>Rejected:</strong> {t.rejection_reason}
                </div>
              )}
              <pre className="text-xs whitespace-pre-wrap text-muted-foreground bg-muted/40 p-2 rounded">{t.body}</pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
