# WhatsApp Inbox — Maximize Message Area & Compact Composer

## Problem (from screenshot)

Two issues waste vertical space and shrink the visible messages area:

1. **Empty black strip below the inbox card** — The chat container uses a hardcoded desktop height `h-[calc(100dvh-200px)]` even though the AppLayout main has `overflow-auto` and small padding. On a 1106×680 viewport (and similar laptop sizes), this leaves ~120–180px of unused space under the card.
2. **Bulky composer** — The reply area takes ~3 stacked rows: Reply/Note tabs row + 2-row textarea + a separate full-width icon toolbar row (emoji, camera, paperclip, mic, AI, template, quick replies) + Send button. This squeezes the messages list, so only ~3 bubbles are visible at once.

## Goal

Make the inbox feel like WhatsApp Web / Respond.io: the chat fills the full viewport height, the composer is compact (one row with inline icons + textarea + Send), and the messages area gets maximum vertical room.

## Changes (single file: `src/pages/whatsapp/WhatsappInbox.tsx`)

### 1. Stretch container to true full height

Replace the hardcoded desktop height so the card consumes whatever vertical space is available, eliminating the empty strip below.

- Current: `md:h-[calc(100dvh-200px)] md:max-h-[calc(100dvh-160px)]`
- New: `md:h-[calc(100dvh-140px)] md:max-h-[calc(100dvh-140px)]`
  - 140px accounts for: 56px topbar + ~32px page padding + ~40px filters bar + a small breathing margin.
- Also reduce the `mb-2` on the filters bar to `mb-1.5` to claw back a few more pixels.

### 2. Compact the composer

Restructure the Reply tab so the textarea, all action icons, and the Send button live on **one horizontal row** (WhatsApp-style), with tabs above as a slim header.

```text
┌──────────────────────────────────────────────────────────┐
│ [Reply] [Note]                       Last reply 9m ago   │  ← slim tabs row, mb-2 → mb-1.5
├──────────────────────────────────────────────────────────┤
│ 😊 📷 📎 🎤 ✨ 📄 💬 │ Type a reply…           │ [Send] │  ← single row
└──────────────────────────────────────────────────────────┘
```

Specifically:
- Wrap icon toolbar + textarea + Send in `flex items-end gap-2` instead of stacking them.
- Icon toolbar: keep all 7 buttons but shrink to `h-8 w-8` (was `h-9 w-9`) and group inside a `flex items-center gap-0.5 shrink-0` block on the **left** of the textarea.
- Textarea: change `rows={2}` → `rows={1}` with `min-h-[40px] max-h-[120px]` so it auto-grows up to a cap but starts compact. Keep `resize-none`.
- Send button stays on the right with `shrink-0` and matches textarea bottom alignment.
- Tabs row: reduce `mb-3` → `mb-2`, button padding `px-4 py-2` → `px-3 py-1.5`, font slightly smaller.
- Container padding: `p-3` → `px-3 py-2`.
- Note tab: same compact single-row treatment (textarea + Save button only — already minimal, just shrink padding/rows to match).

### 3. AI suggestions chips

The violet AI suggestions panel (when present) stays above the composer row but use `p-1.5` instead of `p-2` and chips `py-1` instead of `py-1.5` to keep them compact.

## Net visual result

- Empty space below the card disappears — card extends to near the bottom of the viewport.
- Composer height drops from ~165px to ~95px → roughly **70 extra pixels** of visible messages (≈2 more bubbles on a typical laptop).
- All existing actions (emoji, image, file, voice, AI suggest, template, quick replies) remain accessible — just inline next to the textarea instead of stacked below.
- No behavior/logic changes: send/note/AI/upload handlers untouched.

## Out of scope

- No backend / Supabase changes.
- No changes to message bubble rendering, conversation list, or 24h-window banner logic.
- No changes to mobile layout (mobile already uses full-screen `h-[calc(100dvh-80px)]` which is fine).
