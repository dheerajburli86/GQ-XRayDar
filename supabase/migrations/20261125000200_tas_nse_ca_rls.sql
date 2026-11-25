-- The corporate-action staging tables were created without row level security, so the public API could read them.
-- XRayDar's server and engine connect directly, which is not affected by RLS; nothing else needs these tables.
alter table if exists public.tas_nse_ca enable row level security;
alter table if exists public.tas_nse_ca_raw enable row level security;
alter view if exists public.tas_nse_ca_factor set (security_invoker = true);
