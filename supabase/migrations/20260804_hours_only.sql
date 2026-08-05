-- Hours only (Jeffrey 2026-08-04): the Field app records HOURS; compensation
-- is inner-company data on the Payroll agent (payroll_workers.hourly_rate +
-- filing jsonb: daily_rate/work_days/overtime weekend-only 150%/day cap 12).
--
-- Applied live 2026-08-04 via the Management API; kept here as the record.
alter table public.field_labor_entries alter column hourly_rate drop not null;

comment on column public.field_labor_entries.hourly_rate is
  'DEPRECATED 2026-08-04 — always null going forward. The Field app records '
  'hours only; rates live on the Payroll agent (payroll_workers). line_total '
  '(generated hours*rate) nulls with it.';

-- One-time diminish: every historic rate cleared (21 rows on apply day).
-- line_total is GENERATED ALWAYS AS (hours * hourly_rate) and nulls itself.
update public.field_labor_entries set hourly_rate = null;

-- Server-side guarantee lives in sync-field-log v12: hourly_rate removed from
-- the labor whitelist, so no client version can ever land a rate again.
