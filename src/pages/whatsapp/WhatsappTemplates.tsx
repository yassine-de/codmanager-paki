import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Trash2, Plus } from "lucide-react";
import { toast } from "sonner";

const TYPES = [
  { value: "first_message", label: "First message" },
  { value: "reminder", label: "Reminder" },
  { value: "more_info", label: "More info" },
  { value: "cancel_recovery", label: "Cancel recovery" },
];

const VARS = ["customer_name", "product_name", "price", "city", "address", "order_id"];

export default function WhatsappTemplates() {
  const qc = useQueryClient();
  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["wts-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const [form, setForm] = useState({
    name: "",
    type: "first_message",
    language: "en",
    meta_template_name: "",
    body: "",
    active: true,
  });

  const create = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast.error("Name and body are required");
      return;
    }
    const { error } = await supabase.from("whatsapp_templates").insert(form);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Template created");
    setForm({ name: "", type: "first_message", language: "en", meta_template_name: "", body: "", active: true });
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("whatsapp_templates").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
  };

  const toggleActive = async (id: string, active: boolean) => {
    await supabase.from("whatsapp_templates").update({ active }).eq("id", id);
    qc.invalidateQueries({ queryKey: ["wts-templates"] });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <Card className="lg:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">New template</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div>
            <Label>Name</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>Type</Label>
            <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Language</Label>
              <Input value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value })} placeholder="en, ur, en_US" />
            </div>
            <div>
              <Label>Meta template name</Label>
              <Input value={form.meta_template_name} onChange={(e) => setForm({ ...form, meta_template_name: e.target.value })} placeholder="optional" />
            </div>
          </div>
          <div>
            <Label>Body</Label>
            <Textarea
              rows={6}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              placeholder="Hi {{customer_name}}, your order {{order_id}} for {{product_name}} ({{price}})..."
            />
            <div className="mt-2 flex flex-wrap gap-1">
              {VARS.map((v) => (
                <Badge key={v} variant="secondary" className="text-[10px] cursor-pointer"
                  onClick={() => setForm((f) => ({ ...f, body: f.body + ` {{${v}}}` }))}>
                  {`{{${v}}}`}
                </Badge>
              ))}
            </div>
          </div>
          <Button onClick={create} className="w-full"><Plus className="h-4 w-4 mr-2" /> Create</Button>
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle className="text-base">Templates</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
          {!isLoading && templates.length === 0 && (
            <div className="text-sm text-muted-foreground">No templates yet.</div>
          )}
          {templates.map((t: any) => (
            <div key={t.id} className="border rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{t.name}</div>
                  <div className="text-[11px] text-muted-foreground flex gap-2">
                    <Badge variant="outline" className="text-[10px]">{t.type}</Badge>
                    <span>{t.language}</span>
                    {t.meta_template_name && <span>· {t.meta_template_name}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Switch checked={t.active} onCheckedChange={(v) => toggleActive(t.id, v)} />
                  <Button size="icon" variant="ghost" onClick={() => remove(t.id)}>
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
              <pre className="text-xs whitespace-pre-wrap text-muted-foreground bg-muted/40 p-2 rounded">{t.body}</pre>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
