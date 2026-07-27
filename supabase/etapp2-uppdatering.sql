-- Etapp 2: alla inloggade (= inbjudna släktingar) får flytta och radera dokument,
-- inte bara den som laddade upp. Kör i Supabase SQL Editor.

drop policy "Uppladdaren får ändra" on public.documents;
drop policy "Uppladdaren får radera" on public.documents;

create policy "Inloggade får ändra" on public.documents
  for update to authenticated using (true);

create policy "Inloggade får radera" on public.documents
  for delete to authenticated using (true);
