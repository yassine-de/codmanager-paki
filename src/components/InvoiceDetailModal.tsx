import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Truck, Phone, CreditCard, ArrowDownCircle, ArrowUpCircle, BarChart3, ArrowUpDown, Wallet, Trash2, List } from "lucide-react";
import { formatUSD } from "@/lib/currency";
import { InvoiceOrdersTable } from "@/components/invoice/InvoiceOrdersTable";
import { InvoiceAllOrdersTable } from "@/components/invoice/InvoiceAllOrdersTable";
import { fetchInvoiceSummary } from "@/lib/invoice-summary";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string | null;
  invoiceNumber: string;
  sellerName: string;
}

export function InvoiceDetailModal({
  open, onOpenChange, invoiceId, invoiceNumber, sellerName,
}: Props) {
  const queryClient = useQueryClient();
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const removeAddonMutation = useMutation({
    mutationFn: async (addonId: string) => {
      const { error } = await supabase.rpc("remove_invoice_addon", { p_addon_id: addonId } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["invoice-summary"] });
      queryClient.invalidateQueries({ queryKey: ["invoice-summaries"] });
      setConfirmDeleteId(null);
      toast.success("Addon removed");
    },
    onError: (err: any) => toast.error(err.message || "Failed to remove addon"),
  });
  const { data: summary, isLoading } = useQuery({
    queryKey: ["invoice-summary", invoiceId],
    queryFn: async () => {
      if (!invoiceId) return null;
      return fetchInvoiceSummary(invoiceId);
    },
    enabled: !!invoiceId && open,
  });

  const deliveredOrders = summary?.delivered_orders ?? [];
  const allOrders = summary?.all_orders ?? [];
  const shippingBreakdown = summary?.shipping_breakdown ?? [];
  const addons = summary?.addons ?? [];
  const invoiceAdjustments = summary?.adjustments ?? [];
  const counts = summary?.counts;
  const totals = summary?.totals;
  const rates = summary?.rates;
  const callCenterBreakdown = summary?.call_center_breakdown;
  const productWeightMap = Object.fromEntries(deliveredOrders.map((order) => [order.product_name, order.weight_kg ?? null]));

  const SectionHeader = ({ icon: Icon, title, color, count }: { icon: any; title: string; color: string; count?: number }) => (
    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-t bg-muted/30">
      <Icon className={`h-4 w-4 ${color}`} />
      <span className="text-xs font-bold uppercase tracking-wider text-foreground">{title}</span>
      {count !== undefined && (
        <span className="ml-auto text-[10px] font-semibold bg-muted px-2 py-0.5 rounded-full text-muted-foreground">{count}</span>
      )}
    </div>
  );

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[92vh] p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b">
          <DialogTitle className="text-base font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" />
            {invoiceNumber}
            <span className="text-xs font-normal text-muted-foreground">— {sellerName}</span>
            {summary?.invoice.status === "open" && <span className="text-[10px] bg-warning/20 text-warning px-1.5 py-0.5 rounded font-semibold">OPEN</span>}
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="max-h-[80vh]">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div>
              {/* SECTION 0: ALL ORDERS (full audit visibility) */}
              <SectionHeader icon={List} title="All Orders" color="text-foreground" count={allOrders.length} />
              {allOrders.length > 0 ? (
                <InvoiceAllOrdersTable orders={allOrders} invoiceStatus={summary?.invoice.status ?? "open"} />
              ) : (
                <div className="text-center py-4 text-muted-foreground text-xs">No orders linked to this invoice.</div>
              )}

              {/* SECTION 1: DELIVERED ORDERS (revenue detail) */}
              <SectionHeader icon={Package} title={`Delivered Orders (Revenue)${(counts?.cross_delivered_count ?? 0) > 0 ? ` (incl. ${counts.cross_delivered_count} cross-invoice)` : ''}`} color="text-success" count={counts?.delivered_count ?? 0} />
              {deliveredOrders.length > 0 ? (
                <InvoiceOrdersTable orders={deliveredOrders} productWeightMap={productWeightMap} />
              ) : (
                <div className="text-center py-4 text-muted-foreground text-xs">No delivered orders.</div>
              )}

              {/* SECTION 2: SHIPPING FEES (summary only — count × rate by weight bracket) */}
              <SectionHeader icon={Truck} title={`Shipping Fees${(counts?.cross_shipped_count ?? 0) > 0 ? ` (incl. ${counts.cross_shipped_count} cross-invoice)` : ''}`} color="text-info" count={counts?.shipped_count ?? 0} />
              <div className="px-4 py-2 space-y-1.5">
                {shippingBreakdown.map((item) => {
                  const unitRate = item.count > 0 ? item.fee / item.count : 0;
                  return (
                    <div key={item.bracket} className="flex justify-between items-center text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-foreground">{item.bracket}</span>
                        <span className="text-muted-foreground">×</span>
                        <span className="text-muted-foreground">{item.count} order{item.count !== 1 ? 's' : ''}</span>
                        <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">@ {formatUSD(unitRate)}/ea</span>
                      </div>
                      <span className="tabular-nums font-semibold text-destructive">-{formatUSD(item.fee)}</span>
                    </div>
                  );
                })}
                <div className="border-t pt-1.5 mt-1 flex justify-between text-xs font-bold">
                  <span>Total Shipping</span>
                  <span className="tabular-nums text-destructive">-{formatUSD(totals?.shipping_fees ?? 0)}</span>
                </div>
              </div>

              {/* SECTION 3: CALL CENTER FEES (summary only) */}
              <SectionHeader icon={Phone} title="Call Center Fees" color="text-warning" count={counts?.total_orders_count ?? 0} />
              <div className="px-4 py-2 space-y-1">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Confirmed orders ({callCenterBreakdown?.confirmed_count ?? 0} × {formatUSD(callCenterBreakdown?.confirmed_rate ?? 0)})</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(callCenterBreakdown?.confirmed_fees ?? 0)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Dropped orders ({callCenterBreakdown?.dropped_count ?? 0} × {formatUSD(callCenterBreakdown?.dropped_rate ?? 0)})</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(callCenterBreakdown?.dropped_fees ?? 0)}</span>
                </div>
                <div className="border-t pt-1 mt-1 flex justify-between text-xs font-bold">
                  <span>Total Call Center</span>
                  <span className="tabular-nums text-destructive">-{formatUSD(totals?.call_center_fees ?? 0)}</span>
                </div>
              </div>

              {/* SECTION 4: COD FEES */}
              <SectionHeader icon={CreditCard} title={`COD Fees (${rates?.cod_fee_percentage ?? 0}%)`} color="text-orange-500" />
              <div className="px-4 py-2">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{rates?.cod_fee_percentage ?? 0}% of delivered revenue ({formatUSD(totals?.delivered_revenue_usd ?? 0)})</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(totals?.cod_fees ?? 0)}</span>
                </div>
              </div>

              {/* ADDONS */}
              {addons.length > 0 && (
                <>
                  <SectionHeader icon={ArrowDownCircle} title="Addons" color="text-primary" count={addons.length} />
                  <div className="py-2">
                    {addons.map(addon => (
                      <div key={addon.id} className="flex justify-between px-4 py-1 text-xs items-center gap-2">
                        <span className="flex items-center gap-1.5 text-muted-foreground flex-1 min-w-0">
                          {addon.type === "in" ? <ArrowDownCircle className="h-3 w-3 text-success shrink-0" /> : <ArrowUpCircle className="h-3 w-3 text-destructive shrink-0" />}
                          <span className="truncate">{addon.reason || (addon.type === "in" ? "Bonus" : "Deduction")}</span>
                        </span>
                        <span className="flex items-center gap-1.5">
                          <span className={`font-semibold tabular-nums ${addon.type === "in" ? "text-success" : "text-destructive"}`}>
                            {addon.type === "in" ? "+" : "-"}{formatUSD(addon.amount)}
                          </span>
                          {summary?.invoice.status !== "paid" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-5 w-5 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                              disabled={removeAddonMutation.isPending}
                              onClick={() => setConfirmDeleteId(addon.id)}
                            >
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* ADJUSTMENTS */}
              {invoiceAdjustments.length > 0 && (
                <>
                  <SectionHeader icon={ArrowUpDown} title="Adjustments" color="text-orange-500" count={invoiceAdjustments.length} />
                  <div className="py-2">
                    {invoiceAdjustments.map(adj => (
                      <div key={adj.id} className="flex justify-between px-4 py-1 text-xs items-center">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <ArrowUpDown className="h-3 w-3" />
                          <span className="font-mono">{adj.order_id}</span>
                          <span className="text-muted-foreground/60">({adj.old_status} → {adj.new_status})</span>
                        </span>
                        <span className={`font-semibold tabular-nums ${adj.difference_usd >= 0 ? "text-success" : "text-destructive"}`}>
                          {adj.difference_usd >= 0 ? "+" : ""}{formatUSD(adj.difference_usd)}
                        </span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* FINAL SUMMARY */}
              <SectionHeader icon={BarChart3} title="Final Summary" color="text-primary" />
              <div className="py-3 px-4 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Total Delivered Revenue</span>
                  <span className="tabular-nums font-semibold text-success">{formatUSD(totals?.delivered_revenue_usd ?? 0)}</span>
                </div>
                <div className="border-t my-1" />
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Shipping Fees</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(totals?.shipping_fees ?? 0)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">COD Fees</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(totals?.cod_fees ?? 0)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Call Center Fees</span>
                  <span className="tabular-nums font-semibold text-destructive">-{formatUSD(totals?.call_center_fees ?? 0)}</span>
                </div>
                {(totals?.addon_net ?? 0) !== 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Addons</span>
                    <span className={`tabular-nums font-semibold ${(totals?.addon_net ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                      {(totals?.addon_net ?? 0) >= 0 ? "+" : ""}{formatUSD(totals?.addon_net ?? 0)}
                    </span>
                  </div>
                )}
                {(totals?.adjustment_net ?? 0) !== 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Adjustments</span>
                    <span className={`tabular-nums font-semibold ${(totals?.adjustment_net ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                      {(totals?.adjustment_net ?? 0) >= 0 ? "+" : ""}{formatUSD(totals?.adjustment_net ?? 0)}
                    </span>
                  </div>
                )}
                {(totals?.previous_balance ?? 0) !== 0 && (
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground flex items-center gap-1">
                      <Wallet className="h-3 w-3" /> Previous Balance
                    </span>
                    <span className={`tabular-nums font-semibold ${(totals?.previous_balance ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                      {(totals?.previous_balance ?? 0) >= 0 ? "+" : ""}{formatUSD(totals?.previous_balance ?? 0)}
                    </span>
                  </div>
                )}
                <div className="border-t my-1" />
                <div className="flex justify-between py-1.5">
                  <span className="text-sm font-bold">Net Payable</span>
                  <span className={`text-sm font-bold tabular-nums ${(totals?.net_payable ?? 0) >= 0 ? "text-success" : "text-destructive"}`}>
                    {formatUSD(totals?.net_payable ?? 0)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>

    <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => !open && setConfirmDeleteId(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove Addon</AlertDialogTitle>
          <AlertDialogDescription>Are you sure you want to remove this addon? This action cannot be undone.</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={removeAddonMutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={removeAddonMutation.isPending}
            onClick={() => confirmDeleteId && removeAddonMutation.mutate(confirmDeleteId)}
          >
            {removeAddonMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Remove
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}
