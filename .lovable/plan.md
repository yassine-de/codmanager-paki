

# Sourcing History Tracking

## What we're building
A history tracking system for sourcing requests that logs every status change with who made it, plus a history icon button in the sourcing table for admins to view the timeline.

## Plan

### 1. Create `sourcing_history` database table
- Columns: `id`, `sourcing_request_id` (text, references display_id or uuid), `field_changed`, `old_value`, `new_value`, `changed_by` (uuid), `action_type` (default 'status_change'), `created_at`
- RLS: Admins full access, sellers can view history for their own sourcing requests
- Enable RLS

### 2. Log history in EditSourcingModal
- In the `doUpdate` function, before updating, compare the current `request.status` with the new `status`
- If status changed, insert a row into `sourcing_history` with old/new values and `auth.uid()` as `changed_by`
- Also track other important field changes: `payment_status`, `seller_validated`, `quantity`, `landed_price`, `seller_price`

### 3. Create `SourcingHistoryModal` component
- Similar pattern to `OrderHistoryModal` — a dialog with a scrollable timeline
- Fetch history entries for a given sourcing request ID, joined with profiles to show the admin's name
- Display each entry as a timeline item: date, who changed it, old → new value, with appropriate icons
- Clean, modern design matching existing modals

### 4. Add history button to Sourcing table
- Add a `History` icon (clock/history icon) column in the table next to the Edit button
- Clicking opens the `SourcingHistoryModal` for that request
- Only visible to admins (already on admin-only page)

## Technical details

**Migration SQL:**
```sql
CREATE TABLE public.sourcing_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sourcing_request_id uuid NOT NULL,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  changed_by uuid NOT NULL,
  action_type text NOT NULL DEFAULT 'status_change',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sourcing_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins full access sourcing_history"
  ON public.sourcing_history FOR ALL TO authenticated
  USING (is_admin(auth.uid()))
  WITH CHECK (is_admin(auth.uid()));
```

**Files to create/edit:**
- New: `src/components/SourcingHistoryModal.tsx`
- Edit: `src/components/EditSourcingModal.tsx` — add history logging in `doUpdate`
- Edit: `src/pages/Sourcing.tsx` — add history icon button + column

