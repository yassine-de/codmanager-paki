import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, CheckCircle2, AlertTriangle, XCircle, Send, Reply } from "lucide-react";

function startOfTodayISO() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export default function WhatsappOverview() {
  const todayISO = startOfTodayISO();

  const { data: stats } = useQuery({
    queryKey: ["wts-overview"],
    queryFn: async () => {
      const [inWts, confirmed, escalated, canceled, sent, replies] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("confirmation_status", "new_wts"),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("status", "confirmed").gte("updated_at", todayISO),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("status", "more_info").gte("updated_at", todayISO),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("status", "canceled").gte("updated_at", todayISO),
        supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("direction", "out").gte("created_at", todayISO),
        supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("direction", "in").gte("created_at", todayISO),
      ]);
      return {
        inWts: inWts.count ?? 0,
        confirmed: confirmed.count ?? 0,
        escalated: escalated.count ?? 0,
        canceled: canceled.count ?? 0,
        sent: sent.count ?? 0,
        replies: replies.count ?? 0,
      };
    },
    refetchInterval: 30000,
  });

  const cards = [
    { label: "In WhatsApp", value: stats?.inWts ?? 0, icon: MessageSquare, tone: "text-foreground" },
    { label: "Confirmed today", value: stats?.confirmed ?? 0, icon: CheckCircle2, tone: "text-emerald-600" },
    { label: "Escalated today", value: stats?.escalated ?? 0, icon: AlertTriangle, tone: "text-amber-600" },
    { label: "Canceled today", value: stats?.canceled ?? 0, icon: XCircle, tone: "text-rose-600" },
    { label: "Messages sent today", value: stats?.sent ?? 0, icon: Send, tone: "text-foreground" },
    { label: "Replies received today", value: stats?.replies ?? 0, icon: Reply, tone: "text-foreground" },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.label}</CardTitle>
            <c.icon className={`h-4 w-4 ${c.tone}`} />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${c.tone}`}>{c.value}</div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
