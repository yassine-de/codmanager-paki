-- whatsapp-automation-runner's dedup guard (SELECT existing non-failed run,
-- then INSERT if none found) is not atomic — two near-simultaneous
-- invocations for the same (automation_id, order_id) can both pass the
-- SELECT before either INSERT lands, each independently sending the
-- template. Confirmed live: 27 orders (e.g. SU-48, two "New order
-- confirmation" template sends 1.3s apart at 2026-07-22 17:30:12/13) each
-- have exactly 2 non-failed runs for the same automation+order, and the
-- customer genuinely received the message twice for every one of them.
--
-- Fix: a partial unique index enforces "at most one non-failed run per
-- (automation_id, order_id)" at the database level, so a losing concurrent
-- INSERT gets a real unique-violation error instead of silently succeeding
-- — startNewRuns() already treats an insert error as "skip this automation"
-- (see the `if (error) { errLog(...); continue; }` after the insert), so no
-- code change is needed to benefit from this.
--
-- One-time cleanup first: Postgres can't create the index while existing
-- rows violate it. These are duplicate RUN LOG rows only — the underlying
-- WhatsApp messages were already sent and are untouched; deleting the
-- later duplicate log row does not resend or un-send anything, it only
-- removes the redundant tracking row (keeping the earliest one preserves
-- the existing dedup protection for that pair going forward).
DELETE FROM public.whatsapp_automation_runs
WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY automation_id, order_id
      ORDER BY started_at ASC, id ASC
    ) AS rn
    FROM public.whatsapp_automation_runs
    WHERE status <> 'failed'
  ) ranked
  WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_automation_runs_dedup_active
  ON public.whatsapp_automation_runs (automation_id, order_id)
  WHERE status <> 'failed';
