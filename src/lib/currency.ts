// Currency configuration for the CRM system
// Primary currency: PKR (Pakistani Rupee)
// Sourcing/Product prices: USD
// Fees: USD
// Financial overview: PKR with USD equivalent

export const USD_TO_PKR = 280;

/** Format amount as PKR */
export function formatPKR(amount: number): string {
  return `${amount.toLocaleString()} PKR`;
}

/** Format amount as USD */
export function formatUSD(amount: number): string {
  return `$${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

/** Convert PKR to USD */
export function pkrToUsd(pkr: number): number {
  return pkr / USD_TO_PKR;
}

/** Convert USD to PKR */
export function usdToPkr(usd: number): number {
  return usd * USD_TO_PKR;
}

/** Format amount as PKR with USD equivalent shown */
export function formatPKRWithUSD(pkrAmount: number): { pkr: string; usd: string } {
  return {
    pkr: formatPKR(pkrAmount),
    usd: formatUSD(pkrToUsd(pkrAmount)),
  };
}

/** Format amount as USD with PKR equivalent shown */
export function formatUSDWithPKR(usdAmount: number): { usd: string; pkr: string } {
  return {
    usd: formatUSD(usdAmount),
    pkr: formatPKR(usdToPkr(usdAmount)),
  };
}
