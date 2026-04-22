import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, UserPlus, XCircle, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function WhatsappInbox() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string | null>(null);

  const { data: convos = [], isLoading } = useQuery({
    queryKey: ["wts-convos"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_conversations")
        .select("*")
        .order("updated_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15000,
  });

  const { data: messages = [] } = useQuery({
    queryKey: ["wts-messages", selected],
    queryFn: async () => {
      if (!selected) return [];
      const { data, error } = await supabase
        .from("whatsapp_messages")
        .select("*")
        .eq("conversation_id", selected)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!selected,
    refetchInterval: 10000,
  });

  const { data: order } = useQuery({
    queryKey: ["wts-order", selected],
    queryFn: async () => {
      const conv = convos.find((c: any) => c.id === selected);
      if (!conv) return null;
      const { data } = await supabase
        .from("orders")
        .select("*")
        .eq("order_id", conv.order_id)
        .maybeSingle();
      return data;
    },
    enabled: !!selected && convos.length > 0,
  });

  const action = async (mode: "confirm" | "to_agent" | "cancel" | "resend") => {
    if (!selected) return;
    const conv = convos.find((c: any) => c.id === selected);
    if (!conv) return;
    const { data, error } = await supabase.functions.invoke("whatsapp-action", {
      body: { conversation_id: selected, order_id: conv.order_id, action: mode },
    });
    if (error || !data?.ok) {
      toast.error(error?.message || data?.error || "Failed");
      return;
    }
    toast.success("Done");
    qc.invalidateQueries({ queryKey: ["wts-convos"] });
    qc.invalidateQueries({ queryKey: ["wts-messages", selected] });
    qc.invalidateQueries({ queryKey: ["wts-order", selected] });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-220px)]">
      {/* List */}
      <Card className="lg:col-span-1 overflow-hidden flex flex-col">
        <CardHeader><CardTitle className="text-base">Conversations</CardTitle></CardHeader>
        <CardContent className="overflow-y-auto p-2 space-y-1 flex-1">
          {isLoading && <div className="text-sm text-muted-foreground p-2">Loading…</div>}
          {!isLoading && convos.length === 0 && (
            <div className="text-sm text-muted-foreground p-2">No conversations yet.</div>
          )}
          {convos.map((c: any) => (
            <button
              key={c.id}
              onClick={() => setSelected(c.id)}
              className={`w-full text-left rounded-lg px-3 py-2 hover:bg-muted/60 ${
                selected === c.id ? "bg-muted" : ""
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium truncate">{c.customer_name || c.customer_phone}</div>
                <Badge variant="outline" className="text-[10px]">{c.status}</Badge>
              </div>
              <div className="text-[11px] text-muted-foreground truncate">
                {c.order_id} · {c.last_reply_at
                  ? `Reply ${format(new Date(c.last_reply_at), "HH:mm")}`
                  : c.last_message_at
                  ? `Sent ${format(new Date(c.last_message_at), "HH:mm")}`
                  : "—"}
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* Conversation */}
      <Card className="lg:col-span-2 overflow-hidden flex flex-col">
        <CardHeader className="flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">
            {selected ? "Conversation" : "Select a conversation"}
          </CardTitle>
          {selected && (
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="outline" onClick={() => action("confirm")}>
                <CheckCircle2 className="h-4 w-4 mr-1" /> Confirm
              </Button>
              <Button size="sm" variant="outline" onClick={() => action("to_agent")}>
                <UserPlus className="h-4 w-4 mr-1" /> To agent
              </Button>
              <Button size="sm" variant="outline" onClick={() => action("cancel")}>
                <XCircle className="h-4 w-4 mr-1" /> Cancel
              </Button>
              <Button size="sm" variant="outline" onClick={() => action("resend")}>
                <RotateCcw className="h-4 w-4 mr-1" /> Resend
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="flex-1 overflow-y-auto space-y-3">
          {order && (
            <div className="border rounded-lg p-3 bg-muted/30 text-xs space-y-1">
              <div><strong>Order:</strong> {order.order_id}</div>
              <div><strong>Product:</strong> {order.product_name} × {order.quantity}</div>
              <div><strong>Total:</strong> {order.total_amount}</div>
              <div><strong>City:</strong> {order.customer_city}</div>
              <div><strong>Address:</strong> {order.customer_address || "—"}</div>
              <div><strong>Status:</strong> {order.confirmation_status} / {order.delivery_status ?? "—"}</div>
            </div>
          )}
          {messages.map((m: any) => (
            <div
              key={m.id}
              className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                m.direction === "out"
                  ? "ml-auto bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <div>{m.body || <em className="opacity-70">[{m.message_type}]</em>}</div>
              <div className={`text-[10px] mt-1 ${m.direction === "out" ? "opacity-70" : "text-muted-foreground"}`}>
                {format(new Date(m.created_at), "HH:mm")} {m.status ? `· ${m.status}` : ""}
              </div>
            </div>
          ))}
          {selected && messages.length === 0 && (
            <div className="text-sm text-muted-foreground">No messages yet.</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
