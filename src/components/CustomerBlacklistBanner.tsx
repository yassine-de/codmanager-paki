import { useState } from "react";
import { Ban, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  type BlacklistStatus, blacklistSummary, useBlacklistPermissions, useCustomerBlacklist, useSetCustomerBlacklist,
} from "@/hooks/useCustomerBlacklist";

export function BlacklistBadge({ status, className }: { status?: BlacklistStatus; className?: string }) {
  if (!status?.is_blacklisted) return null;
  return (
    <span
      title={blacklistSummary(status)}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide",
        "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/30",
        className,
      )}
    >
      <Ban className="h-2.5 w-2.5" /> Blacklist
    </span>
  );
}

export function CustomerBlacklistBanner({ phone, className }: { phone: string | null | undefined; className?: string }) {
  const { canView, canAdd, canRemove } = useBlacklistPermissions();
  const { data } = useCustomerBlacklist([phone]);
  const setBlacklist = useSetCustomerBlacklist();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!canView || !phone) return null;
  const status = data?.get(phone);

  const submit = async (blacklisted: boolean, why?: string) => {
    setBusy(true);
    try {
      await setBlacklist(phone, blacklisted, why);
      toast.success(blacklisted ? "Customer added to blacklist" : "Customer removed from blacklist");
      setDialogOpen(false);
      setReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update blacklist");
    } finally {
      setBusy(false);
    }
  };

  if (status?.is_blacklisted) {
    return (
      <div className={cn("rounded-lg border border-[hsl(0,65%,52%)]/40 bg-[hsl(0,65%,52%)]/10 p-3 space-y-1.5", className)}>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[hsl(0,65%,52%)] font-bold text-xs uppercase tracking-wide">
            <Ban className="h-3.5 w-3.5 shrink-0" />
            Blacklisted customer
            <span className="font-medium normal-case tracking-normal text-[10px] opacity-80">
              ({status.source === "manual" ? "manual" : "auto"})
            </span>
          </div>
          {canRemove && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px]"
              disabled={busy}
              onClick={() => submit(false)}
            >
              <ShieldCheck className="h-3 w-3 mr-1" /> Remove
            </Button>
          )}
        </div>
        <p className="text-xs text-foreground">{blacklistSummary(status)}</p>
        <p className="text-[11px] text-muted-foreground">
          Returned: <span className="font-semibold tabular-nums">{status.returned_count}</span>
          {" · "}
          Delivered: <span className="font-semibold tabular-nums">{status.delivered_count}</span>
          {" · "}
          Check carefully with the customer before confirming.
        </p>
      </div>
    );
  }

  if (!canAdd || !data) return null;

  return (
    <>
      <div className={cn("flex justify-end", className)}>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-muted-foreground hover:text-[hsl(0,65%,52%)]"
          onClick={() => setDialogOpen(true)}
        >
          <Ban className="h-3 w-3 mr-1" /> Add customer to blacklist
        </Button>
      </div>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add customer to blacklist</DialogTitle>
            <DialogDescription>
              {phone} will be flagged on every future order, for all sellers.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (optional), e.g. refused the parcel twice"
            rows={3}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={busy}>Cancel</Button>
            <Button variant="destructive" onClick={() => submit(true, reason)} disabled={busy}>
              Add to blacklist
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
