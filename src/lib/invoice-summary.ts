import { supabase } from "@/integrations/supabase/client";

export interface InvoiceSummaryResponse {
  invoice: {
    id: string;
    invoice_number: string;
    seller_id: string;
    status: string;
    created_at: string;
    finalized_at: string | null;
    paid_at: string | null;
    paid_by: string | null;
    payment_proof_url: string | null;
    previous_balance: number;
  };
  rates: {
    shipping: {
      rate_1kg: number;
      rate_2kg: number;
      rate_3kg: number;
      rate_3kg_plus: number;
    };
    call_center: {
      confirmed_rate: number;
      dropped_rate: number;
    };
    cod_fee_percentage: number;
  };
  counts: {
    total_orders_count: number;
    delivered_count: number;
    shipped_count: number;
    confirmed_count: number;
    dropped_count: number;
    cross_shipped_count: number;
    cross_delivered_count: number;
    cross_confirmed_count: number;
  };
  call_center_breakdown: {
    confirmed_count: number;
    confirmed_rate: number;
    confirmed_fees: number;
    dropped_count: number;
    dropped_rate: number;
    dropped_fees: number;
  };
  delivered_orders: Array<{
    id: string;
    order_id: string;
    customer_name: string;
    customer_phone: string;
    product_name: string;
    quantity: number;
    price: number;
    total_amount: number;
    created_at: string;
    weight_kg: number | null;
    total_weight_kg: number | null;
    amount_usd: number;
    is_cross_invoice?: boolean;
    original_invoice_number?: string | null;
  }>;
  all_orders: Array<{
    id: string;
    order_id: string;
    customer_name: string;
    customer_phone: string;
    product_name: string;
    quantity: number;
    price: number;
    total_amount: number;
    created_at: string;
    weight_kg: number | null;
    total_weight_kg: number | null;
    amount_usd: number;
    confirmation_status: string;
    delivery_status: string;
    has_adjustment: boolean;
    adjustment_invoice_id: string | null;
    adjustment_invoice_number: string | null;
    was_delivered: boolean;
    is_cross_invoice?: boolean;
    original_invoice_number?: string | null;
  }>;
  shipping_breakdown: Array<{
    bracket: string;
    count: number;
    fee: number;
  }>;
  addons: Array<{
    id: string;
    invoice_id: string;
    type: string;
    amount: number;
    reason: string;
    created_at: string;
  }>;
  adjustments: Array<{
    id: string;
    order_id: string;
    seller_id: string;
    invoice_id: string | null;
    applied_invoice_id: string | null;
    old_status: string;
    new_status: string;
    difference: number;
    difference_usd: number;
    shipping_difference: number;
    shipping_difference_usd: number;
    reason: string;
    status: string;
    created_at: string;
  }>;
  totals: {
    delivered_revenue_usd: number;
    shipping_fees: number;
    call_center_fees: number;
    cod_fees: number;
    addon_net: number;
    adjustment_net: number;
    previous_balance: number;
    net_payable: number;
  };
}

export async function fetchInvoiceSummary(invoiceId: string): Promise<InvoiceSummaryResponse> {
  const { data, error } = await supabase.rpc("get_invoice_summary", {
    p_invoice_id: invoiceId,
  });

  if (error) throw error;

  return data as unknown as InvoiceSummaryResponse;
}
