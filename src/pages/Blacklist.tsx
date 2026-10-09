import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Ban, Loader2, Plus, Search, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatPKT as format } from "@/lib/timezone";
import { cn } from "@/lib/utils";
import {
  type BlacklistEntry, useBlacklistPermissions, useCustomerBlacklistList, useSetCustomerBlacklist,
} from "@/hooks/useCustomerBlacklist";

const RED = "bg-[hsl(0,65%,52%)]/12 text-[hsl(0,65%,52%)] border-[hsl(0,65%,52%)]/20";
const GREEN = "bg-[hsl(155,50%,42%)]/12 text-[hsl(155,50%,42%)] border-[hsl(155,50%,42%)]/20";
const BLUE = "bg-[hsl(210,60%,52%)]/12 text-[hsl(210,60%,52%)] border-[hsl(210,60%,52%)]/20";
const AMBER = "bg-[hsl(38,90%,55%)]/12 text-[hsl(38,90%,55%)] border-[hsl(38,90%,55%)]/20";

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium", className)}>
      {children}
    </span>
  );
}

export default function Blacklist() {
  const { canAdd, canRemove } = useBlacklistPermissions();
  const { data: entries = [], isLoading } = useCustomerBlacklistList();
  const setBlacklist = useSetCustomerBlacklist();

  const [search, setSearch] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [newReason, setNewReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<BlacklistEntry | null>(null);
  const [removing, setRemoving] = useState(false);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    if (!s) return entries;
    const digits = s.replace(/\D/g, "");
    return entries.filter((e) =>
      (e.customer_name || "").toLowerCase().includes(s) ||
      e.phone.toLowerCase().includes(s) ||
      (digits.length >= 4 && e.phone_key.includes(digits.replace(/^0/, ""))),
    );
  }, [entries, search]);

  const autoCount = entries.filter((e) => e.source === "auto").length;

  const addNumber = async () => {
    if (!newPhone.trim()) return;
    setAdding(true);
    try {
      await setBlacklist(newPhone.trim(), true, newReason);
      toast.success("Customer added to blacklist");
      setNewPhone("");
      setNewReason("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add to blacklist");
    } finally {
      setAdding(false);
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget) return;
    setRemoving(true);
    try {
      await setBlacklist(removeTarget.phone, false);
      toast.success("Customer removed from blacklist");
      setRemoveTarget(null);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove from blacklist");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Ban className="h-5 w-5 text-[hsl(0,65%,52%)]" /> Blacklist
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Customers who keep refusing their parcels. Flagged on every new order for all sellers, and never confirmed by WhatsApp.
          </p>
        </div>
      </div>

      {/* Add a number */}
      {canAdd && (
        <div className="bg-card rounded-lg border p-4 animate-fade-in">
          <div className="text-xs font-medium text-muted-foreground mb-2">Add a customer by phone number</div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={newPhone}
              onChange={(e) => setNewPhone(e.target.value)}
              placeholder="03xx xxxxxxx"
              className="h-9 w-48 text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") void addNumber(); }}
            />
            <Input
              value={newReason}
              onChange={(e) => setNewReason(e.target.value)}
              placeholder="Reason (optional)"
              className="h-9 flex-1 min-w-[200px] text-sm"
              onKeyDown={(e) => { if (e.key === "Enter") void addNumber(); }}
            />
            <Button size="sm" variant="destructive" className="h-9 gap-1.5" disabled={adding || !newPhone.trim()} onClick={() => void addNumber()}>
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add to blacklist
            </Button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-card rounded-lg border animate-slide-up">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-b">
          <p className="text-sm font-medium">
            {entries.length}{" "}
            <span className="text-muted-foreground font-normal">
              blacklisted customer{entries.length !== 1 ? "s" : ""} · {autoCount} auto · {entries.length - autoCount} manual
            </span>
          </p>
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              placeholder="Search by name or phone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-sm"
            />
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading blacklist…
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            {entries.length === 0 ? "No blacklisted customers." : "No customer matches your search."}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/30">
                  {["Customer", "Phone", "Orders", "Returned", "Delivered", "Source", "Reason", "Last order", ""].map((h, i) => (
                    <th
                      key={i}
                      className={cn(
                        "py-2.5 px-3 font-medium text-xs text-muted-foreground uppercase tracking-wider",
                        i >= 2 && i <= 4 ? "text-center" : "text-left",
                      )}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => (
                  <tr key={e.phone_key} className="border-b last:border-0 hover:bg-muted/20">
                    <td className="py-2.5 px-3 text-xs font-medium">{e.customer_name || "—"}</td>
                    <td className="py-2.5 px-3 text-xs tabular-nums">
                      <Link
                        to={`/orders?search=${encodeURIComponent(e.phone)}`}
                        className="text-[hsl(210,60%,52%)] hover:underline underline-offset-2"
                        title="See this customer's orders"
                      >
                        {e.phone}
                      </Link>
                    </td>
                    <td className="py-2.5 px-3 text-center"><Pill className={BLUE}>{e.total_orders}</Pill></td>
                    <td className="py-2.5 px-3 text-center"><Pill className={RED}>{e.returned_count}</Pill></td>
                    <td className="py-2.5 px-3 text-center"><Pill className={GREEN}>{e.delivered_count}</Pill></td>
                    <td className="py-2.5 px-3">
                      <Pill className={e.source === "manual" ? AMBER : RED}>{e.source === "manual" ? "Manual" : "Auto"}</Pill>
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground max-w-[260px]">
                      {e.source === "manual" ? (
                        <div>
                          <div className="text-foreground truncate" title={e.reason || undefined}>{e.reason || "—"}</div>
                          {(e.updated_by_name || e.updated_at) && (
                            <div className="text-[10px]">
                              {e.updated_by_name || "Unknown"}{e.updated_at ? ` · ${format(new Date(e.updated_at), "dd MMM yyyy")}` : ""}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span>{e.returned_count} returns, 0 delivered</span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-xs text-muted-foreground tabular-nums">
                      {e.last_order_at ? format(new Date(e.last_order_at), "dd MMM yyyy") : "—"}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      {canRemove && (
                        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setRemoveTarget(e)}>
                          <ShieldCheck className="h-3 w-3 mr-1" /> Remove
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AlertDialog open={!!removeTarget} onOpenChange={(o) => { if (!o) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove from blacklist?</AlertDialogTitle>
            <AlertDialogDescription>
              {removeTarget?.customer_name || removeTarget?.phone} will no longer be flagged, and won't be added back
              automatically even if more returns come in. You can always add them again by phone number.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(ev) => { ev.preventDefault(); void confirmRemove(); }} disabled={removing}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
