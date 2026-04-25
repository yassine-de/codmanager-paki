import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Plus, Search, Send, CheckCircle2, Eye, MessageSquare, Zap, Trash2,
  Loader2, Filter, Users, Clock, XCircle, Calendar as CalendarIcon,
  ChevronRight, ChevronLeft, Pencil, Megaphone, X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-muted text-muted-foreground border-border",
  scheduled: "bg-blue-500/15 text-blue-500 border-blue-500/30",
  sending: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  completed: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  failed: "bg-destructive/15 text-destructive border-destructive/30",
  cancelled: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  scheduled: "Scheduled",
  sending: "Sending",
  completed: "Completed",
  failed: "Failed",
  cancelled: "Cancelled",
};

const CONFIRMATION_STATUSES = [
  "new", "confirmed", "postponed", "no_answer", "cancelled", "shipped",
  "new_wts", "awaiting_reply",
];
const DELIVERY_STATUSES = [
  "pending", "booked", "in_transit", "delivered", "returned", "cancelled",
];

interface Campaign {
  id: string;
  name: string;
  description: string;
  status: string;
  template_id: string | null;
  template_name: string | null;
  filters: any;
  send_mode: string;
  scheduled_at: string | null;
  throttle_per_minute: number;
  total_recipients: number;
  sent_count: number;
  delivered_count: number;
  read_count: number;
  replied_count: number;
  failed_count: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export default function WhatsappCampaigns() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailsCampaign, setDetailsCampaign] = useState<Campaign | null>(null);

  const { data: campaigns = [], isLoading } = useQuery({
    queryKey: ["whatsapp-campaigns"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("whatsapp_campaigns")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as Campaign[];
    },
    refetchInterval: 5000,
  });

  // Realtime updates.
  useEffect(() => {
    const ch = supabase
      .channel("campaigns-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "whatsapp_campaigns" }, () => {
        qc.invalidateQueries({ queryKey: ["whatsapp-campaigns"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  const filtered = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter !== "all" && c.status !== statusFilter) return false;
      if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [campaigns, statusFilter, search]);

  const stats = useMemo(() => {
    return {
      total: campaigns.length,
      drafts: campaigns.filter((c) => c.status === "draft").length,
      sending: campaigns.filter((c) => c.status === "sending" || c.status === "scheduled").length,
      sent: campaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0),
      delivered: campaigns.reduce((sum, c) => sum + (c.delivered_count || 0), 0),
      replied: campaigns.reduce((sum, c) => sum + (c.replied_count || 0), 0),
    };
  }, [campaigns]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this campaign? This cannot be undone.")) return;
    const { error } = await (supabase as any).from("whatsapp_campaigns").delete().eq("id", id);
    if (error) toast.error(error.message);
    else {
      toast.success("Campaign deleted");
      qc.invalidateQueries({ queryKey: ["whatsapp-campaigns"] });
    }
  };

  const handleCancel = async (id: string) => {
    const { error } = await supabase.functions.invoke("campaign-runner", {
      body: { action: "cancel", campaign_id: id },
    });
    if (error) toast.error(error.message);
    else {
      toast.success("Campaign cancelled");
      qc.invalidateQueries({ queryKey: ["whatsapp-campaigns"] });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Megaphone className="h-6 w-6 text-emerald-500" />
            <h2 className="text-2xl font-bold tracking-tight">Campaigns & Broadcasts</h2>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {campaigns.length} campaign{campaigns.length !== 1 ? "s" : ""}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)} className="gap-2 bg-emerald-500 hover:bg-emerald-600 text-white">
          <Plus className="h-4 w-4" /> New Campaign
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Send} label="Total" value={stats.total} color="emerald" />
        <StatCard icon={Pencil} label="Drafts" value={stats.drafts} color="muted" />
        <StatCard icon={CheckCircle2} label="Sent" value={stats.sent} color="emerald" />
        <StatCard icon={CheckCircle2} label="Delivered" value={stats.delivered} color="blue" />
        <StatCard icon={Zap} label="Replied" value={stats.replied} color="amber" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search campaigns..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[160px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="scheduled">Scheduled</SelectItem>
            <SelectItem value="sending">Sending</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <Card className="flex flex-col items-center justify-center py-20 border-dashed">
          <Send className="h-12 w-12 text-muted-foreground/40 mb-3" />
          <p className="text-sm text-muted-foreground">No campaigns found</p>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCreateOpen(true)}
            className="mt-3 text-emerald-500 hover:text-emerald-600"
          >
            Create your first campaign
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {filtered.map((c) => (
            <CampaignRow
              key={c.id}
              campaign={c}
              onOpen={() => setDetailsCampaign(c)}
              onDelete={() => handleDelete(c.id)}
              onCancel={() => handleCancel(c.id)}
            />
          ))}
        </div>
      )}

      <CreateCampaignDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => qc.invalidateQueries({ queryKey: ["whatsapp-campaigns"] })}
      />

      <CampaignDetailsDialog
        campaign={detailsCampaign}
        onClose={() => setDetailsCampaign(null)}
      />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-500 bg-emerald-500/10",
    blue: "text-blue-500 bg-blue-500/10",
    amber: "text-amber-500 bg-amber-500/10",
    muted: "text-muted-foreground bg-muted",
  };
  return (
    <Card className="p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
      <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center", colorMap[color])}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <div className="text-2xl font-semibold leading-tight">{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </div>
    </Card>
  );
}

function CampaignRow({
  campaign, onOpen, onDelete, onCancel,
}: {
  campaign: Campaign;
  onOpen: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const total = campaign.total_recipients || 0;
  const progress = total > 0 ? Math.round((campaign.sent_count / total) * 100) : 0;
  const deliveryRate = campaign.sent_count > 0
    ? Math.round((campaign.delivered_count / campaign.sent_count) * 100) : 0;
  const replyRate = campaign.sent_count > 0
    ? Math.round((campaign.replied_count / campaign.sent_count) * 100) : 0;

  return (
    <Card className="p-5 hover:border-emerald-500/40 transition-colors cursor-pointer group" onClick={onOpen}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-semibold text-base truncate group-hover:text-emerald-500 transition-colors">
              {campaign.name}
            </h3>
            <Badge variant="outline" className={STATUS_STYLES[campaign.status]}>
              {STATUS_LABELS[campaign.status]}
            </Badge>
            {campaign.scheduled_at && campaign.status === "scheduled" && (
              <Badge variant="outline" className="gap-1 text-xs">
                <CalendarIcon className="h-3 w-3" />
                {format(new Date(campaign.scheduled_at), "MMM d, HH:mm")}
              </Badge>
            )}
          </div>
          {campaign.description && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{campaign.description}</p>
          )}
          {campaign.template_name && (
            <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1.5">
              <MessageSquare className="h-3 w-3" />
              {campaign.template_name}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {(campaign.status === "sending" || campaign.status === "scheduled") && (
            <Button variant="ghost" size="sm" onClick={onCancel} className="text-amber-500 hover:text-amber-600">
              Cancel
            </Button>
          )}
          {campaign.status !== "sending" && (
            <Button variant="ghost" size="icon" onClick={onDelete} className="h-8 w-8 text-muted-foreground hover:text-destructive">
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      {total > 0 && (
        <div className="mt-4 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {campaign.sent_count} / {total} sent
            </span>
            <span className="text-muted-foreground">{progress}%</span>
          </div>
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-emerald-500 transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex flex-wrap gap-4 pt-1">
            <Metric label="Recipients" value={total} icon={Users} />
            <Metric label="Sent" value={campaign.sent_count} icon={Send} />
            <Metric label="Delivered" value={campaign.delivered_count} icon={CheckCircle2} suffix={`(${deliveryRate}%)`} />
            <Metric label="Read" value={campaign.read_count} icon={Eye} />
            <Metric label="Replied" value={campaign.replied_count} icon={Zap} suffix={`(${replyRate}%)`} />
            {campaign.failed_count > 0 && (
              <Metric label="Failed" value={campaign.failed_count} icon={XCircle} className="text-destructive" />
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function Metric({
  label, value, icon: Icon, suffix, className,
}: { label: string; value: number; icon: any; suffix?: string; className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 text-xs", className)}>
      <Icon className="h-3 w-3 text-muted-foreground" />
      <span className="text-muted-foreground">{label}:</span>
      <span className="font-medium text-foreground">{value}</span>
      {suffix && <span className="text-muted-foreground">{suffix}</span>}
    </div>
  );
}

/* ============================================================
 *  Create campaign multi-step wizard
 * ============================================================ */

function CreateCampaignDialog({
  open, onOpenChange, onCreated,
}: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: () => void }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [templateId, setTemplateId] = useState<string>("");
  const [filters, setFilters] = useState<any>({
    seller_ids: [],
    confirmation_status: [],
    delivery_status: [],
    product_names: [],
    date_from: null,
    date_to: null,
  });
  const [sendMode, setSendMode] = useState<"immediate" | "scheduled">("immediate");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>(undefined);
  const [scheduledTime, setScheduledTime] = useState("10:00");
  const [throttle, setThrottle] = useState(30);
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Reset on open.
  useEffect(() => {
    if (open) {
      setStep(0);
      setName("");
      setDescription("");
      setTemplateId("");
      setFilters({
        seller_ids: [], confirmation_status: [], delivery_status: [],
        product_names: [], date_from: null, date_to: null,
      });
      setSendMode("immediate");
      setScheduledDate(undefined);
      setScheduledTime("10:00");
      setThrottle(30);
      setPreviewCount(null);
    }
  }, [open]);

  // Templates.
  const { data: templates = [] } = useQuery({
    queryKey: ["wts-templates-active"],
    queryFn: async () => {
      const { data } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .eq("active", true)
        .order("name");
      return data ?? [];
    },
    enabled: open,
  });

  // Sellers.
  const { data: sellers = [] } = useQuery({
    queryKey: ["sellers-for-campaign"],
    queryFn: async () => {
      // Get all seller user_ids from user_roles
      const { data: roles, error: rolesErr } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "seller");
      if (rolesErr) {
        console.error("[campaign] sellers roles error", rolesErr);
        return [];
      }
      const ids = (roles ?? []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];

      // Fetch corresponding profiles (admins can read all profiles via RLS)
      const { data: profs, error: profErr } = await supabase
        .from("profiles")
        .select("user_id, name, email")
        .in("user_id", ids);
      if (profErr) {
        console.error("[campaign] sellers profiles error", profErr);
      }
      const byId = new Map<string, any>();
      for (const p of profs ?? []) byId.set((p as any).user_id, p);

      return ids
        .map((id) => {
          const p = byId.get(id);
          return {
            id,
            name: p?.name || p?.email || id.slice(0, 8),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    },
    enabled: open,
  });



  // Products (distinct names).
  const { data: products = [] } = useQuery({
    queryKey: ["products-for-campaign"],
    queryFn: async () => {
      const { data } = await supabase.from("products").select("id, name").order("name");
      return data ?? [];
    },
    enabled: open,
  });

  const selectedTemplate = useMemo(
    () => templates.find((t: any) => t.id === templateId),
    [templates, templateId],
  );

  const handlePreview = async () => {
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("campaign-runner", {
        body: { action: "preview", campaign: { filters } },
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "Preview failed");
      setPreviewCount(data.count);
    } catch (e: any) {
      toast.error(e.message);
      setPreviewCount(0);
    } finally {
      setPreviewLoading(false);
    }
  };

  // Auto-preview on filter step entry.
  useEffect(() => {
    if (open && step === 1) {
      handlePreview();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, open]);

  const canNext = useMemo(() => {
    if (step === 0) return name.trim().length > 0 && templateId;
    if (step === 1) return previewCount !== null && previewCount > 0;
    if (step === 2) {
      if (sendMode === "scheduled") return !!scheduledDate;
      return true;
    }
    return true;
  }, [step, name, templateId, previewCount, sendMode, scheduledDate]);

  const buildScheduledAt = (): string | null => {
    if (sendMode !== "scheduled" || !scheduledDate) return null;
    const [hh, mm] = scheduledTime.split(":").map(Number);
    const d = new Date(scheduledDate);
    d.setHours(hh || 0, mm || 0, 0, 0);
    return d.toISOString();
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const scheduled_at = buildScheduledAt();
      const status = sendMode === "scheduled" ? "scheduled" : "sending";
      const { data: created, error } = await (supabase as any)
        .from("whatsapp_campaigns")
        .insert({
          name: name.trim(),
          description: description.trim(),
          status: "draft",
          template_id: templateId,
          template_name: selectedTemplate?.name ?? null,
          filters,
          send_mode: sendMode,
          scheduled_at,
          throttle_per_minute: throttle,
        })
        .select()
        .single();
      if (error) throw error;

      if (sendMode === "immediate") {
        const { data: runRes, error: runErr } = await supabase.functions.invoke("campaign-runner", {
          body: { action: "start", campaign_id: (created as any).id },
        });
        if (runErr) throw runErr;
        if (!runRes?.ok) throw new Error(runRes?.error || "Failed to start");
        toast.success(`Campaign started — ${runRes.total} recipients`);
      } else {
        await (supabase as any).from("whatsapp_campaigns").update({ status: "scheduled" }).eq("id", (created as any).id);
        toast.success(`Campaign scheduled for ${format(new Date(scheduled_at!), "PPp")}`);
      }
      onCreated();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const STEPS = ["Basics", "Audience", "Schedule", "Review"];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-emerald-500" />
            Create Campaign
          </DialogTitle>
          <DialogDescription>
            Send WhatsApp templates to a targeted audience of customers.
          </DialogDescription>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center justify-between gap-2 px-1">
          {STEPS.map((label, i) => (
            <div key={label} className="flex items-center flex-1">
              <div className="flex items-center gap-2 flex-1">
                <div className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold transition-colors",
                  i === step ? "bg-emerald-500 text-white" :
                  i < step ? "bg-emerald-500/20 text-emerald-500" :
                  "bg-muted text-muted-foreground",
                )}>
                  {i < step ? <CheckCircle2 className="h-4 w-4" /> : i + 1}
                </div>
                <span className={cn(
                  "text-xs font-medium hidden sm:inline",
                  i === step ? "text-foreground" : "text-muted-foreground",
                )}>
                  {label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("h-px flex-1 mx-2", i < step ? "bg-emerald-500" : "bg-border")} />
              )}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto pr-3 -mr-3 min-h-0">
          {step === 0 && (
            <div className="space-y-4 py-2">
              <div>
                <Label htmlFor="name">Campaign Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. April Promo - Karachi"
                  className="mt-1.5"
                />
              </div>
              <div>
                <Label htmlFor="desc">Description (optional)</Label>
                <Textarea
                  id="desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Internal note about the campaign goal"
                  className="mt-1.5"
                  rows={2}
                />
              </div>
              <TemplatePicker
                templates={templates}
                templateId={templateId}
                onSelect={setTemplateId}
                selectedTemplate={selectedTemplate}
              />
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Filter className="h-4 w-4 text-muted-foreground" />
                <span className="font-medium">Targeting filters</span>
                <span className="text-muted-foreground">— leave empty to include everyone</span>
              </div>

              <FilterMultiSelect
                label="Sellers"
                options={sellers.map((s) => ({ value: s.id, label: s.name }))}
                selected={filters.seller_ids}
                onChange={(v) => setFilters({ ...filters, seller_ids: v })}
              />

              <FilterMultiSelect
                label="Products"
                options={products.map((p: any) => ({ value: p.name, label: p.name }))}
                selected={filters.product_names}
                onChange={(v) => setFilters({ ...filters, product_names: v })}
              />

              <FilterMultiSelect
                label="Confirmation Status"
                options={CONFIRMATION_STATUSES.map((s) => ({ value: s, label: s }))}
                selected={filters.confirmation_status}
                onChange={(v) => setFilters({ ...filters, confirmation_status: v })}
              />

              <FilterMultiSelect
                label="Delivery Status"
                options={DELIVERY_STATUSES.map((s) => ({ value: s, label: s }))}
                selected={filters.delivery_status}
                onChange={(v) => setFilters({ ...filters, delivery_status: v })}
              />

              <div className="grid grid-cols-2 gap-3">
                <DateField
                  label="From date"
                  value={filters.date_from}
                  onChange={(d) => setFilters({ ...filters, date_from: d })}
                />
                <DateField
                  label="To date"
                  value={filters.date_to}
                  onChange={(d) => setFilters({ ...filters, date_to: d })}
                />
              </div>

              {/* Live preview */}
              <Card className={cn(
                "p-4 mt-2 border-2 transition-colors",
                previewCount === 0 ? "border-destructive/40 bg-destructive/5" :
                "border-emerald-500/40 bg-emerald-500/5",
              )}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "h-10 w-10 rounded-full flex items-center justify-center",
                      previewCount === 0 ? "bg-destructive/15 text-destructive" : "bg-emerald-500/15 text-emerald-500",
                    )}>
                      <Users className="h-5 w-5" />
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Estimated recipients</div>
                      <div className="text-2xl font-bold">
                        {previewLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : previewCount ?? "—"}
                      </div>
                    </div>
                  </div>
                  <Button variant="outline" size="sm" onClick={handlePreview} disabled={previewLoading}>
                    {previewLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : "Refresh"}
                  </Button>
                </div>
                {previewCount === 0 && (
                  <p className="text-xs text-destructive mt-2">
                    No recipients match these filters. Adjust the filters above.
                  </p>
                )}
              </Card>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4 py-2">
              <div>
                <Label>Send mode</Label>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <SendModeCard
                    selected={sendMode === "immediate"}
                    onClick={() => setSendMode("immediate")}
                    icon={Send}
                    title="Send now"
                    description="Start sending right away"
                  />
                  <SendModeCard
                    selected={sendMode === "scheduled"}
                    onClick={() => setSendMode("scheduled")}
                    icon={Clock}
                    title="Schedule"
                    description="Pick a date & time"
                  />
                </div>
              </div>

              {sendMode === "scheduled" && (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label>Date *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn("w-full justify-start mt-1.5", !scheduledDate && "text-muted-foreground")}>
                          <CalendarIcon className="h-4 w-4 mr-2" />
                          {scheduledDate ? format(scheduledDate, "PPP") : "Pick a date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={scheduledDate}
                          onSelect={setScheduledDate}
                          disabled={(d) => d < new Date(new Date().setHours(0, 0, 0, 0))}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <Label>Time</Label>
                    <Input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="mt-1.5"
                    />
                  </div>
                </div>
              )}

              <div>
                <Label>Throttle (messages per minute)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Higher = faster, but risks WhatsApp rate limits. Recommended: 30-60.
                </p>
                <Input
                  type="number"
                  min={1}
                  max={120}
                  value={throttle}
                  onChange={(e) => setThrottle(Math.max(1, Math.min(120, Number(e.target.value) || 30)))}
                />
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-3 py-2">
              <Card className="p-4 space-y-3">
                <ReviewItem label="Name" value={name} />
                {description && <ReviewItem label="Description" value={description} />}
                <ReviewItem label="Template" value={selectedTemplate?.name ?? "—"} />
                <ReviewItem label="Recipients" value={`${previewCount ?? 0} customers`} highlight />
                <ReviewItem
                  label="Send"
                  value={sendMode === "immediate" ? "Immediately" : `Scheduled — ${scheduledDate ? format(scheduledDate, "PPP") : ""} at ${scheduledTime}`}
                />
                <ReviewItem label="Throttle" value={`${throttle} msg/min`} />
              </Card>

              <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3 flex gap-2 items-start">
                <Zap className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Once started, the campaign cannot be paused — only cancelled. Make sure your template and audience are correct.
                </p>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-2 sm:justify-between">
          <Button
            variant="ghost"
            onClick={() => step === 0 ? onOpenChange(false) : setStep(step - 1)}
            disabled={submitting}
          >
            {step === 0 ? "Cancel" : <><ChevronLeft className="h-4 w-4 mr-1" /> Back</>}
          </Button>
          {step < STEPS.length - 1 ? (
            <Button
              onClick={() => setStep(step + 1)}
              disabled={!canNext}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              Next <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          ) : (
            <Button
              onClick={handleSubmit}
              disabled={submitting}
              className="bg-emerald-500 hover:bg-emerald-600 text-white"
            >
              {submitting && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              {sendMode === "immediate" ? "Send Campaign" : "Schedule Campaign"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewItem({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn("text-sm text-right", highlight && "font-semibold text-emerald-500")}>{value}</span>
    </div>
  );
}

function SendModeCard({
  selected, onClick, icon: Icon, title, description,
}: { selected: boolean; onClick: () => void; icon: any; title: string; description: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "p-4 rounded-lg border-2 text-left transition-all",
        selected ? "border-emerald-500 bg-emerald-500/5" : "border-border hover:border-emerald-500/40",
      )}
    >
      <Icon className={cn("h-5 w-5 mb-2", selected ? "text-emerald-500" : "text-muted-foreground")} />
      <div className="font-medium text-sm">{title}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
    </button>
  );
}

function DateField({
  label, value, onChange,
}: { label: string; value: string | null; onChange: (v: string | null) => void }) {
  const date = value ? new Date(value) : undefined;
  return (
    <div>
      <Label>{label}</Label>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" className={cn("w-full justify-start mt-1.5", !date && "text-muted-foreground")}>
            <CalendarIcon className="h-4 w-4 mr-2" />
            {date ? format(date, "PP") : "Any"}
            {date && (
              <X
                className="h-3 w-3 ml-auto hover:text-destructive"
                onClick={(e) => { e.stopPropagation(); onChange(null); }}
              />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => onChange(d ? d.toISOString() : null)}
            initialFocus
            className={cn("p-3 pointer-events-auto")}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}

function FilterMultiSelect({
  label, options, selected, onChange,
}: {
  label: string;
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => {
    if (selected.includes(v)) onChange(selected.filter((x) => x !== v));
    else onChange([...selected, v]);
  };
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
        {selected.length > 0 && (
          <button type="button" onClick={() => onChange([])} className="text-xs text-muted-foreground hover:text-foreground">
            Clear ({selected.length})
          </button>
        )}
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-auto min-h-9 py-2">
            <div className="flex flex-wrap gap-1 flex-1 text-left">
              {selected.length === 0 ? (
                <span className="text-muted-foreground text-sm">Any {label.toLowerCase()}</span>
              ) : selected.length <= 3 ? (
                selected.map((v) => {
                  const opt = options.find((o) => o.value === v);
                  return (
                    <Badge key={v} variant="secondary" className="text-xs">
                      {opt?.label ?? v}
                    </Badge>
                  );
                })
              ) : (
                <Badge variant="secondary" className="text-xs">{selected.length} selected</Badge>
              )}
            </div>
            <ChevronRight className={cn("h-4 w-4 transition-transform shrink-0", open && "rotate-90")} />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <ScrollArea className="max-h-[280px]">
            <div className="p-1">
              {options.length === 0 ? (
                <div className="text-xs text-muted-foreground px-3 py-2">No options</div>
              ) : options.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggle(opt.value)}
                  className="w-full flex items-center gap-2 px-2 py-1.5 hover:bg-muted rounded text-sm text-left"
                >
                  <Checkbox checked={selected.includes(opt.value)} className="pointer-events-none" />
                  <span className="truncate">{opt.label}</span>
                </button>
              ))}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/* ============================================================
 *  Campaign details dialog
 * ============================================================ */

function CampaignDetailsDialog({ campaign, onClose }: { campaign: Campaign | null; onClose: () => void }) {
  const open = !!campaign;
  const { data: recipients = [] } = useQuery({
    queryKey: ["campaign-recipients", campaign?.id],
    queryFn: async () => {
      if (!campaign) return [];
      const { data } = await (supabase as any)
        .from("whatsapp_campaign_recipients")
        .select("*")
        .eq("campaign_id", campaign.id)
        .order("created_at", { ascending: false })
        .limit(500);
      return data ?? [];
    },
    enabled: open,
    refetchInterval: open && (campaign?.status === "sending") ? 3000 : false,
  });

  if (!campaign) return null;

  const counters = [
    { label: "Recipients", value: campaign.total_recipients, color: "text-foreground" },
    { label: "Sent", value: campaign.sent_count, color: "text-emerald-500" },
    { label: "Delivered", value: campaign.delivered_count, color: "text-blue-500" },
    { label: "Read", value: campaign.read_count, color: "text-purple-500" },
    { label: "Replied", value: campaign.replied_count, color: "text-amber-500" },
    { label: "Failed", value: campaign.failed_count, color: "text-destructive" },
  ];

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-emerald-500" />
            {campaign.name}
            <Badge variant="outline" className={STATUS_STYLES[campaign.status]}>
              {STATUS_LABELS[campaign.status]}
            </Badge>
          </DialogTitle>
          {campaign.description && (
            <DialogDescription>{campaign.description}</DialogDescription>
          )}
        </DialogHeader>

        <Tabs defaultValue="overview" className="flex-1 flex flex-col overflow-hidden">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="recipients">Recipients ({recipients.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {counters.map((c) => (
                <Card key={c.label} className="p-3">
                  <div className={cn("text-2xl font-bold", c.color)}>{c.value}</div>
                  <div className="text-xs text-muted-foreground">{c.label}</div>
                </Card>
              ))}
            </div>

            <Card className="p-4 space-y-2 text-sm">
              <DetailRow label="Template" value={campaign.template_name ?? "—"} />
              <DetailRow label="Send mode" value={campaign.send_mode} />
              {campaign.scheduled_at && (
                <DetailRow label="Scheduled at" value={format(new Date(campaign.scheduled_at), "PPp")} />
              )}
              {campaign.started_at && (
                <DetailRow label="Started" value={format(new Date(campaign.started_at), "PPp")} />
              )}
              {campaign.completed_at && (
                <DetailRow label="Completed" value={format(new Date(campaign.completed_at), "PPp")} />
              )}
              <DetailRow label="Throttle" value={`${campaign.throttle_per_minute} msg/min`} />
            </Card>
          </TabsContent>

          <TabsContent value="recipients" className="flex-1 overflow-auto mt-4">
            <Card className="overflow-hidden">
              <div className="divide-y">
                {recipients.length === 0 ? (
                  <div className="p-6 text-center text-sm text-muted-foreground">
                    No recipients yet.
                  </div>
                ) : recipients.map((r: any) => (
                  <div key={r.id} className="p-3 flex items-center justify-between gap-3 text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{r.customer_name || "—"}</div>
                      <div className="text-xs text-muted-foreground">{r.customer_phone}</div>
                    </div>
                    {r.order_id && (
                      <Badge variant="outline" className="text-xs">{r.order_id}</Badge>
                    )}
                    <RecipientStatusBadge status={r.status} />
                  </div>
                ))}
              </div>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function RecipientStatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-muted text-muted-foreground",
    sent: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
    delivered: "bg-blue-500/15 text-blue-500 border-blue-500/30",
    read: "bg-purple-500/15 text-purple-500 border-purple-500/30",
    replied: "bg-amber-500/15 text-amber-500 border-amber-500/30",
    failed: "bg-destructive/15 text-destructive border-destructive/30",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] capitalize", map[status])}>
      {status}
    </Badge>
  );
}

/* ============================================================
 *  TemplatePicker — modern template selector for campaign wizard
 * ============================================================ */
function TemplatePicker({
  templates,
  templateId,
  onSelect,
  selectedTemplate,
}: {
  templates: any[];
  templateId: string;
  onSelect: (id: string) => void;
  selectedTemplate: any;
}) {
  const approvedCount = templates.filter((t) => t.sync_status === "APPROVED").length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <Label className="text-sm font-semibold">Choose a template</Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Only approved templates can be broadcasted to customers.
          </p>
        </div>
        <Badge variant="outline" className="text-[10px] gap-1">
          <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          {approvedCount} approved
        </Badge>
      </div>

      {templates.length === 0 ? (
        <Card className="p-6 text-center border-dashed">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm font-medium">No active templates</p>
          <p className="text-xs text-muted-foreground mt-1">
            Create one in the Templates tab first.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* LEFT: Selector + summary */}
          <div className="space-y-3 min-w-0">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Template</Label>
              <Select value={templateId} onValueChange={onSelect}>
                <SelectTrigger className="h-11 bg-card">
                  <SelectValue placeholder="Select approved template" />
                </SelectTrigger>
                <SelectContent className="max-h-[320px]">
                  {templates.map((t: any) => {
                    const approved = t.sync_status === "APPROVED";
                    return (
                      <SelectItem key={t.id} value={t.id} disabled={!approved}>
                        {t.name}
                        {!approved ? ` — ${t.sync_status ?? "pending"}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>

            <Card
              className={cn(
                "p-4 transition-colors",
                selectedTemplate ? "border-primary/30 bg-primary/5" : "border-dashed",
              )}
            >
              {selectedTemplate ? (
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{selectedTemplate.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-4 whitespace-pre-wrap break-words">
                        {selectedTemplate.body}
                      </p>
                    </div>
                    <CheckCircle2 className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge
                      variant="outline"
                      className="text-[10px] border-emerald-500/40 text-emerald-600 bg-emerald-500/10"
                    >
                      ✓ Approved
                    </Badge>
                    {selectedTemplate.category && (
                      <Badge variant="outline" className="text-[10px] capitalize">
                        {selectedTemplate.category.toLowerCase()}
                      </Badge>
                    )}
                    {selectedTemplate.language && (
                      <Badge variant="outline" className="text-[10px] uppercase">
                        {selectedTemplate.language}
                      </Badge>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center text-center py-6">
                  <MessageSquare className="h-8 w-8 text-muted-foreground/40 mb-2" />
                  <p className="text-sm font-medium">No template selected</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Choose one from the dropdown to preview it.
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* RIGHT: WhatsApp live preview */}
          <div className="min-w-0">
            <div className="rounded-lg border bg-[#0b141a] p-4 h-full min-h-[340px] relative overflow-hidden">
              <div
                className="absolute inset-0 opacity-[0.04] pointer-events-none"
                style={{
                  backgroundImage:
                    "radial-gradient(circle at 25% 25%, white 1px, transparent 1px), radial-gradient(circle at 75% 75%, white 1px, transparent 1px)",
                  backgroundSize: "24px 24px",
                }}
              />
              {!selectedTemplate ? (
                <div className="relative h-full flex flex-col items-center justify-center text-center min-h-[300px]">
                  <Eye className="h-10 w-10 text-white/20 mb-3" />
                  <p className="text-sm text-white/60 font-medium">Live preview</p>
                  <p className="text-xs text-white/40 mt-1 max-w-[220px]">
                    Select a template on the left to see how it will look on WhatsApp.
                  </p>
                </div>
              ) : (
                <div className="relative space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-[10px] uppercase tracking-wider text-white/50 font-semibold">
                      Preview
                    </div>
                    <div className="text-[10px] text-white/40">
                      {selectedTemplate.language?.toUpperCase() ?? "EN"}
                    </div>
                  </div>

                  <div className="flex justify-start">
                    <div className="max-w-[92%] rounded-lg rounded-tl-sm bg-[#202c33] text-white shadow-md overflow-hidden">
                      {selectedTemplate.header_type === "TEXT" && selectedTemplate.header_text && (
                        <div className="px-3 pt-2 pb-1">
                          <p className="font-bold text-sm break-words">{selectedTemplate.header_text}</p>
                        </div>
                      )}
                      {selectedTemplate.header_type === "IMAGE" && (
                        <div className="aspect-video bg-[#111b21] flex items-center justify-center">
                          {selectedTemplate.header_media_url ? (
                            <img
                              src={selectedTemplate.header_media_url}
                              alt="header"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span className="text-xs text-white/40">[Image header]</span>
                          )}
                        </div>
                      )}
                      {selectedTemplate.header_type === "VIDEO" && (
                        <div className="aspect-video bg-[#111b21] flex items-center justify-center">
                          <span className="text-xs text-white/40">[Video header]</span>
                        </div>
                      )}

                      <div className="px-3 py-2">
                        <p className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">
                          {selectedTemplate.body}
                        </p>
                      </div>

                      {selectedTemplate.footer && (
                        <div className="px-3 pb-1">
                          <p className="text-[11px] text-white/50 break-words">{selectedTemplate.footer}</p>
                        </div>
                      )}

                      <div className="flex justify-end px-3 pb-1.5">
                        <span className="text-[10px] text-white/40">
                          {format(new Date(), "HH:mm")}
                        </span>
                      </div>

                      {Array.isArray(selectedTemplate.buttons) && selectedTemplate.buttons.length > 0 && (
                        <div className="border-t border-white/10 divide-y divide-white/10">
                          {selectedTemplate.buttons.map((b: any, i: number) => (
                            <div
                              key={i}
                              className="px-3 py-2 text-center text-[13px] font-medium text-[#53bdeb]"
                            >
                              {b.text ?? b.label ?? "Button"}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {Array.isArray(selectedTemplate.variables) && selectedTemplate.variables.length > 0 && (
                    <div className="rounded-md bg-white/5 border border-white/10 p-2.5">
                      <p className="text-[10px] uppercase tracking-wider text-white/50 font-semibold mb-1.5">
                        Variables
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {selectedTemplate.variables.map((v: any, i: number) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="text-[10px] border-white/20 bg-white/5 text-white/80"
                          >
                            {typeof v === "string" ? v : v.name ?? `var_${i + 1}`}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
