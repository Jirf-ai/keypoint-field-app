-- Field app phone-OTP auth (applied to the shared project 2026-07-28).
-- Phone OTP challenges: short-lived, hashed codes. RLS enabled with NO policies
-- → only the service role (the worker-auth edge function) can read/write; the
-- anon key cannot see codes.
create table if not exists public.phone_otps (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts int not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists phone_otps_phone_created_idx on public.phone_otps (phone, created_at desc);
alter table public.phone_otps enable row level security;

-- Marks whether a worker registration's phone has been OTP-verified, so a
-- cross-device login restores a real, verified account.
alter table public.worker_registrations
  add column if not exists phone_verified boolean not null default false;
