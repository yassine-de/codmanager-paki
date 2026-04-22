import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus, Search, Play, Pause, History, Copy, Trash2, Pencil, Zap,
  ShoppingBag, CheckCircle2, Truck, Clock, UserPlus, Tag, Send, Loader2,
} from "lucide-react";
import { toast } from "sonner";

/* ---------- Trigger catalog (shared with builder) ---------- */
export const TRIGGERS = [
  {
    value: "new_order",
    label: "New Order (WhatsApp)",
    description:
      "Fires only for new orders whose product has WhatsApp confirmation enabled. Other orders are ignored.",
    icon: ShoppingBag,
    group: "Orders",
  },
  {
    value: "confirmation_status_changed",
    label: "Confirmation Status",
    description: "When confirmation status changes (confirmed, cancelled…)",
    icon: CheckCircle2,
    group: "Orders",
  },
  {
    value: "delivery_status_changed",
    label: "Delivery Status",
    description: "When delivery status changes (shipped, delivered…)",
    icon: Truck,
    group: "Orders",
  },
  {
    value: "follow_up_status_changed",
    label: "Follow-up Status",
    description: "When the follow-up status of a shipped order changes",
    icon: Clock,
    group: "Orders",
  },
  {
    value: "new_contact",
    label: "New Contact",
    description: "When a brand-new WhatsApp customer messages you",
    icon: UserPlus,
    group: "Contacts",
  },
  {
    value: "tag_added",
    label: "Tag Added",
    description: "When a tag is added to a contact",
    icon: Tag,
    group: "Contacts",
  },
] as const;

export type TriggerValue = (typeof TRIGGERS)[number]["value"];

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  paused: "bg-amber-500/15 text-amber-500 border-amber-500/30",
};

export default function WhatsappAutomations() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [triggerFilter, setTriggerFilter] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const { data: automations = [], isLoading } = useQuery({
    queryKey: ["whatsapp-automations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_automations")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const filtered = useMemo(() => {
    return automations.filter((a: any) => {
      if (statusFilter !== "all" && a.status !== statusFilter) return false;
      if (triggerFilter !== "all" && a.trigger_type !== triggerFilter) return false;
      if (search && !(a.name || "").toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [automations, statusFilter, triggerFilter, search]);

  const activeCount = automations.filter((a: any) => a.status === "active").length;

  async function toggleStatus(a: any) {
    const next = a.status === "active" ? "paused" : "active";
    const { error } = await supabase
      .from("whatsapp_automations")
      .update({ status: next })
      .eq("id", a.id);
    if (error) return toast.error(error.message);
    toast.success(next === "active" ? "Automation activated" : "Automation paused");
    qc.invalidateQueries({ queryKey: ["whatsapp-automations"] });
  }

  async function duplicate(a: any) {
    const { data, error } = await supabase
      .from("whatsapp_automations")
      .insert({
        name: `${a.name} (copy)`,
        description: a.description,
        status: "draft",
        trigger_type: a.trigger_type,
        trigger_config: a.trigger_config,
        nodes: a.nodes,
        edges: a.edges,
      })
      .select()
      .single();
    if (error) return toast.error(error.message);
    toast.success("Automation duplicated");
    qc.invalidateQueries({ queryKey: ["whatsapp-automations"] });
    if (data) navigate(`/whatsapp/automations/${data.id}`);
  }

  async function remove(a: any) {
    if (!confirm(`Delete "${a.name}"?`)) return;
    const { error } = await supabase.from("whatsapp_automations").delete().eq("id", a.id);
    if (error) return toast.error(error.message);
    toast.success("Automation deleted");
    qc.invalidateQueries({ queryKey: ["whatsapp-automations"] });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-3xl font-bold tracking-tight">Automations</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {automations.length} automation{automations.length !== 1 && "s"} ·{" "}
            <span className="text-emerald-500">{activeCount} active</span>
          </p>
        </div>
        <Button
          onClick={() => setCreateOpen(true)}
          className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-md"
        >
          <Plus className="h-4 w-4 mr-1.5" /> Create Automation
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search automations..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
          </SelectContent>
        </Select>
        <Select value={triggerFilter} onValueChange={setTriggerFilter}>
          <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Triggers</SelectItem>
            {TRIGGERS.map((t) => (
              <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Cards grid */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      ) : filtered.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-muted flex items-center justify-center mb-4">
            <Zap className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="font-semibold mb-1">No automations yet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Create your first automation to react to orders, statuses or new contacts.
          </p>
          <Button
            onClick={() => setCreateOpen(true)}
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
          >
            <Plus className="h-4 w-4 mr-1.5" /> Create Automation
          </Button>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((a: any) => {
            const trig = TRIGGERS.find((t) => t.value === a.trigger_type);
            const Icon = trig?.icon ?? Zap;
            const nodes = Array.isArray(a.nodes) ? a.nodes : [];
            const successRate = a.runs_count > 0
              ? Math.round((a.success_count / a.runs_count) * 100)
              : 0;
            return (
              <div
                key={a.id}
                className="group relative border rounded-xl bg-card hover:border-primary/40 hover:shadow-elevated transition-all cursor-pointer overflow-hidden flex flex-col"
                onClick={() => navigate(`/whatsapp/automations/${a.id}`)}
              >
                {/* Top accent strip by status */}
                <div className={`h-1 w-full ${
                  a.status === "active" ? "bg-emerald-500" :
                  a.status === "paused" ? "bg-amber-500" :
                  "bg-muted-foreground/30"
                }`} />

                <div className="p-3 space-y-2 flex-1 flex flex-col">
                  {/* Header: name + active toggle */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm truncate" title={a.name}>{a.name}</div>
                      <div className="flex items-center gap-1 mt-0.5">
                        <Badge
                          variant="outline"
                          className={`uppercase text-[9px] px-1.5 py-0 h-4 tracking-wider font-semibold ${STATUS_STYLES[a.status]}`}
                        >
                          {a.status}
                        </Badge>
                      </div>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost" size="icon" className="h-7 w-7"
                        title={a.status === "active" ? "Pause" : "Activate"}
                        onClick={() => toggleStatus(a)}
                      >
                        {a.status === "active"
                          ? <Pause className="h-3.5 w-3.5" />
                          : <Play className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>

                  {/* Meta info chips */}
                  <div className="flex items-center gap-1 flex-wrap">
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal gap-0.5">
                      <Icon className="h-2.5 w-2.5" />
                      {trig?.label ?? a.trigger_type}
                    </Badge>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4 font-normal">
                      {nodes.length} {nodes.length === 1 ? "node" : "nodes"}
                    </Badge>
                  </div>

                  {/* Stats preview */}
                  <div className="text-[11px] text-muted-foreground bg-muted/40 rounded-md p-2 leading-relaxed flex-1 flex items-center justify-between">
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase tracking-wider">Runs</span>
                      <span className="font-semibold text-foreground">{a.runs_count}</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase tracking-wider">Success</span>
                      <span className="font-semibold text-emerald-500">{successRate}%</span>
                    </div>
                    <div className="flex flex-col">
                      <span className="text-[9px] uppercase tracking-wider">OK</span>
                      <span className="font-semibold text-foreground">{a.success_count ?? 0}</span>
                    </div>
                  </div>

                  {/* Actions footer */}
                  <div
                    className="flex items-center justify-between gap-1 pt-1 border-t"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-[9px] text-muted-foreground truncate font-mono">
                      {a.last_run_at ? new Date(a.last_run_at).toLocaleDateString() : "Never run"}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7" title="History"
                        onClick={() => navigate(`/whatsapp/automations/${a.id}?tab=runs`)}
                      >
                        <History className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7" title="Rename"
                        onClick={() => {
                          const newName = prompt("Rename automation:", a.name);
                          if (!newName || newName === a.name) return;
                          supabase.from("whatsapp_automations").update({ name: newName }).eq("id", a.id)
                            .then(({ error }) => {
                              if (error) toast.error(error.message);
                              else qc.invalidateQueries({ queryKey: ["whatsapp-automations"] });
                            });
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7" title="Duplicate"
                        onClick={() => duplicate(a)}
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        size="icon" variant="ghost" className="h-7 w-7" title="Delete"
                        onClick={() => remove(a)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <CreateAutomationDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => navigate(`/whatsapp/automations/${id}`)}
      />
    </div>
  );
}

/* ---------- Create dialog (pick trigger first) ---------- */
function CreateAutomationDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const [step, setStep] = useState<"name" | "trigger">("name");
  const [name, setName] = useState("");
  const [trigger, setTrigger] = useState<TriggerValue | "">("");
  const [creating, setCreating] = useState(false);

  function reset() {
    setStep("name"); setName(""); setTrigger("");
  }

  async function create() {
    if (!name.trim() || !trigger) return;
    setCreating(true);
    const { data, error } = await supabase.from("whatsapp_automations").insert({
      name: name.trim(), trigger_type: trigger, status: "draft", nodes: [], edges: [],
    }).select().single();
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("Automation created");
    onOpenChange(false);
    reset();
    if (data) onCreated(data.id);
  }

  const grouped = useMemo(() => {
    const m = new Map<string, typeof TRIGGERS[number][]>();
    TRIGGERS.forEach((t) => {
      if (!m.has(t.group)) m.set(t.group, []);
      m.get(t.group)!.push(t);
    });
    return Array.from(m.entries());
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {step === "name" ? "Name your automation" : "Start automation when..."}
          </DialogTitle>
        </DialogHeader>

        {step === "name" ? (
          <div className="space-y-3 py-2">
            <Input
              placeholder="e.g. Send welcome on new order"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              onKeyDown={(e) => { if (e.key === "Enter" && name.trim()) setStep("trigger"); }}
            />
            <p className="text-xs text-muted-foreground">
              Pick a clear name — you'll see it in the list and run logs.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-2 max-h-[60vh] overflow-auto">
            {grouped.map(([group, items]) => (
              <div key={group}>
                <p className="text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wider">
                  {group}
                </p>
                <div className="space-y-2">
                  {items.map((t) => {
                    const Icon = t.icon;
                    const active = trigger === t.value;
                    return (
                      <button
                        key={t.value}
                        type="button"
                        onClick={() => setTrigger(t.value)}
                        className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-all ${
                          active
                            ? "border-emerald-500 bg-emerald-500/5"
                            : "border-border hover:border-emerald-500/40 hover:bg-muted/30"
                        }`}
                      >
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                          active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
                        }`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-sm">{t.label}</div>
                          <div className="text-xs text-muted-foreground">{t.description}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          {step === "trigger" && (
            <Button variant="ghost" onClick={() => setStep("name")}>Back</Button>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {step === "name" ? (
            <Button
              disabled={!name.trim()}
              onClick={() => setStep("trigger")}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >Continue</Button>
          ) : (
            <Button
              disabled={!trigger || creating}
              onClick={create}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {creating && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Create
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
