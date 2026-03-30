import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageCircle, Send, X, ArrowLeft, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";
import { playSellerNotificationSound } from "@/lib/support-sounds";

type Ticket = {
  id: string;
  issue_type: string;
  related_id: string | null;
  status: string;
  created_at: string;
};

type Message = {
  id: string;
  ticket_id: string;
  sender_id: string;
  sender_type: string;
  message: string;
  created_at: string;
  read_at: string | null;
};

const statusColors: Record<string, string> = {
  open: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  in_progress: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  closed: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  closed: "Closed",
};

const issueLabels: Record<string, string> = {
  product: "Product Issue",
  order: "Order Issue",
  sourcing: "Sourcing Issue",
  other: "Other",
};

type View = "list" | "new" | "chat";

export function SellerSupportChat() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [newMessage, setNewMessage] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const prevUnreadRef = useRef<number>(0);

  // New ticket form
  const [issueType, setIssueType] = useState("other");
  const [relatedId, setRelatedId] = useState("");
  const [firstMessage, setFirstMessage] = useState("");

  // Fetch seller's tickets
  const { data: tickets = [] } = useQuery({
    queryKey: ["seller-support-tickets"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
    enabled: !!authUser && open,
    refetchInterval: 10000,
  });

  // Fetch messages for selected ticket
  const { data: messages = [] } = useQuery({
    queryKey: ["seller-support-messages", selectedTicketId],
    queryFn: async () => {
      if (!selectedTicketId) return [];
      const { data, error } = await supabase
        .from("support_messages")
        .select("*")
        .eq("ticket_id", selectedTicketId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!selectedTicketId,
  });

  // Realtime for messages
  useEffect(() => {
    if (!selectedTicketId) return;
    const channel = supabase
      .channel(`seller-support-${selectedTicketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `ticket_id=eq.${selectedTicketId}` },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["seller-support-messages", selectedTicketId] });
          queryClient.invalidateQueries({ queryKey: ["seller-support-unread"] });
          // Mark admin messages as read if chat is open
          if (payload.new && (payload.new as any).sender_type === "admin") {
            supabase
              .from("support_messages")
              .update({ read_at: new Date().toISOString() })
              .eq("id", (payload.new as any).id)
              .then();
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedTicketId, queryClient]);

  // Unread count (admin messages not read by seller)
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["seller-support-unread"],
    queryFn: async () => {
      if (!authUser) return 0;
      const { data: tix } = await supabase
        .from("support_tickets")
        .select("id");
      if (!tix?.length) return 0;
      const { count } = await supabase
        .from("support_messages")
        .select("*", { count: "exact", head: true })
        .in("ticket_id", tix.map((t: any) => t.id))
        .eq("sender_type", "admin")
        .is("read_at", null);
      return count || 0;
    },
    enabled: !!authUser,
    refetchInterval: 15000,
  });

  // Realtime for global unread (even when chat popup is closed) + toast
  useEffect(() => {
    if (!authUser || authUser.role !== "seller") return;
    const channel = supabase
      .channel("seller-support-global-unread")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        (payload) => {
          const msg = payload.new as any;
          if (msg.sender_type === "admin" && msg.sender_id !== authUser.id) {
            queryClient.invalidateQueries({ queryKey: ["seller-support-unread"] });
            queryClient.invalidateQueries({ queryKey: ["seller-support-messages", msg.ticket_id] });
            queryClient.invalidateQueries({ queryKey: ["seller-support-tickets"] });
            // Show toast notification
            toast.info("New message from support", {
              description: msg.message?.slice(0, 80) + (msg.message?.length > 80 ? "..." : ""),
              duration: 4000,
            });
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [authUser, queryClient]);

  // Play sound on new unread
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current && prevUnreadRef.current >= 0) {
      playSellerNotificationSound();
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // Mark messages as read when opening a ticket
  const markTicketRead = async (ticketId: string) => {
    await supabase
      .from("support_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("ticket_id", ticketId)
      .eq("sender_type", "admin")
      .is("read_at", null);
    queryClient.invalidateQueries({ queryKey: ["seller-support-unread"] });
  };

  // Create ticket
  const createTicket = useMutation({
    mutationFn: async () => {
      if (!authUser || !firstMessage.trim()) return;
      const { data: ticket, error: ticketErr } = await supabase
        .from("support_tickets")
        .insert({
          seller_id: authUser.id,
          issue_type: issueType,
          related_id: relatedId.trim() || null,
          status: "open",
        })
        .select()
        .single();
      if (ticketErr) throw ticketErr;

      const { error: msgErr } = await supabase.from("support_messages").insert({
        ticket_id: ticket.id,
        sender_id: authUser.id,
        sender_type: "seller",
        message: firstMessage.trim(),
      });
      if (msgErr) throw msgErr;

      return ticket;
    },
    onSuccess: (ticket) => {
      if (ticket) {
        setSelectedTicketId(ticket.id);
        setView("chat");
        setIssueType("other");
        setRelatedId("");
        setFirstMessage("");
        queryClient.invalidateQueries({ queryKey: ["seller-support-tickets"] });
      }
    },
    onError: () => toast.error("Failed to create ticket"),
  });

  // Send message
  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!newMessage.trim() || !selectedTicketId || !authUser) return;

      const ticket = tickets.find((t: Ticket) => t.id === selectedTicketId);
      if (ticket?.status === "closed") {
        await supabase
          .from("support_tickets")
          .update({ status: "open", updated_at: new Date().toISOString() })
          .eq("id", selectedTicketId);
      } else {
        await supabase
          .from("support_tickets")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", selectedTicketId);
      }

      const { error } = await supabase.from("support_messages").insert({
        ticket_id: selectedTicketId,
        sender_id: authUser.id,
        sender_type: "seller",
        message: newMessage.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewMessage("");
      queryClient.invalidateQueries({ queryKey: ["seller-support-messages", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["seller-support-tickets"] });
    },
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const showIdField = issueType === "product" || issueType === "order" || issueType === "sourcing";
  const idPlaceholder = issueType === "product" ? "Product ID" : issueType === "order" ? "Order ID" : "Sourcing ID";

  if (!authUser || authUser.role !== "seller") return null;

  return (
    <>
      {/* Floating Button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-50 h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:bg-primary/90 transition-all flex items-center justify-center"
      >
        {open ? <X className="h-6 w-6" /> : (
          <div className="relative">
            <MessageCircle className="h-6 w-6" />
            {unreadCount > 0 && (
              <span className="absolute -top-2 -right-2 min-w-[18px] h-[18px] px-1 flex items-center justify-center rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold animate-bounce">
                {unreadCount}
              </span>
            )}
          </div>
        )}
      </button>

      {/* Chat Panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-h-[520px] rounded-2xl border bg-card shadow-2xl flex flex-col overflow-hidden animate-in slide-in-from-bottom-4 fade-in duration-200">
          {/* Header */}
          <div className="px-4 py-3 border-b bg-primary/5 flex items-center gap-2">
            {view !== "list" && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => {
                  setView("list");
                  setSelectedTicketId(null);
                }}
              >
                <ArrowLeft className="h-4 w-4" />
              </Button>
            )}
            <h3 className="text-sm font-semibold flex-1">
              {view === "list" ? "Support" : view === "new" ? "New Ticket" : "Chat"}
            </h3>
            {view === "list" && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => setView("new")}>
                <Plus className="h-3.5 w-3.5" /> New
              </Button>
            )}
          </div>

          {/* Content */}
          {view === "list" && (
            <ScrollArea className="flex-1 max-h-[420px]">
              {tickets.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageCircle className="h-10 w-10 mx-auto mb-2 text-muted-foreground/30" />
                  <p className="text-sm text-muted-foreground">No tickets yet</p>
                  <Button size="sm" className="mt-3 text-xs" onClick={() => setView("new")}>
                    Create Ticket
                  </Button>
                </div>
              ) : (
                <div className="divide-y">
                  {tickets.map((ticket: Ticket) => (
                    <button
                      key={ticket.id}
                      onClick={() => {
                        setSelectedTicketId(ticket.id);
                        setView("chat");
                        markTicketRead(ticket.id);
                      }}
                      className="w-full text-left px-4 py-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{issueLabels[ticket.issue_type]}</span>
                        <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusColors[ticket.status])}>
                          {statusLabels[ticket.status]}
                        </Badge>
                      </div>
                      {ticket.related_id && (
                        <p className="text-[11px] text-muted-foreground font-mono mt-0.5">#{ticket.related_id}</p>
                      )}
                      <p className="text-[10px] text-muted-foreground/60 mt-1">
                        {format(new Date(ticket.created_at), "MMM dd, HH:mm")}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          )}

          {view === "new" && (
            <div className="p-4 space-y-3">
              <div>
                <label className="text-xs font-medium mb-1 block">Issue Type</label>
                <Select value={issueType} onValueChange={setIssueType}>
                  <SelectTrigger className="h-9 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="product" className="text-xs">Product Issue</SelectItem>
                    <SelectItem value="order" className="text-xs">Order Issue</SelectItem>
                    <SelectItem value="sourcing" className="text-xs">Sourcing Issue</SelectItem>
                    <SelectItem value="other" className="text-xs">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {showIdField && (
                <div>
                  <label className="text-xs font-medium mb-1 block">{idPlaceholder}</label>
                  <Input
                    value={relatedId}
                    onChange={(e) => setRelatedId(e.target.value)}
                    placeholder={`Enter ${idPlaceholder}`}
                    className="h-9 text-xs"
                  />
                </div>
              )}

              <div>
                <label className="text-xs font-medium mb-1 block">Message</label>
                <Textarea
                  value={firstMessage}
                  onChange={(e) => setFirstMessage(e.target.value)}
                  placeholder="Describe your issue..."
                  className="text-xs min-h-[80px] resize-none"
                />
              </div>

              <Button
                className="w-full h-9 text-xs"
                disabled={!firstMessage.trim() || createTicket.isPending}
                onClick={() => createTicket.mutate()}
              >
                <Send className="h-3.5 w-3.5 mr-1.5" />
                {createTicket.isPending ? "Sending..." : "Send"}
              </Button>
            </div>
          )}

          {view === "chat" && selectedTicketId && (
            <>
              {/* Ticket Info */}
              {(() => {
                const t = tickets.find((tk: Ticket) => tk.id === selectedTicketId);
                if (!t) return null;
                return (
                  <div className="px-4 py-2 border-b bg-muted/30 flex items-center gap-2 text-[11px]">
                    <span className="font-medium">{issueLabels[t.issue_type]}</span>
                    {t.related_id && <span className="font-mono text-muted-foreground">#{t.related_id}</span>}
                    <Badge variant="outline" className={cn("ml-auto text-[10px] px-1.5 py-0", statusColors[t.status])}>
                      {statusLabels[t.status]}
                    </Badge>
                  </div>
                );
              })()}

              <ScrollArea className="flex-1 max-h-[320px] p-3">
                <div className="space-y-2.5">
                  {messages.map((msg: Message) => {
                    const isSeller = msg.sender_type === "seller";
                    return (
                      <div key={msg.id} className={cn("flex", isSeller ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[75%] rounded-2xl px-3.5 py-2",
                          isSeller
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted rounded-bl-md"
                        )}>
                          <p className="text-[13px] whitespace-pre-wrap break-words">{msg.message}</p>
                          <p className={cn(
                            "text-[10px] mt-0.5",
                            isSeller ? "text-primary-foreground/60" : "text-muted-foreground/60"
                          )}>
                            {format(new Date(msg.created_at), "HH:mm")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>
              </ScrollArea>

              <div className="p-3 border-t">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    sendMessage.mutate();
                  }}
                  className="flex gap-2"
                >
                  <Input
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className="flex-1 h-8 text-xs"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-8 w-8 p-0"
                    disabled={!newMessage.trim() || sendMessage.isPending}
                  >
                    <Send className="h-3.5 w-3.5" />
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
