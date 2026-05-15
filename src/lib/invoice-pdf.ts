import type { InvoiceSummaryResponse } from "./invoice-summary";

const usd  = (n: number) => `$${Math.abs(n).toFixed(2)}`;
const sign = (n: number) => (n >= 0 ? `+$${n.toFixed(2)}` : `-$${Math.abs(n).toFixed(2)}`);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });

export function downloadInvoicePDF(summary: InvoiceSummaryResponse, sellerName: string) {
  const inv = summary.invoice;
  const tot = summary.totals;
  const cc  = summary.call_center_breakdown;
  const cnt = summary.counts;

  const statusColor: Record<string, string> = { paid: "#15803d", open: "#b45309", ready: "#1d4ed8" };
  const statusBg:    Record<string, string> = { paid: "#dcfce7", open: "#fef9c3", ready: "#dbeafe" };
  const sc = statusColor[inv.status] ?? "#555";
  const sb = statusBg[inv.status]   ?? "#f3f4f6";

  /* ── Delivered orders rows ── */
  const orderRows = summary.delivered_orders.length
    ? summary.delivered_orders.map((o, i) => `
        <tr class="${i % 2 ? "s" : ""}">
          <td class="mono">${o.order_id}</td>
          <td>${o.customer_name}</td>
          <td class="muted">${o.customer_phone}</td>
          <td>${o.product_name}</td>
          <td class="r">${o.quantity}</td>
          <td class="r g">${usd(o.amount_usd)}</td>
        </tr>`).join("")
    : `<tr><td colspan="6" class="empty">No delivered orders</td></tr>`;


  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${inv.invoice_number} — ${sellerName}</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Segoe UI',Arial,sans-serif;font-size:11px;color:#111;background:#fff;padding:32px 40px;line-height:1.5}

/* ── HEADER ── */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #111;margin-bottom:22px}
.brand{font-size:20px;font-weight:800;letter-spacing:-.5px}
.brand-sub{font-size:10px;color:#888;margin-top:2px}
.inv-num{font-size:18px;font-weight:700;text-align:right}
.status{display:inline-block;padding:2px 10px;border-radius:99px;font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;background:${sb};color:${sc};border:1px solid ${sc}33;margin-top:4px}
.dates{margin-top:6px;font-size:10px;color:#777;text-align:right}
.dates span{display:block}

/* ── STATS ── */
.stats{display:flex;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:22px}
.stat{flex:1;padding:10px 8px;text-align:center;border-right:1px solid #e5e7eb;background:#fafafa}
.stat:last-child{border-right:none}
.stat-n{font-size:19px;font-weight:800}
.stat-l{font-size:8.5px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-top:2px}

/* ── SUMMARY BOX ── */
.fee-list{width:100%;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:20px}
.fee-row{display:flex;justify-content:space-between;align-items:center;padding:8px 14px;border-bottom:1px solid #f3f4f6;font-size:11.5px}
.fee-row:last-child{border-bottom:none}
.fee-lbl{color:#555}
.fee-lbl small{display:block;font-size:9.5px;color:#aaa;margin-top:1px}
.fee-minus{background:#fef2f2}
.fee-total{background:#f9fafb;font-weight:700;font-size:12px}

/* ── SECTIONS ── */
.section{margin-bottom:20px}
.sh{display:flex;align-items:center;gap:8px;padding:7px 14px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;border-radius:6px 6px 0 0}
.sh .badge{margin-left:auto;background:rgba(0,0,0,.08);padding:1px 7px;border-radius:99px;font-size:9px}

/* ── TABLES ── */
table{width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-top:none;font-size:10.5px;border-radius:0 0 6px 6px;overflow:hidden}
thead tr{background:#f9fafb}
th{padding:6px 10px;font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;text-align:left;border-bottom:1px solid #e5e7eb}
td{padding:6px 10px;border-bottom:1px solid #f3f4f6;vertical-align:middle}
tr:last-child td{border-bottom:none}
tr.s td{background:#fafafa}
tfoot tr td{background:#f0fdf4;font-weight:700;border-top:1.5px solid #d1fae5;border-bottom:none}
tfoot tr td.r-ft{background:#fef2f2;color:#dc2626}

.r{text-align:right}
.g{color:#16a34a;font-weight:600}
.r-val{color:#dc2626;font-weight:600}
.bold{font-weight:700}
.mono{font-family:'Courier New',monospace;font-size:10px;font-weight:600}
.muted{color:#6b7280}
.pill{display:inline-block;background:#f3f4f6;padding:1px 5px;border-radius:3px;font-size:9.5px;font-family:monospace;margin:0 2px}
.empty{text-align:center;color:#9ca3af;padding:12px;font-style:italic}

/* ── DETAIL SECTION ── */
.detail-wrap{padding-top:8px}

/* ── FOOTER ── */
.footer{margin-top:28px;padding-top:10px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:9.5px;color:#bbb}

@media print{
  body{padding:14px 18px}
  @page{margin:.6cm;size:A4}
}
</style>
</head>
<body>

<!-- HEADER -->
<div class="hdr">
  <div>
    <div class="brand">CodPakistani</div>
    <div class="brand-sub">COD Fulfillment &amp; Logistics</div>
  </div>
  <div>
    <div class="inv-num">${inv.invoice_number}</div>
    <div style="text-align:right"><span class="status">${inv.status.toUpperCase()}</span></div>
    <div class="dates">
      <span>Issued: ${fmtDate(inv.created_at)}</span>
      ${inv.finalized_at ? `<span>Finalized: ${fmtDate(inv.finalized_at)}</span>` : ""}
      ${inv.paid_at ? `<span style="color:#16a34a;font-weight:700">Paid: ${fmtDate(inv.paid_at)}</span>` : ""}
    </div>
  </div>
</div>

<!-- STATS BAR -->
<div class="stats">
  <div class="stat"><div class="stat-n">${cnt?.total_orders_count??0}</div><div class="stat-l">Total Orders</div></div>
  <div class="stat"><div class="stat-n" style="color:#16a34a">${cnt?.confirmed_count??0}</div><div class="stat-l">Confirmed</div></div>
  <div class="stat"><div class="stat-n" style="color:#15803d">${cnt?.delivered_count??0}</div><div class="stat-l">Delivered</div></div>
  <div class="stat"><div class="stat-n" style="color:#1d4ed8">${cnt?.shipped_count??0}</div><div class="stat-l">Shipped</div></div>
  <div class="stat"><div class="stat-n" style="color:#dc2626">${cnt?.dropped_count??0}</div><div class="stat-l">Dropped</div></div>
</div>

<!-- DELIVERED ORDERS TABLE -->
<div class="detail-wrap">
  <div class="section">
    <div class="sh" style="background:#dcfce7;color:#15803d;border-left:4px solid #16a34a">
      Delivered Orders — Revenue Detail
      <span class="badge">${cnt?.delivered_count??0}</span>
    </div>
    <table>
      <thead>
        <tr>
          <th>Order ID</th><th>Customer</th><th>Phone</th><th>Product</th><th class="r">Qty</th><th class="r">Amount</th>
        </tr>
      </thead>
      <tbody>${orderRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" style="text-align:right;padding-right:10px;color:#555">Total Delivered Revenue</td>
          <td class="r g">${usd(tot?.delivered_revenue_usd??0)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
</div>

<!-- FINAL SUMMARY -->
<div class="fee-list">
    <div class="fee-row" style="background:#f0fdf4">
      <span class="fee-lbl"><strong>Delivered Revenue</strong><small>${cnt?.delivered_count??0} orders × avg price</small></span>
      <span class="g bold">${usd(tot?.delivered_revenue_usd??0)}</span>
    </div>
    <div class="fee-row fee-minus">
      <span class="fee-lbl">Shipping Fees<small>${cnt?.shipped_count??0} orders shipped</small></span>
      <span class="r-val">−${usd(tot?.shipping_fees??0)}</span>
    </div>
    <div class="fee-row fee-minus">
      <span class="fee-lbl">COD Fees<small>${summary.rates?.cod_fee_percentage??0}% of delivered revenue</small></span>
      <span class="r-val">−${usd(tot?.cod_fees??0)}</span>
    </div>
    <div class="fee-row fee-minus">
      <span class="fee-lbl">Call Center Fees<small>${cc?.confirmed_count??0} confirmed + ${cc?.dropped_count??0} dropped</small></span>
      <span class="r-val">−${usd(tot?.call_center_fees??0)}</span>
    </div>
    ${(tot?.addon_net??0)!==0?`
    <div class="fee-row">
      <span class="fee-lbl">Addons Net<small>${summary.addons.length} addon(s)</small></span>
      <span class="${(tot?.addon_net??0)>=0?"g":"r-val"}">${sign(tot?.addon_net??0)}</span>
    </div>`:""}
    ${(tot?.adjustment_net??0)!==0?`
    <div class="fee-row">
      <span class="fee-lbl">Adjustments Net<small>${summary.adjustments.length} adjustment(s)</small></span>
      <span class="${(tot?.adjustment_net??0)>=0?"g":"r-val"}">${sign(tot?.adjustment_net??0)}</span>
    </div>`:""}
    ${(tot?.previous_balance??0)!==0?`
    <div class="fee-row">
      <span class="fee-lbl">Previous Balance</span>
      <span class="${(tot?.previous_balance??0)>=0?"g":"r-val"}">${sign(tot?.previous_balance??0)}</span>
    </div>`:""}
    <div class="fee-row fee-total" style="border-top:2px solid #e5e7eb">
      <span>NET PAYABLE TO SELLER</span>
      <span class="${(tot?.net_payable??0)>=0?"g":"r-val"}">${usd(tot?.net_payable??0)}</span>
    </div>
</div>

<!-- FOOTER -->
<div class="footer">
  <span>CodPakistani CRM · ${inv.invoice_number} · ${sellerName}</span>
  <span>Generated ${new Date().toLocaleDateString("en-GB",{day:"2-digit",month:"long",year:"numeric"})}</span>
</div>

<script>window.onload=function(){setTimeout(function(){window.print();},300);};</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=960,height=800");
  if (!w) return;
  w.document.write(html);
  w.document.close();
}
