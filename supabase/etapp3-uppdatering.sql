-- Etapp 3: årtal, söktext från OCR och kommentarer. Kör i Supabase SQL Editor.

-- Årtal för dokumentet/fotot självt (inte uppladdningsdatum)
alter table public.documents add column if not exists year int;

-- Text som lästs ur bilden vid skanning (OCR), används av sökrutan
alter table public.documents add column if not exists ocr_text text;

-- Kommentarer, främst tänkt för foton: "farfar vid båthuset 1954"
create table if not exists public.comments (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  body text not null,
  author_email text not null,
  created_at timestamptz not null default now()
);

alter table public.comments enable row level security;

drop policy if exists "Inloggade får läsa kommentarer" on public.comments;
create policy "Inloggade får läsa kommentarer" on public.comments
  for select to authenticated using (true);

drop policy if exists "Inloggade får kommentera" on public.comments;
create policy "Inloggade får kommentera" on public.comments
  for insert to authenticated with check (true);

drop policy if exists "Inloggade får radera kommentarer" on public.comments;
create policy "Inloggade får radera kommentarer" on public.comments
  for delete to authenticated using (true);

create index if not exists comments_document_id_idx on public.comments(document_id);
