import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare, CheckCircle2, AlertTriangle, XCircle, Send, Reply, MessageCircleQuestion, RotateCcw } from "lucide-react";

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
      const [inWts, confirmed, escalated, canceled, sent, replies, unansweredRows, followUpRows] = await Promise.all([
        supabase.from("orders").select("id", { count: "exact", head: true }).eq("confirmation_status", "new_wts"),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("status", "confirmed").gte("updated_at", todayISO),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("status", "more_info").gte("updated_at", todayISO),
        supabase.from("whatsapp_conversations").select("id", { count: "exact", head: true }).eq("status", "canceled").gte("updated_at", todayISO),
        supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("direction", "out").gte("created_at", todayISO),
        supabase.from("whatsapp_messages").select("id", { count: "exact", head: true }).eq("direction", "in").gte("created_at", todayISO),
        // Conversations whose latest customer message has no reply yet. PostgREST filters can't
        // compare two columns to each other, so this is counted client-side.
        supabase.from("whatsapp_conversations").select("last_inbound_at, last_reply_at").not("last_inbound_at", "is", null).order("last_inbound_at", { ascending: false }).limit(2000),
        // Same "needs follow-up" definition as the Inbox's Follow Up tab: labeled
        // followup_<status> by the automation runner, excluding followup_shipped
        // (a shipped notice alone doesn't need staff follow-up).
        supabase.from("whatsapp_conversations").select("labels").not("labels", "is", null).limit(3000),
      ]);
      const unanswered = (unansweredRows.data || []).filter((c) =>
        !c.last_reply_at || new Date(c.last_reply_at) < new Date(c.last_inbound_at)
      ).length;
      const followUp = (followUpRows.data || []).filter((c) =>
        Array.isArray(c.labels) && c.labels.some((l: string) => l.startsWith("followup_") && l !== "followup_shipped")
      ).length;
      return {
        inWts: inWts.count ?? 0,
        confirmed: confirmed.count ?? 0,
        escalated: escalated.count ?? 0,
        canceled: canceled.count ?? 0,
        sent: sent.count ?? 0,
        replies: replies.count ?? 0,
        unanswered,
        followUp,
      };
    },
    refetchInterval: 30000,
  });

  const cards = [
    { label: "In WhatsApp", value: stats?.inWts ?? 0, icon: MessageSquare, tone: "text-foreground" },
    { label: "Unanswered", value: stats?.unanswered ?? 0, icon: MessageCircleQuestion, tone: "text-amber-600" },
    { label: "Follow Up", value: stats?.followUp ?? 0, icon: RotateCcw, tone: "text-amber-600" },
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
