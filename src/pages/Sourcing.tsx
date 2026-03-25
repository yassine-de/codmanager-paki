import { useState, useMemo } from "react";
import { format } from "date-fns";
import { ExternalLink, Pencil, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Package2, Plus } from "lucide-react";
import {
  mockSourcingRequests,
  sourcingStatusConfig,
  paymentStatusConfig,
  type SourcingRequest,
  type SourcingStatus,
  type PaymentStatus,
} from "@/lib/sourcing-data";
import { EditSourcingModal } from "@/components/EditSourcingModal";
import { CreateSourcingModal } from "@/components/CreateSourcingModal";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/SearchableSelect";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function Sourcing() {
  const [requests, setRequests] = useState<SourcingRequest[]>(mockSourcingRequests);
  const [sellerFilter, setSellerFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [paymentFilter, setPaymentFilter] = useState("all");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [editRequest, setEditRequest] = useState<SourcingRequest | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const sellers = useMemo(() => [...new Set(requests.map(r => r.seller))].sort(), [requests]);

  const filtered = useMemo(() => {
    return requests.filter(r => {
      if (sellerFilter !== "all" && r.seller !== sellerFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (paymentFilter !== "all" && r.paymentStatus !== paymentFilter) return false;
      return true;
    });
  }, [requests, sellerFilter, statusFilter, paymentFilter]);

  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);

  const handleSave = (updated: SourcingRequest) => {
    setRequests(prev => prev.map(r => r.id === updated.id ? updated : r));
  };

  const handleCreate = (newReq: SourcingRequest) => {
    setRequests(prev => [newReq, ...prev]);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package2 className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-semibold text-foreground">Sourcing</h1>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" />
          New Request
        </Button>
      </div>

      {/* Filters + toolbar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card p-3">
        <SearchableSelect
          value={sellerFilter}
          onValueChange={v => { setSellerFilter(v); setPage(1); }}
          options={sellers.map(s => ({ value: s, label: s }))}
          placeholder="Seller"
          allLabel="All Sellers"
          className="w-[160px]"
        />

        <SearchableSelect
          value={statusFilter}
          onValueChange={v => { setStatusFilter(v); setPage(1); }}
          options={(Object.keys(sourcingStatusConfig) as SourcingStatus[]).map(s => ({ value: s, label: sourcingStatusConfig[s].label }))}
          placeholder="Status"
          allLabel="All Status"
          className="w-[140px]"
        />

        <SearchableSelect
          value={paymentFilter}
          onValueChange={v => { setPaymentFilter(v); setPage(1); }}
          options={(Object.keys(paymentStatusConfig) as PaymentStatus[]).map(s => ({ value: s, label: paymentStatusConfig[s].label }))}
          placeholder="Payment"
          allLabel="All Payment"
          className="w-[140px]"
        />

        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{filtered.length} requests</span>
          <Select value={String(pageSize)} onValueChange={v => { setPageSize(Number(v)); setPage(1); }}>
            <SelectTrigger className="w-[80px] h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map(n => <SelectItem key={n} value={String(n)}>{n}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[50px]">Image</TableHead>
              <TableHead>Product</TableHead>
              <TableHead>Seller</TableHead>
              <TableHead className="text-center">Qty</TableHead>
              <TableHead className="text-right">Unit Price</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-center">Status</TableHead>
              <TableHead className="text-center">Payment</TableHead>
              <TableHead className="text-right">Paid</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-center">Link</TableHead>
              <TableHead className="text-center w-[70px]">Edit</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginated.map(req => {
              const sConfig = sourcingStatusConfig[req.status];
              const pConfig = paymentStatusConfig[req.paymentStatus];

              return (
                <TableRow key={req.id} className="text-xs">
                  <TableCell className="p-2">
                    <img src={req.productImage} alt={req.productName} className="w-9 h-9 rounded-md object-cover" />
                  </TableCell>
                  <TableCell className="font-medium max-w-[140px] truncate">{req.productName}</TableCell>
                  <TableCell className="text-muted-foreground">{req.seller}</TableCell>
                  <TableCell className="text-center tabular-nums">{req.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">{req.unitPrice} MAD</TableCell>
                  <TableCell className="text-right tabular-nums font-medium">{req.totalPrice} MAD</TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${sConfig.color}`}>
                      {sConfig.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${pConfig.color}`}>
                      {pConfig.label}
                    </span>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{req.paidAmount} MAD</TableCell>
                  <TableCell className="text-muted-foreground whitespace-nowrap">
                    {format(new Date(req.createdAt), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <a href={req.sourceLink} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center justify-center w-7 h-7 rounded-md text-info hover:bg-info/10 transition-colors">
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      </TooltipTrigger>
                      <TooltipContent>Open source link</TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell className="text-center">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-warning hover:bg-warning/10" onClick={() => setEditRequest(req)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Edit request</TooltipContent>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1">
          <span className="text-xs text-muted-foreground">
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filtered.length)} of {filtered.length}
          </span>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(1)}>
              <ChevronsLeft className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <span className="text-xs px-2 text-muted-foreground">Page {page}/{totalPages}</span>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
            <Button variant="outline" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => setPage(totalPages)}>
              <ChevronsRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      {/* Create Modal */}
      <CreateSourcingModal
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreate={handleCreate}
      />

      {/* Edit Modal */}
      <EditSourcingModal
        request={editRequest}
        open={!!editRequest}
        onOpenChange={open => { if (!open) setEditRequest(null); }}
        onSave={handleSave}
      />
    </div>
  );
}
