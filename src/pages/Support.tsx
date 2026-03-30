import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MessageSquare, Send, Search, ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import { toast } from "sonner";


type Ticket = {
  id: string;
  seller_id: string;
  issue_type: string;
  related_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  seller_name?: string;
  last_message?: string;
  last_message_at?: string;
  unread_count?: number;
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

// Priority order for sorting
const statusPriority: Record<string, number> = { open: 0, in_progress: 1, closed: 2 };

export default function Support() {
  const { authUser } = useAuth();
  const queryClient = useQueryClient();
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [readFilter, setReadFilter] = useState<string>("all"); // all | unread | read
  const [searchQuery, setSearchQuery] = useState("");
  const [newMessage, setNewMessage] = useState("");
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  

  // Fetch all tickets with seller names + unread counts
  const { data: tickets = [] } = useQuery({
    queryKey: ["support-tickets", statusFilter],
    queryFn: async () => {
      let query = supabase
        .from("support_tickets")
        .select("*")
        .order("updated_at", { ascending: false });

      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const sellerIds = [...new Set((data || []).map((t: any) => t.seller_id))];
      const ticketIds = (data || []).map((t: any) => t.id);

      const [{ data: profiles }, { data: messages }] = await Promise.all([
        supabase.from("profiles").select("user_id, name").in("user_id", sellerIds),
        supabase
          .from("support_messages")
          .select("ticket_id, message, created_at, sender_type, read_at")
          .in("ticket_id", ticketIds)
          .order("created_at", { ascending: false }),
      ]);

      const profileMap = Object.fromEntries((profiles || []).map((p: any) => [p.user_id, p.name]));

      return (data || []).map((ticket: any) => {
        const ticketMessages = (messages || []).filter((m: any) => m.ticket_id === ticket.id);
        const lastMsg = ticketMessages[0];
        // Unread = seller messages that admin hasn't read
        const unreadCount = ticketMessages.filter(
          (m: any) => m.sender_type === "seller" && !m.read_at
        ).length;

        return {
          ...ticket,
          seller_name: profileMap[ticket.seller_id] || "Unknown",
          last_message: lastMsg?.message || "",
          last_message_at: lastMsg?.created_at || ticket.created_at,
          unread_count: unreadCount,
        };
      });
    },
    refetchInterval: 10000,
  });

  // Fetch messages for selected ticket
  const { data: messages = [] } = useQuery({
    queryKey: ["support-messages", selectedTicketId],
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

  // Mark messages as read when opening a conversation
  const markMessagesRead = useCallback(async (ticketId: string) => {
    await supabase
      .from("support_messages")
      .update({ read_at: new Date().toISOString() })
      .eq("ticket_id", ticketId)
      .eq("sender_type", "seller")
      .is("read_at", null);
    queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
  }, [queryClient]);

  // Realtime subscription for messages
  useEffect(() => {
    if (!selectedTicketId) return;
    const channel = supabase
      .channel(`support-messages-${selectedTicketId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages", filter: `ticket_id=eq.${selectedTicketId}` },
        (payload) => {
          queryClient.invalidateQueries({ queryKey: ["support-messages", selectedTicketId] });
          queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
          // Auto-mark as read if admin is viewing this conversation
          if (payload.new && (payload.new as any).sender_type === "seller") {
            markMessagesRead(selectedTicketId);
          }
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [selectedTicketId, queryClient, markMessagesRead]);

  // Realtime for ticket list updates
  useEffect(() => {
    const channel = supabase
      .channel("support-tickets-list")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "support_tickets" },
        () => queryClient.invalidateQueries({ queryKey: ["support-tickets"] })
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "support_messages" },
        () => queryClient.invalidateQueries({ queryKey: ["support-tickets"] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  // Send message
  const sendMessage = useMutation({
    mutationFn: async () => {
      if (!newMessage.trim() || !selectedTicketId || !authUser) return;
      const { error } = await supabase.from("support_messages").insert({
        ticket_id: selectedTicketId,
        sender_id: authUser.id,
        sender_type: "admin",
        message: newMessage.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setNewMessage("");
      queryClient.invalidateQueries({ queryKey: ["support-messages", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
    },
    onError: () => toast.error("Failed to send message"),
  });

  // Update ticket status
  const updateStatus = useMutation({
    mutationFn: async (newStatus: string) => {
      if (!selectedTicketId) return;
      const { error } = await supabase
        .from("support_tickets")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", selectedTicketId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["support-tickets"] });
      toast.success("Status updated");
    },
  });

  // Auto scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const selectedTicket = tickets.find((t: Ticket) => t.id === selectedTicketId);

  // Filter + Sort
  const filteredTickets = tickets
    .filter((t: Ticket) => {
      if (searchQuery && !(
        t.seller_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.issue_type.toLowerCase().includes(searchQuery.toLowerCase())
      )) return false;
      if (readFilter === "unread" && !(t.unread_count && t.unread_count > 0)) return false;
      if (readFilter === "read" && t.unread_count && t.unread_count > 0) return false;
      return true;
    })
    .sort((a: Ticket, b: Ticket) => {
      // 1. Unread first
      const aUnread = (a.unread_count || 0) > 0 ? 0 : 1;
      const bUnread = (b.unread_count || 0) > 0 ? 0 : 1;
      if (aUnread !== bUnread) return aUnread - bUnread;
      // 2. Status priority
      const aPri = statusPriority[a.status] ?? 3;
      const bPri = statusPriority[b.status] ?? 3;
      if (aPri !== bPri) return aPri - bPri;
      // 3. Latest message time
      return new Date(b.last_message_at || b.created_at).getTime() - new Date(a.last_message_at || a.created_at).getTime();
    });

  const handleSelectTicket = (id: string) => {
    setSelectedTicketId(id);
    setMobileShowChat(true);
    markMessagesRead(id);
  };

  return (
    <div className="h-[calc(100vh-7rem)]">
      <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold">Support Center</h1>
          <p className="text-xs text-muted-foreground">Manage seller support tickets</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Filters */}
          {["all", "open", "in_progress", "closed"].map((s) => (
            <Button
              key={s}
              variant={statusFilter === s ? "default" : "outline"}
              size="sm"
              className="text-xs h-8"
              onClick={() => setStatusFilter(s)}
            >
              {s === "all" ? "All" : statusLabels[s]}
            </Button>
          ))}
          <div className="w-px h-6 bg-border" />
          {/* Read/Unread Filters */}
          {["all", "unread", "read"].map((r) => (
            <Button
              key={r}
              variant={readFilter === r ? "secondary" : "ghost"}
              size="sm"
              className="text-xs h-8"
              onClick={() => setReadFilter(r)}
            >
              {r === "all" ? "All" : r === "unread" ? "Unread" : "Read"}
            </Button>
          ))}
        </div>
      </div>

      <div className="flex gap-4 h-[calc(100%-3.5rem)]">
        {/* Ticket List */}
        <Card className={cn(
          "w-[360px] shrink-0 flex flex-col overflow-hidden",
          mobileShowChat && "hidden md:flex"
        )}>
          <div className="p-3 border-b">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search sellers..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 h-8 text-xs"
              />
            </div>
          </div>
          <ScrollArea className="flex-1">
            {filteredTickets.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">No tickets found</div>
            ) : (
              <div className="divide-y">
                {filteredTickets.map((ticket: Ticket) => {
                  const hasUnread = (ticket.unread_count || 0) > 0;
                  return (
                    <button
                      key={ticket.id}
                      onClick={() => handleSelectTicket(ticket.id)}
                      className={cn(
                        "w-full text-left px-3 py-3 hover:bg-muted/50 transition-colors",
                        selectedTicketId === ticket.id && "bg-muted",
                        hasUnread && selectedTicketId !== ticket.id && "bg-primary/5"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={cn(
                              "text-sm truncate",
                              hasUnread ? "font-bold" : "font-medium"
                            )}>
                              {ticket.seller_name}
                            </span>
                            <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusColors[ticket.status])}>
                              {statusLabels[ticket.status]}
                            </Badge>
                          </div>
                          <p className={cn(
                            "text-[11px] mt-0.5",
                            hasUnread ? "text-foreground/80 font-medium" : "text-muted-foreground"
                          )}>
                            {issueLabels[ticket.issue_type]}
                            {ticket.related_id && <span className="ml-1 font-mono">#{ticket.related_id}</span>}
                          </p>
                          <p className={cn(
                            "text-xs mt-1 truncate",
                            hasUnread ? "text-foreground/70 font-medium" : "text-muted-foreground/70"
                          )}>
                            {ticket.last_message}
                          </p>
                        </div>
                        <div className="text-right shrink-0 flex flex-col items-end gap-1">
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(ticket.last_message_at || ticket.created_at), "HH:mm")}
                          </span>
                          {hasUnread && (
                            <span className="min-w-[20px] h-5 px-1.5 flex items-center justify-center rounded-full bg-emerald-500 text-white text-[11px] font-bold">
                              {ticket.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </Card>

        {/* Chat Area */}
        <Card className={cn(
          "flex-1 flex flex-col overflow-hidden",
          !mobileShowChat && !selectedTicketId && "hidden md:flex"
        )}>
          {!selectedTicket ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground">
              <div className="text-center">
                <MessageSquare className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Select a ticket to view conversation</p>
              </div>
            </div>
          ) : (
            <>
              {/* Chat Header */}
              <div className="p-3 border-b flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 md:hidden"
                  onClick={() => setMobileShowChat(false)}
                >
                  <ArrowLeft className="h-4 w-4" />
                </Button>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{selectedTicket.seller_name}</span>
                    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", statusColors[selectedTicket.status])}>
                      {statusLabels[selectedTicket.status]}
                    </Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {issueLabels[selectedTicket.issue_type]}
                    {selectedTicket.related_id && <span className="ml-1 font-mono">· #{selectedTicket.related_id}</span>}
                    <span className="ml-2">· {format(new Date(selectedTicket.created_at), "MMM dd, yyyy")}</span>
                  </p>
                </div>
                <Select
                  value={selectedTicket.status}
                  onValueChange={(val) => updateStatus.mutate(val)}
                >
                  <SelectTrigger className="w-[130px] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="open" className="text-xs">Open</SelectItem>
                    <SelectItem value="in_progress" className="text-xs">In Progress</SelectItem>
                    <SelectItem value="closed" className="text-xs">Closed</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Messages */}
              <ScrollArea className="flex-1 p-4">
                <div className="space-y-3">
                  {messages.map((msg: Message) => {
                    const isAdmin = msg.sender_type === "admin";
                    return (
                      <div key={msg.id} className={cn("flex", isAdmin ? "justify-end" : "justify-start")}>
                        <div className={cn(
                          "max-w-[70%] rounded-2xl px-4 py-2.5",
                          isAdmin
                            ? "bg-primary text-primary-foreground rounded-br-md"
                            : "bg-muted rounded-bl-md"
                        )}>
                          <p className="text-sm whitespace-pre-wrap break-words">{msg.message}</p>
                          <p className={cn(
                            "text-[10px] mt-1",
                            isAdmin ? "text-primary-foreground/60" : "text-muted-foreground/60"
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

              {/* Message Input */}
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
                    className="flex-1 h-9 text-sm"
                  />
                  <Button
                    type="submit"
                    size="sm"
                    className="h-9 px-4"
                    disabled={!newMessage.trim() || sendMessage.isPending}
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
