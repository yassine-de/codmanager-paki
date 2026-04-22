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
} from "lucide-react";
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
      <div className="grid grid-cols-12 gap-0 h-[calc(100vh-220px)] min-h-[560px] rounded-xl border border-border overflow-hidden bg-card">
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
        <section className="col-span-12 md:col-span-8 lg:col-span-9 flex flex-col bg-background/20">
          {!conv ? (
            <div className="flex-1 grid place-items-center text-sm text-muted-foreground">
              Select a conversation to view the order and chat.
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="border-b border-border px-4 h-14 flex items-center gap-3">
                <div
                  className={cn(
                    "h-9 w-9 rounded-full grid place-items-center text-sm font-semibold shrink-0",
                    colorFor(conv.customer_phone),
                  )}
                >
                  {initials(conv.customer_name, conv.customer_phone)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="font-semibold truncate">
                      {conv.customer_name || conv.customer_phone}
                    </div>
                    <Badge
                      variant="outline"
                      className={cn("text-[10px] h-5", statusBadge(conv.status).cls)}
                    >
                      {statusBadge(conv.status).label}
                    </Badge>
                    {windowExpired ? (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-5 bg-rose-500/10 text-rose-500 border-rose-500/30"
                      >
                        🔒 24h Expired
                      </Badge>
                    ) : (
                      <Badge
                        variant="outline"
                        className="text-[10px] h-5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30"
                      >
                        Window Open
                      </Badge>
                    )}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {conv.customer_phone}
                    {order && (
                      <>
                        {" • "}#{order.order_id} • {order.product_name}
                      </>
                    )}
                  </div>
                </div>

                {/* Quick actions */}
                {order && (
                  <div className="hidden md:flex items-center gap-1.5">
                    <Button size="sm" variant="outline" onClick={() => action("confirm")}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => action("to_agent")}>
                      <UserPlus className="h-3.5 w-3.5 mr-1" /> Agent
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => action("cancel")}>
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                    </Button>
                  </div>
                )}
              </div>

              {/* Messages */}
              <div
                ref={scrollerRef}
                className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--muted-foreground)/0.06)_1px,_transparent_0)] [background-size:16px_16px]"
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
                            <div className="whitespace-pre-wrap break-words">
                              {m.body || <em className="opacity-70">[{m.message_type}]</em>}
                            </div>
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
              <div className="border-t border-border p-3 bg-card">
                <div className="flex items-center gap-1 mb-2">
                  <button
                    onClick={() => setTab("reply")}
                    className={cn(
                      "text-sm px-3 py-1.5 rounded-md font-medium border-b-2 transition-colors",
                      tab === "reply"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Reply
                  </button>
                  <button
                    onClick={() => setTab("note")}
                    className={cn(
                      "text-sm px-3 py-1.5 rounded-md font-medium border-b-2 transition-colors",
                      tab === "note"
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    Note
                  </button>
                  {lastInboundAt && (
                    <span className="ml-auto text-[10px] text-muted-foreground">
                      Last reply {formatDistanceToNowStrict(lastInboundAt, { addSuffix: true })}
                    </span>
                  )}
                </div>

                {tab === "reply" ? (
                  <div className="flex gap-2">
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
                    {windowExpired ? (
                      <Button
                        onClick={() => setTplOpen(true)}
                        className="shrink-0 self-end bg-emerald-600 hover:bg-emerald-700 text-white"
                      >
                        <FileText className="h-4 w-4 mr-1" /> Template
                      </Button>
                    ) : (
                      <Button
                        onClick={sendReply}
                        disabled={sending || !draft.trim()}
                        className="shrink-0 self-end"
                      >
                        {sending ? (
                          <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                        ) : (
                          <Send className="h-4 w-4 mr-1" />
                        )}
                        Send
                      </Button>
                    )}
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
