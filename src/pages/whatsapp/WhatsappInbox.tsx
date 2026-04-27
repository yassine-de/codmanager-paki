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
  Bot,
  BotOff,
  Check,
  CheckCheck,
  AlertCircle,
  Languages,
  ArrowLeft,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import { Navigate, useNavigate } from "react-router-dom";
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
  last_read_at: string | null;
  updated_at: string;
  ai_enabled?: boolean;
  review_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
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

function getAudioPayload(msg: Msg) {
  const audio = msg.payload?.audio ?? null;
  const rawUrl = audio?.link || audio?.url || null;
  const mediaId = audio?.id || null;
  const mimeType = audio?.mime_type || "audio/ogg";
  const isTemporaryMetaUrl = typeof rawUrl === "string" && rawUrl.includes("lookaside.fbsbx.com");

  return { rawUrl, mediaId, mimeType, isTemporaryMetaUrl };
}

function AudioMessagePlayer({ message }: { message: Msg }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const { rawUrl, mediaId } = getAudioPayload(message);

  useEffect(() => {
    const { rawUrl, mediaId, mimeType, isTemporaryMetaUrl } = getAudioPayload(message);
    if (rawUrl && !isTemporaryMetaUrl) {
      setSrc(rawUrl);
      setLoading(false);
      setFailed(false);
      return;
    }

    if (!mediaId) {
      setSrc(null);
      setLoading(false);
      setFailed(true);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const loadAudio = async () => {
      setLoading(true);
      setFailed(false);
      setSrc(null);
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Missing session");

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?messageId=${message.id}`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!response.ok) {
          if (response.status === 404) {
            if (!cancelled) {
              setFailed(true);
              setSrc(null);
              setLoading(false);
            }
            return;
          }
          throw new Error(`Audio proxy failed (${response.status})`);
        }

        // Proxy returns 200 + JSON when media expired/unavailable (to avoid runtime error overlay)
        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          if (!cancelled) {
            setFailed(true);
            setSrc(null);
            setLoading(false);
          }
          return;
        }

        const blob = await response.blob();
        const effectiveMime = response.headers.get("x-media-type") || blob.type || mimeType;
        const typedBlob = blob.type === effectiveMime
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: effectiveMime });

        objectUrl = URL.createObjectURL(typedBlob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }

        setSrc(objectUrl);
      } catch (error) {
        // Silent fail — UI shows "audio unavailable" state. Avoid console.error to prevent runtime overlay.
        if (!cancelled) {
          setFailed(true);
          setSrc(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadAudio();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.id, message.payload?.audio?.id, message.payload?.audio?.link, message.payload?.audio?.url, message.payload?.audio?.mime_type]);

  if (!src && loading) {
    return <div className="text-xs text-muted-foreground">Loading audio…</div>;
  }

  if (!src && failed) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-destructive">Audio unavailable</div>
        {rawUrl && !rawUrl.includes("lookaside.fbsbx.com") ? (
          <a href={rawUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
            Open audio
          </a>
        ) : mediaId ? (
          <div className="text-[10px] text-muted-foreground">Media ID: {mediaId}</div>
        ) : null}
      </div>
    );
  }

  if (!src) return null;

  return <audio controls preload="metadata" src={src} className="max-w-full" />;
}

/**
 * Renders an image attachment by fetching it through the media-proxy edge function.
 * WhatsApp's lookaside.fbsbx.com URLs require a Bearer token, so we cannot use them
 * as <img src> directly — we proxy + blob URL instead.
 */
function MediaImage({ message, directUrl, alt = "attachment", className }: { message: Msg; directUrl?: string | null; alt?: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const isTemporary = typeof directUrl === "string" && directUrl.includes("lookaside.fbsbx.com");

  useEffect(() => {
    if (directUrl && !isTemporary) {
      setSrc(directUrl);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (!token) throw new Error("Missing session");

        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?messageId=${message.id}`;
        const response = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        const contentType = response.headers.get("Content-Type") || "";
        if (!response.ok || contentType.includes("application/json")) {
          if (!cancelled) setFailed(true);
          return;
        }

        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.id, directUrl, isTemporary]);

  if (failed) {
    return (
      <div className="text-xs text-muted-foreground italic px-2 py-3">
        Image unavailable (expired on WhatsApp servers)
      </div>
    );
  }

  if (!src) {
    return (
      <div className={cn("flex items-center justify-center bg-muted/40 rounded-lg", className)} style={{ minHeight: 120, minWidth: 160 }}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return <img src={src} alt={alt} className={className} />;
}

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
    handled: { label: "resolved", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25" },
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
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<
    "all" | "unread" | "needs_review" | "ai_on" | "ai_off" | "with_order" | "no_order" | "window_open"
  >("all");
  const [markingAllRead, setMarkingAllRead] = useState(false);
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
  const [orderInfoOpen, setOrderInfoOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);
  // Per-message English translations (internal only)
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
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

  // Per-conversation unread counts (WhatsApp-style green badge).
  // Counts inbound messages newer than `last_read_at` (the moment the user
  // opened the thread). We deliberately don't use `last_message_at` because
  // outbound sends bump it too, which would silently clear the badge.
  const convoIdsKey = convos.map((c) => c.id).join(",");
  const { data: unreadMap = {} } = useQuery<Record<string, number>>({
    queryKey: ["wts-unread-counts", convoIdsKey],
    queryFn: async () => {
      if (!convos.length) return {};
      const ids = convos.map((c) => c.id);
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("conversation_id, created_at")
        .eq("direction", "in")
        .in("conversation_id", ids)
        .order("created_at", { ascending: false })
        .limit(2000);
      if (error) throw error;
      const lastRead = new Map<string, number>(
        convos.map((c) => [c.id, c.last_read_at ? new Date(c.last_read_at).getTime() : 0]),
      );
      const map: Record<string, number> = {};
      for (const row of (data ?? []) as { conversation_id: string; created_at: string }[]) {
        const seen = lastRead.get(row.conversation_id) ?? 0;
        if (new Date(row.created_at).getTime() > seen) {
          map[row.conversation_id] = (map[row.conversation_id] ?? 0) + 1;
        }
      }
      return map;
    },
    enabled: convos.length > 0,
    staleTime: 10_000,
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
          qc.invalidateQueries({ queryKey: ["wts-unread-counts"] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "whatsapp_messages" },
        (payload) => {
          const row: any = payload.new ?? payload.old;
          qc.invalidateQueries({ queryKey: ["wts-convos"] });
          qc.invalidateQueries({ queryKey: ["wts-unread-counts"] });
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

  // Auto-translate inbound non-English messages (staff-only, never sent to customer)
  const autoTranslatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!messages.length) return;
    const toTranslate = messages.filter((m) => {
      if (m.direction !== "inbound") return false;
      if (!m.body) return false;
      if (translations[m.id]) return false;
      if ((m.payload as any)?._translation_en) return false;
      if (autoTranslatedRef.current.has(m.id)) return false;
      if (!needsTranslation(m.body)) return false;
      return true;
    });
    if (!toTranslate.length) return;
    toTranslate.forEach((m) => {
      autoTranslatedRef.current.add(m.id);
      void (async () => {
        try {
          const { data, error } = await supabase.functions.invoke("whatsapp-translate", {
            body: { message_id: m.id, text: m.body },
          });
          if (error || !data?.ok) return;
          setTranslations((prev) => ({ ...prev, [m.id]: data.translation }));
        } catch {
          // silent — staff-only feature, no toast spam
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages]);

  // Mark conversation read on open. We update `last_read_at` only — touching
  // `last_message_at` would re-sort the list and jump this thread to the top
  // (because of the `update_updated_at_column` trigger).
  useEffect(() => {
    if (!selected) return;
    void supabase
      .from("whatsapp_conversations")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", selected)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["wts-unread-counts"] });
      });
  }, [selected, qc]);

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
      list = list.filter((c) => (unreadMap[c.id] ?? 0) > 0);
    } else if (filter === "needs_review") {
      list = list.filter((c) => c.status === "manual_review_needed");
    } else if (filter === "ai_on") {
      list = list.filter((c) => c.ai_enabled !== false);
    } else if (filter === "ai_off") {
      list = list.filter((c) => c.ai_enabled === false);
    } else if (filter === "with_order") {
      list = list.filter((c) => !!c.order_id);
    } else if (filter === "no_order") {
      list = list.filter((c) => !c.order_id);
    } else if (filter === "window_open") {
      list = list.filter((c) => {
        // Use last_message_at as a proxy for last customer activity (the
        // 24h WA window opens on inbound messages).
        const ts = c.last_message_at || c.last_reply_at;
        if (!ts) return false;
        return differenceInHours(new Date(), new Date(ts)) < 24;
      });
    }
    // Sort by most recent activity (last message timestamp), WhatsApp-style.
    // We intentionally avoid `updated_at` here because a DB trigger bumps it
    // every time the row changes (including when we mark the thread as read),
    // which would incorrectly jump the opened conversation to the top.
    list.sort((a, b) => {
      const ta = new Date(a.last_message_at || a.updated_at).getTime();
      const tb = new Date(b.last_message_at || b.updated_at).getTime();
      return sortDesc ? tb - ta : ta - tb;
    });
    return list;
  }, [convos, search, filter, sortDesc, unreadMap]);

  // Count CONVERSATIONS (contacts) with unread — not total unread messages.
  const totalUnread = useMemo(
    () => Object.values(unreadMap).filter((n) => (n ?? 0) > 0).length,
    [unreadMap],
  );

  const needsReviewCount = useMemo(
    () => convos.filter((c) => c.status === "manual_review_needed").length,
    [convos],
  );

  const markAllAsRead = async () => {
    const unreadIds = Object.keys(unreadMap).filter((id) => (unreadMap[id] ?? 0) > 0);
    if (unreadIds.length === 0) {
      toast.info("No unread conversations");
      return;
    }
    setMarkingAllRead(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("whatsapp_conversations")
        .update({ last_read_at: nowIso })
        .in("id", unreadIds);
      if (error) throw error;
      toast.success(`Marked ${unreadIds.length} conversation${unreadIds.length > 1 ? "s" : ""} as read`);
      qc.invalidateQueries({ queryKey: ["wts-unread-counts"] });
      qc.invalidateQueries({ queryKey: ["wts-convos"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to mark as read");
    } finally {
      setMarkingAllRead(false);
    }
  };

  // The WhatsApp 24h customer-service window opens whenever the CUSTOMER
  // sends a message (inbound). Find the most recent inbound message for
  // the selected conversation. Fall back to conv.last_message_at.
  const lastInboundAt = useMemo(() => {
    const lastInboundMsg = [...messages]
      .reverse()
      .find((m) => m.direction === "in" || m.direction === "inbound");
    if (lastInboundMsg) return new Date(lastInboundMsg.created_at);
    if (conv?.last_message_at) return new Date(conv.last_message_at);
    return null;
  }, [messages, conv]);

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

  const aiEnabled = conv?.ai_enabled !== false;

  const markAsResolved = async () => {
    if (!selected || !conv) return;
    setResolving(true);
    const note = resolveNote.trim();
    const { data: u } = await supabase.auth.getUser();
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({
        status: "handled",
        review_note: note || null,
        resolved_by: u?.user?.id ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", selected);
    if (error) {
      setResolving(false);
      toast.error(error.message || "Failed to mark as resolved");
      return;
    }
    // Save the note as an internal note in the chat for traceability
    if (note) {
      await supabase.from("whatsapp_messages").insert({
        conversation_id: selected,
        order_id: conv.order_id ?? null,
        direction: "in",
        message_type: "note",
        body: `[Resolved] ${note}`,
        status: "internal",
        payload: { internal_note: true, resolution: true },
      });
    }
    setResolving(false);
    setResolveOpen(false);
    setResolveNote("");
    qc.invalidateQueries({ queryKey: ["wts-convos"] });
    qc.invalidateQueries({ queryKey: ["wts-msgs", selected] });
    toast.success("Conversation marked as resolved");
  };
  const toggleAi = async () => {
    if (!selected || !conv) return;
    const next = !aiEnabled;
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({ ai_enabled: next })
      .eq("id", selected);
    if (error) {
      toast.error(error.message || "Failed to update AI status");
      return;
    }
    qc.invalidateQueries({ queryKey: ["wts-convos"] });
    toast.success(next ? "AI auto-reply enabled" : "AI stopped for this conversation");
  };

  // Detect if a message body likely needs English translation (internal staff only).
  const needsTranslation = (text: string | null | undefined): boolean => {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 2) return false;
    if (/[\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u4E00-\u9FFF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)) {
      return true;
    }
    const romanHints = /\b(hai|hain|nahi|nhi|kya|kyun|kyu|kuch|raha|rahi|rahe|karo|karna|mujhe|mera|meri|aap|apka|tum|tumhara|bhai|theek|thik|acha|achha|abhi|chahiye|paisa|paise|qeemat|keemat|bhej|plz|haan|bilkul|sahi|ghalat|samjh|samajh|matlab|kaisa|kaise|kahan|magar|lekin|liye|wala|wali|mein|hum|hamara|pouch|pucha|baat|kaam)\b/i;
    return romanHints.test(t);
  };

  const handleTranslate = async (m: Msg) => {
    if (!m.body || translations[m.id]) return;
    setTranslatingId(m.id);
    try {
      const { data, error } = await supabase.functions.invoke("whatsapp-translate", {
        body: { message_id: m.id, text: m.body },
      });
      if (error || !data?.ok) throw new Error(error?.message || data?.error || "Translation failed");
      setTranslations((prev) => ({ ...prev, [m.id]: data.translation }));
    } catch (e: any) {
      toast.error(e.message || "Translation failed");
    } finally {
      setTranslatingId(null);
    }
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
      if (error || !data?.ok) {
        const metaErr = data?.response?.error?.message || data?.error || error?.message;
        throw new Error(metaErr || "Send failed");
      }
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

      // WhatsApp voice notes ONLY render properly when sent as audio/ogg with the Opus codec.
      // Native OGG recording: Firefox supports `audio/ogg;codecs=opus` directly.
      // Chrome/Edge/Safari record Opus inside a WebM container — the Opus bitstream is identical,
      // and Meta accepts the file when we label it `audio/ogg; codecs=opus` and use `.ogg` extension.
      const candidates = [
        "audio/ogg;codecs=opus",
        "audio/webm;codecs=opus",
        "audio/webm",
      ];
      const supported = candidates.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m));
      if (!supported) {
        toast.error("Browser doesn't support voice recording. Try Chrome, Firefox, or Safari.");
        return;
      }
      const mr = new MediaRecorder(stream, { mimeType: supported });

      recordedChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        // Always upload as audio/ogg + .ogg — the Opus stream is identical regardless of container,
        // and this is the only MIME that WhatsApp Cloud API accepts for voice notes.
        const outType = "audio/ogg";
        const blob = new Blob(recordedChunksRef.current, { type: outType });
        const file = new File([blob], `voice-${Date.now()}.ogg`, { type: outType });
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
      {/* Horizontal filters bar above inbox — hidden on mobile when a conversation is open */}
      <div className={cn(
        "mb-2 items-center gap-2 flex-wrap rounded-xl border border-border bg-card px-3 py-2",
        selected ? "hidden md:flex" : "flex"
      )}>
        <div className="flex items-center gap-1.5 mr-1">
          <FilterIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">Filters</span>
        </div>
        {([
          { key: "all", label: "All" },
          { key: "unread", label: "Unread" },
          { key: "needs_review", label: "Needs Review", count: needsReviewCount },
          { key: "ai_on", label: "AI On" },
          { key: "ai_off", label: "AI Off" },
          { key: "with_order", label: "With Order" },
          { key: "no_order", label: "No Order" },
          { key: "window_open", label: "24h Window" },
        ] as const).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "px-2.5 py-1 rounded-full font-medium border transition-colors text-[11px] inline-flex items-center gap-1",
              filter === f.key
                ? f.key === "needs_review"
                  ? "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30"
                  : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
            )}
          >
            {f.label}
            {"count" in f && f.count > 0 && (
              <span className={cn(
                "inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-full text-[9px] font-semibold",
                filter === f.key
                  ? "bg-sky-500 text-white"
                  : "bg-sky-500/20 text-sky-600 dark:text-sky-400",
              )}>
                {f.count > 99 ? "99+" : f.count}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className={cn(
        "grid grid-cols-12 gap-0 rounded-xl border border-border overflow-hidden bg-card",
        // Full-screen on mobile when chat is open; constrained on desktop and on mobile list view
        selected
          ? "h-[calc(100dvh-80px)] max-h-[calc(100dvh-80px)] md:h-[calc(100dvh-200px)] md:max-h-[calc(100dvh-160px)]"
          : "h-[calc(100dvh-200px)] max-h-[calc(100dvh-160px)]"
      )}>
        {/* LEFT PANEL — hidden on mobile when a conversation is selected */}
        <aside className={cn(
          "col-span-12 md:col-span-4 lg:col-span-3 border-r border-border flex-col bg-background/40 min-h-0 overflow-hidden",
          selected ? "hidden md:flex" : "flex"
        )}>
          <div className="px-4 h-12 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FilterIcon className="h-4 w-4 text-muted-foreground" />
              <div className="text-sm font-semibold">Inbox</div>
              {totalUnread > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs gap-1"
                onClick={markAllAsRead}
                disabled={markingAllRead || totalUnread === 0}
                title="Mark all conversations as read"
              >
                {markingAllRead ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Mark all read</span>
              </Button>
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
          </div>

          <div className="p-3 border-b border-border">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or message"
                className="pl-9 h-9"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
            {!isLoading && filteredConvos.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No conversations.
              </div>
            )}
            {filteredConvos.map((c) => {
              const unreadCount = unreadMap[c.id] ?? 0;
              const unread = unreadCount > 0;
              const needsReview = c.status === "manual_review_needed";
              const ts = c.last_reply_at || c.last_message_at || c.updated_at;
              const tooltip = needsReview
                ? "⚠️ Needs human review — AI flagged this conversation"
                : unread
                ? `${unreadCount} unread message${unreadCount > 1 ? "s" : ""}${
                    c.last_reply_at
                      ? ` • last reply ${formatDistanceToNowStrict(new Date(c.last_reply_at), { addSuffix: true })}`
                      : ""
                  }`
                : ts
                ? `Last activity ${formatDistanceToNowStrict(new Date(ts), { addSuffix: true })}`
                : "";
              return (
                <button
                  key={c.id}
                  type="button"
                  title={tooltip}
                  onClick={() => {
                    setSelected(c.id);
                    setTab("reply");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-3 border-b border-border/60 hover:bg-muted/40 transition-colors flex gap-3 relative",
                    selected === c.id && "bg-muted/60",
                    needsReview && "bg-sky-500/5 hover:bg-sky-500/10 border-l-4 border-l-sky-500",
                  )}
                >
                  <div className="relative shrink-0">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full grid place-items-center text-sm font-semibold",
                        colorFor(c.customer_phone),
                      )}
                    >
                      {initials(c.customer_name, c.customer_phone)}
                    </div>
                    {needsReview && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-3.5 w-3.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-sky-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-sky-500 border-2 border-background items-center justify-center">
                          <AlertCircle className="h-2 w-2 text-white" />
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={cn(
                          "text-sm truncate",
                          unread || needsReview ? "font-bold text-foreground" : "font-semibold",
                        )}
                      >
                        {c.customer_name || c.customer_phone}
                      </div>
                      <div
                        className={cn(
                          "text-[10px] shrink-0",
                          unread ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {ts ? format(new Date(ts), "HH:mm") : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <div
                        className={cn(
                          "text-[11px] truncate flex-1",
                          unread ? "text-foreground/80 font-medium" : "text-muted-foreground",
                        )}
                      >
                        {c.order_id ? `#${c.order_id}` : c.customer_phone}
                      </div>
                      {needsReview && (
                        <span
                          className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full bg-sky-500 text-white text-[9px] font-bold shrink-0 uppercase tracking-wide"
                          aria-label="Needs human review"
                        >
                          <AlertCircle className="h-2.5 w-2.5" />
                          Review
                        </span>
                      )}
                      {unread && (
                        <span
                          className="min-w-[20px] h-5 px-1.5 rounded-full bg-emerald-500 text-white text-[11px] font-bold grid place-items-center shrink-0"
                          aria-label={`${unreadCount} unread messages`}
                        >
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </aside>

        {/* RIGHT PANEL — hidden on mobile when no conversation selected */}
        <section className={cn(
          "col-span-12 md:col-span-8 lg:col-span-9 min-h-0 flex-col bg-background/20",
          selected ? "flex" : "hidden md:flex"
        )}>
          {!conv ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Select a conversation to view the order and chat.
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="border-b border-border px-3 sm:px-4 py-2 flex items-center gap-2.5 shrink-0 bg-card">
                {/* Mobile back button */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 md:hidden -ml-1"
                  onClick={() => setSelected(null)}
                  title="Back to inbox"
                >
                  <ArrowLeft className="h-5 w-5" />
                </Button>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setOrderInfoOpen(true)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setOrderInfoOpen(true);
                    }
                  }}
                  className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer rounded-md hover:bg-muted/50 transition-colors py-1 px-1 -mx-1"
                  title="View customer & order info"
                >
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
                  {/* Row 2: phone + order + status pills */}
                  <div className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5 flex-wrap">
                    <span className="shrink-0">{conv.customer_phone}</span>
                    {order && (
                      <>
                        <span className="shrink-0 opacity-50">•</span>
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
                        {/* Status pills — compact, color-coded */}
                        {order.confirmation_status && (
                          <span
                            className={cn(
                              "shrink-0 inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none capitalize",
                              confirmationStatusCls(order.confirmation_status),
                            )}
                            title={`Confirmation: ${order.confirmation_status.replace(/_/g, " ")}`}
                          >
                            <span className="h-1 w-1 rounded-full bg-current opacity-70" />
                            {order.confirmation_status.replace(/_/g, " ")}
                          </span>
                        )}
                        {order.delivery_status && (
                          <span
                            className={cn(
                              "hidden md:inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none capitalize",
                              deliveryStatusCls(order.delivery_status),
                            )}
                            title={`Delivery: ${order.delivery_status.replace(/_/g, " ")}`}
                          >
                            <span className="h-1 w-1 rounded-full bg-current opacity-70" />
                            {order.delivery_status.replace(/_/g, " ")}
                          </span>
                        )}
                        {order.shipping_status && (
                          <span
                            className="hidden lg:inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 text-muted-foreground px-1.5 py-px text-[10px] font-medium leading-none capitalize"
                            title={`Shipping: ${order.shipping_status.replace(/_/g, " ")}`}
                          >
                            <span className="h-1 w-1 rounded-full bg-current opacity-70" />
                            {order.shipping_status.replace(/_/g, " ")}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  </div>
                </div>

                {/* Mark as resolved (only when conversation needs review) */}
                {conv?.status === "manual_review_needed" && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setResolveOpen(true)}
                    className="h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-medium border-sky-500/30 bg-sky-500/10 text-sky-600 hover:bg-sky-500/20 hover:text-sky-700 dark:text-sky-400"
                    title="Mark this conversation as resolved"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">Mark Resolved</span>
                  </Button>
                )}

                {/* AI auto-reply toggle */}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={toggleAi}
                  className={cn(
                    "h-8 shrink-0 gap-1.5 rounded-full px-3 text-xs font-medium",
                    aiEnabled
                      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20 hover:text-emerald-700 dark:text-emerald-400"
                      : "border-rose-500/30 bg-rose-500/10 text-rose-600 hover:bg-rose-500/20 hover:text-rose-700 dark:text-rose-400",
                  )}
                  title={aiEnabled ? "AI is replying — click to stop" : "AI is stopped — click to enable"}
                >
                  {aiEnabled ? <Bot className="h-3.5 w-3.5" /> : <BotOff className="h-3.5 w-3.5" />}
                  <span className="hidden md:inline">{aiEnabled ? "AI On" : "AI Off"}</span>
                </Button>

                {/* Status indicators removed per request */}
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
                                m.payload?.video?.link ||
                                m.payload?.image?.url ||
                                m.payload?.document?.url ||
                                m.payload?.audio?.url ||
                                m.payload?.video?.url ||
                                null;
                              const mediaName =
                                m.payload?.document?.filename || "file";
                              // Some inbound messages have body = JSON.stringify(payload). Hide it for media.
                              const bodyLooksLikeJson =
                                typeof m.body === "string" && m.body.trim().startsWith("{") && m.body.includes("\"id\"");
                              const caption = bodyLooksLikeJson ? null : m.body;

                              if (m.message_type === "image") {
                                return (
                                  <div>
                                    <MediaImage
                                      message={m}
                                      directUrl={mediaUrl}
                                      className="rounded-lg max-w-full max-h-64 object-cover mb-1"
                                    />
                                    {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
                                  </div>
                                );
                              }
                              if (m.message_type === "audio") {
                                return <AudioMessagePlayer message={m} />;
                              }
                              if (m.message_type === "document") {
                                // For documents, link to the proxy so it works after the lookaside URL expires
                                const proxyHref = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?messageId=${m.id}`;
                                const href = mediaUrl && !mediaUrl.includes("lookaside.fbsbx.com") ? mediaUrl : proxyHref;
                                return (
                                  <a
                                    href={href}
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
                                  {caption || <em className="opacity-70">[{m.message_type}]</em>}
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
                            {/* Internal English translation (staff-only, never sent to customer) */}
                            {!isOut && !isTemplate && m.body && (() => {
                              const cached = m.payload?._translation_en as string | undefined;
                              const shown = translations[m.id] || cached;
                              if (shown) {
                                return (
                                  <div className="mt-1.5 pt-1.5 border-t border-border/60 text-[12px] italic text-muted-foreground flex gap-1.5">
                                    <Languages className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
                                    <span className="whitespace-pre-wrap break-words">{shown}</span>
                                  </div>
                                );
                              }
                              if (needsTranslation(m.body)) {
                                const isLoading = translatingId === m.id;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleTranslate(m)}
                                    disabled={isLoading}
                                    className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors disabled:opacity-60"
                                  >
                                    {isLoading ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Languages className="h-3 w-3" />
                                    )}
                                    {isLoading ? "Translating…" : "Translate to English"}
                                  </button>
                                );
                              }
                              return null;
                            })()}
                            <div
                              className={cn(
                                "text-[10px] mt-1 flex items-center gap-1",
                                isOut ? "text-white/70 justify-end" : "text-muted-foreground",
                              )}
                            >
                              <span>{format(new Date(m.created_at), "HH:mm")}</span>
                              {isOut && m.status && (
                                <>
                                  {m.status === "failed" ? (
                                    <span className="inline-flex items-center gap-0.5 text-red-200 font-semibold" title="Message failed to deliver">
                                      <AlertCircle className="w-3 h-3" />
                                      failed
                                    </span>
                                  ) : m.status === "read" ? (
                                    <CheckCheck className="w-3.5 h-3.5 text-sky-300" aria-label="Read" >
                                      <title>Read by customer</title>
                                    </CheckCheck>
                                  ) : m.status === "delivered" ? (
                                    <span title="Delivered to customer's phone (read receipts may be disabled)">
                                      <CheckCheck className="w-3.5 h-3.5 text-white/80" />
                                    </span>
                                  ) : m.status === "sent" ? (
                                    <span title="Sent to WhatsApp">
                                      <Check className="w-3.5 h-3.5 text-white/80" />
                                    </span>
                                  ) : null}
                                </>
                              )}
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

      {/* Customer & Order Info Dialog */}
      <Dialog open={orderInfoOpen} onOpenChange={setOrderInfoOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {conv && (
                <div
                  className={cn(
                    "h-10 w-10 rounded-full grid place-items-center text-sm font-semibold shrink-0",
                    colorFor(conv.customer_phone),
                  )}
                >
                  {initials(conv.customer_name, conv.customer_phone)}
                </div>
              )}
              <div className="min-w-0">
                <div className="truncate text-base">
                  {conv?.customer_name || conv?.customer_phone}
                </div>
                <div className="text-xs text-muted-foreground font-normal font-mono">
                  {conv?.customer_phone}
                </div>
              </div>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
            {/* Conversation status */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge
                variant="outline"
                className={cn("text-[11px]", statusBadge(conv?.status || "").cls)}
              >
                {statusBadge(conv?.status || "").label}
              </Badge>
              <Badge
                variant="outline"
                className={cn(
                  "text-[11px]",
                  windowExpired
                    ? "bg-rose-500/10 text-rose-500 border-rose-500/30"
                    : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
                )}
              >
                {windowExpired ? "🔒 24h Expired" : "Window Open"}
              </Badge>
            </div>

            {/* Order section */}
            {order ? (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground font-semibold">
                    Order
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => {
                      setOrderInfoOpen(false);
                      navigate(`/orders/${order.order_id}`);
                    }}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" /> Open
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="col-span-2">
                    <div className="text-[11px] text-muted-foreground">Order ID</div>
                    <div className="font-mono font-semibold">#{order.order_id}</div>
                  </div>
                  <div className="col-span-2">
                    <div className="text-[11px] text-muted-foreground">Product</div>
                    <div className="font-medium">{order.product_name}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Quantity</div>
                    <div>{order.quantity}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Total</div>
                    <div className="font-semibold">Rs {Number(order.total_amount || 0).toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">City</div>
                    <div>{order.customer_city || "—"}</div>
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Created</div>
                    <div>{order.created_at ? format(new Date(order.created_at), "dd/MM/yyyy HH:mm") : "—"}</div>
                  </div>
                  {order.customer_address && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-muted-foreground">Address</div>
                      <div className="text-sm">{order.customer_address}</div>
                    </div>
                  )}
                  {order.note && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-muted-foreground">Note</div>
                      <div className="text-sm whitespace-pre-wrap">{order.note}</div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-border">
                  {order.confirmation_status && (
                    <Badge
                      variant="outline"
                      className={cn("text-[11px]", confirmationStatusCls(order.confirmation_status))}
                    >
                      Conf: {order.confirmation_status.replace(/_/g, " ")}
                    </Badge>
                  )}
                  {order.delivery_status && (
                    <Badge
                      variant="outline"
                      className={cn("text-[11px]", deliveryStatusCls(order.delivery_status))}
                    >
                      Del: {order.delivery_status.replace(/_/g, " ")}
                    </Badge>
                  )}
                  {order.shipping_status && (
                    <Badge variant="outline" className="text-[11px]">
                      Ship: {order.shipping_status.replace(/_/g, " ")}
                    </Badge>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                No order linked to this conversation
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Mark as resolved dialog */}
      <Dialog open={resolveOpen} onOpenChange={(o) => { setResolveOpen(o); if (!o) setResolveNote(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-sky-500" />
              Mark as Resolved
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Confirm this conversation has been handled. Add an optional note to record what was done.
            </p>
            <Textarea
              value={resolveNote}
              onChange={(e) => setResolveNote(e.target.value)}
              placeholder="Reviewer note (optional)…"
              rows={4}
              className="resize-none"
            />
            <div className="flex items-center justify-end gap-2 pt-1">
              <Button variant="ghost" size="sm" onClick={() => setResolveOpen(false)} disabled={resolving}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={markAsResolved}
                disabled={resolving}
                className="gap-1.5 bg-emerald-500 hover:bg-emerald-600 text-white"
              >
                {resolving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                Mark Resolved
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
