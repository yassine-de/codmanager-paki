import { formatUSD } from "@/lib/currency";

interface Order {
  id: string;
  order_id: string;
  confirmation_status: string;
}

interface Props {
  confirmedOrders: Order[];
  droppedOrders: Order[];
  confirmedRate: number;
  droppedRate: number;
}

export function InvoiceCallCenterTable({ confirmedOrders, droppedOrders, confirmedRate, droppedRate }: Props) {
  const allOrders = [
    ...confirmedOrders.map(o => ({ ...o, type: "confirmed" as const, fee: confirmedRate })),
    ...droppedOrders.map(o => ({ ...o, type: "dropped" as const, fee: droppedRate })),
  ];

  const totalFees = confirmedOrders.length * confirmedRate + droppedOrders.length * droppedRate;

  return (
    <div>
      <div className="max-h-[200px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted/60 z-10">
            <tr className="border-b">
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Order ID</th>
              <th className="text-left px-3 py-2 font-semibold text-muted-foreground">Status</th>
              <th className="text-right px-3 py-2 font-semibold text-muted-foreground">Fee Applied</th>
            </tr>
          </thead>
          <tbody>
            {allOrders.length === 0 ? (
              <tr><td colSpan={3} className="text-center py-6 text-muted-foreground">No call center fees</td></tr>
            ) : (
              allOrders.map((o, i) => (
                <tr key={o.id} className={`border-b ${i % 2 === 0 ? "bg-background" : "bg-muted/20"}`}>
                  <td className="px-3 py-1.5 font-mono text-[11px]">{o.order_id}</td>
                  <td className="px-3 py-1.5">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                      o.type === "confirmed" 
                        ? "bg-success/10 text-success" 
                        : "bg-destructive/10 text-destructive"
                    }`}>
                      {o.type === "confirmed" ? "Confirmed" : "Dropped"}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums font-semibold text-destructive">-{formatUSD(o.fee)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {/* Summary row */}
      <div className="px-4 py-2 border-t bg-muted/30 space-y-0.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Confirmed ({confirmedOrders.length} × {formatUSD(confirmedRate)})</span>
          <span className="tabular-nums text-destructive font-semibold">-{formatUSD(confirmedOrders.length * confirmedRate)}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Dropped ({droppedOrders.length} × {formatUSD(droppedRate)})</span>
          <span className="tabular-nums text-destructive font-semibold">-{formatUSD(droppedOrders.length * droppedRate)}</span>
        </div>
        <div className="flex justify-between text-xs font-bold pt-1 border-t">
          <span>Total Call Center</span>
          <span className="tabular-nums text-destructive">-{formatUSD(totalFees)}</span>
        </div>
      </div>
    </div>
  );
}
