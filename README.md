# Gårdsarkivet

Gemensamt, privat arkiv för fastighetens dokument (köpekontrakt, servitut, gåvobrev, avtal)
och släktens foton. Byggd för 5–7 inbjudna användare. Appkoden kan ligga öppet (t.ex. GitHub
Pages) – all data skyddas av Supabase-inloggning och signerade URL:er mot Cloudflare R2.

## Arkitektur

- **Frontend:** statisk PWA (HTML/CSS/JS), ingen byggkedja
- **Supabase (EU-region):** inloggning med magic link (endast inbjudna) + databas med metadata
- **Cloudflare R2:** själva filerna (10 GB gratis). Nås aldrig direkt – en Supabase
  edge-funktion (`supabase/functions/r2`) skapar tidsbegränsade signerade URL:er,
  och bara för inloggade användare.

## Kom igång – checklista

### 1. Supabase (ca 15 min)

1. Skapa konto på [supabase.com](https://supabase.com) och ett nytt projekt.
   Välj region **eu-north-1 (Stockholm)** eller Frankfurt.
2. **Stäng av öppen registrering:** Authentication → Sign In / Up → slå av "Allow new users to sign up".
3. **Bjud in släkten:** Authentication → Users → "Invite user" – en per e-postadress (inklusive dig själv).
4. **Databas:** SQL Editor → klistra in innehållet i `supabase/schema.sql` → Run.
5. **Nycklar:** Settings → API → kopiera `Project URL` och `anon public`-nyckeln
   till `js/config.js`.

### 2. Cloudflare R2 (ca 10 min)

1. Skapa konto på [cloudflare.com](https://dash.cloudflare.com), gå till R2.
2. Skapa en bucket, t.ex. `gardsarkivet`. Välj plats **European Union (EU)**.
   Lämna den **privat** (ingen public access, ingen custom domain).
3. R2 → Manage API Tokens → skapa en token med **Object Read & Write** för just den bucketen.
   Anteckna Access Key ID, Secret Access Key och ditt Account ID.
4. Bucket → Settings → **CORS policy** – lägg in (byt origin mot din riktiga adress när appen är publicerad):

   ```json
   [
     {
       "AllowedOrigins": ["http://localhost:8000", "https://DITT-ANVANDARNAMN.github.io"],
       "AllowedMethods": ["GET", "PUT"],
       "AllowedHeaders": ["Content-Type"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```

### 3. Edge-funktionen (ca 10 min)

Kräver [Supabase CLI](https://supabase.com/docs/guides/cli) (`npm i -g supabase`):

```bash
supabase login
supabase link --project-ref DITT_PROJEKT_REF
supabase secrets set R2_ENDPOINT=https://xxxx.eu.r2.cloudflarestorage.com R2_ACCESS_KEY_ID=... R2_SECRET_ACCESS_KEY=... R2_BUCKET=gardsarkivet
supabase functions deploy r2
```

### 4. Testa lokalt

Starta en enkel server i projektmappen och öppna http://localhost:8000:

```bash
python -m http.server 8000
```

Logga in med en inbjuden e-postadress, ladda upp en PDF, kontrollera att den dyker upp
i listan och går att öppna.

### 5. Publicera (senare)

Skapa ett GitHub-repo, pusha, slå på GitHub Pages. Lägg till Pages-adressen i
R2-bucketens CORS-policy och i Supabase: Authentication → URL Configuration → Site URL.

## Säkerhet i korthet

- Registrering avstängd – endast inbjudna konton kan logga in.
- Row Level Security på databasen: bara inloggade läser/skriver.
- R2-bucketen är privat; alla fil-URL:er är signerade och giltiga i 10 minuter,
  och utfärdas bara till inloggade användare via edge-funktionen.
- Data i EU (Supabase Stockholm/Frankfurt, R2 EU-region).

## Roadmap

- **Etapp 2:** kameraskanning (jscanify + jsPDF) → PDF direkt i appen, fotoläge för gamla kort
- **Etapp 3:** sök, flersidiga skanningar, PWA-installation, kommentarer på foton
