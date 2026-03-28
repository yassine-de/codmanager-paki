import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertTriangle, Bell, Info, Plus, Pencil, Trash2, Calendar } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

type Alert = {
  id: string;
  title: string;
  message: string;
  urgency: string;
  is_active: boolean;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
};

const urgencyConfig = {
  info: { label: "Info", color: "bg-blue-500/15 text-blue-400 border-blue-500/30", icon: Info },
  medium: { label: "Medium", color: "bg-orange-500/15 text-orange-400 border-orange-500/30", icon: Bell },
  urgent: { label: "Urgent", color: "bg-red-500/15 text-red-400 border-red-500/30", icon: AlertTriangle },
};

const emptyForm = {
  title: "",
  message: "",
  urgency: "info",
  is_active: true,
  use_timing: false,
  start_date: "",
  end_date: "",
};

export default function Alerts() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Alert[];
    },
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        title: form.title,
        message: form.message,
        urgency: form.urgency,
        is_active: form.is_active,
        start_date: form.use_timing && form.start_date ? form.start_date : null,
        end_date: form.use_timing && form.end_date ? form.end_date : null,
      };
      if (editingId) {
        const { error } = await supabase.from("alerts").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("alerts").insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success(editingId ? "Alert updated" : "Alert created");
      resetForm();
    },
    onError: (e: any) => toast.error(e.message),
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from("alerts").update({ is_active }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Alert status updated");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alerts").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast.success("Alert deleted");
    },
  });

  const resetForm = () => {
    setForm(emptyForm);
    setEditingId(null);
    setOpen(false);
  };

  const openEdit = (a: Alert) => {
    setForm({
      title: a.title,
      message: a.message,
      urgency: a.urgency,
      is_active: a.is_active,
      use_timing: !!(a.start_date || a.end_date),
      start_date: a.start_date ? a.start_date.slice(0, 16) : "",
      end_date: a.end_date ? a.end_date.slice(0, 16) : "",
    });
    setEditingId(a.id);
    setOpen(true);
  };

  const placeholders = [
    "📢 New update available",
    "⚠️ Delivery delays expected",
    "🚨 Important: Action required",
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Alerts Management</h1>
          <p className="text-sm text-muted-foreground">Create and manage alerts displayed to sellers</p>
        </div>
        <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); setOpen(v); }}>
          <DialogTrigger asChild>
            <Button size="sm"><Plus className="h-4 w-4 mr-1" /> New Alert</Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Alert" : "Create Alert"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label>Title</Label>
                <Input
                  placeholder={placeholders[Math.floor(Math.random() * placeholders.length)]}
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Message</Label>
                <Textarea
                  placeholder="Write your alert message here... Emojis supported! 🎉"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                  rows={4}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Urgency Level</Label>
                <Select value={form.urgency} onValueChange={(v) => setForm({ ...form, urgency: v })}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="info">🔵 Info</SelectItem>
                    <SelectItem value="medium">🟠 Medium</SelectItem>
                    <SelectItem value="urgent">🔴 Urgent</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  checked={form.is_active}
                  onCheckedChange={(v) => setForm({ ...form, is_active: v })}
                />
                <Label>Active</Label>
              </div>
              <div className="border rounded-lg p-3 space-y-3">
                <div className="flex items-center gap-2">
                  <Switch
                    checked={form.use_timing}
                    onCheckedChange={(v) => setForm({ ...form, use_timing: v })}
                  />
                  <Label className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" /> Schedule timing
                  </Label>
                </div>
                {form.use_timing && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Start Date</Label>
                      <Input
                        type="datetime-local"
                        value={form.start_date}
                        onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">End Date</Label>
                      <Input
                        type="datetime-local"
                        value={form.end_date}
                        onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                      />
                    </div>
                  </div>
                )}
              </div>
              <Button
                className="w-full"
                onClick={() => saveMutation.mutate()}
                disabled={!form.title.trim() || !form.message.trim() || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving..." : editingId ? "Update Alert" : "Create Alert"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">All Alerts</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-sm text-muted-foreground">Loading...</div>
          ) : alerts.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">No alerts yet</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Urgency</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timing</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.map((a) => {
                  const cfg = urgencyConfig[a.urgency as keyof typeof urgencyConfig] || urgencyConfig.info;
                  const Icon = cfg.icon;
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 shrink-0" />
                          <div>
                            <div className="font-medium text-sm">{a.title}</div>
                            <div className="text-xs text-muted-foreground line-clamp-1">{a.message}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge className={cfg.color} variant="outline">{cfg.label}</Badge>
                      </TableCell>
                      <TableCell>
                        <Switch
                          checked={a.is_active}
                          onCheckedChange={(v) => toggleMutation.mutate({ id: a.id, is_active: v })}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.start_date || a.end_date ? (
                          <div>
                            {a.start_date && <div>From: {format(new Date(a.start_date), "MMM d, HH:mm")}</div>}
                            {a.end_date && <div>To: {format(new Date(a.end_date), "MMM d, HH:mm")}</div>}
                          </div>
                        ) : (
                          "Always"
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(a)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            onClick={() => deleteMutation.mutate(a.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
