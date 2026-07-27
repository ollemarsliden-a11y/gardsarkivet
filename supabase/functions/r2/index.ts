// Edge-funktion: skapar signerade URL:er mot Cloudflare R2 (S3-kompatibelt API).
// Kräver secrets: R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// R2_ENDPOINT = hela S3-endpointen från Cloudflare, t.ex.
// https://xxxx.eu.r2.cloudflarestorage.com (EU-jurisdiktion har ".eu." i adressen)
// Deploya med: supabase functions deploy r2
import { AwsClient } from 'npm:aws4fetch@1.0.20';
import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const r2 = new AwsClient({
  accessKeyId: Deno.env.get('R2_ACCESS_KEY_ID')!,
  secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY')!,
});
const endpoint = Deno.env.get('R2_ENDPOINT')!.replace(/\/$/, '');
const bucket = Deno.env.get('R2_BUCKET')!;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // Verifiera att anropet kommer från en inloggad användare
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization')! } } },
    );
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return json({ error: 'Ej inloggad' }, 401);
    }

    const { action, key, contentType } = await req.json();
    if (!key || key.includes('..')) return json({ error: 'Ogiltig nyckel' }, 400);

    if (action === 'delete') {
      // Radering sker direkt härifrån (server till server) – ingen CORS inblandad
      const res = await r2.fetch(`${endpoint}/${bucket}/${key}`, {
        method: 'DELETE',
        aws: { service: 's3', region: 'auto' },
      });
      if (!res.ok && res.status !== 404) {
        return json({ error: 'Lagringen svarade ' + res.status }, 500);
      }
      return json({ ok: true });
    }

    const url = new URL(`${endpoint}/${bucket}/${key}`);
    url.searchParams.set('X-Amz-Expires', '600'); // giltig i 10 minuter

    if (action === 'sign-upload') {
      // Content-Type signeras medvetet inte in – webbläsaren får skicka vilken
      // typ den vill, signaturen gäller bara metod + sökväg. (Robustare, och
      // Cloudflares egen rekommendation för presignade R2-URL:er.)
      const signed = await r2.sign(new Request(url, { method: 'PUT' }), {
        aws: { signQuery: true, service: 's3', region: 'auto' },
      });
      return json({ url: signed.url });
    }

    if (action === 'sign-download') {
      const signed = await r2.sign(new Request(url, { method: 'GET' }), {
        aws: { signQuery: true, service: 's3', region: 'auto' },
      });
      return json({ url: signed.url });
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
