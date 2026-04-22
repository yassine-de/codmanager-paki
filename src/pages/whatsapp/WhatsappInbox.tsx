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
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import { format, formatDistanceToNowStrict, differenceInHours } from "date-fns";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";

type Conv = {
  id: string;
  order_id: string;
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
  direction: string; // "in" | "out"
  message_type: string; // "text" | "template" | "note" | ...
  status: string | null;
  created_at: string;
};

const statusBadge = (s: string) => {
  const map: Record<string, { label: string; cls: string }> = {
    pending: { label: "New WTS", cls: "bg-[hsl(220,90%,56%)]/15 text-[hsl(220,90%,56%)] border-[hsl(220,90%,56%)]/25" },
    awaiting_reply: { label: "Awaiting Reply", cls: "bg-amber-500/15 text-amber-500 border-amber-500/25" },
    sent: { label: "Awaiting Reply", cls: "bg-amber-500/15 text-amber-500 border-amber-500/25" },
    confirmed: { label: "Confirmed", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/25" },
    canceled: { label: "Canceled", cls: "bg-rose-500/15 text-rose-500 border-rose-500/25" },
    more_info: { label: "Sent to Agent", cls: "bg-violet-500/15 text-violet-500 border-violet-500/25" },
  };
  return map[s] ?? { label: s || "—", cls: "bg-muted text-muted-foreground border-border" };
};

function initials(name?: string | null, phone?: string) {
  const src = (name || phone || "?").trim();
  const parts = src.split(/\s+/);
  return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
}

const avatarColors = [
  "bg-emerald-500/20 text-emerald-500",
  "bg-violet-500/20 text-violet-500",
  "bg-rose-500/20 text-rose-500",
  "bg-amber-500/20 text-amber-500",
  "bg-sky-500/20 text-sky-500",
  "bg-pink-500/20 text-pink-500",
];
function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return avatarColors[h % avatarColors.length];
}

export default function WhatsappInbox() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [tab, setTab] = useState<"reply" | "note">("reply");
  const [draft, setDraft] = useState("");
  const [noteDraft, setNoteDraft] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
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
    refetchInterval: 15000,
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
    refetchInterval: 8000,
  });

  const conv = useMemo(() => convos.find((c) => c.id === selected) || null, [convos, selected]);

  const { data: order } = useQuery({
    queryKey: ["wts-order", conv?.order_id],
    queryFn: async () => {
      if (!conv) return null;
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("order_id", conv.order_id)
        .maybeSingle();
      return data;
    },
    enabled: !!conv,
  });

  // Auto-scroll on new messages
  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
  }, [messages.length, selected]);

  const filteredConvos = useMemo(() => {
    let list = convos.slice();
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (c) =>
          (c.customer_name || "").toLowerCase().includes(q) ||
          c.customer_phone.toLowerCase().includes(q) ||
          c.order_id.toLowerCase().includes(q),
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
    if (!lastInboundAt) return true; // no reply ever -> only template allowed
    return differenceInHours(new Date(), lastInboundAt) >= 24;
  }, [lastInboundAt]);

  const action = async (mode: "confirm" | "to_agent" | "cancel" | "resend") => {
    if (!selected || !conv) return;
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
    qc.invalidateQueries({ queryKey: ["wts-convos"] });
    qc.invalidateQueries({ queryKey: ["wts-messages", selected] });
    qc.invalidateQueries({ queryKey: ["wts-order", conv.order_id] });
  };

  const sendReply = async () => {
    if (!selected || !conv || !draft.trim()) return;
    if (windowExpired) {
      toast.error("24h window expired — use a template");
      return;
    }
    const text = draft.trim();
    const { error } = await supabase.from("whatsapp_messages").insert({
      conversation_id: selected,
      order_id: conv.order_id,
      direction: "out",
      message_type: "text",
      body: text,
      status: "queued",
      payload: { source: "inbox_manual" },
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("whatsapp_conversations")
      .update({ last_message_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", selected);
    setDraft("");
    toast.success("Reply queued");
    qc.invalidateQueries({ queryKey: ["wts-messages", selected] });
    qc.invalidateQueries({ queryKey: ["wts-convos"] });
  };

  const sendNote = async () => {
    if (!selected || !conv || !noteDraft.trim()) return;
    const text = noteDraft.trim();
    const { error } = await supabase.from("whatsapp_messages").insert({
      conversation_id: selected,
      order_id: conv.order_id,
      direction: "in", // internal, not outbound
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
    qc.invalidateQueries({ queryKey: ["wts-messages", selected] });
  };

  const lastMessagePreview = (cId: string) => {
    if (selected === cId && messages.length) {
      const last = messages[messages.length - 1];
      return last.body || `[${last.message_type}]`;
    }
    return null;
  };

  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <div className="grid grid-cols-12 gap-0 h-[calc(100vh-220px)] min-h-[560px] rounded-xl border border-border overflow-hidden bg-card">
      {/* LEFT PANEL */}
      <aside className="col-span-12 md:col-span-4 lg:col-span-3 border-r border-border flex flex-col bg-background/40">
        <div className="p-3 border-b border-border flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 grid place-items-center text-primary">
              <FilterIcon className="h-4 w-4" />
            </div>
            <div className="text-sm font-semibold">Inbox</div>
          </div>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8"
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
              placeholder="Search by name, phone, or order"
              className="pl-9 h-9"
            />
          </div>
          <div className="flex items-center gap-2 text-sm">
            <button
              onClick={() => setFilter("all")}
              className={cn(
                "px-3 py-1.5 rounded-md font-medium border transition-colors",
                filter === "all"
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
              )}
            >
              All
            </button>
            <button
              onClick={() => setFilter("unread")}
              className={cn(
                "px-3 py-1.5 rounded-md font-medium border transition-colors",
                filter === "unread"
                  ? "bg-primary/15 text-primary border-primary/30"
                  : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/50",
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
            const sb = statusBadge(c.status);
            const unread =
              c.last_reply_at &&
              (!c.last_message_at || new Date(c.last_reply_at) > new Date(c.last_message_at));
            const preview = lastMessagePreview(c.id);
            return (
              <button
                key={c.id}
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
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
                      {c.last_reply_at
                        ? format(new Date(c.last_reply_at), "HH:mm")
                        : c.last_message_at
                        ? format(new Date(c.last_message_at), "HH:mm")
                        : ""}
                    </div>
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">
                    #{c.order_id}
                  </div>
                  <div className="flex items-center justify-between gap-2 mt-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
                        sb.cls,
                      )}
                    >
                      {sb.label}
                    </span>
                    {unread && (
                      <span className="h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
                    )}
                  </div>
                  {preview && (
                    <div className="text-[11px] text-muted-foreground/80 truncate mt-1">
                      {preview}
                    </div>
                  )}
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
            <div className="border-b border-border p-3 flex items-center gap-3">
              <div
                className={cn(
                  "h-10 w-10 rounded-full grid place-items-center text-sm font-semibold shrink-0",
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
                  <span className="text-xs text-muted-foreground">{conv.customer_phone}</span>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", statusBadge(conv.status).cls)}
                  >
                    {statusBadge(conv.status).label}
                  </Badge>
                  {windowExpired ? (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-rose-500/15 text-rose-500 border-rose-500/25"
                    >
                      24h Expired
                    </Badge>
                  ) : (
                    <Badge
                      variant="outline"
                      className="text-[10px] bg-emerald-500/15 text-emerald-500 border-emerald-500/25"
                    >
                      Window Open
                    </Badge>
                  )}
                </div>
                {order && (
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    Order <span className="font-medium text-foreground">#{order.order_id}</span>{" "}
                    • {order.product_name} • {order.customer_city}
                    {order.confirmation_status && (
                      <>
                        {" "}
                        •{" "}
                        <span className="text-foreground/80">
                          {order.confirmation_status}
                        </span>
                      </>
                    )}
                    {order.delivery_status && (
                      <>
                        {" / "}
                        <span className="text-foreground/80">{order.delivery_status}</span>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Quick actions */}
              <div className="hidden md:flex items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => action("confirm")}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm
                </Button>
                <Button size="sm" variant="outline" onClick={() => action("to_agent")}>
                  <UserPlus className="h-3.5 w-3.5 mr-1" /> Send to Agent
                </Button>
                <Button size="sm" variant="outline" onClick={() => action("cancel")}>
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
                </Button>
                <Button size="sm" variant="outline" onClick={() => action("resend")}>
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resend
                </Button>
              </div>
            </div>

            {/* Mobile actions row */}
            <div className="md:hidden flex flex-wrap gap-1.5 p-2 border-b border-border">
              <Button size="sm" variant="outline" onClick={() => action("confirm")}>
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Confirm
              </Button>
              <Button size="sm" variant="outline" onClick={() => action("to_agent")}>
                <UserPlus className="h-3.5 w-3.5 mr-1" /> Agent
              </Button>
              <Button size="sm" variant="outline" onClick={() => action("cancel")}>
                <XCircle className="h-3.5 w-3.5 mr-1" /> Cancel
              </Button>
              <Button size="sm" variant="outline" onClick={() => action("resend")}>
                <RotateCcw className="h-3.5 w-3.5 mr-1" /> Resend
              </Button>
            </div>

            {/* Messages */}
            <div
              ref={scrollerRef}
              className="flex-1 overflow-y-auto p-4 space-y-3 scroll-smooth bg-[radial-gradient(circle_at_1px_1px,_hsl(var(--muted-foreground)/0.08)_1px,_transparent_0)] [background-size:16px_16px]"
            >
              <div className="flex justify-center">
                <span className="text-[10px] px-2 py-1 rounded-full bg-muted text-muted-foreground">
                  🔒 Messages are end-to-end encrypted
                </span>
              </div>

              {messages.map((m) => {
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
                        <div>{m.body}</div>
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
                            "text-[10px] uppercase tracking-wide font-semibold mb-1 opacity-80",
                            isOut ? "text-white/80" : "text-muted-foreground",
                          )}
                        >
                          Template
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
                  24h window expired — free-form messaging is blocked.
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-rose-500/40 text-rose-600 dark:text-rose-400"
                  onClick={() => action("resend")}
                >
                  <RotateCcw className="h-3.5 w-3.5 mr-1" /> Send Template
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
                    disabled={windowExpired}
                    rows={2}
                    className="resize-none"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendReply();
                      }
                    }}
                  />
                  <Button
                    onClick={sendReply}
                    disabled={windowExpired || !draft.trim()}
                    className="shrink-0 self-end"
                  >
                    <Send className="h-4 w-4 mr-1" /> Send
                  </Button>
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
  );
}
