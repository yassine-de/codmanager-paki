import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  ChevronLeft, Save, Play, Pause, CheckCircle2, Eye, Pencil, Plus,
  MessageSquare, FileText, Sparkles, GitBranch, Clock, Tag, Trash2,
  Zap, ZoomIn, ZoomOut, Maximize2, Loader2, X, ArrowRight, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { TRIGGERS } from "./WhatsappAutomations";

/* ---------- Step types ---------- */
const STEP_TYPES = [
  { value: "send_message", label: "Send Message", description: "Send text/buttons", icon: MessageSquare },
  { value: "send_template", label: "Send Template", description: "Send WhatsApp template", icon: FileText },
  { value: "ai_step", label: "AI Step", description: "AI handles conversation", icon: Sparkles },
  { value: "condition", label: "Condition", description: "If/else branching", icon: GitBranch },
  { value: "delay", label: "Delay", description: "Wait before next step", icon: Clock },
  { value: "add_tag", label: "Add Tag", description: "Tag the contact", icon: Tag },
  { value: "remove_tag", label: "Remove Tag", description: "Remove a tag", icon: Tag },
] as const;

type StepType = (typeof STEP_TYPES)[number]["value"];

interface FlowNode {
  id: string;
  type: StepType;
  position: { x: number; y: number };
  data: Record<string, any>;
}
interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string; // "true" | "false" for conditions
}

/* ---------- Confirmation/Delivery status options ---------- */
const CONFIRMATION_STATUSES = ["new", "confirmed", "no_answer", "postponed", "cancelled", "new_wts"];
// Real delivery statuses used in the orders.delivery_status column.
const DELIVERY_STATUSES = [
  "pending",
  "booked",
  "shipped",
  "failed_attempt",
  "delivered",
  "ready_for_return",
  "return",
  "cancelled",
];
const FOLLOW_UP_STATUSES = ["pending", "in_progress", "resolved", "escalated"];

export default function WhatsappAutomationBuilder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "runs" ? "runs" : "flow";

  const { data: automation, isLoading } = useQuery({
    queryKey: ["whatsapp-automation", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_automations").select("*").eq("id", id!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!id,
  });

  const [name, setName] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nodes, setNodes] = useState<FlowNode[]>([]);
  const [edges, setEdges] = useState<FlowEdge[]>([]);
  const [triggerConfig, setTriggerConfig] = useState<any>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [addStepFromId, setAddStepFromId] = useState<string | null>(null);
  const [addStepHandle, setAddStepHandle] = useState<string | undefined>(undefined);
  const [addPickerOpen, setAddPickerOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<"flow" | "runs">(initialTab as any);
  const skipDirty = useRef(true);

  useEffect(() => {
    if (!automation) return;
    setName(automation.name);
    setNodes((automation.nodes as any) ?? []);
    setEdges((automation.edges as any) ?? []);
    setTriggerConfig((automation.trigger_config as any) ?? {});
    skipDirty.current = true;
    setDirty(false);
  }, [automation]);

  useEffect(() => {
    if (skipDirty.current) { skipDirty.current = false; return; }
    setDirty(true);
  }, [name, nodes, edges, triggerConfig]);

  const trigger = useMemo(
    () => TRIGGERS.find((t) => t.value === automation?.trigger_type),
    [automation],
  );

  /* ---------- Validation ---------- */
  const validation = useMemo(() => {
    const errors: string[] = [];
    if (!nodes.length) errors.push("Add at least one step");
    nodes.forEach((n) => {
      if (n.type === "send_message" && !n.data.message?.trim()) errors.push(`"Send Message" needs text`);
      if (n.type === "send_template" && !n.data.template_id) errors.push(`"Send Template" needs a template`);
      if (n.type === "delay" && !n.data.minutes) errors.push(`"Delay" needs duration`);
      if (n.type === "condition" && !n.data.field) errors.push(`"Condition" needs a field`);
      if (n.type === "add_tag" && !n.data.tag?.trim()) errors.push(`"Add Tag" needs a tag`);
    });
    // trigger config validation
    if (automation?.trigger_type === "confirmation_status_changed" && !triggerConfig.to)
      errors.push("Confirmation trigger needs target status");
    if (automation?.trigger_type === "delivery_status_changed" && !triggerConfig.to)
      errors.push("Delivery trigger needs target status");
    if (automation?.trigger_type === "follow_up_status_changed" && !triggerConfig.to)
      errors.push("Follow-up trigger needs target status");
    if (automation?.trigger_type === "from_template" && !triggerConfig.template_id)
      errors.push("Pick the template that should trigger this automation");
    return { ok: errors.length === 0, errors };
  }, [nodes, triggerConfig, automation?.trigger_type]);

  /* ---------- Save ---------- */
  async function save(opts?: { setLive?: boolean }) {
    if (!id) return;
    if (opts?.setLive && !validation.ok) {
      toast.error(validation.errors[0]);
      return;
    }
    setSaving(true);
    const payload: any = {
      name,
      nodes: nodes as any,
      edges: edges as any,
      trigger_config: triggerConfig,
    };
    if (opts?.setLive) payload.status = "active";
    const { error } = await supabase.from("whatsapp_automations").update(payload).eq("id", id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(opts?.setLive ? "Automation set live" : "Saved");
    setDirty(false);
    qc.invalidateQueries({ queryKey: ["whatsapp-automation", id] });
    qc.invalidateQueries({ queryKey: ["whatsapp-automations"] });
  }

  async function togglePause() {
    if (!automation) return;
    const next = automation.status === "active" ? "paused" : "active";
    const { error } = await supabase.from("whatsapp_automations").update({ status: next }).eq("id", id!);
    if (error) return toast.error(error.message);
    toast.success(next === "active" ? "Activated" : "Paused");
    qc.invalidateQueries({ queryKey: ["whatsapp-automation", id] });
    qc.invalidateQueries({ queryKey: ["whatsapp-automations"] });
  }

  /* ---------- Add step ---------- */
  function openAddStep(fromId: string | null, handle?: string) {
    setAddStepFromId(fromId);
    setAddStepHandle(handle);
    setAddPickerOpen(true);
  }

  function addStep(type: StepType) {
    const newId = `node_${Date.now()}`;
    // Position below the source node
    const source = addStepFromId ? nodes.find((n) => n.id === addStepFromId) : null;
    const baseY = source ? source.position.y + 180 : 220;
    const baseX = source ? source.position.x : 380;
    const newNode: FlowNode = {
      id: newId,
      type,
      position: { x: baseX, y: baseY },
      data: defaultData(type),
    };
    setNodes((ns) => [...ns, newNode]);
    if (addStepFromId) {
      setEdges((es) => [
        ...es,
        { id: `edge_${Date.now()}`, source: addStepFromId, target: newId, sourceHandle: addStepHandle },
      ]);
    }
    setAddPickerOpen(false);
    setSelectedNodeId(newId);
  }

  function defaultData(type: StepType): Record<string, any> {
    switch (type) {
      case "send_message": return { message: "" };
      case "send_template": return { template_id: "" };
      case "ai_step": return { prompt: "Reply naturally to the customer", max_tokens: 200 };
      case "condition": return { field: "delivery_status", operator: "equals", value: "" };
      case "delay": return { minutes: 60 };
      case "add_tag": return { tag: "" };
      case "remove_tag": return { tag: "" };
      default: return {};
    }
  }

  function deleteNode(nodeId: string) {
    setNodes((ns) => ns.filter((n) => n.id !== nodeId));
    setEdges((es) => es.filter((e) => e.source !== nodeId && e.target !== nodeId));
    if (selectedNodeId === nodeId) setSelectedNodeId(null);
  }

  function updateNodeData(nodeId: string, data: Record<string, any>) {
    setNodes((ns) => ns.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...data } } : n)));
  }

  /* ---------- Build adjacency for rendering ---------- */
  const childrenMap = useMemo(() => {
    const m = new Map<string, { target: string; handle?: string }[]>();
    edges.forEach((e) => {
      if (!m.has(e.source)) m.set(e.source, []);
      m.get(e.source)!.push({ target: e.target, handle: e.sourceHandle });
    });
    return m;
  }, [edges]);

  // Roots = nodes with no incoming edges
  const rootNodeIds = useMemo(() => {
    const targets = new Set(edges.map((e) => e.target));
    return nodes.filter((n) => !targets.has(n.id)).map((n) => n.id);
  }, [nodes, edges]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading automation...
      </div>
    );
  }
  if (!automation) {
    return <div className="p-6">Automation not found.</div>;
  }

  const TriggerIcon = trigger?.icon ?? Zap;

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-3.5rem)]">
      {/* Top bar */}
      <div className="border-b bg-card/60 backdrop-blur px-4 py-2.5 flex items-center gap-3 flex-wrap">
        <Button variant="ghost" size="sm" onClick={() => navigate("/whatsapp/automations")}>
          <ChevronLeft className="h-4 w-4 mr-1" /> Automations
        </Button>
        <div className="text-muted-foreground">›</div>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {editingName ? (
            <Input
              autoFocus value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setEditingName(false)}
              onKeyDown={(e) => { if (e.key === "Enter") setEditingName(false); }}
              className="h-8 max-w-xs"
            />
          ) : (
            <button
              className="font-semibold flex items-center gap-1.5 hover:text-emerald-500 transition-colors"
              onClick={() => setEditingName(true)}
            >
              {name}
              <Pencil className="h-3 w-3 opacity-50" />
            </button>
          )}
          <Badge variant="outline" className={`uppercase text-[10px] tracking-wider font-semibold ml-1 ${
            automation.status === "active" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
              : automation.status === "paused" ? "bg-amber-500/15 text-amber-500 border-amber-500/30"
              : "bg-muted text-muted-foreground"
          }`}>{automation.status}</Badge>
        </div>

        <div className="flex items-center gap-2 ml-auto">
          {dirty && <span className="text-xs text-amber-500">Unsaved</span>}
          {!dirty && (
            <span className="text-xs text-emerald-500 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" /> Saved
            </span>
          )}
          <Button
            variant="outline" size="sm"
            onClick={() => toast(validation.ok ? "Flow looks good ✓" : validation.errors[0], {
              icon: validation.ok ? "✅" : "⚠️",
            })}
          >
            <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" /> Validate
          </Button>
          {automation.status === "active" && (
            <Button variant="outline" size="sm" onClick={togglePause}>
              <Pause className="h-3.5 w-3.5 mr-1.5" /> Pause
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => save()} disabled={saving || !dirty}>
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save Draft
          </Button>
          <Button
            size="sm" className="bg-emerald-500 hover:bg-emerald-600 text-white"
            onClick={() => save({ setLive: true })}
            disabled={saving}
          >
            <Play className="h-3.5 w-3.5 mr-1.5" /> Set Live
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="flex-1 flex flex-col">
        <div className="border-b px-4">
          <TabsList className="bg-transparent h-10 p-0">
            <TabsTrigger value="flow" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 rounded-none h-10">Flow</TabsTrigger>
            <TabsTrigger value="runs" className="data-[state=active]:bg-transparent data-[state=active]:border-b-2 data-[state=active]:border-emerald-500 rounded-none h-10">Run History</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="flow" className="flex-1 m-0 overflow-hidden">
          <div className="flex h-full">
            {/* Left palette */}
            <div className="w-[260px] border-r bg-card/30 p-3 overflow-y-auto">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Add Step</p>
              <div className="space-y-2">
                {STEP_TYPES.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.value}
                      onClick={() => openAddStep(null)}
                      onDoubleClick={() => addStep(s.value)}
                      className="w-full flex items-start gap-2.5 p-2.5 rounded-lg border bg-card hover:border-emerald-500/40 hover:bg-muted/30 text-left transition-all"
                    >
                      <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-semibold text-xs">{s.label}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{s.description}</div>
                      </div>
                    </button>
                  );
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-3 px-1">
                Tip: click "+" under any node to add the next step.
              </p>
            </div>

            {/* Canvas */}
            <div className="flex-1 relative overflow-auto bg-[radial-gradient(circle,hsl(var(--muted-foreground)/0.15)_1px,transparent_1px)] [background-size:20px_20px]">
              <div
                className="relative min-w-[1200px] min-h-[1000px] p-8"
                style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }}
              >
                {/* Trigger node (always at top) */}
                <div className="flex flex-col items-center">
                  <Card className="w-[300px] p-4 border-emerald-500/40 bg-emerald-500/5">
                    <div className="text-xs text-muted-foreground mb-2">When...</div>
                    <div className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-emerald-500/15 text-emerald-500 text-sm font-semibold">
                      <TriggerIcon className="h-3.5 w-3.5" />
                      {trigger?.label}
                    </div>
                    <TriggerConfigInline
                      type={automation.trigger_type}
                      config={triggerConfig}
                      onChange={setTriggerConfig}
                    />
                    <div className="text-xs text-muted-foreground mt-3">Then</div>
                  </Card>

                  {rootNodeIds.length === 0 ? (
                    <div className="mt-6">
                      <ConnectorLine />
                      <Button
                        variant="outline" size="sm"
                        onClick={() => openAddStep(null)}
                        className="mt-2 border-dashed"
                      >
                        <Plus className="h-3.5 w-3.5 mr-1" /> Add first step
                      </Button>
                    </div>
                  ) : (
                    rootNodeIds.map((rid) => (
                      <NodeBranch
                        key={rid}
                        nodeId={rid}
                        nodes={nodes}
                        childrenMap={childrenMap}
                        selectedId={selectedNodeId}
                        onSelect={setSelectedNodeId}
                        onAddBelow={(fromId, handle) => openAddStep(fromId, handle)}
                        onDelete={deleteNode}
                      />
                    ))
                  )}
                </div>
              </div>

              {/* Zoom controls */}
              <div className="absolute right-4 bottom-4 flex flex-col gap-1 bg-card border rounded-lg p-1 shadow-md">
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.min(z + 0.1, 1.5))}>
                  <ZoomIn className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}>
                  <ZoomOut className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom(1)}>
                  <Maximize2 className="h-4 w-4" />
                </Button>
              </div>

              {/* Bottom add-step button */}
              {nodes.length > 0 && (
                <div className="sticky bottom-4 flex justify-center mt-4 pointer-events-none">
                  <Button
                    onClick={() => openAddStep(nodes[nodes.length - 1].id)}
                    className="bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg pointer-events-auto"
                  >
                    <Plus className="h-4 w-4 mr-1.5" /> Add Step
                  </Button>
                </div>
              )}
            </div>

            {/* Right inspector */}
            {selectedNodeId && (
              <NodeInspector
                node={nodes.find((n) => n.id === selectedNodeId)!}
                onChange={(d) => updateNodeData(selectedNodeId, d)}
                onClose={() => setSelectedNodeId(null)}
                onDelete={() => deleteNode(selectedNodeId)}
              />
            )}
          </div>
        </TabsContent>

        <TabsContent value="runs" className="flex-1 m-0 overflow-auto p-6">
          <RunsHistory automationId={id!} />
        </TabsContent>
      </Tabs>

      {/* Add step picker dialog */}
      <Dialog open={addPickerOpen} onOpenChange={setAddPickerOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add a step</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-2 py-2">
            {STEP_TYPES.map((s) => {
              const Icon = s.icon;
              return (
                <button
                  key={s.value}
                  onClick={() => addStep(s.value)}
                  className="flex items-start gap-2.5 p-3 rounded-lg border hover:border-emerald-500/40 hover:bg-muted/30 text-left transition-all"
                >
                  <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{s.label}</div>
                    <div className="text-xs text-muted-foreground">{s.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Trigger inline config (inside trigger node) ---------- */
function TriggerConfigInline({
  type, config, onChange,
}: { type: string; config: any; onChange: (c: any) => void }) {
  if (type === "new_order") {
    const sw = config.switch_to_agent ?? {};
    const enabled = !!sw.enabled;
    return (
      <div className="mt-3 space-y-2 rounded-md border border-dashed border-emerald-500/30 bg-emerald-500/5 p-2.5">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-3.5 w-3.5 accent-emerald-500"
            checked={enabled}
            onChange={(e) =>
              onChange({
                ...config,
                switch_to_agent: {
                  ...sw,
                  enabled: e.target.checked,
                  value: sw.value ?? 30,
                  unit: sw.unit ?? "minutes",
                },
              })
            }
          />
          <span className="text-[11px] font-medium">Switch to agent if no reply</span>
        </label>
        {enabled && (
          <div className="flex items-center gap-2 pl-5">
            <Input
              type="number"
              min={1}
              className="h-7 w-16 text-xs"
              value={sw.value ?? 30}
              onChange={(e) =>
                onChange({
                  ...config,
                  switch_to_agent: { ...sw, enabled: true, value: Math.max(1, Number(e.target.value) || 1), unit: sw.unit ?? "minutes" },
                })
              }
            />
            <Select
              value={sw.unit ?? "minutes"}
              onValueChange={(v) =>
                onChange({
                  ...config,
                  switch_to_agent: { ...sw, enabled: true, value: sw.value ?? 30, unit: v },
                })
              }
            >
              <SelectTrigger className="h-7 w-[100px] text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="minutes">Minutes</SelectItem>
                <SelectItem value="hours">Hours</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-[10px] text-muted-foreground">after template sent</span>
          </div>
        )}
      </div>
    );
  }
  if (type === "confirmation_status_changed") {
    return (
      <div className="mt-3 space-y-3">
        <div className="space-y-1.5">
          <Label className="text-[10px] text-muted-foreground">Becomes</Label>
          <Select
            value={config.to ?? ""}
            onValueChange={(v) =>
              onChange({ ...config, to: v, ...(v === "no_answer" ? {} : { attempt: undefined }) })
            }
          >
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any status" /></SelectTrigger>
            <SelectContent>
              {CONFIRMATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {config.to === "no_answer" && (
          <div className="space-y-1.5">
            <Label className="text-[10px] text-muted-foreground">After attempt</Label>
            <Select
              value={config.attempt != null ? String(config.attempt) : "any"}
              onValueChange={(v) =>
                onChange({ ...config, attempt: v === "any" ? undefined : Number(v) })
              }
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Any attempt" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any attempt</SelectItem>
                {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
                  <SelectItem key={n} value={String(n)}>
                    Attempt #{n}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
    );
  }
  if (type === "delivery_status_changed") {
    return (
      <div className="mt-3 space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">Becomes</Label>
        <Select value={config.to ?? ""} onValueChange={(v) => onChange({ ...config, to: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any status" /></SelectTrigger>
          <SelectContent>
            {DELIVERY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (type === "follow_up_status_changed") {
    return (
      <div className="mt-3 space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">Becomes</Label>
        <Select value={config.to ?? ""} onValueChange={(v) => onChange({ ...config, to: v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Any status" /></SelectTrigger>
          <SelectContent>
            {FOLLOW_UP_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    );
  }
  if (type === "tag_added") {
    return (
      <div className="mt-3 space-y-1.5">
        <Label className="text-[10px] text-muted-foreground">Tag (optional)</Label>
        <Input
          className="h-8 text-xs" placeholder="Any tag"
          value={config.tag ?? ""} onChange={(e) => onChange({ ...config, tag: e.target.value })}
        />
      </div>
    );
  }
  if (type === "from_template") {
    return <FromTemplateConfig config={config} onChange={onChange} />;
  }
  return null;
}

function FromTemplateConfig({
  config, onChange,
}: { config: any; onChange: (c: any) => void }) {
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["wts-active-templates-trigger"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("id, name, language, body, meta_template_name, active")
        .eq("active", true)
        .order("name", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="mt-3 space-y-2">
      <Label className="text-[10px] text-muted-foreground">
        Run when client replies to this template
      </Label>
      <Select
        value={config.template_id ?? ""}
        onValueChange={(v) => onChange({ ...config, template_id: v })}
      >
        <SelectTrigger className="h-8 text-xs">
          <SelectValue placeholder={isLoading ? "Loading…" : "Pick a template"} />
        </SelectTrigger>
        <SelectContent>
          {templates.map((t: any) => (
            <SelectItem key={t.id} value={t.id} className="text-xs">
              {t.name} <span className="text-muted-foreground">({t.language})</span>
            </SelectItem>
          ))}
          {!isLoading && templates.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              No active templates yet
            </div>
          )}
        </SelectContent>
      </Select>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Automation will start when the customer sends any reply to a message that used this template.
      </p>
    </div>
  );
}

/* ---------- Render a node + its children recursively ---------- */
function NodeBranch({
  nodeId, nodes, childrenMap, selectedId, onSelect, onAddBelow, onDelete,
}: {
  nodeId: string;
  nodes: FlowNode[];
  childrenMap: Map<string, { target: string; handle?: string }[]>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAddBelow: (id: string, handle?: string) => void;
  onDelete: (id: string) => void;
}) {
  const node = nodes.find((n) => n.id === nodeId);
  if (!node) return null;

  const children = childrenMap.get(nodeId) ?? [];
  const stepDef = STEP_TYPES.find((s) => s.value === node.type);
  const Icon = stepDef?.icon ?? MessageSquare;
  const selected = selectedId === nodeId;

  const isCondition = node.type === "condition";
  const templateButtons: any[] =
    node.type === "send_template" && Array.isArray(node.data.template_buttons)
      ? node.data.template_buttons
      : [];
  const hasTemplateButtons = templateButtons.length > 0;

  return (
    <div className="flex flex-col items-center">
      <ConnectorLine />
      <Card
        onClick={() => onSelect(nodeId)}
        className={`mt-2 w-[300px] p-3 cursor-pointer transition-all hover:shadow-md ${
          selected ? "border-emerald-500 ring-2 ring-emerald-500/20" : ""
        }`}
      >
        <div className="flex items-start gap-2.5">
          <div className="w-8 h-8 rounded-md bg-emerald-500/15 text-emerald-500 flex items-center justify-center shrink-0">
            <Icon className="h-4 w-4" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{stepDef?.label}</div>
            <div className="text-xs text-muted-foreground truncate">
              {nodeSummary(node)}
            </div>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(nodeId); }}
            className="opacity-0 group-hover:opacity-100 hover:text-destructive p-1"
          >
            <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
          </button>
        </div>
      </Card>

      {isCondition ? (
        <div className="flex gap-12 mt-4">
          {["true", "false"].map((handle) => {
            const child = children.find((c) => c.handle === handle);
            return (
              <div key={handle} className="flex flex-col items-center">
                <Badge
                  variant="outline"
                  className={handle === "true"
                    ? "bg-emerald-500/10 text-emerald-500 border-emerald-500/30"
                    : "bg-destructive/10 text-destructive border-destructive/30"
                  }
                >
                  {handle === "true" ? "If yes" : "If no"}
                </Badge>
                {child ? (
                  <NodeBranch
                    nodeId={child.target}
                    nodes={nodes}
                    childrenMap={childrenMap}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onAddBelow={onAddBelow}
                    onDelete={onDelete}
                  />
                ) : (
                  <>
                    <ConnectorLine />
                    <Button
                      size="sm" variant="outline"
                      className="mt-2 border-dashed h-7"
                      onClick={() => onAddBelow(nodeId, handle)}
                    >
                      <Plus className="h-3 w-3 mr-1" /> Add
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : hasTemplateButtons ? (
        <div className="flex gap-6 mt-4 items-start flex-wrap justify-center">
          {templateButtons.map((b: any, i: number) => {
            const handle = `btn:${i}`;
            const child = children.find((c) => c.handle === handle);
            return (
              <div key={handle} className="flex flex-col items-center min-w-[120px]">
                <Badge
                  variant="outline"
                  className="bg-emerald-500/10 text-emerald-500 border-emerald-500/30 max-w-[140px] truncate"
                  title={b.text || `Button ${i + 1}`}
                >
                  {b.text || `Button ${i + 1}`}
                </Badge>
                {child ? (
                  <NodeBranch
                    nodeId={child.target}
                    nodes={nodes}
                    childrenMap={childrenMap}
                    selectedId={selectedId}
                    onSelect={onSelect}
                    onAddBelow={onAddBelow}
                    onDelete={onDelete}
                  />
                ) : (
                  <>
                    <ConnectorLine />
                    <Button
                      size="icon" variant="outline"
                      className="mt-2 h-7 w-7 rounded-full border-dashed"
                      onClick={() => onAddBelow(nodeId, handle)}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      ) : children.length > 0 ? (
        children.map((c) => (
          <NodeBranch
            key={c.target}
            nodeId={c.target}
            nodes={nodes}
            childrenMap={childrenMap}
            selectedId={selectedId}
            onSelect={onSelect}
            onAddBelow={onAddBelow}
            onDelete={onDelete}
          />
        ))
      ) : (
        <Button
          size="icon" variant="outline"
          className="mt-3 h-7 w-7 rounded-full border-dashed"
          onClick={() => onAddBelow(nodeId)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function ConnectorLine() {
  return <div className="w-px h-6 bg-border" />;
}

function nodeSummary(node: FlowNode): string {
  switch (node.type) {
    case "send_message": return node.data.message ? `"${node.data.message.slice(0, 40)}${node.data.message.length > 40 ? "…" : ""}"` : "(empty message)";
    case "send_template": return node.data.template_name || node.data.template_id || "(no template selected)";
    case "ai_step": return "AI: " + (node.data.prompt?.slice(0, 40) ?? "");
    case "condition": return `If ${node.data.field || "?"} ${node.data.operator || "="} ${node.data.value || "?"}`;
    case "delay": return `Wait ${node.data.minutes ?? 0} min`;
    case "add_tag": return `Tag: ${node.data.tag || "(empty)"}`;
    case "remove_tag": return `Remove tag: ${node.data.tag || "(empty)"}`;
    default: return "";
  }
}

/* ---------- Right-side inspector ---------- */
function NodeInspector({
  node, onChange, onClose, onDelete,
}: { node: FlowNode; onChange: (d: Record<string, any>) => void; onClose: () => void; onDelete: () => void }) {
  const stepDef = STEP_TYPES.find((s) => s.value === node.type);

  // Templates list (for send_template)
  const { data: templates = [] } = useQuery({
    queryKey: ["whatsapp-templates-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_templates")
        .select("id, name, body, language, buttons")
        .eq("active", true);
      return data ?? [];
    },
    enabled: node.type === "send_template",
  });

  return (
    <div className="w-[340px] border-l bg-card/40 overflow-y-auto">
      <div className="flex items-center justify-between p-3 border-b">
        <div>
          <div className="text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">Step</div>
          <div className="font-semibold">{stepDef?.label}</div>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}><X className="h-4 w-4" /></Button>
      </div>

      <div className="p-4 space-y-4">
        {node.type === "send_message" && (
          <div className="space-y-2">
            <Label className="text-xs">Message</Label>
            <Textarea
              rows={6}
              placeholder="Hi {{name}}, your order is confirmed!"
              value={node.data.message ?? ""}
              onChange={(e) => onChange({ message: e.target.value })}
            />
            <p className="text-[10px] text-muted-foreground">
              Variables: {`{{name}}, {{order_id}}, {{product_name}}`}
            </p>
          </div>
        )}

        {node.type === "send_template" && (
          <div className="space-y-2">
            <Label className="text-xs">Template</Label>
            <Select
              value={node.data.template_id ?? ""}
              onValueChange={(v) => {
                const tpl = templates.find((t: any) => t.id === v);
                onChange({
                  template_id: v,
                  template_name: tpl?.name,
                  template_buttons: Array.isArray(tpl?.buttons) ? tpl.buttons : [],
                });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Pick a template" /></SelectTrigger>
              <SelectContent>
                {templates.length === 0 && <div className="text-xs text-muted-foreground p-2">No active templates</div>}
                {templates.map((t: any) => (
                  <SelectItem key={t.id} value={t.id}>{t.name} ({t.language})</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {node.type === "ai_step" && (
          <AiStepInspector node={node} onChange={onChange} />
        )}

        {node.type === "condition" && (
          <>
            <div className="space-y-2">
              <Label className="text-xs">Field</Label>
              <Select value={node.data.field ?? ""} onValueChange={(v) => onChange({ field: v })}>
                <SelectTrigger><SelectValue placeholder="Pick field" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="confirmation_status">Confirmation status</SelectItem>
                  <SelectItem value="delivery_status">Delivery status</SelectItem>
                  <SelectItem value="customer_city">Customer city</SelectItem>
                  <SelectItem value="product_name">Product name</SelectItem>
                  <SelectItem value="quantity">Quantity</SelectItem>
                  <SelectItem value="total_amount">Total amount</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Operator</Label>
              <Select value={node.data.operator ?? "equals"} onValueChange={(v) => onChange({ operator: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="equals">equals</SelectItem>
                  <SelectItem value="not_equals">not equals</SelectItem>
                  <SelectItem value="contains">contains</SelectItem>
                  <SelectItem value="greater_than">greater than</SelectItem>
                  <SelectItem value="less_than">less than</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="text-xs">Value</Label>
              <Input value={node.data.value ?? ""} onChange={(e) => onChange({ value: e.target.value })} />
            </div>
          </>
        )}

        {node.type === "delay" && (
          <div className="space-y-2">
            <Label className="text-xs">Wait (minutes)</Label>
            <Input
              type="number" min={1}
              value={node.data.minutes ?? 60}
              onChange={(e) => onChange({ minutes: Number(e.target.value) })}
            />
          </div>
        )}

        {(node.type === "add_tag" || node.type === "remove_tag") && (
          <div className="space-y-2">
            <Label className="text-xs">Tag name</Label>
            <Input
              value={node.data.tag ?? ""}
              onChange={(e) => onChange({ tag: e.target.value })}
              placeholder="e.g. vip, repeat-customer"
            />
          </div>
        )}

        <Button
          variant="outline" size="sm"
          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 mt-4"
          onClick={onDelete}
        >
          <Trash2 className="h-3.5 w-3.5 mr-1.5" /> Delete step
        </Button>
      </div>
    </div>
  );
}

/* ---------- Run history tab ---------- */
function RunsHistory({ automationId }: { automationId: string }) {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["automation-runs", automationId],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_automation_runs")
        .select("*")
        .eq("automation_id", automationId)
        .order("started_at", { ascending: false })
        .limit(100);
      return data ?? [];
    },
  });

  if (isLoading) return <Loader2 className="h-5 w-5 animate-spin" />;
  if (runs.length === 0) {
    return (
      <Card className="p-12 text-center border-dashed">
        <Clock className="h-8 w-8 mx-auto text-muted-foreground mb-3" />
        <h3 className="font-semibold mb-1">No runs yet</h3>
        <p className="text-sm text-muted-foreground">
          Once this automation is live and the trigger fires, executions will appear here.
        </p>
      </Card>
    );
  }
  return (
    <div className="space-y-2">
      {runs.map((r: any) => (
        <Card key={r.id} className="p-3 flex items-center gap-3 text-sm">
          <Badge
            variant="outline"
            className={
              r.status === "success" ? "bg-emerald-500/15 text-emerald-500 border-emerald-500/30"
                : r.status === "failed" ? "bg-destructive/15 text-destructive border-destructive/30"
                : "bg-muted text-muted-foreground"
            }
          >{r.status}</Badge>
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">
              {r.customer_phone || r.order_id || "—"}
            </div>
            {r.error_message && (
              <div className="text-xs text-destructive truncate">{r.error_message}</div>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {new Date(r.started_at).toLocaleString()}
          </div>
        </Card>
      ))}
    </div>
  );
}

/* ---------- AI Step Inspector ---------- */
function AiStepInspector({
  node,
  onChange,
}: {
  node: FlowNode;
  onChange: (d: Record<string, any>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string>(node.data.prompt ?? "");
  const [draftMode, setDraftMode] = useState<"override" | "append">(
    node.data.prompt_mode === "append" ? "append" : "override"
  );

  // Load global AI system prompt for preview
  const { data: aiSettings } = useQuery({
    queryKey: ["whatsapp-ai-settings-singleton"],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_ai_settings")
        .select("system_prompt, model, max_tokens")
        .eq("singleton", true)
        .maybeSingle();
      return data;
    },
  });

  const mode: "general" | "custom" = node.data.instructions_mode === "custom" ? "custom" : "general";
  const hasCustom = !!(node.data.prompt && node.data.prompt.trim().length > 0);

  const openModal = () => {
    setDraft(node.data.prompt ?? "");
    setDraftMode(node.data.prompt_mode === "append" ? "append" : "override");
    setOpen(true);
  };

  const saveModal = () => {
    onChange({
      prompt: draft,
      prompt_mode: draftMode,
      instructions_mode: draft.trim().length > 0 ? "custom" : "general",
    });
    setOpen(false);
  };

  const clearCustom = () => {
    onChange({ prompt: "", prompt_mode: "override", instructions_mode: "general" });
  };

  return (
    <>
      <div className="space-y-2">
        <Label className="text-xs">AI Mode</Label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onChange({ instructions_mode: "general" })}
            className={`text-left rounded-md border p-2 transition ${
              mode === "general"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="text-xs font-semibold">General Prompt</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Use the global AI Settings prompt
            </div>
          </button>
          <button
            type="button"
            onClick={() => onChange({ instructions_mode: "custom" })}
            className={`text-left rounded-md border p-2 transition ${
              mode === "custom"
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40"
            }`}
          >
            <div className="text-xs font-semibold">Custom Instructions</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Override or extend for this step
            </div>
          </button>
        </div>
      </div>

      {mode === "general" && (
        <div className="rounded-md border bg-muted/30 p-2 space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Active prompt (from AI Settings)
          </div>
          <div className="text-xs whitespace-pre-wrap line-clamp-4 text-muted-foreground">
            {aiSettings?.system_prompt || "—"}
          </div>
        </div>
      )}

      {mode === "custom" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs">Custom Instructions</Label>
            {hasCustom && (
              <Badge variant="outline" className="text-[10px]">
                {node.data.prompt_mode === "append" ? "Append to general" : "Override general"}
              </Badge>
            )}
          </div>
          <div className="rounded-md border p-2 bg-muted/20 min-h-[60px]">
            {hasCustom ? (
              <div className="text-xs whitespace-pre-wrap line-clamp-4">{node.data.prompt}</div>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                No custom instructions yet. Click Edit to add.
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={openModal} className="flex-1">
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              {hasCustom ? "Edit Instructions" : "Add Instructions"}
            </Button>
            {hasCustom && (
              <Button size="sm" variant="ghost" onClick={clearCustom}>
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        <Label className="text-xs">Max tokens</Label>
        <Input
          type="number"
          value={node.data.max_tokens ?? 200}
          onChange={(e) => onChange({ max_tokens: Number(e.target.value) })}
        />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>AI Instructions for this step</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-xs">Mode</Label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setDraftMode("override")}
                  className={`text-left rounded-md border p-3 transition ${
                    draftMode === "override"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-semibold">Override</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Replace the global AI prompt entirely for this step
                  </div>
                </button>
                <button
                  type="button"
                  onClick={() => setDraftMode("append")}
                  className={`text-left rounded-md border p-3 transition ${
                    draftMode === "append"
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <div className="text-sm font-semibold">Append</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Add these instructions on top of the global prompt
                  </div>
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">Instructions</Label>
              <Textarea
                rows={14}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={`Example:\n\nYou must reply only in Urdu.\nIf the customer asks about delivery time, say "2-3 working days".\nNever discount more than 10%.`}
                className="font-mono text-xs"
              />
              <p className="text-[10px] text-muted-foreground">
                Variables: {`{{name}}, {{order_id}}, {{product_name}}, {{customer_city}}`}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={saveModal}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />
              Save Instructions
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
