-- Etapp 6: kvittens på att man läst informationen om arkivet och personuppgifter.
-- Kör i Supabase SQL Editor.

create table if not exists public.samtycken (
  user_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  version text not null,
  godkand_at timestamptz not null default now(),
  primary key (user_id, version)
);

alter table public.samtycken enable row level security;

-- Alla inloggade får se vilka som kvitterat – gör det möjligt för en
-- administratör att följa upp. Man kan bara kvittera i eget namn.
drop policy if exists "Inloggade får se kvittenser" on public.samtycken;
create policy "Inloggade får se kvittenser" on public.samtycken
  for select to authenticated using (true);

drop policy if exists "Man kvitterar i eget namn" on public.samtycken;
create policy "Man kvitterar i eget namn" on public.samtycken
  for insert to authenticated with check (user_id = auth.uid());
