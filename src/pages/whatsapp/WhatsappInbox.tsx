import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  CheckCircle2,
  UserPlus,
  XCircle,
  RotateCcw,
  Search,
  Filter as FilterIcon,
  Lock,
  Send,
  StickyNote,
  ArrowDownUp,
  FileText,
  Loader2,
  Smile,
  Camera,
  Paperclip,
  Mic,
  Sparkles,
  MessageSquare,
  Square,
  Download,
  X,
  Reply,
  ExternalLink,
  Phone,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { toast } from "sonner";
import {
  format,
  formatDistanceToNowStrict,
  differenceInHours,
  isToday,
  isYesterday,
} from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { SendTemplateModal } from "@/components/whatsapp/SendTemplateModal";

type Conv = {
  id: string;
  order_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  status: string;
  last_message_at: string | null;
  last_reply_at: string | null;
  updated_at: string;
};

type Msg = {
  id: string;
  conversation_id: string;
  body: string | null;
  direction: string;
  message_type: string;
  status: string | null;
  created_at: string;
  payload?: any;
};

const statusBadge = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "open", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25" },
    awaiting_reply: { label: "awaiting reply", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25" },
    sent: { label: "awaiting reply", cls: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25" },
    awaiting_processing: { label: "open", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25" },
    confirmed: { label: "confirmed", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25" },
    canceled: { label: "canceled", cls: "bg-rose-500/15 text-rose-500 border-rose-500/25" },
    more_info: { label: "sent to agent", cls: "bg-violet-500/15 text-violet-500 border-violet-500/25" },
    manual_review_needed: { label: "needs review", cls: "bg-sky-500/15 text-sky-500 border-sky-500/25" },
  };
  return map[s] ?? { label: s || "—", cls: "bg-muted text-muted-foreground border-border" };
};

const confirmationStatusCls = (s: string) => {
  const map: Record<string, string> = {
    new: "bg-sky-500/15 text-sky-500 border-sky-500/25",
    confirmed: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    no_answer: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    postponed: "bg-violet-500/15 text-violet-500 border-violet-500/25",
    cancelled: "bg-rose-500/15 text-rose-500 border-rose-500/25",
    new_wts: "bg-cyan-500/15 text-cyan-500 border-cyan-500/25",
  };
  return map[s] ?? "bg-muted text-muted-foreground border-border";
};

const deliveryStatusCls = (s: string) => {
  const map: Record<string, string> = {
    pending: "bg-muted text-muted-foreground border-border",
    booked: "bg-sky-500/15 text-sky-500 border-sky-500/25",
    shipped: "bg-blue-500/15 text-blue-500 border-blue-500/25",
    failed_attempt: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    ready_for_return: "bg-orange-500/15 text-orange-500 border-orange-500/25",
    return: "bg-rose-500/15 text-rose-500 border-rose-500/25",
    cancelled: "bg-rose-500/15 text-rose-500 border-rose-500/25",
  };
  return map[s] ?? "bg-muted text-muted-foreground border-border";
};

function initials(name?: string | null, phone?: string) {
  const src = (name || phone || "?").trim();
  const parts = src.split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

const avatarColors = [
  "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400",
  "bg-violet-500/20 text-violet-500",
  "bg-rose-500/20 text-rose-500",
  "bg-amber-500/20 text-amber-600 dark:text-amber-400",
  "bg-sky-500/20 text-sky-500",
  "bg-pink-500/20 text-pink-500",
];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarColors[h % avatarColors.length];
}

function dayLabel(d: Date) {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd/MM/yyyy");
}

export default function WhatsappInbox() {
  const { authUser } = useAuth();
  const isAdmin = authUser?.role === "admin";

  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [sending, setSending] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [recording, setRecording] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { data: convos = [], isLoading } = useQuery<Conv[]>({
    queryKey: ["wts-convos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(300);
      if (error) throw error;
      return (data ?? []) as Conv[];
    },
  });

  const { data: messages = [] } = useQuery<Msg[]>({
    queryKey: ["wts-messages", selected],
    queryFn: async () => {
      if (!selected) return [];
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("conversation_id", selected)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Msg[];
    },
    enabled: !!selected,
  });

  // Load templates so we can render the buttons (quick replies / URL / phone) below template messages
  const { data: templates = [] } = useQuery<any[]>({
    queryKey: ["wts-templates-buttons"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("id, name, meta_template_name, buttons");
      if (error) throw error;
      return data ?? [];
    },
    staleTime: 5 * 60_000,
  });
  const templateButtonsById = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const t of templates) {
      if (Array.isArray(t.buttons)) m.set(t.id, t.buttons);
    }
    return m;
  }, [templates]);

  const conv = useMemo(() => convos.find((c) => c.id === selected) || null, [convos, selected]);

  const { data: order } = useQuery({
    queryKey: ["wts-order", conv?.order_id],
    queryFn: async () => {
      if (!conv?.order_id) return null;
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("order_id", conv.order_id)
        .maybeSingle();
      return data;
    },
    enabled: !!conv?.order_id,
  });

  // Realtime subscriptions
  useEffect(() => {
    const channel = supabase
      .channel("wts-inbox-rt")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_conversations" },
        () => {
          qc.invalidateQueries({ queryKey: ["wts-convos"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const row: any = payload.new ?? payload.old;
          qc.invalidateQueries({ queryKey: ["wts-convos"] });
          if (row?.conversation_id) {
            qc.invalidateQueries({ queryKey: ["wts-messages", row.conversation_id] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length, selected]);

  // Mark conversation read on open (clears the unread dot by setting last_message_at)
  useEffect(() => {
    if (!selected) return;
    void supabase
      .from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", selected);
  }, [selected]);

  const filteredConvos = useMemo(() => {
    let list = convos.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          (c.customer_name || "").toLowerCase().includes(q) ||
          c.customer_phone.toLowerCase().includes(q) ||
          (c.order_id || "").toLowerCase().includes(q),
      );
    }
    if (filter === "unread") {
      list = list.filter(
        (c) =>
          c.last_reply_at &&
          (!c.last_message_at || new Date(c.last_reply_at) > new Date(c.last_message_at)),
      );
    }
    list.sort((a, b) => {
      const ta = new Date(a.updated_at).getTime();
      const tb = new Date(b.updated_at).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
    return list;
  }, [convos, search, filter, sortDesc]);

  const lastInboundAt = useMemo(() => {
    if (!conv?.last_reply_at) return null;
    return new Date(conv.last_reply_at);
  }, [conv]);

  const windowExpired = useMemo(() => {
    if (!lastInboundAt) return true;
    return differenceInHours(new Date(), lastInboundAt) >= 24;
  }, [lastInboundAt]);

  const action = async (mode: "confirm" | "to_agent" | "cancel" | "resend") => {
    if (!selected || !conv?.order_id) {
      toast.error("Conversation has no linked order");
      return;
    }
    const { data, error } = await supabase.functions.invoke("whatsapp-action", {
      body: { conversation_id: selected, order_id: conv.order_id, action: mode },
    });
    if (error || !data?.ok) {
      toast.error(error?.message || data?.error || "Action failed");
      return;
    }
    toast.success(
      mode === "confirm"
        ? "Order confirmed"
        : mode === "to_agent"
        ? "Sent to agent queue"
        : mode === "cancel"
        ? "Order canceled"
        : "Template resent",
    );
  };

  const sendReply = async () => {
    if (!selected || !conv || !draft.trim()) return;
    if (windowExpired) {
      toast.error("24h window expired — use a template");
      return;
    }
    setSending(true);
    const text = draft.trim();
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: {
        mode: "text",
        conversation_id: selected,
        order_id: conv.order_id ?? undefined,
        body: text,
      },
    });
    setSending(false);
    if (error || !data?.ok) {
      toast.error(error?.message || data?.error || "Send failed");
      return;
    }
    setDraft("");
    toast.success("Reply sent");
  };

  const sendNote = async () => {
    if (!selected || !conv || !noteDraft.trim()) return;
    const text = noteDraft.trim();
    const { error } = await supabase.from("whatsapp_messages").insert({
      conversation_id: selected,
      order_id: conv.order_id ?? null,
      direction: "in",
      message_type: "note",
      body: text,
      status: "internal",
      payload: { internal_note: true },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNoteDraft("");
    toast.success("Note saved");
  };

  // Quick reply snippets
  const quickReplies = [
    "Salam, comment puis-je vous aider ?",
    "Merci pour votre commande ! 🙏",
    "Pouvez-vous confirmer votre adresse ?",
    "Votre commande sera livrée bientôt.",
    "Je vous remercie pour votre patience.",
  ];

  const insertAtCursor = (text: string) => {
    setDraft((d) => (d ? d + text : text));
  };

  const uploadAndSend = async (file: File, mode: "image" | "document" | "audio") => {
    if (!selected || !conv) return;
    if (windowExpired) {
      toast.error("24h window expired — use a template");
      return;
    }
    setUploadingMedia(true);
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `${conv.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("whatsapp-media")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("whatsapp-media").getPublicUrl(path);
      const mediaUrl = pub.publicUrl;
      const { data, error } = await supabase.functions.invoke("whatsapp-send", {
        body: {
          mode,
          conversation_id: selected,
          order_id: conv.order_id ?? undefined,
          media_url: mediaUrl,
          media_filename: file.name,
          body: draft.trim() || undefined,
        },
      });
      if (error || !data?.ok) throw new Error(error?.message || data?.error || "Send failed");
      setDraft("");
      toast.success(`${mode} sent`);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally {
      setUploadingMedia(false);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      recordedChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(recordedChunksRef.current, { type: "audio/ogg" });
        const file = new File([blob], `voice-${Date.now()}.ogg`, { type: "audio/ogg" });
        await uploadAndSend(file, "audio");
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setRecording(true);
    } catch (e: any) {
      toast.error("Microphone access denied");
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    setRecording(false);
  };

  const fetchAiSuggestions = async () => {
    if (!selected) return;
    setAiLoading(true);
    setAiSuggestions([]);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-ai", {
        body: { mode: "suggest", conversation_id: selected },
      });
      if (error) throw error;
      const sugg = (data?.suggestions as string[]) || [];
      if (sugg.length === 0) {
        toast.error("No AI suggestions available");
        return;
      }
      setAiSuggestions(sugg);
    } catch (e: any) {
      toast.error(e?.message || "AI suggestion failed");
    } finally {
      setAiLoading(false);
    }
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  // Group messages by day
  const grouped: Array<{ key: string; label: string; items: Msg[] }> = [];
  for (const m of messages) {
    const d = new Date(m.created_at);
    const k = format(d, "yyyy-MM-dd");
    let g = grouped[grouped.length - 1];
    if (!g || g.key !== k) {
      g = { key: k, label: dayLabel(d), items: [] };
      grouped.push(g);
    }
    g.items.push(m);
  }

  return (
    <>
      <div className="grid grid-cols-12 gap-0 h-[calc(100dvh-160px)] min-h-[600px] max-h-[calc(100dvh-120px)] rounded-xl border border-border overflow-hidden bg-card">
        {/* LEFT PANEL */}
        <aside className="col-span-12 md:col-span-4 lg:col-span-3 border-r border-border flex flex-col bg-background/40">
          <div className="px-4 h-12 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FilterIcon className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-semibold">Inbox</div>
            </div>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={() => setSortDesc((v) => !v)}
              title={sortDesc ? "Newest first" : "Oldest first"}
            >
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>

          <div className="p-3 space-y-3 border-b border-border">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or message"
                className="pl-9 h-9"
              />
            </div>
            <div className="flex items-center gap-2 text-sm">
              <button
                onClick={() => setFilter("all")}
                className={cn(
                  "px-3 py-1 rounded-full font-medium border transition-colors text-xs",
                  filter === "all"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                All
              </button>
              <button
                onClick={() => setFilter("unread")}
                className={cn(
                  "px-3 py-1 rounded-full font-medium border transition-colors text-xs",
                  filter === "unread"
                    ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                    : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                )}
              >
                Unread
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto">
            {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
            {!isLoading && filteredConvos.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No conversations.
              </div>
            )}
            {filteredConvos.map((c) => {
              const unread =
                c.last_reply_at &&
                (!c.last_message_at || new Date(c.last_reply_at) > new Date(c.last_message_at));
              const ts = c.last_reply_at || c.last_message_at || c.updated_at;
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    setSelected(c.id);
                    setTab("reply");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b border-border/60 hover:bg-muted/40 transition-colors flex gap-3",
                    selected === c.id && "bg-muted/60",
                  )}
                >
                  <div
                    className={cn(
                      "h-10 w-10 rounded-full grid place-items-center text-sm font-semibold shrink-0",
                      colorFor(c.customer_phone),
                    )}
                  >
                    {initials(c.customer_name, c.customer_phone)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold truncate">
                        {c.customer_name || c.customer_phone}
                      </div>
                      <div className="text-[10px] text-muted-foreground shrink-0">
                        {ts ? format(new Date(ts), "dd/MM/yyyy") : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div className="text-[11px] text-muted-foreground truncate flex-1">
                        {c.order_id ? `#${c.order_id}` : c.customer_phone}
                      </div>
                      {unread && (
                        <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* RIGHT PANEL */}
        <section className="col-span-12 md:col-span-8 lg:col-span-9 flex min-h-0 flex-col bg-background/20">
          {!conv ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Select a conversation to view the order and chat.
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="border-b border-border px-3 sm:px-4 py-2 flex items-center gap-2.5 shrink-0 bg-card">
                <div
                  className={cn(
                    "h-9 w-9 rounded-full grid place-items-center text-sm font-semibold shrink-0",
                    colorFor(conv.customer_phone),
                  )}
                >
                  {initials(conv.customer_name, conv.customer_phone)}
                </div>
                <div className="min-w-0 flex-1">
                  {/* Row 1: Name + status badge */}
                  <div className="flex items-center gap-1.5 min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {conv.customer_name || conv.customer_phone}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] h-4 px-1.5 shrink-0", statusBadge(conv.status).cls)}
                    >
                      {statusBadge(conv.status).label}
                    </Badge>
                    <span
                      className={cn(
                        "shrink-0 h-1.5 w-1.5 rounded-full",
                        windowExpired ? "bg-rose-500" : "bg-emerald-500",
                      )}
                      title={windowExpired ? "24h window expired" : "Window open"}
                    />
                  </div>
                  {/* Row 2: phone + order */}
                  <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5">
                    <span className="shrink-0">{conv.customer_phone}</span>
                    {order && (
                      <>
                        <span className="shrink-0">•</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(order.order_id);
                            toast.success(`Copied #${order.order_id}`);
                          }}
                          onDoubleClick={(e) => {
                            e.stopPropagation();
                            window.open(`/orders/${order.order_id}`, "_blank");
                          }}
                          title="Click to copy • Double-click to open"
                          className="font-mono text-foreground hover:text-primary transition-colors shrink-0"
                        >
                          #{order.order_id}
                        </button>
                        <span className="shrink-0 hidden sm:inline">•</span>
                        <span className="truncate hidden sm:inline">{order.product_name}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Quick actions — icon-only on small, full on lg */}
                {order && (
                  <div className="hidden sm:flex items-center gap-1 shrink-0">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => action("confirm")}
                      className="h-8 px-2 lg:px-3"
                      title="Confirm"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5 lg:mr-1" />
                      <span className="hidden lg:inline">Confirm</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => action("to_agent")}
                      className="h-8 px-2 lg:px-3"
                      title="Send to Agent"
                    >
                      <UserPlus className="h-3.5 w-3.5 lg:mr-1" />
                      <span className="hidden lg:inline">Agent</span>
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => action("cancel")}
                      className="h-8 px-2 lg:px-3"
                      title="Cancel"
                    >
                      <XCircle className="h-3.5 w-3.5 lg:mr-1" />
                      <span className="hidden lg:inline">Cancel</span>
                    </Button>
                  </div>
                )}
              </div>

              {/* Messages */}
              <div
                ref={scrollerRef}
                className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--muted-foreground)/0.06)_1px,_transparent_0)] [background-size:16px_16px]"
              >
                {grouped.map((g) => (
                  <div key={g.key} className="space-y-3">
                    <div className="flex justify-center">
                      <span className="text-[10px] px-2 py-1 rounded-md bg-muted/60 text-muted-foreground">
                        {g.label}
                      </span>
                    </div>
                    {g.items.map((m) => {
                      const isOut = m.direction === "out";
                      const isNote = m.message_type === "note";
                      const isTemplate = m.message_type === "template";
                      if (isNote) {
                        return (
                          <div key={m.id} className="flex justify-center">
                            <div className="max-w-[80%] rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                              <div className="flex items-center gap-1 mb-0.5 text-[10px] font-semibold uppercase tracking-wide">
                                <StickyNote className="h-3 w-3" /> Internal note
                              </div>
                              <div className="whitespace-pre-wrap">{m.body}</div>
                              <div className="text-[10px] opacity-70 mt-1">
                                {format(new Date(m.created_at), "HH:mm")}
                              </div>
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div
                          key={m.id}
                          className={cn("flex", isOut ? "justify-end" : "justify-start")}
                        >
                          <div
                            className={cn(
                              "max-w-[75%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                              isOut
                                ? "bg-emerald-600 text-white rounded-br-sm"
                                : "bg-card border border-border rounded-bl-sm",
                            )}
                          >
                            {isTemplate && (
                              <div
                                className={cn(
                                  "text-[10px] uppercase tracking-wide font-semibold mb-1 flex items-center gap-1",
                                  isOut ? "text-white/80" : "text-muted-foreground",
                                )}
                              >
                                <FileText className="h-3 w-3" /> Template
                              </div>
                            )}
                            {(() => {
                              const mediaUrl =
                                m.payload?.image?.link ||
                                m.payload?.document?.link ||
                                m.payload?.audio?.link ||
                                m.payload?.image?.url ||
                                m.payload?.document?.url ||
                                m.payload?.audio?.url ||
                                null;
                              const mediaName =
                                m.payload?.document?.filename || "file";
                              if (m.message_type === "image" && mediaUrl) {
                                return (
                                  <a href={mediaUrl} target="_blank" rel="noreferrer">
                                    <img
                                      src={mediaUrl}
                                      alt="attachment"
                                      className="rounded-lg max-w-full max-h-64 object-cover mb-1"
                                    />
                                    {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                                  </a>
                                );
                              }
                              if (m.message_type === "audio" && mediaUrl) {
                                return <audio controls src={mediaUrl} className="max-w-full" />;
                              }
                              if (m.message_type === "document" && mediaUrl) {
                                return (
                                  <a
                                    href={mediaUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={cn(
                                      "flex items-center gap-2 px-2 py-1.5 rounded-md",
                                      isOut ? "bg-white/10" : "bg-muted",
                                    )}
                                  >
                                    <FileText className="h-4 w-4 shrink-0" />
                                    <span className="text-xs truncate flex-1">{mediaName}</span>
                                    <Download className="h-3.5 w-3.5 shrink-0" />
                                  </a>
                                );
                              }
                              return (
                                <div className="whitespace-pre-wrap break-words">
                                  {m.body || <em className="opacity-70">[{m.message_type}]</em>}
                                </div>
                              );
                            })()}
                            {/* Template buttons preview (quick replies / URL / phone) */}
                            {isTemplate && (() => {
                              const tplId = m.payload?._template_id as string | undefined;
                              const btns = tplId ? templateButtonsById.get(tplId) : null;
                              if (!btns || btns.length === 0) return null;
                              return (
                                <div className="mt-2 -mx-3 -mb-2 flex flex-col gap-1 pt-2">
                                  {btns.map((b: any, i: number) => {
                                    const label = (b.text || b.label || `Button ${i + 1}`).trim();
                                    const type = (b.type || b.button_type || "QUICK_REPLY").toString().toUpperCase();
                                    const isUrl = type.includes("URL");
                                    const isPhone = type.includes("PHONE");
                                    const Icon = isUrl ? ExternalLink : isPhone ? Phone : Reply;
                                    const href = isUrl
                                      ? (b.url || b.value || "#")
                                      : isPhone
                                        ? `tel:${b.phone_number || b.value || ""}`
                                        : undefined;
                                    const content = (
                                      <>
                                        <Icon className="h-3.5 w-3.5 shrink-0" />
                                        <span className="truncate">{label}</span>
                                      </>
                                    );
                                    const baseClasses = cn(
                                      "flex items-center justify-center gap-1.5 px-3 py-2 text-[13px] font-medium rounded-lg transition-colors duration-150 cursor-default select-none",
                                      isOut
                                        ? "bg-white/15 text-white hover:bg-white/25"
                                        : "bg-sky-50 text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20",
                                    );
                                    if (href) {
                                      return (
                                        <a
                                          key={i}
                                          href={href}
                                          target={isUrl ? "_blank" : undefined}
                                          rel={isUrl ? "noreferrer" : undefined}
                                          className={cn(baseClasses, "cursor-pointer")}
                                        >
                                          {content}
                                        </a>
                                      );
                                    }
                                    return (
                                      <div key={i} className={baseClasses}>
                                        {content}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })()}
                            <div
                              className={cn(
                                "text-[10px] mt-1 flex items-center gap-1",
                                isOut ? "text-white/70 justify-end" : "text-muted-foreground",
                              )}
                            >
                              {format(new Date(m.created_at), "HH:mm")}
                              {m.status && isOut ? ` · ${m.status}` : ""}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}

                {messages.length === 0 && (
                  <div className="text-sm text-center text-muted-foreground py-12">
                    No messages yet.
                  </div>
                )}
              </div>

              {/* 24h banner */}
              {windowExpired && (
                <div className="flex items-center justify-between gap-2 px-4 py-2.5 bg-rose-500/10 border-t border-rose-500/30 text-rose-600 dark:text-rose-400 text-sm">
                  <div className="flex items-center gap-2">
                    <Lock className="h-4 w-4" />
                    24h window expired. Free-form messaging is blocked.
                  </div>
                  <Button
                    size="sm"
                    onClick={() => setTplOpen(true)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1" /> Send Template
                  </Button>
                </div>
              )}

              {/* Tabs + input */}
              <div className="shrink-0 border-t border-border p-3 bg-card">
                <div className="flex items-center gap-2 mb-3">
                  <button
                    onClick={() => setTab("reply")}
                    className={cn(
                      "flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg font-semibold transition-all",
                      tab === "reply"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Reply className="h-4 w-4" />
                    Reply
                  </button>
                  <button
                    onClick={() => setTab("note")}
                    className={cn(
                      "flex items-center gap-1.5 text-sm px-4 py-2 rounded-lg font-semibold transition-all",
                      tab === "note"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <StickyNote className="h-4 w-4" />
                    Note
                  </button>
                  {lastInboundAt && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      Last reply {formatDistanceToNowStrict(lastInboundAt, { addSuffix: true })}
                    </span>
                  )}
                </div>

                {tab === "reply" ? (
                  <div className="space-y-2">
                    {/* AI suggestions chips */}
                    {aiSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 p-2 rounded-md bg-violet-500/5 border border-violet-500/20">
                        <div className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-violet-500 w-full">
                          <Sparkles className="h-3 w-3" /> AI suggestions
                          <button
                            onClick={() => setAiSuggestions([])}
                            className="ml-auto opacity-70 hover:opacity-100"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                        {aiSuggestions.map((s, i) => (
                          <button
                            key={i}
                            onClick={() => {
                              setDraft(s);
                              setAiSuggestions([]);
                            }}
                            className="text-xs px-2.5 py-1.5 rounded-md bg-card border border-border hover:bg-muted transition-colors text-left max-w-full"
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}

                    <Textarea
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={
                        windowExpired
                          ? "24h window expired — use template"
                          : "Type a reply…"
                      }
                      disabled={windowExpired || sending}
                      rows={2}
                      className="resize-none"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendReply();
                        }
                      }}
                    />

                    {/* Toolbar */}
                    <div className="flex items-center gap-1 flex-wrap">
                      {/* Emoji */}
                      <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                            disabled={windowExpired}
                            title="Emoji"
                          >
                            <Smile className="h-5 w-5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="p-0 border-none w-auto" side="top" align="start">
                          <EmojiPicker
                            onEmojiClick={(e) => {
                              insertAtCursor(e.emoji);
                              setEmojiOpen(false);
                            }}
                            theme={Theme.AUTO}
                            emojiStyle={EmojiStyle.NATIVE}
                            width={320}
                            height={380}
                            searchDisabled={false}
                            skinTonesDisabled
                            previewConfig={{ showPreview: false }}
                          />
                        </PopoverContent>
                      </Popover>

                      {/* Image */}
                      <input
                        ref={imageInputRef}
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAndSend(f, "image");
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground"
                        disabled={windowExpired || uploadingMedia}
                        title="Send image"
                        onClick={() => imageInputRef.current?.click()}
                      >
                        <Camera className="h-5 w-5" />
                      </Button>

                      {/* Document */}
                      <input
                        ref={fileInputRef}
                        type="file"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadAndSend(f, "document");
                          e.target.value = "";
                        }}
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground"
                        disabled={windowExpired || uploadingMedia}
                        title="Attach file"
                        onClick={() => fileInputRef.current?.click()}
                      >
                        <Paperclip className="h-5 w-5" />
                      </Button>

                      {/* Voice */}
                      <Button
                        type="button"
                        size="icon"
                        variant={recording ? "destructive" : "ghost"}
                        className={cn(
                          "h-9 w-9",
                          !recording && "text-muted-foreground hover:text-foreground",
                          recording && "animate-pulse",
                        )}
                        disabled={windowExpired || uploadingMedia}
                        title={recording ? "Stop recording" : "Record voice"}
                        onClick={() => (recording ? stopRecording() : startRecording())}
                      >
                        {recording ? <Square className="h-4 w-4 fill-current" /> : <Mic className="h-5 w-5" />}
                      </Button>

                      {/* AI suggest */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-violet-500 hover:text-violet-600 hover:bg-violet-500/10"
                        disabled={aiLoading || messages.length === 0}
                        title="AI suggestions"
                        onClick={fetchAiSuggestions}
                      >
                        {aiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                      </Button>

                      {/* Template */}
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground"
                        title="Send template"
                        onClick={() => setTplOpen(true)}
                      >
                        <FileText className="h-5 w-5" />
                      </Button>

                      {/* Quick replies */}
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-9 w-9 text-muted-foreground hover:text-foreground"
                            disabled={windowExpired}
                            title="Quick replies"
                          >
                            <MessageSquare className="h-5 w-5" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-72 p-2" side="top" align="start">
                          <div className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground px-2 py-1">
                            Quick Replies
                          </div>
                          <div className="space-y-0.5">
                            {quickReplies.map((q, i) => (
                              <button
                                key={i}
                                onClick={() => setDraft(q)}
                                className="w-full text-left text-sm px-2 py-1.5 rounded hover:bg-muted transition-colors"
                              >
                                {q}
                              </button>
                            ))}
                          </div>
                        </PopoverContent>
                      </Popover>

                      <div className="flex-1" />

                      {windowExpired ? (
                        <Button
                          onClick={() => setTplOpen(true)}
                          className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <FileText className="h-4 w-4 mr-1" /> Template
                        </Button>
                      ) : (
                        <Button
                          onClick={sendReply}
                          disabled={sending || uploadingMedia || !draft.trim()}
                          className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          {sending || uploadingMedia ? (
                            <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4 mr-1" />
                          )}
                          Send
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Internal note (not sent to customer)…"
                      rows={2}
                      className="resize-none border-amber-500/30 focus-visible:ring-amber-500/30"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          sendNote();
                        }
                      }}
                    />
                    <Button
                      onClick={sendNote}
                      disabled={!noteDraft.trim()}
                      variant="outline"
                      className="shrink-0 self-end border-amber-500/40 text-amber-600 dark:text-amber-400"
                    >
                      <StickyNote className="h-4 w-4 mr-1" /> Save Note
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      <SendTemplateModal
        open={tplOpen}
        onOpenChange={setTplOpen}
        conversationId={selected}
        orderId={conv?.order_id ?? null}
      />
    </>
  );
}
