-- Etapp 4: administratörer som kan lägga till personer direkt i appen.
-- Kör i Supabase SQL Editor.
--
-- VIKTIGT: byt ut DIN@EPOST.SE på sista raden mot e-postadressen du själv
-- loggar in med i appen, annars blir ingen administratör.

create table if not exists public.app_admins (
  email text primary key,
  created_at timestamptz not null default now()
);

alter table public.app_admins enable row level security;

-- Alla inloggade får se vilka som är administratörer (appen behöver veta det
-- för att visa knappen). Ändringar sker bara via edge-funktionen, som kör med
-- serverns nyckel – därför finns medvetet inga insert/update/delete-policies.
drop policy if exists "Inloggade får se administratörer" on public.app_admins;
create policy "Inloggade får se administratörer" on public.app_admins
  for select to authenticated using (true);

insert into public.app_admins (email) values ('DIN@EPOST.SE')
  on conflict (email) do nothing;
