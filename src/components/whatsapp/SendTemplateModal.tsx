import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Template = {
  id: string;
  name: string;
  body: string;
  language: string;
  active: boolean;
  type: string;
  meta_template_name: string | null;
};

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  conversationId: string | null;
  orderId: string | null;
  onSent?: () => void;
}

export function SendTemplateModal({
  open,
  onOpenChange,
  conversationId,
  orderId,
  onSent,
}: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: templates = [], isLoading } = useQuery<Template[]>({
    queryKey: ["wts-active-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("whatsapp_templates")
        .select("*")
        .eq("active", true)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Template[];
    },
    enabled: open,
  });

  const send = async () => {
    if (!selected) return toast.error("Pick a template");
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("whatsapp-send", {
      body: {
        mode: "template",
        template_id: selected,
        conversation_id: conversationId ?? undefined,
        order_id: orderId ?? undefined,
      },
    });
    setBusy(false);
    if (error || !data?.ok) {
      toast.error(error?.message || data?.error || "Send failed");
      return;
    }
    toast.success("Template sent");
    setSelected(null);
    onOpenChange(false);
    onSent?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Send Template</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-2 -mx-2 px-2">
          {isLoading && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              Loading templates…
            </div>
          )}
          {!isLoading && templates.length === 0 && (
            <div className="text-sm text-muted-foreground py-6 text-center">
              No active templates. Create one in the Templates tab.
            </div>
          )}
          {templates.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelected(t.id)}
              className={cn(
                "w-full text-left rounded-lg border p-3 transition-colors",
                selected === t.id
                  ? "border-primary bg-primary/5"
                  : "border-border hover:bg-muted/40",
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">{t.name}</div>
                <span className="text-[10px] text-muted-foreground uppercase">
                  {t.language}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap line-clamp-3">
                {t.body}
              </div>
              {t.meta_template_name && (
                <div className="text-[10px] text-primary mt-1">
                  Meta: {t.meta_template_name}
                </div>
              )}
            </button>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={send} disabled={busy || !selected}>
            {busy ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-1" />
            )}
            Send
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
