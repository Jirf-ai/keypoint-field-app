-- Web Push for the PWA + server-side clock nudges (2026-08-03).
--
-- 1. worker_push_subscriptions — one row per browser subscription (a worker
--    may hold several: phone + spare). Endpoint is unique per browser+site
--    by construction, so it is the key. Service-role-only, like every
--    worker-facing table (RLS on, no anon policies).
create table if not exists public.worker_push_subscriptions (
  endpoint   text primary key,
  worker_id  text not null,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists worker_push_subscriptions_worker_idx
  on public.worker_push_subscriptions (worker_id);
alter table public.worker_push_subscriptions enable row level security;

-- 2. field_push_log — one-shot dedupe for notify-clocks. The PK is the
--    guarantee: a nudge kind fires at most once per clock.
create table if not exists public.field_push_log (
  clock_id text not null,
  kind     text not null,
  sent_at  timestamptz not null default now(),
  primary key (clock_id, kind)
);
alter table public.field_push_log enable row level security;

-- 3. field_clock_events.event learns 'ot_confirm' — the worker's overtime
--    confirmation rides the same append-only spine as start/end (starts =
--    the start stamp's clock_id). Defensive: the table was created outside
--    repo migrations, so find whatever CHECK governs `event` (if any),
--    replace it with one that admits the new kind.
do $$
declare c text;
begin
  select conname into c
    from pg_constraint
   where conrelid = 'public.field_clock_events'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) ilike '%event%';
  if c is not null then
    execute format('alter table public.field_clock_events drop constraint %I', c);
  end if;
  alter table public.field_clock_events
    add constraint field_clock_events_event_check
    check (event in ('start', 'end', 'ot_confirm'));
end $$;

-- NOTE (applied at deploy time, NOT in this file — it embeds a secret):
-- the pg_cron schedule that drives notify-clocks every minute:
--
--   select cron.schedule('notify-clocks-minutely', '* * * * *', $cron$
--     select net.http_post(
--       url     := 'https://<project-ref>.supabase.co/functions/v1/notify-clocks',
--       headers := '{"Content-Type":"application/json",
--                    "Authorization":"Bearer <ANON_KEY>",
--                    "x-cron-key":"<CRON_KEY>"}'::jsonb,
--       body    := '{}'::jsonb
--     );
--   $cron$);
--
-- The Authorization header is the platform gateway's JWT check (any valid
-- key; the public anon key is fine) — without it the request 401s before the
-- function runs. Found live 2026-08-03. x-cron-key remains the real gate.
--
-- CRON_KEY is a random string set BOTH as an edge-function secret and in the
-- cron header — the function refuses anything else, so knowing the public
-- anon key is not enough to spam crews.
