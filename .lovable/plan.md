## L-mochkil

Daba campaign-runner ka-y-dedupliki recipients b **phone bark**. Natija: ila customer 3ndo 2 orders b 2 products mokhtalfin (kollhom `no_answer`), kay-receivi message wahed 3la order wahed bark — l-order tani kay-tlefa3.

## L-7el

Bdel l-dedup mn `phone` l `phone + product_name` (lowercase, trimmed).

| Cas | Daba | M3a l-7el |
|---|---|---|
| Customer A — 1 order Product X | 1 message | 1 message |
| Customer A — 2 orders nafs Product X | 1 message (dedup) | 1 message (dedup nafs product) |
| Customer A — 2 orders, Product X + Product Y | **1 message bark** ❌ | **2 messages** (wahed l X, wahed l Y) ✅ |

## Tabdilat

### `supabase/functions/campaign-runner/index.ts` — `buildRecipients()`

Bdel l-dedup key:

```ts
// 9bel:
if (seen.has(phone)) continue;
seen.add(phone);

// b3d:
const product = (o.product_name || "").trim().toLowerCase();
const key = `${phone}|${product}`;
if (seen.has(key)) continue;
seen.add(key);
```

L-9adi (variables, recipient row, return shape) y-bqa kifkif.

### `src/pages/whatsapp/WhatsappCampaigns.tsx` — preview labels

Bdel:
- `"Unique recipients (1 message per phone)"` → `"Unique recipients (1 per phone + product)"`
- `"Duplicate phones"` → `"Duplicate (same phone & product)"`

Bach l-user yfham wadeh ash kay-skipi l-system.

## Notes

- Customer b nafs phone walakin product mkhtelf → ka-y-receivi 2 messages bel ordre (throttle dyal campaign ka-y3temed bach yt-spaceaw).
- Hadshi muhim khsosan f cas dyal `no_answer`: kol order khass yt-followi 3la 7da bach customer y3ref ach 3ndo.
