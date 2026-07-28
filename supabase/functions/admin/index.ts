// Edge-funktion: låter administratörer hantera vilka som har tillgång till appen.
// Körs med serverns nyckel (service role) men släpper bara igenom anrop från
// inloggade användare som finns i tabellen app_admins.
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Vem ringer?
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: req.headers.get('Authorization')! } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user?.email) return json({ error: 'Ej inloggad' }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);

    // Är den som ringer administratör?
    const { data: adminRad } = await admin.from('app_admins')
      .select('email').eq('email', user.email).maybeSingle();
    if (!adminRad) return json({ error: 'Bara administratörer kan hantera personer' }, 403);

    const { action, email } = await req.json();
    const epost = (email ?? '').trim().toLowerCase();

    if (action === 'list') {
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      const { data: admins } = await admin.from('app_admins').select('email');
      const adminEposter = new Set((admins ?? []).map((a) => a.email));

      // Aktiva sessioner – kräver etapp5-uppdateringen, saknas den visas bara
      // ingen sessionsinfo istället för att hela listan slutar fungera.
      const sessioner = new Map<string, { antal: number; senast: string }>();
      const { data: rader } = await admin.rpc('aktiva_sessioner');
      for (const rad of rader ?? []) {
        sessioner.set(rad.user_id, { antal: Number(rad.antal), senast: rad.senast });
      }

      return json({
        personer: data.users.map((u) => ({
          id: u.id,
          email: u.email,
          senast_inloggad: u.last_sign_in_at,
          admin: adminEposter.has(u.email ?? ''),
          jag: u.email === user.email,
          sessioner: sessioner.get(u.id)?.antal ?? 0,
          senast_aktiv: sessioner.get(u.id)?.senast ?? null,
        })).sort((a, b) => (a.email ?? '').localeCompare(b.email ?? '', 'sv')),
      });
    }

    if (action === 'logout') {
      const { data: users, error } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      const träff = users.users.find((u) => u.email === epost);
      if (!träff) return json({ error: 'Hittade ingen med den adressen' }, 404);
      const { data: antal, error: rpcError } = await admin.rpc('avsluta_sessioner', { mal: träff.id });
      if (rpcError) return json({ error: 'Kunde inte logga ut: ' + rpcError.message }, 500);
      return json({ ok: true, antal });
    }

    if (action === 'add') {
      if (!epost.includes('@')) return json({ error: 'Ogiltig e-postadress' }, 400);
      // Skapar kontot färdigbekräftat – inget inbjudningsmejl skickas, personen
      // loggar in med Google eller begär en inloggningslänk själv i appen.
      const { error } = await admin.auth.admin.createUser({
        email: epost,
        email_confirm: true,
      });
      if (error) {
        const meddelande = String(error.message).toLowerCase().includes('already')
          ? 'Personen har redan tillgång.'
          : error.message;
        return json({ error: meddelande }, 400);
      }
      return json({ ok: true });
    }

    if (action === 'remove') {
      if (epost === user.email) return json({ error: 'Du kan inte ta bort dig själv' }, 400);
      const { data, error } = await admin.auth.admin.listUsers({ perPage: 200 });
      if (error) throw error;
      const träff = data.users.find((u) => u.email === epost);
      if (!träff) return json({ error: 'Hittade ingen med den adressen' }, 404);
      const { error: delError } = await admin.auth.admin.deleteUser(träff.id);
      if (delError) throw delError;
      await admin.from('app_admins').delete().eq('email', epost);
      return json({ ok: true });
    }

    if (action === 'set-admin' || action === 'unset-admin') {
      if (action === 'unset-admin' && epost === user.email) {
        return json({ error: 'Du kan inte ta bort din egen behörighet' }, 400);
      }
      const { error } = action === 'set-admin'
        ? await admin.from('app_admins').upsert({ email: epost })
        : await admin.from('app_admins').delete().eq('email', epost);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Okänd action' }, 400);
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
