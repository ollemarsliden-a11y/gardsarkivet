-- Gårdsarkivet: databasschema. Kör i Supabase SQL Editor.

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null check (category in ('kopekontrakt','servitut','gavobrev','avtal','foton','ovrigt')),
  description text,
  file_key text not null unique,
  file_size bigint,
  mime_type text,
  uploaded_by uuid not null default auth.uid() references auth.users(id),
  uploaded_by_email text not null,
  created_at timestamptz not null default now()
);

alter table public.documents enable row level security;

-- Alla inloggade (= inbjudna släktingar, registrering är avstängd) får läsa och lägga till.
create policy "Inloggade får läsa" on public.documents
  for select to authenticated using (true);

create policy "Inloggade får lägga till" on public.documents
  for insert to authenticated with check (uploaded_by = auth.uid());

-- Bara den som laddade upp får ändra/radera (kan breddas senare om ni vill).
create policy "Uppladdaren får ändra" on public.documents
  for update to authenticated using (uploaded_by = auth.uid());

create policy "Uppladdaren får radera" on public.documents
  for delete to authenticated using (uploaded_by = auth.uid());
