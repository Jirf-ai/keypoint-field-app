-- SF-02 — incident / near-miss reports (Field app). Applied to the shared
-- project 2026-07-29.
--
-- Same spine as the rest of the field tables: client-generated uuid PK so the
-- offline store's rows are idempotent on re-send, append-only version/supersedes
-- chain, and RLS enabled with NO policies → only the service role (the
-- sync-field-log edge function) reads or writes. Nothing is ever hard-deleted;
-- a correction writes a new row pointing at the old one.
create table if not exists public.field_incidents (
  incident_id uuid primary key,
  log_id uuid references public.field_daily_logs (log_id) on delete set null,
  project_id uuid not null,
  work_date date not null,
  -- Constrained set, not free text, so incidents aggregate across jobs.
  incident_type text not null check (incident_type in ('injury', 'near_miss', 'property', 'other')),
  description text not null,
  -- When it happened (the worker's clock) vs. when it was recorded.
  occurred_at timestamptz not null,
  gps_lat numeric,
  gps_lng numeric,
  phase text,
  area text,
  -- Reporter identity: any role can file one (PRD: safety is everyone's).
  reported_by text not null,
  reporter_worker_id text,
  note text,
  recorded_by text,
  recorded_at timestamptz,
  captured_offline boolean not null default true,
  version int not null default 1,
  supersedes uuid,
  synced_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists field_incidents_project_date_idx
  on public.field_incidents (project_id, work_date desc);

alter table public.field_incidents enable row level security;

-- Incident photos ride the existing field_photos table (one photo pipeline, one
-- storage bucket). Nullable + on delete set null so nothing about the existing
-- photo flow changes.
alter table public.field_photos
  add column if not exists incident_id uuid references public.field_incidents (incident_id) on delete set null;
