-- Track initial club-admin access invite delivery per tenant request
-- Created: 2026-03-22

alter table public.tenant_provision_requests
add column if not exists access_invite_sent_at timestamptz,
add column if not exists access_invite_sent_by_user_id uuid references auth.users(id) on delete set null,
add column if not exists access_invite_last_error text;
