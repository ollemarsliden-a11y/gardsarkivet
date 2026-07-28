-- Etapp 5: låter administratörer se vilka som är inloggade och logga ut dem.
-- Kör i Supabase SQL Editor.
--
-- Funktionerna läser/skriver i auth-schemat, som normalt inte går att nå.
-- Därför är de "security definer" och körbara enbart av service_role, dvs.
-- bara från edge-funktionen admin – som i sin tur kräver att den som ringer
-- finns i app_admins.

create or replace function public.aktiva_sessioner()
returns table (user_id uuid, antal bigint, senast timestamptz)
language sql
security definer
set search_path = auth, public
as $$
  select s.user_id,
         count(*)::bigint,
         max(coalesce(s.refreshed_at, s.updated_at, s.created_at))
  from auth.sessions s
  group by s.user_id;
$$;

create or replace function public.avsluta_sessioner(mal uuid)
returns int
language plpgsql
security definer
set search_path = auth, public
as $$
declare
  antal int;
begin
  delete from auth.sessions where user_id = mal;
  get diagnostics antal = row_count;
  -- Äldre versioner av auth-schemat städar inte alltid bort dessa automatiskt
  begin
    delete from auth.refresh_tokens where user_id = mal::text;
  exception when others then null;
  end;
  return antal;
end;
$$;

revoke all on function public.aktiva_sessioner() from public, anon, authenticated;
revoke all on function public.avsluta_sessioner(uuid) from public, anon, authenticated;
grant execute on function public.aktiva_sessioner() to service_role;
grant execute on function public.avsluta_sessioner(uuid) to service_role;
