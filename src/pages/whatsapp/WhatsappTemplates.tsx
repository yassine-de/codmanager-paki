import { useMemo, useRef, useState, useEffect } from "react";
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

const VAR_SUGGESTIONS = [
  { name: "customer_name", label: "Customer name" },
  { name: "order_id", label: "Order ID" },
  { name: "product_name", label: "Product name" },
  { name: "price", label: "Price" },
  { name: "quantity", label: "Quantity" },
  { name: "city", label: "City" },
  { name: "address", label: "Address" },
  { name: "phone", label: "Phone" },
  { name: "tracking_number", label: "Tracking number" },
  { name: "store_name", label: "Store name" },
];

export default function WhatsappTemplates() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [previewTpl, setPreviewTpl] = useState<any | null>(null);

  // @ mention autocomplete state for body textarea
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);
  const [mention, setMention] = useState<{
    open: boolean;
    query: string;
    start: number;
    activeIdx: number;
  }>({ open: false, query: "", start: -1, activeIdx: 0 });

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
                      <div className="relative">
                        <Textarea
                          ref={bodyRef}
                          rows={6}
                          value={form.body}
                          onChange={(e) => {
                            const val = e.target.value;
                            const caret = e.target.selectionStart ?? val.length;
                            set("body", val);
                            // Detect "@word" being typed before caret
                            const before = val.slice(0, caret);
                            const m = before.match(/(?:^|[\s\n.,;:!?(])@([a-zA-Z0-9_]*)$/);
                            if (m) {
                              setMention({
                                open: true,
                                query: m[1].toLowerCase(),
                                start: caret - m[1].length - 1, // position of '@'
                                activeIdx: 0,
                              });
                            } else {
                              setMention((p) => ({ ...p, open: false }));
                            }
                          }}
                          onKeyDown={(e) => {
                            if (!mention.open) return;
                            const filtered = VAR_SUGGESTIONS.filter((v) =>
                              v.name.toLowerCase().includes(mention.query)
                            );
                            if (e.key === "ArrowDown") {
                              e.preventDefault();
                              setMention((p) => ({
                                ...p,
                                activeIdx: Math.min(p.activeIdx + 1, filtered.length - 1),
                              }));
                            } else if (e.key === "ArrowUp") {
                              e.preventDefault();
                              setMention((p) => ({ ...p, activeIdx: Math.max(p.activeIdx - 1, 0) }));
                            } else if (e.key === "Enter" || e.key === "Tab") {
                              if (filtered.length) {
                                e.preventDefault();
                                const v = filtered[mention.activeIdx] ?? filtered[0];
                                const before = form.body.slice(0, mention.start);
                                const after = form.body.slice(
                                  (bodyRef.current?.selectionStart ?? mention.start) || mention.start
                                );
                                const inserted = `{{${v.name}}}`;
                                const next = before + inserted + after;
                                set("body", next);
                                setMention({ open: false, query: "", start: -1, activeIdx: 0 });
                                requestAnimationFrame(() => {
                                  const pos = before.length + inserted.length;
                                  bodyRef.current?.focus();
                                  bodyRef.current?.setSelectionRange(pos, pos);
                                });
                              }
                            } else if (e.key === "Escape") {
                              setMention((p) => ({ ...p, open: false }));
                            }
                          }}
                          onBlur={() => setTimeout(() => setMention((p) => ({ ...p, open: false })), 150)}
                          placeholder="Type your message here. Type @ to insert variables (customer_name, order_id…)"
                          maxLength={1024}
                        />
                        {mention.open && (() => {
                          const filtered = VAR_SUGGESTIONS.filter((v) =>
                            v.name.toLowerCase().includes(mention.query)
                          );
                          if (!filtered.length) return null;
                          return (
                            <div className="absolute z-50 mt-1 w-64 rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden">
                              <div className="px-2 py-1.5 text-[10px] uppercase tracking-wide text-muted-foreground border-b bg-muted/40">
                                Insert variable
                              </div>
                              <div className="max-h-56 overflow-y-auto">
                                {filtered.map((v, i) => (
                                  <button
                                    key={v.name}
                                    type="button"
                                    onMouseDown={(e) => {
                                      e.preventDefault();
                                      const before = form.body.slice(0, mention.start);
                                      const after = form.body.slice(
                                        (bodyRef.current?.selectionStart ?? mention.start) || mention.start
                                      );
                                      const inserted = `{{${v.name}}}`;
                                      const next = before + inserted + after;
                                      set("body", next);
                                      setMention({ open: false, query: "", start: -1, activeIdx: 0 });
                                      requestAnimationFrame(() => {
                                        const pos = before.length + inserted.length;
                                        bodyRef.current?.focus();
                                        bodyRef.current?.setSelectionRange(pos, pos);
                                      });
                                    }}
                                    onMouseEnter={() =>
                                      setMention((p) => ({ ...p, activeIdx: i }))
                                    }
                                    className={`w-full text-left px-2.5 py-1.5 text-xs flex items-center justify-between gap-2 ${
                                      i === mention.activeIdx ? "bg-accent text-accent-foreground" : ""
                                    }`}
                                  >
                                    <span className="font-medium">{v.label}</span>
                                    <code className="text-[10px] text-muted-foreground">
                                      {`{{${v.name}}}`}
                                    </code>
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-1">
                        Type <code className="bg-muted px-1 rounded">@</code> to pick a variable, or write{" "}
                        <code className="bg-muted px-1 rounded">{`{{variable_name}}`}</code> manually.
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
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">All templates</CardTitle>
            {!isLoading && templates.length > 0 && (
              <span className="text-[11px] text-muted-foreground">{templates.length} total</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && templates.length === 0 && (
            <div className="text-sm text-muted-foreground py-12 text-center border border-dashed rounded-lg">
              No templates yet.
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {templates.map((t: any) => {
              const headerIcon = t.header_type === "IMAGE" ? ImageIcon
                : t.header_type === "VIDEO" ? VideoIcon
                : t.header_type === "DOCUMENT" ? FileText
                : null;
              const HIcon = headerIcon;
              const buttonsCount = Array.isArray(t.buttons) ? t.buttons.length : 0;
              return (
                <div
                  key={t.id}
                  className="group relative border rounded-xl bg-card hover:border-primary/40 hover:shadow-elevated transition-all cursor-pointer overflow-hidden flex flex-col"
                  onClick={() => setPreviewTpl(t)}
                >
                  {/* Top accent strip by status */}
                  <div className={`h-1 w-full ${
                    t.sync_status === "APPROVED" ? "bg-emerald-500" :
                    t.sync_status === "PENDING" ? "bg-amber-500" :
                    t.sync_status === "REJECTED" ? "bg-destructive" :
                    "bg-muted-foreground/30"
                  }`} />

                  <div className="p-3 space-y-2 flex-1 flex flex-col">
                    {/* Header: name + active toggle */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-sm truncate" title={t.name}>{t.name}</div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <StatusBadge status={t.sync_status} />
                        </div>
                      </div>
                      <div onClick={(e) => e.stopPropagation()}>
                        <Switch checked={t.active} onCheckedChange={(v) => toggleActive(t.id, v)} />
                      </div>
                    </div>

                    {/* Meta info chips */}
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
                        {t.category || "UTILITY"}
                      </Badge>
                      <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal uppercase">
                        {t.language}
                      </Badge>
                      {HIcon && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal gap-0.5">
                          <HIcon className="h-2.5 w-2.5" />
                        </Badge>
                      )}
                      {buttonsCount > 0 && (
                        <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
                          {buttonsCount} btn
                        </Badge>
                      )}
                    </div>

                    {/* Body preview - 2 lines clamped */}
                    <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2 leading-relaxed line-clamp-2 flex-1">
                      {t.body || <span className="italic">No content</span>}
                    </div>

                    {/* Rejection reason */}
                    {t.rejection_reason && (
                      <div className="text-[10px] text-destructive bg-destructive/10 rounded px-2 py-1 line-clamp-1">
                        {t.rejection_reason}
                      </div>
                    )}

                    {/* Actions footer */}
                    <div
                      className="flex items-center justify-between gap-1 pt-1 border-t"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="text-[9px] text-muted-foreground truncate font-mono">
                        {t.meta_template_name || "—"}
                      </span>
                      <div className="flex items-center gap-0.5">
                        {(t.sync_status === "LOCAL" || t.sync_status === "REJECTED") && (
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Submit to Meta" onClick={() => submitToMeta(t.id)}>
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Edit" onClick={() => openEdit(t)}>
                          <Type className="h-3.5 w-3.5" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" title="Delete" onClick={() => remove(t.id)}>
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Preview Modal */}
      <Dialog open={!!previewTpl} onOpenChange={(o) => !o && setPreviewTpl(null)}>
        <DialogContent className="max-w-md p-0 overflow-hidden bg-transparent border-0 shadow-2xl">
          {previewTpl && (
            <div className="bg-[#0b141a] rounded-2xl overflow-hidden">
              {/* WhatsApp Header */}
              <div className="bg-[#1f2c33] px-4 py-3 flex items-center gap-3">
                <div className="h-9 w-9 rounded-full bg-emerald-600 flex items-center justify-center text-white font-semibold text-sm">
                  {(previewTpl.name || "B").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white font-medium text-sm truncate">{previewTpl.name}</div>
                  <div className="text-[10px] text-white/60">online</div>
                </div>
                <Badge variant="outline" className="text-[10px] border-white/20 text-white/80">
                  {previewTpl.language}
                </Badge>
              </div>

              {/* Chat background */}
              <div
                className="px-4 py-6 min-h-[320px] space-y-2"
                style={{
                  backgroundImage:
                    "radial-gradient(rgba(255,255,255,0.04) 1px, transparent 1px)",
                  backgroundSize: "20px 20px",
                  backgroundColor: "#0b141a",
                }}
              >
                <div className="max-w-[85%] rounded-lg bg-[#202c33] text-white p-2 shadow-md text-xs space-y-2">
                  {previewTpl.header_type === "TEXT" && previewTpl.header_text && (
                    <div className="font-semibold text-sm">{renderPreview(previewTpl.header_text)}</div>
                  )}
                  {previewTpl.header_type === "IMAGE" && (
                    <div className="bg-black/40 rounded h-32 flex items-center justify-center text-white/40">
                      {previewTpl.header_media_url ? (
                        <img src={previewTpl.header_media_url} alt="" className="h-full w-full object-cover rounded" />
                      ) : (
                        <ImageIcon className="h-8 w-8" />
                      )}
                    </div>
                  )}
                  {previewTpl.header_type === "VIDEO" && (
                    <div className="bg-black/40 rounded h-32 flex items-center justify-center text-white/40">
                      <VideoIcon className="h-8 w-8" />
                    </div>
                  )}
                  {previewTpl.header_type === "DOCUMENT" && (
                    <div className="bg-black/40 rounded p-2 flex items-center gap-2 text-white/70">
                      <FileText className="h-4 w-4" /> document.pdf
                    </div>
                  )}
                  <div className="whitespace-pre-wrap leading-relaxed">{renderPreview(previewTpl.body)}</div>
                  {previewTpl.footer && (
                    <div className="text-[10px] text-white/50 pt-1">{previewTpl.footer}</div>
                  )}
                  <div className="text-[9px] text-white/40 text-right">12:00</div>
                </div>

                {Array.isArray(previewTpl.buttons) && previewTpl.buttons.length > 0 && (
                  <div className="max-w-[85%] space-y-0.5">
                    {previewTpl.buttons.map((b: any, i: number) => (
                      <div
                        key={i}
                        className="rounded-lg bg-[#202c33] text-center text-[12px] py-2 text-[#53bdeb] font-medium border-t border-white/5 first:border-t-0"
                      >
                        {b.text || "Button"}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Footer info */}
              <div className="bg-[#1f2c33] px-4 py-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 text-[10px] text-white/60">
                  <StatusBadge status={previewTpl.sync_status} />
                  <span>{previewTpl.category}</span>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => { openEdit(previewTpl); setPreviewTpl(null); }}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreviewTpl(null)}>
                    Close
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
