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

## Google-inloggning (valfritt men bekvämt)

1. Gå till [console.cloud.google.com](https://console.cloud.google.com) (vanligt Google-konto räcker)
   → skapa ett projekt, t.ex. "Gardsarkivet".
2. **APIs & Services → OAuth consent screen:** välj External, fyll i appnamn
   ("Gårdsarkivet") och din e-post. Spara igenom stegen och tryck **Publish app**.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID:**
   - Application type: **Web application**
   - Authorized redirect URIs: `https://vnaqunoqgijnxhipjitl.supabase.co/auth/v1/callback`
4. Kopiera **Client ID** och **Client secret** till Supabase:
   **Authentication → Sign In / Up → Google** → slå på, klistra in båda, spara.
5. Viktigt: bjud in släktingar med **samma adress som deras Google-konto** –
   då kopplas Google-inloggningen automatiskt till rätt konto. Registrering är
   fortfarande avstängd, så okända Google-konton släpps inte in.

## Radera och flytta

- Alla inbjudna kan radera dokument (med bekräftelsefråga) och flytta dem
  mellan kategorier. Kräver att `supabase/etapp2-uppdatering.sql` körts i SQL Editor.
- Radering tar bort både filen i R2 (via edge-funktionen) och raden i databasen.

## Etapp 3-funktioner

Kräver att `supabase/etapp3-uppdatering.sql` körts i SQL Editor (lägger till
kolumnerna `year` och `ocr_text` samt tabellen `comments`).

- **Flersidiga skanningar:** "Lägg till sida" i förhandsgranskningen sparar sidan
  och öppnar kameran igen. Alla sidor hamnar i samma PDF.
- **Installera som app:** `manifest.json` + `sw.js` gör appen installerbar på
  hemskärmen. Service workern cachar bara appens skal – aldrig dokumenten.
- **Kommentarer:** knapp på varje kort. Alla inbjudna kan kommentera; man kan
  bara ta bort sina egna. Antalet visas på knappen.
- **Textsökning i dokument (OCR):** skannade dokument textläses med tesseract.js
  (svensk språkmodell) vid uppladdning och texten sparas i `ocr_text`, som
  sökrutan söker i. Foton textläses inte. Misslyckas OCR:en sparas dokumentet ändå.
- **Årtal:** eget fält för dokumentets/fotots år, visas på kortet och används av
  sorteringen. Dokument utan årtal hamnar sist vid årtalssortering.

## Administratörer

Kräver `supabase/etapp4-administratorer.sql` (byt ut DIN@EPOST.SE mot din
inloggningsadress innan du kör den) och edge-funktionen `admin`.

Administratörer ser knappen **Personer** i appens huvudvy och kan där:

- lägga till en person (kontot skapas färdigbekräftat – inget mejl skickas,
  personen loggar in med Google eller begär en inloggningslänk själv)
- ta bort en person
- göra någon annan till administratör, som backup om du inte är tillgänglig
- se vem som är inloggad just nu, på hur många enheter, och när de senast var aktiva
- logga ut någon från alla enheter utan att ta bort deras tillgång
  (kräver `supabase/etapp5-sessioner.sql`)

Behörigheten kontrolleras i edge-funktionen mot tabellen `app_admins`; att
knappen döljs för andra är bara bekvämlighet, inte skyddet.

## Säkerhet i korthet

- Registrering avstängd – endast inbjudna konton kan logga in.
- Row Level Security på databasen: bara inloggade läser/skriver.
- R2-bucketen är privat; alla fil-URL:er är signerade och giltiga i 10 minuter,
  och utfärdas bara till inloggade användare via edge-funktionen.
- Data i EU (Supabase Stockholm/Frankfurt, R2 EU-region).

## Roadmap

- **Etapp 2:** kameraskanning (jscanify + jsPDF) → PDF direkt i appen, fotoläge för gamla kort
- **Etapp 3:** sök, flersidiga skanningar, PWA-installation, kommentarer på foton
