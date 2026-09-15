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
  Lock,
  Send,
  StickyNote,
  FileText,
  Loader2,
  Smile,
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
  MapPin,
  Pencil,
  Truck,
  Plus,
  Trash2,
  Inbox,
  Clock,
  Archive,
  Play,
  Pause,
  MoreVertical,
  ChevronRight,
  Package,
  SlidersHorizontal,
  Info,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import EmojiPicker, { EmojiStyle, Theme } from "emoji-picker-react";
import { toast } from "sonner";
import { formatDistanceToNowStrict, differenceInHours } from "date-fns";
import { formatPKT as format, isTodayPKT as isToday, toPKT } from "@/lib/timezone";
// isYesterday in PKT context
const isYesterday = (date: Date) => {
  const pkt = toPKT(date);
  const yesterdayPkt = toPKT(new Date(Date.now() - 86400000));
  return pkt.getFullYear() === yesterdayPkt.getFullYear() &&
    pkt.getMonth() === yesterdayPkt.getMonth() &&
    pkt.getDate() === yesterdayPkt.getDate();
};
import { useAuth } from "@/contexts/AuthContext";
import { Navigate, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { exactOrderIdMatch, isOrderIdSearch, normalizeOrderIdSearch } from "@/lib/search";
import { SendTemplateModal } from "@/components/whatsapp/SendTemplateModal";
import { useCarrierCities } from "@/hooks/useCarrierCities";
import { CitySelect } from "@/components/CitySelect";

type Conv = {
  id: string;
  order_id: string | null;
  customer_name: string | null;
  customer_phone: string;
  status: string;
  last_message_at: string | null;
  last_inbound_at: string | null;
  last_reply_at: string | null;
  last_read_at: string | null;
  updated_at: string;
  is_legacy?: boolean;
  ai_enabled?: boolean;
  labels?: string[] | null;
  review_note?: string | null;
  resolved_by?: string | null;
  resolved_at?: string | null;
  pending_button_intent?: {
    intent?: string;
    button_text?: string;
    mapped_status?: string | null;
    created_at?: string;
  } | null;
};

type Msg = {
  id: string;
  conversation_id: string;
  body: string | null;
  direction: string;
  message_type: string;
  status: string | null;
  created_at: string;
  meta_message_id?: string | null;
  payload?: any;
};

type LastMessage = { conversation_id: string; direction: string; message_type: string; body: string | null };

// A real WhatsApp-style preview line for the conversation list — what actually
// happened last, not the order id. Mirrors WhatsApp's own conventions
// (media type icons, "You:" prefix on outbound, reactions worded like WhatsApp).
function previewText(last: LastMessage | undefined, fallback: string): string {
  if (!last) return fallback;
  const you = last.direction === "out" ? "You: " : "";
  const clean = (s: string | null) => (s || "").replace(/\s+/g, " ").trim().slice(0, 80);
  switch (last.message_type) {
    case "image": return `${you}📷 Photo`;
    case "video": return `${you}🎥 Video`;
    case "audio": return `${you}🎤 Voice message`;
    case "audio_transcribed": return `${you}🎤 ${clean(last.body) || "Voice message"}`;
    case "sticker": return `${you}Sticker`;
    case "location": return `${you}📍 Location`;
    case "document": return `${you}📄 Document`;
    case "order": return `${you}🛒 Order`;
    case "unsupported": return `${you}Unsupported message`;
    case "reaction": return last.direction === "out" ? "You reacted" : "Reacted";
    default: return `${you}${clean(last.body)}` || fallback;
  }
}

type ProductOption = {
  key: string;
  productId: string;
  variantId: string | null;
  name: string;
  sku: string | null;
  variantName: string | null;
  price: number;
};

type OrderItemDraft = {
  id?: string;
  product_id?: string | null;
  product_variant_id?: string | null;
  sku?: string | null;
  product_name: string;
  variant_name?: string | null;
  quantity: string;
  unit_price: string;
};

type RecentOrderRow = {
  id: string;
  order_id: string;
  product_name: string | null;
  quantity: number | null;
  price: number | null;
  total_amount: number | null;
  confirmation_status: string | null;
  delivery_status: string | null;
  created_at: string;
  order_items?: { product_name: string | null; product_id: string | null }[] | null;
};

type DuplicateOrderWarning = {
  id: string;
  order_id: string;
  confirmation_status: string | null;
  delivery_status: string | null;
  product_name: string | null;
  customer_city: string | null;
  created_at: string | null;
  order_items?: { product_name: string | null }[] | null;
};

const CANCEL_REASONS = [
  { value: "high_price", label: "High Price" },
  { value: "product_issue", label: "Product Issue" },
  { value: "not_convinced", label: "Not Convinced" },
  { value: "quality_issue", label: "Quality Issue" },
  { value: "other", label: "Other" },
];

const CANCEL_REASON_VALUES = new Set(CANCEL_REASONS.map((reason) => reason.value));

const getCancelReasonDraft = (reason?: string | null) => {
  if (!reason) return { reason: "", note: "" };
  return CANCEL_REASON_VALUES.has(reason)
    ? { reason, note: "" }
    : { reason: "other", note: reason };
};

const phoneVariants = (raw: string | null | undefined): string[] => {
  const digits = (raw || "").replace(/\D/g, "");
  const last10 = digits.slice(-10);
  if (!last10) return [];
  return Array.from(
    new Set([raw || "", digits, `+${digits}`, `92${last10}`, `+92${last10}`, `0${last10}`, last10]),
  ).filter(Boolean);
};

const getFreshAccessToken = async () => {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  let session = data.session;

  const expiresAtMs = session?.expires_at ? session.expires_at * 1000 : 0;
  if (session && expiresAtMs && expiresAtMs - Date.now() < 120_000) {
    const refreshed = await supabase.auth.refreshSession();
    if (refreshed.error) throw refreshed.error;
    session = refreshed.data.session;
  }

  if (!session?.access_token) throw new Error("Session expired — please login again");
  return session.access_token;
};

const getFunctionHeaders = async (json = false) => {
  const token = await getFreshAccessToken();
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return {
    Authorization: `Bearer ${token}`,
    ...(key ? { apikey: key } : {}),
    ...(json ? { "Content-Type": "application/json" } : {}),
  };
};

const invokeProtectedFunction = async <T,>(name: string, body: unknown): Promise<T> => {
  const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: await getFunctionHeaders(true),
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || data?.message || `Edge Function failed (${response.status})`);
  return data as T;
};

function getAudioPayload(msg: Msg) {
  const audio = msg.payload?.audio ?? null;
  const rawUrl = audio?.link || audio?.url || null;
  const mediaId = audio?.id || null;
  const mimeType = audio?.mime_type || "audio/ogg";
  const isTemporaryMetaUrl = typeof rawUrl === "string" && rawUrl.includes("lookaside.fbsbx.com");

  return { rawUrl, mediaId, mimeType, isTemporaryMetaUrl };
}

function AudioMessagePlayer({ message, isOut }: { message: Msg; isOut: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
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
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?messageId=${message.id}`;
        const response = await fetch(url, {
          headers: await getFunctionHeaders(),
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

  // Decorative waveform — WhatsApp's own bars aren't real amplitude analysis
  // either. Seeded by message id so the pattern is stable across re-renders
  // instead of reshuffling every time state updates.
  let seed = 0;
  for (let i = 0; i < message.id.length; i++) seed = (seed * 31 + message.id.charCodeAt(i)) >>> 0;
  const bars = Array.from({ length: 28 }, () => {
    seed = (seed * 1103515245 + 12345) >>> 0;
    return 25 + (seed % 1000) / 1000 * 75; // 25–100% height
  });
  const progress = duration > 0 ? currentTime / duration : 0;
  const playedBars = Math.round(progress * bars.length);
  const formatTime = (s: number) => {
    if (!isFinite(s) || s < 0) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex items-center gap-2.5 min-w-[210px] py-0.5">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        className="hidden"
      />
      <button
        type="button"
        onClick={() => {
          const audio = audioRef.current;
          if (!audio) return;
          if (audio.paused) void audio.play(); else audio.pause();
        }}
        className={cn(
          "shrink-0 h-9 w-9 rounded-full grid place-items-center transition-colors",
          isOut ? "bg-white/20 hover:bg-white/30 text-white" : "bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-600",
        )}
      >
        {isPlaying ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
      </button>
      <div className="flex-1 flex items-center gap-[2px] h-8">
        {bars.map((h, i) => (
          <div
            key={i}
            className={cn(
              "flex-1 rounded-full min-w-[2px]",
              i < playedBars
                ? (isOut ? "bg-white" : "bg-emerald-600")
                : (isOut ? "bg-white/30" : "bg-muted-foreground/30"),
            )}
            style={{ height: `${h}%` }}
          />
        ))}
      </div>
      <span className={cn("text-[10px] tabular-nums shrink-0 w-8", isOut ? "text-white/80" : "text-muted-foreground")}>
        {formatTime(isPlaying || currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  );
}

/**
 * Renders a video attachment via the media-proxy edge function.
 * WhatsApp's lookaside.fbsbx.com URLs are bearer-protected, so we fetch through
 * the proxy, create a blob URL, and hand it to a native <video> element.
 */
function VideoMessagePlayer({ message }: { message: Msg }) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const rawUrl: string | null =
    message.payload?.video?.link ||
    message.payload?.video?.url ||
    null;
  const isTemporary = typeof rawUrl === "string" && rawUrl.includes("lookaside.fbsbx.com");

  useEffect(() => {
    // If we have a permanent URL, use it directly
    if (rawUrl && !isTemporary) {
      setSrc(rawUrl);
      setLoading(false);
      setFailed(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;

    const load = async () => {
      setLoading(true);
      setFailed(false);
      setSrc(null);
      try {
        const proxyUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?messageId=${message.id}`;
        const response = await fetch(proxyUrl, {
          headers: await getFunctionHeaders(),
        });

        if (!response.ok) {
          if (!cancelled) { setFailed(true); setLoading(false); }
          return;
        }

        const contentType = response.headers.get("Content-Type") || "";
        if (contentType.includes("application/json")) {
          if (!cancelled) { setFailed(true); setLoading(false); }
          return;
        }

        const blob = await response.blob();
        const effectiveMime = response.headers.get("x-media-type") || blob.type || "video/mp4";
        const typedBlob = blob.type === effectiveMime
          ? blob
          : new Blob([await blob.arrayBuffer()], { type: effectiveMime });

        objectUrl = URL.createObjectURL(typedBlob);
        if (cancelled) { URL.revokeObjectURL(objectUrl); return; }
        setSrc(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [message.id, message.payload?.video?.id, message.payload?.video?.link, message.payload?.video?.url]);

  if (loading) {
    return (
      <div className="flex items-center justify-center bg-muted/40 rounded-lg" style={{ minHeight: 120, minWidth: 200 }}>
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div className="space-y-1">
        <div className="text-xs text-destructive">Video unavailable</div>
        {rawUrl && !isTemporary && (
          <a href={rawUrl} target="_blank" rel="noreferrer" className="text-xs underline underline-offset-2">
            Open video
          </a>
        )}
      </div>
    );
  }

  return (
    <video
      controls
      preload="metadata"
      src={src}
      className="rounded-lg max-w-full max-h-64 object-contain"
    />
  );
}

/**
 * Renders an image attachment by fetching it through the media-proxy edge function.
 * WhatsApp's lookaside.fbsbx.com URLs require a Bearer token, so we cannot use them
 * as <img src> directly — we proxy + blob URL instead.
 */
function MediaImage({ message, directUrl, alt = "attachment", className, onOpen }: { message: Msg; directUrl?: string | null; alt?: string; className?: string; onOpen?: (src: string) => void }) {
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
        const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/whatsapp-media-proxy?messageId=${message.id}`;
        const response = await fetch(url, {
          headers: await getFunctionHeaders(),
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

  return (
    <img
      src={src}
      alt={alt}
      className={cn(className, "cursor-zoom-in transition-opacity hover:opacity-90")}
      onClick={() => onOpen?.(src)}
    />
  );
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
    double: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  };
  return map[s] ?? "bg-muted text-muted-foreground border-border";
};

const deliveryStatusCls = (s: string) => {
  const map: Record<string, string> = {
    pending: "bg-muted text-muted-foreground border-border",
    booked: "bg-sky-500/15 text-sky-500 border-sky-500/25",
    printed: "bg-indigo-500/15 text-indigo-500 border-indigo-500/25",
    dispatched: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    shipped: "bg-blue-500/15 text-blue-500 border-blue-500/25",
    failed_attempt: "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
    delivered: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    ready_for_return: "bg-orange-500/15 text-orange-500 border-orange-500/25",
    return_received: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/25",
    return: "bg-rose-500/15 text-rose-500 border-rose-500/25",
    cancelled: "bg-rose-500/15 text-rose-500 border-rose-500/25",
  };
  return map[s] ?? "bg-muted text-muted-foreground border-border";
};

// Primary stage-pill metadata — shared by the top filter row and each
// conversation card's status badge, so colors/labels can't drift apart.
const STAGE_META: Record<
  "confirmation" | "shipped" | "out_for_delivery" | "failed_attempt",
  { label: string; icon: typeof CheckCircle2; activeCls: string; badgeCls: string }
> = {
  confirmation: {
    label: "Confirmation",
    icon: CheckCircle2,
    activeCls: "bg-blue-500 text-white border-blue-500 shadow-sm",
    badgeCls: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  },
  shipped: {
    label: "Order Shipped",
    icon: Truck,
    activeCls: "bg-purple-500 text-white border-purple-500 shadow-sm",
    badgeCls: "bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/25",
  },
  out_for_delivery: {
    label: "Out for Delivery",
    icon: Truck,
    activeCls: "bg-orange-500 text-white border-orange-500 shadow-sm",
    badgeCls: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/25",
  },
  failed_attempt: {
    label: "Failed Attempt",
    icon: AlertCircle,
    activeCls: "bg-red-500 text-white border-red-500 shadow-sm",
    badgeCls: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25",
  },
};

const shouldShowShippingStatus = (deliveryStatus?: string | null, shippingStatus?: string | null) => {
  if (!shippingStatus) return false;

  const delivery = (deliveryStatus || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  const shipping = shippingStatus.trim().toLowerCase().replace(/[\s-]+/g, "_");

  // Printed and dispatched are authoritative warehouse stages. Courier values at
  // this point are often the older create-order response (for example UnBooked).
  if (["printed", "dispatched"].includes(delivery)) return false;

  const deliveryHasProgressed = [
    "shipped",
    "in_transit",
    "with_courier",
    "out_for_delivery",
    "delivered",
    "paid",
    "failed_attempt",
    "ready_for_return",
    "return",
    "returned",
    "return_received",
  ].includes(delivery);

  if (deliveryHasProgressed && ["unbooked", "un_booked", "booked"].includes(shipping)) return false;
  return shipping !== delivery;
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

// Conversations that need follow-up attention — automated delivery-status
// messages tag the conversation "followup_<status>" (whatsapp-automation-
// runner), but only statuses that actually need staff follow-up show the
// "Follow Up" badge/filter here. "followup_shipped" is intentionally
// excluded: a shipped notification doesn't need any follow-up by itself,
// unlike e.g. "followup_failed_attempt" where the customer may need
// redelivery arranged.
function isFollowUpConv(c: { labels?: string[] | null }) {
  return (
    Array.isArray(c.labels) &&
    c.labels.some((l) => l.startsWith("followup_") && l !== "followup_shipped")
  );
}

// The Tags card reuses whatsapp_conversations.labels (already there for the
// automation builder's add_tag/remove_tag nodes and the followup_*/
// urgent_redelivery system markers) rather than adding a new column. A
// "tag" is any label that isn't one of those reserved, code-driven markers.
function isSystemLabel(label: string) {
  return label.startsWith("followup_") || label === "urgent_redelivery";
}
function visibleTags(labels?: string[] | null): string[] {
  return (Array.isArray(labels) ? labels : []).filter((l) => !isSystemLabel(l));
}

function dayLabel(d: Date) {
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "dd/MM/yyyy");
}

function getOrderItems(order: any) {
  const items = Array.isArray(order?.order_items) ? order.order_items : [];
  if (items.length > 0) return items;
  if (!order) return [];
  return [{
    id: undefined,
    product_id: order.product_id || null,
    product_variant_id: order.product_variant_id || null,
    sku: order.sku || null,
    product_name: order.product_name,
    quantity: order.quantity,
    unit_price: order.price,
    total_price: Number(order.quantity || 1) * Number(order.price || 0),
  }];
}

function buildOrderItemDrafts(order: any): OrderItemDraft[] {
  return getOrderItems(order).map((item: any) => ({
    id: item.id,
    product_id: item.product_id || null,
    product_variant_id: item.product_variant_id || null,
    sku: item.sku || null,
    product_name: item.product_name || item.sku || "Product",
    variant_name: item.variant_name || null,
    quantity: String(Number(item.quantity || 1)),
    unit_price: String(Number(item.unit_price || 0)),
  }));
}

export default function WhatsappInbox() {
  const { authUser, hasPermission } = useAuth();
  const isAdmin = authUser?.role === "admin";
  const WHATSAPP_ALLOWED_EMAILS = ["eshaehsan@gmail.com"];
  const hasWhatsappAccess = isAdmin || authUser?.role === "whatsapp_manager" || authUser?.role === "general_manager" || hasPermission("access_to_whatsapp_inbox") || WHATSAPP_ALLOWED_EMAILS.includes(authUser?.email ?? "");

  const qc = useQueryClient();
  const navigate = useNavigate();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [dbSearchResults, setDbSearchResults] = useState<Conv[]>([]);
  const [dbSearching, setDbSearching] = useState(false);
  // Two independent, combinable filter dimensions: `stageFilter` narrows by
  // the order's operational stage (linked order's confirmation/delivery
  // status), `refineFilter` narrows further within that (e.g. AI On). Both
  // apply together (AND). `refineFilter` (plus Old Conversations) lives
  // behind the "advanced filter" popover, not the top-level pill row.
  const [stageFilter, setStageFilter] = useState<
    "all" | "confirmation" | "shipped" | "out_for_delivery" | "failed_attempt"
  >("all");
  const [refineFilter, setRefineFilter] = useState<
    "none" | "unread" | "needs_review" | "follow_up" | "ai_on" | "ai_off" | "with_order" | "no_order" | "window_open"
  >("none");
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);
  // Separate from stage/refine (which only narrow within the current set):
  // legacy conversations are from the WhatsApp number active before Meta
  // disabled the account — hidden from the main inbox by default so it stays
  // focused on the new number, one button away when the old history is needed.
  const [showLegacy, setShowLegacy] = useState(false);
  // Right-hand Customer/Order panel: persistent column on desktop, a Sheet
  // (drawer) on medium screens and mobile, opened via a header button.
  const [rightPanelOpen, setRightPanelOpen] = useState(false);
  const [markingAllRead, setMarkingAllRead] = useState(false);
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [sending, setSending] = useState(false);
  const [tplOpen, setTplOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const [orderInfoOpen, setOrderInfoOpen] = useState(false);
  // Valid carrier cities are used to flag a wrong/unrecognized order city in red.
  const { data: carrierCities = [], isLoading: carrierCitiesLoading } = useCarrierCities();
  const validCityKeys = useMemo(
    () => new Set(carrierCities.map((c) => (c.city_name || "").trim().toLowerCase().replace(/\s+/g, ""))),
    [carrierCities],
  );
  const isCityInvalid = (city?: string | null) => {
    if (!city || carrierCitiesLoading || validCityKeys.size === 0) return false;
    return !validCityKeys.has(city.trim().toLowerCase().replace(/\s+/g, ""));
  };
  const [editConfStatus, setEditConfStatus] = useState("");
  const [editDelStatus, setEditDelStatus] = useState("");
  const [editCancelReason, setEditCancelReason] = useState("");
  const [editCancelNote, setEditCancelNote] = useState("");
  const [editingAddress, setEditingAddress] = useState(false);
  const [addressDraft, setAddressDraft] = useState("");
  const [savingAddress, setSavingAddress] = useState(false);
  const [editingCity, setEditingCity] = useState(false);
  const [cityDraft, setCityDraft] = useState("");
  const [savingCity, setSavingCity] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [savingName, setSavingName] = useState(false);
  const [editingPricing, setEditingPricing] = useState(false);
  const [itemDrafts, setItemDrafts] = useState<OrderItemDraft[]>([]);
  const [savingPricing, setSavingPricing] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [resolving, setResolving] = useState(false);
  // Per-message English translations (internal only)
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  const { data: convos = [], isLoading } = useQuery<Conv[]>({
    queryKey: ["wts-convos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data ?? []) as Conv[];
    },
  });

  const { data: lastMessages = [] } = useQuery<LastMessage[]>({
    queryKey: ["wts-last-messages"],
    queryFn: async () => {
      const PAGE = 1000;
      const rows: LastMessage[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase.rpc("get_conversation_last_messages").range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as LastMessage[];
        rows.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
    refetchInterval: 30_000,
  });
  const lastMessageByConv = useMemo(
    () => new Map(lastMessages.map((m) => [m.conversation_id, m])),
    [lastMessages],
  );

  // Operational stage for the primary filter pills (Confirmation/Order
  // Shipped/Out for Delivery/Failed Attempt) lives on the linked ORDER, not
  // on the conversation — so every visible row needs its order's status,
  // not just the one currently open. One broad, narrow-column fetch (same
  // shape/pattern as lastMessages above), refreshed periodically.
  const { data: orderStatuses = [] } = useQuery<
    { order_id: string; confirmation_status: string | null; delivery_status: string | null }[]
  >({
    queryKey: ["wts-order-statuses"],
    queryFn: async () => {
      const PAGE = 1000;
      const rows: { order_id: string; confirmation_status: string | null; delivery_status: string | null }[] = [];
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("orders")
          .select("order_id, confirmation_status, delivery_status")
          .not("order_id", "is", null)
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const page = (data ?? []) as typeof rows;
        rows.push(...page);
        if (page.length < PAGE) break;
        from += PAGE;
      }
      return rows;
    },
    refetchInterval: 30_000,
  });
  const orderStatusByOrderId = useMemo(
    () => new Map(orderStatuses.map((o) => [o.order_id, o])),
    [orderStatuses],
  );
  // "Confirmation" = still undecided; the other three are delivery-pipeline
  // stages further along. A conversation with no linked order never matches
  // any of these — it only shows under "All". Verified live against real
  // delivery_status values: this app has no literal "out_for_delivery"
  // value — "with_courier" is what it actually uses for that stage.
  function orderStage(orderId: string | null): "confirmation" | "shipped" | "out_for_delivery" | "failed_attempt" | null {
    if (!orderId) return null;
    const o = orderStatusByOrderId.get(orderId);
    if (!o) return null;
    if (o.delivery_status === "failed_attempt") return "failed_attempt";
    if (o.delivery_status === "with_courier") return "out_for_delivery";
    if (o.delivery_status === "shipped") return "shipped";
    if (!["confirmed", "cancelled"].includes(o.confirmation_status || "")) return "confirmation";
    return null;
  }

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

  // Per-conversation unread indicator.
  // Primary: uses last_inbound_at (set by webhook on every customer message).
  // Fallback: when last_inbound_at is NULL (webhook not yet deployed for this
  //   conv), falls back to last_message_at as a proxy. This may produce minor
  //   false-positives on outbound-only convos but is far better than missing
  //   real unread indicators. Once the webhook is deployed, all convos get
  //   last_inbound_at and the fallback becomes a no-op.
  // Both paths compare against last_read_at (set when the user opens a thread).
  const unreadMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const c of convos) {
      const readTs = c.last_read_at ? new Date(c.last_read_at).getTime() : 0;
      const activityTs = c.last_inbound_at
        ? new Date(c.last_inbound_at).getTime()
        : c.last_message_at
        ? new Date(c.last_message_at).getTime()
        : 0;
      if (activityTs > readTs) {
        map[c.id] = 1;
      }
    }
    return map;
  }, [convos]);

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

  // For rendering a WhatsApp-style quoted-reply preview: when a customer
  // swipes-to-reply on their phone, Meta includes `context.id` (the replied-
  // to message's meta_message_id) in the raw payload we already store
  // verbatim on insert (whatsapp-webhook stores `payload: m`). Purely a
  // lookup against what's already loaded — no new data/backend needed.
  const messageByMetaId = useMemo(() => {
    const map = new Map<string, Msg>();
    for (const m of messages) {
      if (m.meta_message_id) map.set(m.meta_message_id, m);
    }
    return map;
  }, [messages]);
  function quotedMessageFor(m: Msg): Msg | null {
    const quotedId = m.payload?.context?.id as string | undefined;
    if (!quotedId) return null;
    return messageByMetaId.get(quotedId) || null;
  }
  function quotedPreviewText(m: Msg): string {
    if (m.message_type === "template") return "Template message";
    const body = (m.body || "").trim();
    if (body && !body.startsWith("{")) return body.slice(0, 80);
    return `[${m.message_type}]`;
  }

  // Right-panel Notes card — reuses the already-loaded message stream
  // (notes are message_type='note' rows) instead of a separate query.
  const conversationNotes = useMemo(
    () => messages.filter((m) => m.message_type === "note").slice(-3).reverse(),
    [messages],
  );

  const conv = useMemo(() => convos.find((c) => c.id === selected) || null, [convos, selected]);

  const { data: order } = useQuery({
    queryKey: ["wts-order", conv?.order_id],
    queryFn: async () => {
      if (!conv?.order_id) return null;
      const { data } = await supabase
        .from("orders")
        .select("*, order_items(id, product_id, product_variant_id, sku, product_name, variant_name, quantity, unit_price, total_price, weight_kg, created_at), shipments(id, tracking_number, carrier_status, normalized_status, created_at, carriers(name))")
        .eq("order_id", conv.order_id)
        .maybeSingle();
      return data;
    },
    enabled: !!conv?.order_id,
  });

  const latestShipment = useMemo(() => {
    const shipments = Array.isArray((order as any)?.shipments) ? (order as any).shipments : [];
    if (shipments.length === 0) return null;
    return [...shipments].sort((a: any, b: any) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    )[0];
  }, [order]);

  const { data: followUpAgent } = useQuery({
    queryKey: ["wts-followup-agent", (order as any)?.follow_up_assigned_to],
    queryFn: async () => {
      const assignedTo = (order as any)?.follow_up_assigned_to;
      if (!assignedTo) return null;
      const { data } = await supabase
        .from("profiles")
        .select("name, phone")
        .eq("user_id", assignedTo)
        .maybeSingle();
      return data;
    },
    enabled: !!(order as any)?.follow_up_assigned_to,
  });

  const { data: duplicateMatches = [] } = useQuery<DuplicateOrderWarning[]>({
    queryKey: ["wts-order-duplicates", order?.id, order?.customer_phone],
    queryFn: async () => {
      if (!order?.id || !order.customer_phone) return [];
      const currentNames = new Set(
        [
          order.product_name,
          ...getOrderItems(order).map((item: any) => item.product_name),
        ]
          .filter(Boolean)
          .map((name: string) => name.trim().toLowerCase()),
      );
      if (currentNames.size === 0) return [];

      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, confirmation_status, delivery_status, product_name, customer_city, created_at, order_items(product_name)")
        .in("customer_phone", phoneVariants(order.customer_phone))
        .neq("id", order.id)
        .order("created_at", { ascending: false })
        .limit(10);
      if (error) throw error;

      return ((data ?? []) as DuplicateOrderWarning[]).filter((candidate) => {
        const candidateNames = [
          candidate.product_name,
          ...(candidate.order_items || []).map((item) => item.product_name),
        ]
          .filter(Boolean)
          .map((name: string) => name.trim().toLowerCase());
        return candidateNames.some((name) => currentNames.has(name));
      });
    },
    enabled: !!order?.id && !!order?.customer_phone,
  });

  // Right-panel "Customer Info" stats (customer since / total / delivered).
  // No aggregate RPC exists for this — a plain client-side query on `orders`
  // by phone, same access pattern this file already uses for the duplicate-
  // order check above, fired only for the open conversation (not per row).
  const { data: customerStats } = useQuery({
    queryKey: ["wts-customer-stats", conv?.customer_phone],
    queryFn: async () => {
      if (!conv?.customer_phone) return null;
      const { data, error } = await supabase
        .from("orders")
        .select("delivery_status, created_at")
        .in("customer_phone", phoneVariants(conv.customer_phone));
      if (error) throw error;
      const rows = data ?? [];
      const total = rows.length;
      const delivered = rows.filter((r) => r.delivery_status === "delivered").length;
      const firstOrderAt = rows.reduce<string | null>(
        (min, r) => (!min || r.created_at < min ? r.created_at : min),
        null,
      );
      return { total, delivered, firstOrderAt };
    },
    enabled: !!conv?.customer_phone,
  });

  // Right-panel "Recent Orders" card — this customer's most recent orders
  // (the linked one plus a couple more), reusing the same phone-matching as
  // the duplicate check above rather than the product-name-scoped query.
  const { data: recentOrders = [] } = useQuery<RecentOrderRow[]>({
    queryKey: ["wts-recent-orders", conv?.customer_phone],
    queryFn: async () => {
      if (!conv?.customer_phone) return [];
      const { data, error } = await supabase
        .from("orders")
        .select("id, order_id, product_name, quantity, price, total_amount, confirmation_status, delivery_status, created_at, order_items(product_name, product_id)")
        .in("customer_phone", phoneVariants(conv.customer_phone))
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!conv?.customer_phone,
  });

  // Best-effort product thumbnail for the Recent Orders card — only orders
  // whose order_items carry a product_id can resolve one; others fall back
  // to a generic package icon (product_id isn't guaranteed set on every order).
  const recentOrderProductIds = useMemo(() => {
    const ids = new Set<string>();
    for (const o of recentOrders) {
      for (const item of getOrderItems(o)) {
        if (item.product_id) ids.add(item.product_id);
      }
    }
    return Array.from(ids);
  }, [recentOrders]);
  const { data: recentOrderProductImages = [] } = useQuery<{ id: string; image_url: string | null }[]>({
    queryKey: ["wts-recent-order-product-images", recentOrderProductIds.join(",")],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("id, image_url")
        .in("id", recentOrderProductIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: recentOrderProductIds.length > 0,
  });
  const productImageById = useMemo(
    () => new Map(recentOrderProductImages.map((p) => [p.id, p.image_url])),
    [recentOrderProductImages],
  );

  const selectedConfirmationStatus = editConfStatus || order?.confirmation_status || "new";
  const selectedDeliveryStatus = editDelStatus || order?.delivery_status || "pending";
  const hasDuplicateWarning = duplicateMatches.length > 0;
  const cancelReasonValue = editCancelReason === "other" ? editCancelNote.trim() : editCancelReason;
  const statusHasChanges = !!order && (
    selectedConfirmationStatus !== (order.confirmation_status || "new") ||
    selectedDeliveryStatus !== (order.delivery_status || "pending")
  );
  const cancelReasonHasChanges = !!order &&
    selectedConfirmationStatus === "cancelled" &&
    cancelReasonValue !== (order.cancel_reason || "");
  const needsCancelReason = selectedConfirmationStatus === "cancelled";
  const canUpdateOrderStatus = (statusHasChanges || cancelReasonHasChanges) && (!needsCancelReason || !!cancelReasonValue);

  const { data: productOptions = [] } = useQuery<ProductOption[]>({
    queryKey: ["wts-product-options", order?.seller_id],
    queryFn: async () => {
      if (!order?.seller_id) return [];

      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, sku, price")
        .eq("seller_id", order.seller_id)
        .eq("active", true)
        .order("name", { ascending: true });
      if (productsError) throw productsError;

      const productIds = (products || []).map((p: any) => p.id);
      const { data: variants, error: variantsError } = productIds.length
        ? await supabase
            .from("product_variants")
            .select("id, product_id, sku, name, price")
            .in("product_id", productIds)
            .eq("active", true)
            .order("name", { ascending: true })
        : { data: [], error: null };
      if (variantsError) throw variantsError;

      const variantsByProduct = new Map<string, any[]>();
      for (const variant of variants || []) {
        const list = variantsByProduct.get(variant.product_id) || [];
        list.push(variant);
        variantsByProduct.set(variant.product_id, list);
      }

      return (products || []).flatMap((product: any) => {
        const productVariants = variantsByProduct.get(product.id) || [];
        if (productVariants.length === 0) {
          return [{
            key: `product:${product.id}`,
            productId: product.id,
            variantId: null,
            name: product.name,
            sku: product.sku || null,
            variantName: null,
            price: Number(product.price || 0),
          }];
        }

        return productVariants.map((variant) => ({
          key: `variant:${variant.id}`,
          productId: product.id,
          variantId: variant.id,
          name: productVariants.length > 1 && variant.name ? `${product.name} - ${variant.name}` : product.name,
          sku: variant.sku || product.sku || null,
          variantName: variant.name || null,
          price: Number(variant.price || product.price || 0),
        }));
      });
    },
    enabled: !!order?.seller_id && orderInfoOpen,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    if (orderInfoOpen && order && !editingPricing) {
      setItemDrafts(buildOrderItemDrafts(order));
    }
  }, [orderInfoOpen, order, editingPricing]);

  const productKeyForDraft = (draft: OrderItemDraft, index: number) => {
    if (draft.product_variant_id) return `variant:${draft.product_variant_id}`;
    if (draft.product_id) return `product:${draft.product_id}`;
    return `current:${index}`;
  };

  const applyProductOption = (index: number, key: string) => {
    const option = productOptions.find((p) => p.key === key);
    if (!option) return;
    setItemDrafts((prev) => prev.map((item, i) => (
      i === index
        ? {
            ...item,
            product_id: option.productId,
            product_variant_id: option.variantId,
            sku: option.sku,
            product_name: option.name,
            variant_name: option.variantName,
            unit_price: String(option.price),
          }
        : item
    )));
  };

  const addProductDraft = () => {
    const first = productOptions[0];
    setItemDrafts((prev) => [
      ...prev,
      first
        ? {
            product_id: first.productId,
            product_variant_id: first.variantId,
            sku: first.sku,
            product_name: first.name,
            variant_name: first.variantName,
            quantity: "1",
            unit_price: String(first.price),
          }
        : {
            product_id: null,
            product_variant_id: null,
            sku: null,
            product_name: "",
            variant_name: null,
            quantity: "1",
            unit_price: "0",
          },
    ]);
  };

  const removeProductDraft = (index: number) => {
    if (itemDrafts.length <= 1) {
      toast.error("Order must have at least one product");
      return;
    }
    setItemDrafts((prev) => prev.filter((_, i) => i !== index));
  };

  const itemDraftTotal = itemDrafts.reduce((sum, item) => {
    return sum + Math.max(1, Math.trunc(Number(item.quantity || 1))) * Math.max(0, Number(item.unit_price || 0));
  }, 0);

  const saveProductItems = async () => {
    if (!order?.id) return;
    const normalized = itemDrafts.map((item) => ({
      ...item,
      product_name: (item.product_name || "").trim(),
      quantity: Math.max(1, Math.trunc(Number(item.quantity))),
      unit_price: Number(item.unit_price),
    }));

    if (normalized.some((item) => !item.product_name)) {
      toast.error("Product name is required");
      return;
    }
    if (normalized.some((item) => !Number.isFinite(item.quantity) || item.quantity < 1 || !Number.isFinite(item.unit_price) || item.unit_price < 0)) {
      toast.error("Enter valid quantity and price for every product");
      return;
    }

    setSavingPricing(true);
    try {
      const existingIds = new Set((Array.isArray(order.order_items) ? order.order_items : []).map((item: any) => item.id).filter(Boolean));
      const keptIds = new Set(normalized.map((item) => item.id).filter(Boolean));
      const removedIds = [...existingIds].filter((id) => !keptIds.has(id));

      if (removedIds.length > 0) {
        const { error } = await supabase.from("order_items" as any).delete().in("id", removedIds);
        if (error) throw error;
      }

      for (const item of normalized) {
        const payload = {
          product_id: item.product_id || null,
          product_variant_id: item.product_variant_id || null,
          sku: item.sku || null,
          product_name: item.product_name,
          variant_name: item.variant_name || null,
          quantity: item.quantity,
          unit_price: item.unit_price,
        };

        if (item.id) {
          const { error } = await supabase.from("order_items" as any).update(payload).eq("id", item.id);
          if (error) throw error;
        } else {
          const { error } = await supabase.from("order_items" as any).insert({ ...payload, order_id: order.id });
          if (error) throw error;
        }
      }

      const main = normalized[0];
      const totalQuantity = normalized.reduce((sum, item) => sum + item.quantity, 0);
      const totalAmount = normalized.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
      const { error: orderError } = await supabase
        .from("orders")
        .update({
          product_name: main.product_name,
          quantity: totalQuantity,
          price: main.unit_price,
          total_amount: totalAmount,
          is_manual_price: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", order.id);
      if (orderError) throw orderError;

      if (authUser?.id) {
        await supabase.from("order_history").insert({
          order_id: order.order_id,
          changed_by: authUser.id,
          changed_by_role: isAdmin ? "admin" : "agent",
          field_changed: "order_items",
          old_value: JSON.stringify(getOrderItems(order).map((item: any) => ({
            name: item.product_name,
            qty: item.quantity,
            price: item.unit_price,
          }))),
          new_value: JSON.stringify(normalized.map((item) => ({
            name: item.product_name,
            qty: item.quantity,
            price: item.unit_price,
          }))),
          action_type: "order_items_update",
        } as any);
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["wts-order", order.order_id] }),
        qc.invalidateQueries({ queryKey: ["wts-convos"] }),
        qc.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      toast.success("Products updated");
      setEditingPricing(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to update products");
    } finally {
      setSavingPricing(false);
    }
  };

  // The name shown here is whatsapp_conversations.customer_name, but the
  // linked order (elsewhere in the app — Orders list, analytics, dashboards)
  // reads orders.customer_name independently. Update both together so a
  // typo fix here doesn't leave the customer showing under two different
  // names depending on which screen you look at.
  const saveCustomerName = async () => {
    const trimmed = nameDraft.trim();
    if (!trimmed || !conv?.id) return;
    setSavingName(true);
    try {
      const { error: convError } = await supabase
        .from("whatsapp_conversations")
        .update({ customer_name: trimmed })
        .eq("id", conv.id);
      if (convError) throw convError;

      if (order?.order_id) {
        const { error: orderError } = await supabase
          .from("orders")
          .update({ customer_name: trimmed, updated_at: new Date().toISOString() })
          .eq("order_id", order.order_id);
        if (orderError) throw orderError;
      }

      await Promise.all([
        qc.invalidateQueries({ queryKey: ["wts-order", conv.order_id] }),
        qc.invalidateQueries({ queryKey: ["wts-convos"] }),
        qc.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      toast.success("Customer name updated");
      setEditingName(false);
    } catch (error: any) {
      toast.error(error.message || "Failed to update customer name");
    } finally {
      setSavingName(false);
    }
  };

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

  // Strict check: outbound (AI) messages only translated if they contain actual
  // non-Latin script (Urdu/Arabic). Roman-Urdu hints are NOT enough for outbound
  // to avoid false positives on English AI replies like "Your order is confirmed".
  const containsNonLatin = (text: string) =>
    /[؀-ۿऀ-ॿঀ-৿一-鿿ݐ-ݿﭐ-﷿ﹰ-﻿]/.test(text);

  // Auto-translate non-English messages (inbound + outbound AI) — staff-only, never sent to customer
  const autoTranslatedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!messages.length) return;
    const MEDIA_TYPES = ["image", "video", "audio", "voice", "document", "sticker", "location"];
    const toTranslate = messages.filter((m) => {
      if (!m.body) return false;
      if (MEDIA_TYPES.includes(m.message_type)) return false; // never translate media payloads
      if (m.body.trimStart().startsWith("{")) return false;   // skip raw JSON fallback bodies
      if (translations[m.id]) return false;
      if ((m.payload as any)?._translation_en) return false;
      if (autoTranslatedRef.current.has(m.id)) return false;
      // Both directions: non-Latin script OR Roman Urdu hints → auto-translate
      if (!containsNonLatin(m.body) && !needsTranslation(m.body)) return false;
      return true;
    });
    if (!toTranslate.length) return;
    toTranslate.forEach((m) => {
      autoTranslatedRef.current.add(m.id);
      void (async () => {
        try {
          const data = await invokeProtectedFunction<{ ok: boolean; translation?: string }>("whatsapp-translate", {
            message_id: m.id,
            text: m.body,
          });
          if (!data?.ok || !data.translation) return;
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
  // Invalidate wts-convos so the updated last_read_at is reflected immediately
  // in the unreadMap (which is now computed from conv fields, not a separate query).
  useEffect(() => {
    if (!selected) return;
    void supabase
      .from("whatsapp_conversations")
      .update({ last_read_at: new Date().toISOString() })
      .eq("id", selected)
      .then(() => {
        qc.invalidateQueries({ queryKey: ["wts-convos"] });
      });
  }, [selected, qc]);

  const filteredConvos = useMemo(() => {
    let list = convos.filter((c) => !!c.is_legacy === showLegacy);
    if (search.trim()) {
      if (isOrderIdSearch(search)) {
        list = list.filter((c) => exactOrderIdMatch(c.order_id, search));
      } else {
        const q = search.toLowerCase();
        list = list.filter(
          (c) =>
            (c.customer_name || "").toLowerCase().includes(q) ||
            c.customer_phone.toLowerCase().includes(q) ||
            (c.order_id || "").toLowerCase().includes(q),
        );
      }
    }
    if (stageFilter !== "all") {
      list = list.filter((c) => orderStage(c.order_id) === stageFilter);
    }
    if (refineFilter === "unread") {
      list = list.filter((c) => (unreadMap[c.id] ?? 0) > 0);
    } else if (refineFilter === "needs_review") {
      list = list.filter((c) => c.status === "manual_review_needed");
    } else if (refineFilter === "follow_up") {
      list = list.filter((c) => isFollowUpConv(c));
    } else if (refineFilter === "ai_on") {
      list = list.filter((c) => c.ai_enabled !== false);
    } else if (refineFilter === "ai_off") {
      list = list.filter((c) => c.ai_enabled === false);
    } else if (refineFilter === "with_order") {
      list = list.filter((c) => !!c.order_id);
    } else if (refineFilter === "no_order") {
      list = list.filter((c) => !c.order_id);
    } else if (refineFilter === "window_open") {
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
    // orderStage() closes over orderStatusByOrderId, which is already listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convos, search, stageFilter, refineFilter, sortDesc, unreadMap, showLegacy, orderStatusByOrderId]);

  // DB search: fires when search has text but local filteredConvos is empty
  useEffect(() => {
    const q = search.trim();
    if (!q || filteredConvos.length > 0) {
      setDbSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setDbSearching(true);
      try {
        let query = supabase
          .from("whatsapp_conversations")
          .select("*")
          .order("updated_at", { ascending: false });

        query = isOrderIdSearch(q)
          ? query.eq("order_id", normalizeOrderIdSearch(q))
          : query.or(`customer_name.ilike.%${q}%,customer_phone.ilike.%${q}%,order_id.ilike.%${q}%`);

        const { data } = await query
          .limit(50);
        setDbSearchResults((data ?? []) as Conv[]);
      } finally {
        setDbSearching(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [search, filteredConvos.length]);

  const displayedConvos = search.trim() && filteredConvos.length === 0 ? dbSearchResults : filteredConvos;

  // Render the list 50 at a time — a fully-rendered 1000-row list (avatars,
  // badges, hover states) is genuinely heavy on the DOM. "Load More" adds
  // another 50 instead of paying that cost up front.
  const [visibleCount, setVisibleCount] = useState(50);
  useEffect(() => {
    setVisibleCount(50);
  }, [search, stageFilter, refineFilter, showLegacy, sortDesc]);
  const visibleConvos = displayedConvos.slice(0, visibleCount);

  // Count CONVERSATIONS (contacts) with unread — not total unread messages.
  const totalUnread = useMemo(
    () => Object.values(unreadMap).filter((n) => (n ?? 0) > 0).length,
    [unreadMap],
  );

  const needsReviewCount = useMemo(
    () => convos.filter((c) => c.status === "manual_review_needed").length,
    [convos],
  );

  const followUpCount = useMemo(
    () => convos.filter(isFollowUpConv).length,
    [convos],
  );

  // Stage pill counts — computed off the same orderStage() used to filter,
  // so the badge numbers and the filtered list can never disagree.
  const stageCounts = useMemo(() => {
    const counts = { confirmation: 0, shipped: 0, out_for_delivery: 0, failed_attempt: 0 };
    for (const c of convos) {
      const stage = orderStage(c.order_id);
      if (stage) counts[stage]++;
    }
    return counts;
    // orderStage() closes over orderStatusByOrderId, which is already listed below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convos, orderStatusByOrderId]);
  const confirmationCount = stageCounts.confirmation;
  const shippedCount = stageCounts.shipped;
  const outForDeliveryCount = stageCounts.out_for_delivery;
  const failedAttemptCount = stageCounts.failed_attempt;

  const legacyCount = useMemo(() => convos.filter((c) => !!c.is_legacy).length, [convos]);

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
      qc.invalidateQueries({ queryKey: ["wts-convos"] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to mark as read");
    } finally {
      setMarkingAllRead(false);
    }
  };

  // The WhatsApp 24h customer-service window opens only when the CUSTOMER
  // sends a message (inbound). Outbound templates do not open this window.
  const lastInboundAt = useMemo(() => {
    const lastInboundMsg = [...messages]
      .reverse()
      .find((m) => m.direction === "in" || m.direction === "inbound");
    if (lastInboundMsg) return new Date(lastInboundMsg.created_at);
    return null;
  }, [messages]);

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
    const remainingLabels = (Array.isArray(conv.labels) ? conv.labels : []).filter(
      (l) => l !== "urgent_redelivery",
    );
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({
        status: "handled",
        review_note: note || null,
        resolved_by: u?.user?.id ?? null,
        resolved_at: new Date().toISOString(),
        labels: remainingLabels,
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

  const removeTag = async (tag: string) => {
    if (!selected || !conv) return;
    const current = Array.isArray(conv.labels) ? conv.labels : [];
    const { error } = await supabase
      .from("whatsapp_conversations")
      .update({ labels: current.filter((l) => l !== tag) })
      .eq("id", selected);
    if (error) {
      toast.error(error.message || "Failed to remove tag");
      return;
    }
    qc.invalidateQueries({ queryKey: ["wts-convos"] });
  };

  const [forcingAi, setForcingAi] = useState(false);
  const forceAiReply = async () => {
    if (!selected || !conv) return;
    setForcingAi(true);
    try {
      const { error } = await supabase.functions.invoke("whatsapp-webhook", {
        body: { force_reply: true, conversation_id: selected },
      });
      if (error) throw error;
      toast.success("AI is now replying…");
      qc.invalidateQueries({ queryKey: ["wts-convos"] });
      qc.invalidateQueries({ queryKey: ["wts-messages", selected] });
    } catch (e: any) {
      toast.error(e?.message || "Failed to trigger AI reply");
    } finally {
      setForcingAi(false);
    }
  };

  const [forcingAgent, setForcingAgent] = useState(false);
  const forceToAgent = async () => {
    if (!selected || !conv?.order_id) {
      toast.error("No order linked to this conversation");
      return;
    }
    if (!window.confirm(
      `Force order #${conv.order_id} to the agent queue?\n\n` +
      `• AI will stop replying\n` +
      `• Order returns to "new" status in the agent pool\n` +
      `• Any agent can claim and call the customer`,
    )) return;
    setForcingAgent(true);
    try {
      // 0) Re-check eligibility against a fresh read BEFORE touching
      // anything — not stale component state, since the button's disabled
      // state only reflects whatever was loaded when the page rendered.
      // Without this the order could have been claimed or decided by
      // someone else in the meantime (exactly what broke
      // AB-2014/AB-2019/AB-2023: an agent's claim, postpone, or even a
      // direct status edit getting silently wiped back to "new"). Checked
      // first, before disabling AI on the conversation below, so a
      // rejected force leaves no partial side effect.
      const { data: currentOrder, error: currentOrderErr } = await supabase
        .from("orders")
        .select("confirmation_status, agent_id")
        .eq("order_id", conv.order_id)
        .maybeSingle();
      if (currentOrderErr) throw currentOrderErr;

      if (
        currentOrder?.agent_id ||
        (currentOrder?.confirmation_status && !["new_wts", "new"].includes(currentOrder.confirmation_status))
      ) {
        toast.error(`Order #${conv.order_id} already went to a confirmation agent — refresh to see its current state`);
        setForcingAgent(false);
        return;
      }

      // 1) Stop AI on the conversation + flag channel as agent
      const { error: convErr } = await supabase
        .from("whatsapp_conversations")
        .update({ ai_enabled: false, status: "manual_review_needed" })
        .eq("id", selected);
      if (convErr) throw convErr;

      const previousConfirmationStatus = currentOrder?.confirmation_status || "new";
      const nextConfirmationStatus = previousConfirmationStatus === "no_answer" ? "no_answer" : "new";
      const previousAgentId = currentOrder?.agent_id || null;

      // 2) Reset order back into the agent queue without turning no_answer into new.
      const { error: ordErr } = await supabase
        .from("orders")
        .update({
          confirmation_channel: "agent",
          confirmation_status: nextConfirmationStatus,
          agent_id: null,
          assigned_at: null,
          postpone_date: null,
          whatsapp_status: "handed_to_agent",
          last_activity_at: null,
        })
        .eq("order_id", conv.order_id);
      if (ordErr) throw ordErr;

      if (authUser?.id) {
        const role = isAdmin ? "admin" : "agent";
        const histEntries: any[] = [];
        if (previousConfirmationStatus !== nextConfirmationStatus) {
          histEntries.push({
            order_id: conv.order_id,
            changed_by: authUser.id,
            changed_by_role: role,
            field_changed: "confirmation_status",
            old_value: previousConfirmationStatus,
            new_value: nextConfirmationStatus,
            action_type: "force_to_agent",
          });
        }
        if (previousAgentId) {
          histEntries.push({
            order_id: conv.order_id,
            changed_by: authUser.id,
            changed_by_role: role,
            field_changed: "agent_lock",
            old_value: previousAgentId,
            new_value: null,
            action_type: "force_to_agent",
          });
        }
        if (histEntries.length > 0) {
          await supabase.from("order_history").insert(histEntries);
        }
      }

      qc.invalidateQueries({ queryKey: ["wts-convos"] });
      qc.invalidateQueries({ queryKey: ["wts-order", conv.order_id] });
      toast.success(`Order #${conv.order_id} sent to agent queue`);
    } catch (e: any) {
      toast.error(e.message || "Failed to send to agent");
    } finally {
      setForcingAgent(false);
    }
  };

  // Detect if a message body likely needs English translation (internal staff only).
  const needsTranslation = (text: string | null | undefined): boolean => {
    if (!text) return false;
    const t = text.trim();
    if (t.length < 2) return false;
    // Non-Latin scripts (Arabic/Urdu/Hindi/Bengali/CJK) — always translate
    if (/[\u0600-\u06FF\u0900-\u097F\u0980-\u09FF\u4E00-\u9FFF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(t)) {
      return true;
    }
    // Roman Urdu / Hinglish hint words (broad coverage incl. Pakistani spellings).
    const romanHints = /\b(hai|hain|hay|ha|ho|hota|hoti|hote|hoga|hogi|hona|hua|hui|huwa|nahi|nhi|nai|na|nahin|kya|kyu|kyun|kyon|kyunki|kuch|kuchh|raha|rahi|rahe|rahu|rahun|karo|karna|karne|karke|karta|karti|karte|karu|kar|mujhe|mujhko|mera|meri|mere|main|mai|me|aap|apka|apki|apke|apko|tum|tumhara|tumhari|tujhe|tu|bhai|behan|theek|thik|teek|acha|achha|achhi|achhe|abhi|chahiye|chye|chahye|paisa|paise|qeemat|keemat|qimat|bhej|bhejna|bhejdo|bhejen|bhejenge|bejna|bejdo|plz|plzz|haan|han|jee|ji|bilkul|bilkl|sahi|sai|ghalat|samjh|samajh|samjha|samjhi|matlab|kaisa|kaise|kese|kahan|kahaan|jab|tab|magar|lekin|liye|wala|wali|wale|mein|hum|hamara|hamari|hamare|pouch|pucha|baat|kaam|kam|jo|wo|woh|yeh|ye|iska|uska|iss|uss|phir|fir|sirf|zyada|kam|thoda|bohot|bhot|order|item|items|deliver|delivery|address|parsal|parcel|courier|cod|cash|product|wai|wesa|aisa|jaisa|saath|sath|agar|toh|to|chalo|chalega|chalti|dekh|dekho|dekha|sun|suno|suna|bol|bolo|bola|de|do|do|dena|liya|lena|loga|lega|legi|lenge|aaya|aayi|aaye|aye|gya|gyi|gye|gaya|gayi|gaye|milta|milti|milte|mil|mila|mili|paas|saamne|piche|peeche|aage|jaldi|jaldee|der|abhi|baad|pehle|pehlay|pahle|kal|aaj|kal|kalam|sahab|sahib|saheb|saab|janab|hazoor|huzoor|inshallah|mashallah|alhamdulillah|jazak|shukria|shukriya|meherbani|meharbani)\b/i;
    if (romanHints.test(t)) return true;
    // Heuristic: very few common English words → likely non-English Latin script.
    const englishCommon = /\b(the|and|or|is|are|was|were|will|would|could|should|have|has|had|this|that|these|those|with|from|your|you|i|we|they|he|she|it|but|not|for|on|in|of|to|a|an|be|been|being|do|does|did|done|please|thanks|thank|hello|hi|hey|ok|okay|yes|no|order|delivery|payment|address|product|name|phone|number|when|where|why|how|what|who|which)\b/gi;
    const words = t.match(/\b[a-zA-Z]{2,}\b/g) || [];
    if (words.length >= 3) {
      const englishMatches = (t.match(englishCommon) || []).length;
      const ratio = englishMatches / words.length;
      if (ratio < 0.25) return true; // mostly non-English Latin words
    }
    return false;
  };

  const handleTranslate = async (m: Msg) => {
    if (!m.body || translations[m.id]) return;
    setTranslatingId(m.id);
    try {
      const data = await invokeProtectedFunction<{ ok: boolean; translation?: string; error?: string }>("whatsapp-translate", {
        message_id: m.id,
        text: m.body,
      });
      if (!data?.ok || !data.translation) throw new Error(data?.error || "Translation failed");
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

  if (!hasWhatsappAccess) return <Navigate to="/" replace />;

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

  // Drives the Quick Actions "Force to Agent" button's label/disabled state —
  // same eligibility rule the header button used to enforce.
  const forceToAgentState: "available" | "already_agent" | "sent_to_agent" | "no_order" =
    !conv?.order_id
      ? "no_order"
      : order?.agent_id || (order?.confirmation_status && !["new_wts", "new"].includes(order.confirmation_status))
      ? "already_agent"
      : order?.whatsapp_status === "handed_to_agent"
      ? "sent_to_agent"
      : "available";

  const quickActionBtnCls = "flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-xs font-medium text-foreground hover:bg-muted/60 transition-colors disabled:opacity-50 disabled:cursor-not-allowed";

  // Right-hand Customer/Order panel content — rendered both as a persistent
  // column (lg+) and inside a Sheet (below lg), so it's built once here.
  const rightPanelBody = !conv ? (
    <div className="p-6 text-sm text-muted-foreground">Select a conversation to see customer & order details.</div>
  ) : (
    <div className="p-4 space-y-4">
      {/* Customer Info */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Customer Info</div>
          <button
            type="button"
            onClick={() => setOrderInfoOpen(true)}
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            <Pencil className="h-3 w-3" /> Edit
          </button>
        </div>
        <div className="flex items-center gap-3 mb-3">
          <div
            className={cn(
              "h-11 w-11 rounded-full grid place-items-center text-sm font-semibold shrink-0",
              colorFor(conv.customer_phone),
            )}
          >
            {initials(conv.customer_name, conv.customer_phone)}
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-sm truncate">{conv.customer_name || conv.customer_phone}</div>
            <div className="text-xs text-muted-foreground">{conv.customer_phone}</div>
          </div>
        </div>
        {order?.customer_city && (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
            <MapPin className="h-3 w-3 shrink-0" />
            {order.customer_city}
          </div>
        )}
        <div className="grid grid-cols-3 gap-2 pt-3 border-t border-border/60">
          <div>
            <div className="text-[10px] text-muted-foreground">Customer since</div>
            <div className="text-xs font-semibold mt-0.5">
              {customerStats?.firstOrderAt ? format(new Date(customerStats.firstOrderAt), "MMM yyyy") : "—"}
            </div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Total Orders</div>
            <div className="text-xs font-semibold mt-0.5">{customerStats ? customerStats.total : "—"}</div>
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground">Delivered</div>
            <div className="text-xs font-semibold mt-0.5">{customerStats ? customerStats.delivered : "—"}</div>
          </div>
        </div>
      </div>

      {/* Recent Orders */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent Orders</div>
          <button
            type="button"
            onClick={() => navigate(`/orders?search=${encodeURIComponent(conv.customer_phone)}`)}
            className="text-xs font-medium text-primary hover:underline"
          >
            View All
          </button>
        </div>
        {recentOrders.length === 0 ? (
          <div className="text-xs text-muted-foreground py-1">No orders yet.</div>
        ) : (
          <div className="space-y-2">
            {recentOrders.slice(0, 3).map((o) => {
              const items = getOrderItems(o);
              const firstItem = items[0];
              const img = firstItem?.product_id ? productImageById.get(firstItem.product_id) : null;
              const total = o.total_amount ?? (Number(o.price || 0) * Number(o.quantity || 1));
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => window.open(`/orders/${o.order_id}`, "_blank")}
                  className="w-full flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/60 p-2 text-left hover:bg-muted/50 transition-colors"
                >
                  {img ? (
                    <img src={img} alt="" className="h-10 w-10 rounded-md object-cover shrink-0 border border-border" />
                  ) : (
                    <div className="h-10 w-10 rounded-md bg-muted grid place-items-center shrink-0">
                      <Package className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-xs font-semibold">#{o.order_id}</span>
                      {o.confirmation_status && (
                        <span className={cn("text-[9px] px-1.5 py-px rounded-full border capitalize", confirmationStatusCls(o.confirmation_status))}>
                          {o.confirmation_status.replace(/_/g, " ")}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {firstItem?.product_name || o.product_name}
                    </div>
                    <div className="text-[11px] font-medium mt-0.5">
                      Rs {Number(total).toLocaleString()} · {format(new Date(o.created_at), "d MMM yyyy")}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Quick Actions</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setResolveOpen(true)}
            disabled={conv.status !== "manual_review_needed"}
            className={quickActionBtnCls}
          >
            <CheckCircle2 className="h-4 w-4" />
            Mark as Resolved
          </button>
          <button type="button" onClick={() => setTab("note")} className={quickActionBtnCls}>
            <StickyNote className="h-4 w-4" />
            Add Note
          </button>
          <button
            type="button"
            onClick={forceToAgent}
            disabled={forcingAgent || forceToAgentState !== "available"}
            title={
              forceToAgentState === "already_agent" ? "Already with an agent"
                : forceToAgentState === "sent_to_agent" ? "Already sent to the agent queue"
                : forceToAgentState === "no_order" ? "No order linked to this conversation"
                : "Stop AI and send this order to the agent queue"
            }
            className={quickActionBtnCls}
          >
            {forcingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {forceToAgentState === "already_agent" ? "Already with Agent"
              : forceToAgentState === "sent_to_agent" ? "Sent to Agent"
              : "Force to Agent"}
          </button>
          <button type="button" onClick={() => setTplOpen(true)} className={quickActionBtnCls}>
            <FileText className="h-4 w-4" />
            Send Template
          </button>
        </div>
      </div>

      {/* Notes */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Notes</div>
          <button
            type="button"
            onClick={() => setTab("note")}
            className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
          >
            <Plus className="h-3 w-3" /> Add Note
          </button>
        </div>
        {conversationNotes.length === 0 ? (
          <div className="text-xs text-muted-foreground py-1">No notes yet.</div>
        ) : (
          <div className="space-y-2.5">
            {conversationNotes.map((n) => (
              <div key={n.id} className="text-xs">
                <div className="whitespace-pre-wrap text-foreground/90">{n.body}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {format(new Date(n.created_at), "d MMM yyyy, HH:mm")}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Tags */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-3">Tags</div>
        <div className="flex flex-wrap gap-1.5 mb-2.5">
          {visibleTags(conv.labels).length === 0 && (
            <div className="text-xs text-muted-foreground">No tags yet.</div>
          )}
          {visibleTags(conv.labels).map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/25 px-2 py-1 text-[11px] font-medium"
            >
              {tag}
              <button type="button" onClick={() => removeTag(tag)} className="hover:text-rose-500" title="Remove tag">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Primary operational filter pills — hidden on mobile when a conversation is
          open. Order-status-based (Confirmation/Order Shipped/Out for Delivery/
          Failed Attempt), each with its own color, an icon, and a count badge.
          Everything else that used to live here (Unread/Needs Review/Follow Up/
          AI On-Off/With-No Order/24h Window/Old Conversations) moved into the
          "advanced filters" popover so this row stays a clean, scannable tab bar. */}
      <div className={cn(
        "mb-3 items-center gap-2 flex-wrap",
        selected ? "hidden md:flex" : "flex"
      )}>
        <button
          onClick={() => setStageFilter("all")}
          className={cn(
            "px-3.5 py-1.5 rounded-full font-medium text-xs border inline-flex items-center gap-1.5 transition-colors",
            stageFilter === "all"
              ? "bg-emerald-600 text-white border-emerald-600 shadow-sm"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
          )}
        >
          <Inbox className="h-3.5 w-3.5" />
          All
          {convos.length > 0 && (
            <span className={cn(
              "inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-semibold",
              stageFilter === "all" ? "bg-white/25 text-white" : "bg-foreground/10 text-muted-foreground",
            )}>
              {convos.length > 99 ? "99+" : convos.length}
            </span>
          )}
        </button>
        {(Object.keys(STAGE_META) as Array<keyof typeof STAGE_META>).map((key) => {
          const meta = STAGE_META[key];
          const Icon = meta.icon;
          const active = stageFilter === key;
          const count = key === "confirmation" ? confirmationCount
            : key === "shipped" ? shippedCount
            : key === "out_for_delivery" ? outForDeliveryCount
            : failedAttemptCount;
          return (
            <button
              key={key}
              onClick={() => setStageFilter(key)}
              className={cn(
                "px-3.5 py-1.5 rounded-full font-medium text-xs border inline-flex items-center gap-1.5 transition-colors",
                active ? meta.activeCls : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {meta.label}
              {count > 0 && (
                <span className={cn(
                  "inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[9px] font-semibold",
                  active ? "bg-white/25 text-white" : "bg-foreground/10 text-muted-foreground",
                )}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-2">
          {/* Advanced filters — everything that isn't a top-level stage pill.
              (Sort lives in the conversation list's own header, next to search,
              per the spec's left-column layout — not duplicated here.) */}
          <Popover open={advancedFilterOpen} onOpenChange={setAdvancedFilterOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 relative shrink-0 rounded-full"
                title="Advanced filters"
              >
                <SlidersHorizontal className="h-4 w-4" />
                {(refineFilter !== "none" || showLegacy) && (
                  <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 border-2 border-background" />
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3" align="end">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                Refine
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                {([
                  { key: "unread", label: "Unread", icon: MessageSquare },
                  { key: "needs_review", label: "Needs Review", count: needsReviewCount, icon: AlertCircle },
                  { key: "follow_up", label: "Follow Up", count: followUpCount, icon: RotateCcw },
                  { key: "ai_on", label: "AI On", icon: Bot },
                  { key: "ai_off", label: "AI Off", icon: BotOff },
                  { key: "with_order", label: "With Order", icon: FileText },
                  { key: "no_order", label: "No Order", icon: X },
                  { key: "window_open", label: "24h Window", icon: Clock },
                ] as const).map((f) => {
                  const Icon = f.icon;
                  const active = refineFilter === f.key;
                  return (
                    <button
                      key={f.key}
                      onClick={() => setRefineFilter((prev) => (prev === f.key ? "none" : f.key))}
                      className={cn(
                        "px-2.5 py-1.5 rounded-lg font-medium border transition-colors text-[11px] inline-flex items-center gap-1.5",
                        active
                          ? f.key === "needs_review"
                            ? "bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30"
                            : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                          : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                      )}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="truncate">{f.label}</span>
                      {"count" in f && f.count > 0 && (
                        <span className={cn(
                          "ml-auto shrink-0 inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[8px] font-semibold",
                          active ? "bg-sky-500 text-white" : "bg-sky-500/20 text-sky-600 dark:text-sky-400",
                        )}>
                          {f.count > 99 ? "99+" : f.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              {legacyCount > 0 && (
                <>
                  <div className="h-px bg-border my-2.5" />
                  <button
                    onClick={() => setShowLegacy((prev) => !prev)}
                    title="Conversations from the WhatsApp number active before it was reconnected"
                    className={cn(
                      "w-full px-2.5 py-1.5 rounded-lg font-medium border transition-colors text-[11px] inline-flex items-center gap-1.5",
                      showLegacy
                        ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30"
                        : "border-border text-muted-foreground hover:text-foreground hover:bg-muted/50",
                    )}
                  >
                    <Archive className="h-3 w-3 shrink-0" />
                    Old Conversations
                    <span className={cn(
                      "ml-auto inline-flex items-center justify-center min-w-[15px] h-[15px] px-1 rounded-full text-[8px] font-semibold",
                      showLegacy ? "bg-amber-500 text-white" : "bg-amber-500/20 text-amber-600 dark:text-amber-400",
                    )}>
                      {legacyCount > 999 ? "999+" : legacyCount}
                    </span>
                  </button>
                </>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className={cn(
        "grid grid-cols-12 gap-0 rounded-xl border border-border overflow-hidden bg-card",
        // Full-screen on mobile when chat is open; near-full viewport on desktop to maximize message area
        selected
          ? "h-[calc(100dvh-80px)] max-h-[calc(100dvh-80px)] md:h-[calc(100dvh-140px)] md:max-h-[calc(100dvh-140px)]"
          : "h-[calc(100dvh-140px)] max-h-[calc(100dvh-140px)]"
      )}>
        {/* LEFT PANEL — hidden on mobile when a conversation is selected */}
        <aside className={cn(
          "col-span-12 md:col-span-4 lg:col-span-3 border-r border-border flex-col bg-background/40 min-h-0 overflow-hidden",
          selected ? "hidden md:flex" : "flex"
        )}>
          <div className="px-4 h-14 border-b border-border flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-semibold">Chats</div>
              {totalUnread > 0 && (
                <span className="ml-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-emerald-500 text-white text-[10px] font-semibold">
                  {totalUnread > 99 ? "99+" : totalUnread}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Select value={sortDesc ? "latest" : "oldest"} onValueChange={(v) => setSortDesc(v === "latest")}>
                <SelectTrigger className="h-7 w-[92px] text-xs rounded-full border-border">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="latest">Latest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                </SelectContent>
              </Select>
              <Button
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                onClick={markAllAsRead}
                disabled={markingAllRead || totalUnread === 0}
                title="Mark all conversations as read"
              >
                {markingAllRead ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <CheckCheck className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>

          <div className="p-3.5 border-b border-border">
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, phone, or message"
                className="pl-10 h-10 rounded-full"
              />
            </div>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
            {isLoading && <div className="p-4 text-sm text-muted-foreground">Loading…</div>}
            {dbSearching && <div className="p-4 text-sm text-muted-foreground">Searching…</div>}
            {!isLoading && !dbSearching && displayedConvos.length === 0 && (
              <div className="p-6 text-center text-sm text-muted-foreground">
                No conversations.
              </div>
            )}
            {visibleConvos.map((c) => {
              const unreadCount = unreadMap[c.id] ?? 0;
              const unread = unreadCount > 0;
              const needsReview = c.status === "manual_review_needed";
              const urgentRedelivery = needsReview && !!c.labels?.includes("urgent_redelivery");
              const stage = orderStage(c.order_id);
              const stageMeta = stage ? STAGE_META[stage] : null;
              const ts = c.last_reply_at || c.last_message_at || c.updated_at;
              const tooltip = urgentRedelivery
                ? "🚨 Urgent — customer wants a redelivery attempt"
                : needsReview
                ? "⚠️ Needs human review — AI flagged this conversation"
                : unread
                ? `New message${c.last_inbound_at ? ` • ${formatDistanceToNowStrict(new Date(c.last_inbound_at), { addSuffix: true })}` : ""}${
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
                    "w-full text-left px-4 py-3.5 border-b border-border/60 transition-colors flex gap-3.5 relative",
                    selected === c.id
                      ? "bg-emerald-500/10 border-l-4 border-l-emerald-500"
                      : cn(
                          "hover:bg-muted/40",
                          unread && !needsReview && "bg-emerald-500/5 hover:bg-emerald-500/10 border-l-4 border-l-emerald-500",
                          needsReview && !urgentRedelivery && "bg-sky-500/5 hover:bg-sky-500/10 border-l-4 border-l-sky-500",
                          urgentRedelivery && "bg-red-500/5 hover:bg-red-500/10 border-l-4 border-l-red-500",
                        ),
                  )}
                >
                  <div className="relative shrink-0">
                    <div
                      className={cn(
                        "h-12 w-12 rounded-full grid place-items-center text-base font-semibold",
                        colorFor(c.customer_phone),
                      )}
                    >
                      {initials(c.customer_name, c.customer_phone)}
                    </div>
                    {needsReview && (
                      <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4">
                        <span className={cn("animate-ping absolute inline-flex h-full w-full rounded-full opacity-75", urgentRedelivery ? "bg-red-400" : "bg-sky-400")}></span>
                        <span className={cn("relative inline-flex rounded-full h-4 w-4 border-2 border-background items-center justify-center", urgentRedelivery ? "bg-red-500" : "bg-sky-500")}>
                          <AlertCircle className="h-2.5 w-2.5 text-white" />
                        </span>
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div
                        className={cn(
                          "text-[15px] truncate",
                          unread || needsReview ? "font-bold text-foreground" : "font-semibold",
                        )}
                      >
                        {c.customer_name || c.customer_phone}
                      </div>
                      <div
                        className={cn(
                          "text-xs shrink-0",
                          unread ? "text-emerald-600 dark:text-emerald-400 font-semibold" : "text-muted-foreground",
                        )}
                      >
                        {ts ? format(new Date(ts), "HH:mm") : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 mt-1">
                      <div
                        className={cn(
                          "text-[13px] truncate flex-1",
                          unread ? "text-foreground/80 font-medium" : "text-muted-foreground",
                        )}
                      >
                        {previewText(lastMessageByConv.get(c.id), c.order_id ? `#${c.order_id}` : c.customer_phone)}
                      </div>
                      {needsReview && (
                        urgentRedelivery ? (
                          <span
                            className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full bg-red-500 text-white text-[9px] font-bold shrink-0 uppercase tracking-wide"
                            aria-label="Urgent — redelivery requested"
                          >
                            <AlertCircle className="h-2.5 w-2.5" />
                            Urgent
                          </span>
                        ) : (
                          <span
                            className="inline-flex items-center gap-0.5 h-5 px-1.5 rounded-full bg-sky-500 text-white text-[9px] font-bold shrink-0 uppercase tracking-wide"
                            aria-label="Needs human review"
                          >
                            <AlertCircle className="h-2.5 w-2.5" />
                            Review
                          </span>
                        )
                      )}
                      {stageMeta && (
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 h-5 px-1.5 rounded-full border text-[9px] font-semibold shrink-0",
                            stageMeta.badgeCls,
                          )}
                        >
                          <stageMeta.icon className="h-2.5 w-2.5" />
                          {stageMeta.label}
                        </span>
                      )}
                      {unread && (
                        <span
                          className="h-3 w-3 rounded-full bg-emerald-500 shrink-0"
                          aria-label="Unread messages"
                        />
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
            {displayedConvos.length > visibleCount && (
              <div className="p-3">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs gap-1.5"
                  onClick={() => setVisibleCount((n) => n + 50)}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Load More ({displayedConvos.length - visibleCount} more)
                </Button>
              </div>
            )}
          </div>
        </aside>

        {/* CENTER PANEL (chat) — hidden on mobile when no conversation selected */}
        <section className={cn(
          "col-span-12 md:col-span-8 lg:col-span-6 min-h-0 flex-col bg-background/20",
          selected ? "flex" : "hidden md:flex"
        )}>
          {!conv ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Select a conversation to view the order and chat.
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="border-b border-border px-2.5 sm:px-4 py-2.5 flex flex-wrap md:flex-nowrap items-start gap-x-2.5 gap-y-1.5 shrink-0 bg-card">
                {/* Mobile back button */}
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 md:hidden -ml-1 mt-0.5"
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
                  className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer rounded-md hover:bg-muted/50 transition-colors py-1 px-1 -mx-1"
                  title="View customer & order info"
                >
                  <div
                    className={cn(
                      "h-9 w-9 sm:h-10 sm:w-10 rounded-full grid place-items-center text-sm font-semibold shrink-0",
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
                    {conv.pending_button_intent?.intent === "confirm" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-4 px-1.5 shrink-0 border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        title="Customer confirmed via button — waiting for full delivery address"
                      >
                        ⏳ Awaiting address
                      </Badge>
                    )}
                    <span
                      className={cn(
                        "shrink-0 h-1.5 w-1.5 rounded-full",
                        windowExpired ? "bg-rose-500" : "bg-emerald-500",
                      )}
                      title={windowExpired ? "24h window expired" : "Window open"}
                    />
                  </div>
                  {/* Row 2: phone + order */}
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5 min-w-0">
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
                      </>
                    )}
                  </div>
                  {/* Row 3: statuses remain visible on narrow mobile screens */}
                  {order && (
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
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
                              "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[10px] font-medium leading-none capitalize",
                              deliveryStatusCls(order.delivery_status),
                            )}
                            title={`Delivery: ${order.delivery_status.replace(/_/g, " ")}`}
                          >
                            <Truck className="h-2.5 w-2.5" />
                            {order.delivery_status.replace(/_/g, " ")}
                          </span>
                        )}
                        {shouldShowShippingStatus(order.delivery_status, order.shipping_status) && (
                          <span
                            className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted/50 text-muted-foreground px-1.5 py-px text-[10px] font-medium leading-none capitalize"
                            title={`Shipping: ${order.shipping_status.replace(/_/g, " ")}`}
                          >
                            <span className="h-1 w-1 rounded-full bg-current opacity-70" />
                            {order.shipping_status.replace(/_/g, " ")}
                          </span>
                        )}
                    </div>
                  )}
                  {hasDuplicateWarning && (
                    <div className="mt-2 inline-flex max-w-full items-center gap-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 px-2 py-1 text-[11px] font-semibold text-orange-700 shadow-sm dark:text-orange-300">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">
                        Possible duplicate - {duplicateMatches.length} previous matching order{duplicateMatches.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                  )}
                  </div>
                </div>

                <div className="flex w-full md:w-auto items-center justify-end gap-1 pl-10 md:pl-0">
                {/* Call customer */}
                <Button
                  asChild
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                  title="Call customer"
                >
                  <a href={`tel:${conv.customer_phone}`}>
                    <Phone className="h-4 w-4" />
                  </a>
                </Button>

                {/* Customer & order details — a persistent column at lg+, a
                    Sheet below that (the panel content itself isn't duplicated,
                    see rightPanelBody below). */}
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground lg:hidden"
                  title="Customer & order details"
                  onClick={() => setRightPanelOpen(true)}
                >
                  <Info className="h-4 w-4" />
                </Button>

                {/* AI controls — functional (real ai_enabled toggle + a one-shot
                    "reply now" trigger), just tucked into an overflow menu
                    instead of being large top-level header buttons. Force to
                    Agent lives only in the Quick Actions card now. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-foreground"
                      title="More options"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      AI Assistant
                    </DropdownMenuLabel>
                    <DropdownMenuItem onClick={toggleAi}>
                      {aiEnabled ? <BotOff className="h-4 w-4 mr-2" /> : <Bot className="h-4 w-4 mr-2" />}
                      {aiEnabled ? "Turn AI off" : "Turn AI on"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={forceAiReply} disabled={forcingAi}>
                      {forcingAi ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      Force AI reply now
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                </div>

                {/* Status indicators removed per request */}
              </div>

              {/* Messages */}
              <div
                ref={scrollerRef}
                className="min-h-0 flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--muted-foreground)/0.14)_1.4px,_transparent_0),radial-gradient(circle_at_9px_9px,_hsl(var(--muted-foreground)/0.08)_1px,_transparent_0)] [background-size:18px_18px]"
              >
                {grouped.map((g) => (
                  <div key={g.key} className="space-y-3">
                    <div className="flex justify-center">
                      <span className="text-[11px] px-3 py-1 rounded-full bg-muted/70 text-muted-foreground shadow-sm">
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
                      if (m.message_type === "reaction") {
                        // Extract just the emoji — never render JSON payloads or long strings
                        const rawBody = typeof m.body === "string" ? m.body.trim() : "";
                        const payloadEmoji = m.payload?.reaction?.emoji;
                        const bodyLooksLikeEmoji =
                          rawBody.length > 0 &&
                          rawBody.length <= 8 &&
                          !rawBody.startsWith("{") &&
                          !rawBody.startsWith("[");
                        const emoji = payloadEmoji || (bodyLooksLikeEmoji ? rawBody : "👍");
                        return (
                          <div
                            key={m.id}
                            className={cn("flex", isOut ? "justify-end" : "justify-start")}
                          >
                            <div
                              className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 border border-border px-2.5 py-1 text-xs text-muted-foreground shadow-sm"
                              title={isOut ? "You reacted" : "Customer reacted"}
                            >
                              <span className="text-base leading-none">{emoji}</span>
                              <span className="opacity-70">{isOut ? "You reacted" : "Reacted"}</span>
                              <span className="opacity-50">· {format(new Date(m.created_at), "HH:mm")}</span>
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
                              "max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm",
                              isOut
                                ? "bg-emerald-600 text-white rounded-br-sm"
                                : "bg-card border border-border rounded-bl-sm",
                            )}
                          >
                            {/* Quoted reply preview — shown when the customer swiped-to-reply
                                on a specific earlier message (Meta's context.id, already stored
                                verbatim in payload on insert; resolved against loaded messages). */}
                            {(() => {
                              const quoted = quotedMessageFor(m);
                              if (!quoted) return null;
                              return (
                                <div
                                  className={cn(
                                    "mb-1.5 rounded-md border-l-2 px-2 py-1 text-xs truncate",
                                    isOut
                                      ? "border-white/40 bg-white/10 text-white/80"
                                      : "border-emerald-500/50 bg-muted/60 text-muted-foreground",
                                  )}
                                >
                                  {quotedPreviewText(quoted)}
                                </div>
                              );
                            })()}
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
                                      onOpen={(s) => setLightboxSrc(s)}
                                    />
                                    {caption && <div className="whitespace-pre-wrap break-words">{caption}</div>}
                                  </div>
                                );
                              }
                              if (m.message_type === "audio") {
                                return <AudioMessagePlayer message={m} isOut={isOut} />;
                              }
                              if (m.message_type === "video") {
                                return (
                                  <div>
                                    <VideoMessagePlayer message={m} />
                                    {caption && <div className="whitespace-pre-wrap break-words mt-1">{caption}</div>}
                                  </div>
                                );
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
                            {/* Location message — show map link */}
                            {m.message_type === "location" && m.body?.startsWith("📍") && (() => {
                              const coords = (m.payload as any)?.location;
                              const lat = coords?.latitude;
                              const lng = coords?.longitude;
                              if (!lat || !lng) return null;
                              return (
                                <a
                                  href={`https://maps.google.com/?q=${lat},${lng}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    "mt-1.5 inline-flex items-center gap-1 text-[11px] underline underline-offset-2",
                                    isOut ? "text-white/80 hover:text-white" : "text-primary hover:text-primary/80"
                                  )}
                                >
                                  <MapPin className="h-3 w-3 shrink-0" />
                                  Open in Google Maps
                                </a>
                              );
                            })()}
                            {/* Internal English translation (staff-only, never sent to customer) */}
                            {!isTemplate && m.body && !["image","video","audio","voice","document","sticker","location"].includes(m.message_type) && !m.body.trimStart().startsWith("{") && (() => {
                              const cached = m.payload?._translation_en as string | undefined;
                              const shown = translations[m.id] || cached;
                              if (shown) {
                                return (
                                  <div className={cn(
                                    "mt-1.5 pt-1.5 border-t text-[12px] italic flex gap-1.5",
                                    isOut ? "border-white/20 text-white/70" : "border-border/60 text-muted-foreground"
                                  )}>
                                    <Languages className="h-3 w-3 mt-0.5 shrink-0 opacity-70" />
                                    <span className="whitespace-pre-wrap break-words">{shown}</span>
                                  </div>
                                );
                              }
                              const showBtn = isOut
                                ? containsNonLatin(m.body) || needsTranslation(m.body)
                                : needsTranslation(m.body);
                              if (showBtn) {
                                const isLoading = translatingId === m.id;
                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleTranslate(m)}
                                    disabled={isLoading}
                                    className={cn(
                                      "mt-1.5 inline-flex items-center gap-1 text-[11px] transition-colors disabled:opacity-60",
                                      isOut ? "text-white/60 hover:text-white/90" : "text-muted-foreground hover:text-foreground"
                                    )}
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
              <div className="shrink-0 border-t border-border px-3 py-2 bg-card">
                <div className="flex items-center gap-2 mb-2">
                  <button
                    onClick={() => setTab("reply")}
                    className={cn(
                      "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all",
                      tab === "reply"
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <Reply className="h-3.5 w-3.5" />
                    Reply
                  </button>
                  <button
                    onClick={() => setTab("note")}
                    className={cn(
                      "flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold transition-all",
                      tab === "note"
                        ? "bg-amber-500 text-white shadow-sm"
                        : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    <StickyNote className="h-3.5 w-3.5" />
                    Note
                  </button>
                  {lastInboundAt && (
                    <span className="ml-auto text-[11px] text-muted-foreground">
                      Last reply {formatDistanceToNowStrict(lastInboundAt, { addSuffix: true })}
                    </span>
                  )}
                </div>

                {tab === "reply" ? (
                  <div className="space-y-1.5">
                    {/* Single-row composer: icons | textarea | send (WhatsApp-style) */}
                    <div className="flex items-end gap-2">
                      {/* Inline icon toolbar */}
                      <div className="flex items-center gap-0.5 shrink-0 pb-0.5">
                        {/* Emoji */}
                        <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              disabled={windowExpired}
                              title="Emoji"
                            >
                              <Smile className="h-4 w-4" />
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

                        {/* Attach — a single WhatsApp-style paperclip for both
                            images and documents, auto-detected from the
                            picked file's type instead of two separate icons. */}
                        <input
                          ref={fileInputRef}
                          type="file"
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) uploadAndSend(f, f.type.startsWith("image/") ? "image" : "document");
                            e.target.value = "";
                          }}
                        />
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          disabled={windowExpired || uploadingMedia}
                          title="Attach photo or file"
                          onClick={() => fileInputRef.current?.click()}
                        >
                          <Paperclip className="h-4 w-4" />
                        </Button>

                        {/* Voice */}
                        <Button
                          type="button"
                          size="icon"
                          variant={recording ? "destructive" : "ghost"}
                          className={cn(
                            "h-8 w-8",
                            !recording && "text-muted-foreground hover:text-foreground",
                            recording && "animate-pulse",
                          )}
                          disabled={windowExpired || uploadingMedia}
                          title={recording ? "Stop recording" : "Record voice"}
                          onClick={() => (recording ? stopRecording() : startRecording())}
                        >
                          {recording ? <Square className="h-3.5 w-3.5 fill-current" /> : <Mic className="h-4 w-4" />}
                        </Button>
                      </div>

                      {/* Textarea */}
                      <Textarea
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder={
                          windowExpired
                            ? "24h window expired — use template"
                            : "Type a reply…"
                        }
                        disabled={windowExpired || sending}
                        rows={1}
                        className="resize-none min-h-[40px] max-h-[120px] flex-1 py-2"
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendReply();
                          }
                        }}
                      />

                      {/* Send */}
                      {windowExpired ? (
                        <Button
                          onClick={() => setTplOpen(true)}
                          className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white"
                        >
                          <FileText className="h-4 w-4 mr-1" /> Template
                        </Button>
                      ) : (
                        <Button
                          size="icon"
                          onClick={sendReply}
                          disabled={sending || uploadingMedia || !draft.trim()}
                          className="shrink-0 h-10 w-10 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white"
                          title="Send"
                        >
                          {sending || uploadingMedia ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Send className="h-4 w-4" />
                          )}
                        </Button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-end gap-2">
                    <Textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      placeholder="Internal note (not sent to customer)…"
                      rows={1}
                      className="resize-none min-h-[40px] max-h-[120px] flex-1 py-2 border-amber-500/30 focus-visible:ring-amber-500/30"
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
                      className="shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400"
                    >
                      <StickyNote className="h-4 w-4 mr-1" /> Save Note
                    </Button>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        {/* RIGHT PANEL (customer/order) — persistent column at lg+ only;
            below that it's reached via the header's "details" button (Sheet). */}
        <aside className="hidden lg:flex lg:col-span-3 border-l border-border flex-col bg-background/40 min-h-0 overflow-y-auto">
          {rightPanelBody}
        </aside>
      </div>

      <Sheet open={rightPanelOpen} onOpenChange={setRightPanelOpen}>
        <SheetContent side="right" className="w-full sm:max-w-sm p-0 overflow-y-auto">
          {rightPanelBody}
        </SheetContent>
      </Sheet>

      <SendTemplateModal
        open={tplOpen}
        onOpenChange={setTplOpen}
        conversationId={selected}
        orderId={conv?.order_id ?? null}
      />

      {/* Customer & Order Info Dialog */}
      <Dialog open={orderInfoOpen} onOpenChange={(o) => {
        setOrderInfoOpen(o);
        if (o && order) {
          setEditConfStatus(order.confirmation_status || "new");
          setEditDelStatus(order.delivery_status || "pending");
          const cancelDraft = getCancelReasonDraft(order.cancel_reason);
          setEditCancelReason(cancelDraft.reason);
          setEditCancelNote(cancelDraft.note);
        }
        if (!o) {
          setEditingCity(false);
          setEditingAddress(false);
          setEditingName(false);
          setEditingPricing(false);
          setEditCancelReason("");
          setEditCancelNote("");
        }
      }}>
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
              <div className="min-w-0 flex-1">
                {editingName ? (
                  <div className="flex items-center gap-1.5">
                    <Input
                      value={nameDraft}
                      onChange={(e) => setNameDraft(e.target.value)}
                      className="h-7 text-sm font-normal"
                      placeholder="Customer name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.currentTarget.blur();
                          saveCustomerName();
                        }
                        if (e.key === "Escape") setEditingName(false);
                      }}
                    />
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-emerald-500 transition-colors disabled:opacity-50"
                      title="Save"
                      disabled={savingName || !nameDraft.trim()}
                      onClick={saveCustomerName}
                    >
                      {savingName ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                      title="Cancel"
                      disabled={savingName}
                      onClick={() => setEditingName(false)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <div className="truncate text-base">
                      {conv?.customer_name || conv?.customer_phone}
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
                      title="Edit customer name"
                      onClick={() => {
                        setNameDraft(conv?.customer_name || "");
                        setEditingName(true);
                      }}
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  </div>
                )}
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
            {hasDuplicateWarning && (
              <div className="rounded-xl border border-orange-500/30 bg-orange-500/10 p-3 text-orange-800 shadow-sm dark:text-orange-200">
                <div className="flex items-start gap-2">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-orange-500/15">
                    <AlertCircle className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">Possible Duplicate Order</div>
                    <div className="mt-0.5 text-xs leading-relaxed text-orange-700/85 dark:text-orange-200/80">
                      Same customer phone and product were found in previous orders. Check them before sending messages or changing status.
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {duplicateMatches.map((match) => (
                        <button
                          key={match.id}
                          type="button"
                          onClick={() => window.open(`/orders/${match.order_id}`, "_blank")}
                          className="flex w-full items-center justify-between gap-2 rounded-lg border border-orange-500/20 bg-background/70 px-2 py-1.5 text-left text-xs transition-colors hover:bg-orange-500/10"
                          title={`Open #${match.order_id}`}
                        >
                          <span className="min-w-0">
                            <span className="font-mono font-bold text-orange-800 dark:text-orange-200">
                              #{match.order_id}
                            </span>
                            {match.customer_city && (
                              <span className="ml-1 text-muted-foreground">· {match.customer_city}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-1">
                            <span
                              className={cn(
                                "rounded-full border px-1.5 py-0.5 text-[10px] capitalize",
                                confirmationStatusCls(match.confirmation_status || ""),
                              )}
                            >
                              {(match.confirmation_status || "unknown").replace(/_/g, " ")}
                            </span>
                            {match.delivery_status && (
                              <span
                                className={cn(
                                  "rounded-full border px-1.5 py-0.5 text-[10px] capitalize",
                                  deliveryStatusCls(match.delivery_status),
                                )}
                              >
                                {match.delivery_status.replace(/_/g, " ")}
                              </span>
                            )}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

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
                  <div className="col-span-2 rounded-md border border-border/70 bg-background/70 p-2">
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <div>
                        <div className="text-[11px] text-muted-foreground">Products</div>
                        {!editingPricing && getOrderItems(order).length > 1 && (
                          <div className="text-[10px] text-muted-foreground">
                            {getOrderItems(order).length} products in this order
                          </div>
                        )}
                      </div>
                      {editingPricing ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          disabled={savingPricing}
                          onClick={addProductDraft}
                        >
                          <Plus className="h-3 w-3 mr-1" />
                          Add Product
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setItemDrafts(buildOrderItemDrafts(order));
                            setEditingPricing(true);
                          }}
                        >
                          <Pencil className="h-3 w-3 mr-1" />
                          Edit Products
                        </Button>
                      )}
                    </div>
                    {editingPricing ? (
                      <div className="space-y-3">
                        <div className="space-y-2">
                          {itemDrafts.map((item, index) => {
                            const currentKey = productKeyForDraft(item, index);
                            const hasCurrentOption = productOptions.some((option) => option.key === currentKey);
                            return (
                              <div key={item.id || `new-${index}`} className="rounded-md border border-border/70 bg-muted/25 p-2 space-y-2">
                                <div className="flex items-center gap-2">
                                  <div className="flex-1">
                                    <div className="text-[10px] text-muted-foreground mb-1">Product</div>
                                    <Select value={currentKey} onValueChange={(value) => applyProductOption(index, value)}>
                                      <SelectTrigger className="h-8 text-xs">
                                        <SelectValue placeholder="Select product" />
                                      </SelectTrigger>
                                      <SelectContent>
                                        {!hasCurrentOption && (
                                          <SelectItem value={currentKey} className="text-xs">
                                            {item.product_name || "Current product"}
                                          </SelectItem>
                                        )}
                                        {productOptions.map((option) => (
                                          <SelectItem key={option.key} value={option.key} className="text-xs">
                                            {option.name}{option.sku ? ` · ${option.sku}` : ""}
                                          </SelectItem>
                                        ))}
                                      </SelectContent>
                                    </Select>
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="h-8 w-8 mt-4 text-destructive hover:text-destructive"
                                    disabled={savingPricing || itemDrafts.length <= 1}
                                    onClick={() => removeProductDraft(index)}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                {!item.product_id && (
                                  <Input
                                    className="h-8 text-xs"
                                    placeholder="Product name"
                                    value={item.product_name}
                                    onChange={(e) => setItemDrafts((prev) => prev.map((draft, i) => (
                                      i === index ? { ...draft, product_name: e.target.value } : draft
                                    )))}
                                  />
                                )}
                                <div className="grid grid-cols-3 gap-2">
                                  <div className="space-y-1">
                                    <div className="text-[10px] text-muted-foreground">Qty</div>
                                    <Input
                                      type="number"
                                      min={1}
                                      step={1}
                                      className="h-8 text-sm"
                                      value={item.quantity}
                                      onChange={(e) => setItemDrafts((prev) => prev.map((draft, i) => (
                                        i === index ? { ...draft, quantity: e.target.value } : draft
                                      )))}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[10px] text-muted-foreground">Price</div>
                                    <Input
                                      type="number"
                                      min={0}
                                      step="0.01"
                                      className="h-8 text-sm"
                                      value={item.unit_price}
                                      onChange={(e) => setItemDrafts((prev) => prev.map((draft, i) => (
                                        i === index ? { ...draft, unit_price: e.target.value } : draft
                                      )))}
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <div className="text-[10px] text-muted-foreground">Line</div>
                                    <div className="h-8 flex items-center text-sm font-medium tabular-nums">
                                      Rs {(Math.max(1, Math.trunc(Number(item.quantity || 1))) * Math.max(0, Number(item.unit_price || 0))).toLocaleString()}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <div className="text-xs text-muted-foreground">
                            Total: <span className="font-semibold text-foreground">Rs {itemDraftTotal.toLocaleString()}</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              disabled={savingPricing}
                              onClick={saveProductItems}
                            >
                              {savingPricing ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                              Save
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={savingPricing}
                              onClick={() => setEditingPricing(false)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {getOrderItems(order).map((item: any, index: number) => (
                          <div key={item.id || `${item.product_name}-${index}`} className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium">{item.product_name || item.sku || "Product"}</div>
                              {item.sku && <div className="text-[10px] text-muted-foreground">{item.sku}</div>}
                            </div>
                            <div className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
                              {Number(item.quantity || 1)} x Rs {Number(item.unit_price || 0).toLocaleString()}
                            </div>
                          </div>
                        ))}
                        <div className="flex items-center justify-between border-t border-border/70 pt-2">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">Total</span>
                          <span className="font-semibold tabular-nums">Rs {Number(order.total_amount || 0).toLocaleString()}</span>
                        </div>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground mb-0.5">City</div>
                    {editingCity ? (
                      <div className="space-y-2">
                        <CitySelect
                          value={cityDraft}
                          onValueChange={setCityDraft}
                          highlightInvalid
                          modal
                          triggerClassName="h-8 text-sm w-full"
                          className="w-[240px]"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={savingCity || !cityDraft.trim()}
                            onClick={async () => {
                              setSavingCity(true);
                              const { error } = await supabase
                                .from("orders")
                                .update({ customer_city: cityDraft.trim(), updated_at: new Date().toISOString() })
                                .eq("order_id", order.order_id);
                              setSavingCity(false);
                              if (error) {
                                toast.error("Failed to update city");
                                return;
                              }
                              qc.invalidateQueries({ queryKey: ["wts-order", order.order_id] });
                              toast.success("City updated");
                              setEditingCity(false);
                            }}
                          >
                            {savingCity ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={savingCity}
                            onClick={() => setEditingCity(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span
                          className={cn(
                            isCityInvalid(order.customer_city) && "text-destructive font-semibold",
                          )}
                          title={isCityInvalid(order.customer_city) ? `"${order.customer_city}" is not a valid carrier city` : undefined}
                        >
                          {order.customer_city || "—"}
                          {isCityInvalid(order.customer_city) && (
                            <span className="ml-1 text-[10px] font-normal">(wrong city)</span>
                          )}
                        </span>
                        <button
                          type="button"
                          className="text-muted-foreground hover:text-foreground transition-colors"
                          title="Edit city"
                          onClick={() => {
                            setCityDraft(order.customer_city || "");
                            setEditingCity(true);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-[11px] text-muted-foreground">Created</div>
                    <div>{order.created_at ? format(new Date(order.created_at), "dd/MM/yyyy HH:mm") : "—"}</div>
                  </div>
                  {latestShipment?.carriers?.name && (
                    <div>
                      <div className="text-[11px] text-muted-foreground">Delivery Company</div>
                      <div className="text-sm font-medium">{latestShipment.carriers.name}</div>
                    </div>
                  )}
                  {latestShipment?.tracking_number && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-muted-foreground">Tracking Number</div>
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(latestShipment.tracking_number);
                          toast.success(`Copied ${latestShipment.tracking_number}`);
                        }}
                        title="Click to copy"
                        className="font-mono text-sm text-foreground hover:text-primary transition-colors"
                      >
                        {latestShipment.tracking_number}
                      </button>
                    </div>
                  )}
                  {(order as any)?.follow_up_assigned_to && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-muted-foreground">Follow-up Agent</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium">{followUpAgent?.name || "—"}</span>
                        {followUpAgent?.phone && (
                          <a
                            href={`https://wa.me/${followUpAgent.phone.replace(/\D/g, "")}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            title={`WhatsApp ${followUpAgent.name}`}
                            className="text-muted-foreground hover:text-emerald-500 transition-colors"
                          >
                            <Phone className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </div>
                  )}
                  <div className="col-span-2">
                    <div className="flex items-center justify-between mb-1">
                      <div className="text-[11px] text-muted-foreground">Address</div>
                      {!editingAddress && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => {
                            setAddressDraft(order.customer_address || "");
                            setEditingAddress(true);
                          }}
                        >
                          {order.customer_address ? "Edit" : "Add"}
                        </Button>
                      )}
                    </div>
                    {editingAddress ? (
                      <div className="space-y-2">
                        <Textarea
                          value={addressDraft}
                          onChange={(e) => setAddressDraft(e.target.value)}
                          rows={3}
                          className="text-sm resize-none"
                          placeholder="Customer address"
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs"
                            disabled={savingAddress}
                            onClick={async () => {
                              setSavingAddress(true);
                              const { error } = await supabase
                                .from("orders")
                                .update({ customer_address: addressDraft.trim(), updated_at: new Date().toISOString() })
                                .eq("order_id", order.order_id);
                              setSavingAddress(false);
                              if (error) {
                                toast.error("Failed to update address");
                                return;
                              }
                              qc.invalidateQueries({ queryKey: ["wts-order", order.order_id] });
                              toast.success("Address updated");
                              setEditingAddress(false);
                            }}
                          >
                            {savingAddress ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            disabled={savingAddress}
                            onClick={() => setEditingAddress(false)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm">{order.customer_address || <span className="text-muted-foreground italic">No address</span>}</div>
                    )}
                  </div>
                  {order.note && (
                    <div className="col-span-2">
                      <div className="text-[11px] text-muted-foreground">Note</div>
                      <div className="text-sm whitespace-pre-wrap">{order.note}</div>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-2 border-t border-border">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">Confirmation</div>
                      <Select
                        value={selectedConfirmationStatus}
                        onValueChange={(value) => {
                          setEditConfStatus(value);
                          if (value !== "cancelled") {
                            setEditCancelReason("");
                            setEditCancelNote("");
                          }
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["new","confirmed","no_answer","postponed","cancelled","wrong_number","double"].map(s => (
                            <SelectItem key={s} value={s} className="text-xs">{s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <div className="text-[11px] text-muted-foreground mb-1">Delivery</div>
                      <Select value={selectedDeliveryStatus} onValueChange={setEditDelStatus}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {(isAdmin
                            ? ["pending","booked","printed","dispatched","shipped","in_transit","with_courier","delivered","returned","cancelled","no_answer","postponed","failed_attempt","ready_for_return","rejected","return","return_received"]
                            : ["pending","booked","new"]
                          ).map(s => (
                            <SelectItem key={s} value={s} className="text-xs">
                              {s === "new" ? "New (force to agent)" : s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {selectedConfirmationStatus === "cancelled" && (
                    <div className="space-y-2 rounded-lg border border-destructive/20 bg-destructive/5 p-3">
                      <div className="flex items-center gap-1 text-xs font-semibold text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        Cancellation Reason *
                      </div>
                      <Select value={editCancelReason} onValueChange={setEditCancelReason}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Select reason..." />
                        </SelectTrigger>
                        <SelectContent>
                          {CANCEL_REASONS.map((reason) => (
                            <SelectItem key={reason.value} value={reason.value} className="text-xs">
                              {reason.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {editCancelReason === "other" && (
                        <Textarea
                          value={editCancelNote}
                          onChange={(e) => setEditCancelNote(e.target.value)}
                          placeholder="Write the cancellation reason..."
                          className="min-h-[60px] resize-none text-xs"
                        />
                      )}
                    </div>
                  )}
                  {(statusHasChanges || cancelReasonHasChanges) && (
                    <Button
                      size="sm"
                      className="w-full h-8 text-xs"
                      disabled={updatingStatus || !canUpdateOrderStatus}
                      onClick={async () => {
                        if (needsCancelReason && !cancelReasonValue) {
                          toast.error("Please select a cancellation reason");
                          return;
                        }
                        setUpdatingStatus(true);
                        const updates: {
                          updated_at: string;
                          confirmation_status?: string;
                          confirmed_at?: string;
                          delivery_status?: string;
                          cancel_reason?: string;
                          agent_id?: null;
                          assigned_at?: null;
                          last_activity_at?: null;
                        } = { updated_at: new Date().toISOString() };
                        let forcedToAgent = false;
                        if (selectedConfirmationStatus !== (order.confirmation_status || "new")) {
                          updates.confirmation_status = selectedConfirmationStatus;
                          // This panel never set confirmed_at on confirm — every order
                          // touched only through here (agent/whatsapp mixed, ~484 found)
                          // had confirmed_at stuck at NULL, corrupting any report that
                          // buckets confirms by date (SellerAnalytics' daily trend,
                          // ConfirmationAnalytics' default snapshot view, etc. all fall
                          // back to updated_at instead, mis-dating the confirm event).
                          if (selectedConfirmationStatus === "confirmed" && (order.confirmation_status || "new") !== "confirmed") {
                            updates.confirmed_at = new Date().toISOString();
                          }
                        }
                        if (selectedConfirmationStatus === "cancelled" && cancelReasonValue !== (order.cancel_reason || "")) {
                          updates.cancel_reason = cancelReasonValue;
                        }
                        if (selectedDeliveryStatus !== (order.delivery_status || "pending")) {
                          if (selectedDeliveryStatus === "new") {
                            // "New (force to agent)" — push back without turning no_answer into new.
                            forcedToAgent = true;
                            const currentConfirmationStatus = order.confirmation_status || "new";
                            const nextConfirmationStatus = currentConfirmationStatus === "no_answer" ? "no_answer" : "new";
                            if (nextConfirmationStatus !== currentConfirmationStatus) {
                              updates.confirmation_status = nextConfirmationStatus;
                            } else {
                              delete updates.confirmation_status;
                            }
                            updates.agent_id = null;
                            updates.assigned_at = null;
                            updates.last_activity_at = null;
                          } else {
                            updates.delivery_status = selectedDeliveryStatus;
                          }
                        }
                        const { error } = await supabase.from("orders").update(updates).eq("order_id", order.order_id);
                        if (error) {
                          setUpdatingStatus(false);
                          toast.error(error.message || "Failed to update status");
                          return;
                        }

                        // Log to order_history so the action counts on the agent dashboard
                        // (the dashboard derives all its stats from order_history, not the orders table).
                        if (authUser?.id) {
                          const role = isAdmin ? "admin" : "agent";
                          const histEntries: any[] = [];
                          if (updates.confirmation_status) {
                            histEntries.push({
                              order_id: order.order_id,
                              changed_by: authUser.id,
                              changed_by_role: role,
                              field_changed: "confirmation_status",
                              old_value: order.confirmation_status || "new",
                              new_value: updates.confirmation_status,
                              action_type: forcedToAgent ? "force_to_agent" : "status_change",
                            });
                          }
                          if (forcedToAgent && order.agent_id) {
                            histEntries.push({
                              order_id: order.order_id,
                              changed_by: authUser.id,
                              changed_by_role: role,
                              field_changed: "agent_lock",
                              old_value: order.agent_id,
                              new_value: null,
                              action_type: "force_to_agent",
                            });
                          }
                          if (updates.delivery_status) {
                            histEntries.push({
                              order_id: order.order_id,
                              changed_by: authUser.id,
                              changed_by_role: role,
                              field_changed: "delivery_status",
                              old_value: order.delivery_status || "pending",
                              new_value: updates.delivery_status,
                              action_type: "status_change",
                            });
                          }
                          if (updates.cancel_reason) {
                            histEntries.push({
                              order_id: order.order_id,
                              changed_by: authUser.id,
                              changed_by_role: role,
                              field_changed: "cancel_reason",
                              old_value: order.cancel_reason || "",
                              new_value: updates.cancel_reason,
                              action_type: "status_change",
                            });
                          }
                          if (histEntries.length > 0) {
                            await supabase.from("order_history").insert(histEntries);
                          }
                        }

                        qc.invalidateQueries({ queryKey: ["wts-order", order.order_id] });
                        toast.success("Status updated");
                        setUpdatingStatus(false);
                      }}
                    >
                      {updatingStatus ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Update Status
                    </Button>
                  )}
                  {shouldShowShippingStatus(order.delivery_status, order.shipping_status) && (
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

      {/* Mark as resolved dialog — contextual copy for the urgent redelivery case */}
      <Dialog open={resolveOpen} onOpenChange={(o) => { setResolveOpen(o); if (!o) setResolveNote(""); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {conv?.labels?.includes("urgent_redelivery") ? (
                <>
                  <Truck className="h-5 w-5 text-red-500" />
                  Arrange Delivery — Done
                </>
              ) : (
                <>
                  <CheckCircle2 className="h-5 w-5 text-sky-500" />
                  Mark as Resolved
                </>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {conv?.labels?.includes("urgent_redelivery")
                ? "Confirm a new delivery attempt has been arranged with the courier. Add an optional note (e.g. new pickup date)."
                : "Confirm this conversation has been handled. Add an optional note to record what was done."}
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
                {conv?.labels?.includes("urgent_redelivery") ? "Confirm Arranged" : "Mark Resolved"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image lightbox — click any image in chat to view full-size */}
      <Dialog open={!!lightboxSrc} onOpenChange={(o) => !o && setLightboxSrc(null)}>
        <DialogContent className="max-w-5xl p-0 bg-transparent border-0 shadow-none">
          {lightboxSrc && (
            <div className="flex flex-col items-center gap-3">
              <img
                src={lightboxSrc}
                alt="attachment full size"
                className="max-h-[85vh] max-w-full rounded-lg object-contain"
              />
              <a
                href={lightboxSrc}
                download
                target="_blank"
                rel="noreferrer"
                className="text-xs text-white/80 hover:text-white underline underline-offset-2"
              >
                Open in new tab
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
