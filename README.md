# Familiebudsjett

Rolig, mobilvennlig budsjettapp for husstanden. **Budsjett mot faktisk**, rask «Kjøpt noe»-logging, flere personer + felles, og tydelig Inn/Ut. Alt lagres lokalt i nettleseren (`localStorage`, nøkkel `familie-budsjett-v1`). **Ingen bankinnlogging.**

Valuta: **NOK**. Språk: **bokmål**.


## Årsoversikt

Under **Mer → År**: velg år og se plan inn / plan ut / faktisk ut / til overs per måned, med totaler og enkel SVG-graf. I **Logg** kan du velge «Hele året».

## Underlinjer

Utvid en kategori på Plan og trykk **+ Linje** for å dele forventet beløp (f.eks. Abonnement → Netflix, Spotify). Summen blir kategoriens forventet. Uten linjer fungerer det gamle enkeltbeløpet som før.

### Årlige og kvartalsvise linjer
Sett **Intervall** til Årlig eller Kvartalsvis. Beløpet er da års-/kvartalspris. Velg **Fordel** (jevn månedsandel) eller **I måned** (fullt beløp kun i valgt måned). **Betales i** (Januar–Desember) er alltid synlig for disse intervallene.

## Kategorier

### Felles-fordeling
- Under **Plan → Felles**, utvid en kategori og sett **Fordeling** i % per person (f.eks. Mathias 60 %, Andrea 40 %). Sum bør være 100 %.
- Standard er lik del (50/50). Egendefinert lagres på kategorien; ny person får 0 % på egendefinerte, ellers rebalanseres likt.
- I **Oversikt** per person brukes andelen i planUt / faktisk ut. Under personen vises «Andel felles». Samlet teller felles beløp én gang.


- **Ny installasjon** starter uten kategorier (forslag under hver person / Felles).
- **+ Ny kategori** og **chips per seksjon** (Mathias / Andrea / Felles): personlige forslag + «Felles-forslag». Chip skjules bare når samme navn+eier finnes (Mat hos Mathias skjuler ikke Mat hos Andrea).
- **Hold ⠿ og dra** for egen rekkefølge (lagres som `order` i localStorage). Velg sortering «Egen rekkefølge» på Plan.
- **Fyll budsjett fra Excel** oppretter manglende kategorier med riktig eier (Mathias/Andrea/Felles).
- Eksisterende lagring med kategorier beholdes. Under Mer: «Fjern alle kategorier» (med bekreftelse).


## Åpne på PC

```bash
cd /workspace/familie-budsjett
./start.sh
# eller: python3 -m http.server 8765
```

Åpne [http://localhost:8765](http://localhost:8765).

## Åpne på iPhone (Safari → Hjem-skjerm)

1. Bruk **`familie-budsjett-mobil.html`** (alt i én fil) – AirDrop / iCloud / e-post.
2. Åpne i **Safari** → **Del** → **Legg til på Hjem-skjerm**.
3. Eller host mappen og åpne `index.html` via lokal adresse.

Modaler (Innstillinger, Kjøpt noe, …) har **fallback** hvis `showModal` svikter på iOS `file://`.

## Personer (viktig)

Under ⚙️ **Innstillinger → Personer**:

- **Gi nytt navn** – oppdateres overalt (Inn/Ut-faner, kort, «hvem»).
- **Legg til person** – ny i planlagt inntekt, kort og logging.
- **Arkiver** – skjuler personen. Har de data, flyttes utgifter til **Felles** (bekreftelse).
- **Slett** – kun hvis personen ikke har data (ellers arkiver).
- **Felles** er *ikke* en person: delte utgifter merkes Felles og **deles likt** mellom aktive personer (vist i UI).

Gammel data med `names.a/b` migreres automatisk til `people[]` (`p1`/`p2`).

## Inn og ut

- Faner: **Samlet** | hver person.
- **Samlet**: forventet/faktisk inn og ut, til overs plan/faktisk.
- **Per person**: egen inntekt, egne utgifter + lik andel av Felles, til overs.
- Under **Plan**: forventet inntekt og kategorier – totalsummer oppdateres live.

## Kjøpt noe – kategori og hvem

- **Hvem** styrer hvilke kategorier som vises: person → egne + **Felles**; Felles → kun felles.
- **+ Ny kategori** inne i dialogen hvis du mangler en (eier = valgt «Hvem»).

## Faner

- **Plan** – forventet inntekt + forventede utgifter **per person** (Mathias / Andrea / Felles). Under hver: Faste/Variable; trykk rad for detaljer.
- **Oversikt** – Inn/Ut, kontoer (bruk/spare per person), personkort, diagram.
- **Kjøpt noe** – oransje knappen midt i fanelinjen (åpner dialog, bytter ikke fane).
- **Sparing** – spare saldo, spareinnskudd og **sparemål** (mål / kr per mnd / ETA).
- **Mer** – snarveier: **Logg**, Personer, År, Innstillinger, Ta backup, **Fyll budsjett fra Excel**, Nullstill.

Fanelinjen er balansert: to faner til venstre, Kjøpt noe i midten, to faner til høyre.

## Sparemål

På **Sparing**: sett navn, målbeløp og hvor mye du vil spare per måned. Oppdater «Spart mot dette målet» etter hvert. Appen viser omtrent når målet nås (`ceil(gjenstår / kr per mnd)` kalendermåneder). Fremdrift er bevisst et eget tall per mål – ikke auto-sum fra spare saldo (flere mål kan dele konto).

## Kopier forventet til nye måneder

Når du åpner en måned uten forventet inntekt/budsjett, kopieres verdier fra nærmeste tidligere måned med data (alle kategorier + planlagt inntekt). Endringer i en måned blir mal for senere *tomme* måneder. Allerede utfylte måneder overskrives ikke. Styres under ⚙️ («Kopier forventet til nye måneder automatisk», på som standard). Manuell «Kopier budsjett» finnes fortsatt under Plan.


## Kontoer

På Oversikt: **Bruk** (brukskonto / før lønn) og **Spare** per person, pluss totalt bruk / spare / alt. Gammel enkelt-saldo migreres til første person (Mathias) som bruk; andre starter på 0.

**Forventet på konto etter** bruker kun bruk-saldoer (+ månedsresultat). Sparekonto er **utenfor** «Trygg å bruke».

Ved automatisk kopiering til ny måned kopieres også kontoer fra forrige måned (hvis den nye måneden ikke allerede har kontoer satt).

## Trygg å bruke

På Oversikt (og mini på Plan). Følger **Inn/Ut-fanen** (Samlet / person).

- **Samlet**: husstandstall.
- **Per person**: personens tall. Tittel: `Trygg å bruke · [navn]`.

**Saldo-modus** (bruk satt): `bruk − gjenstående budsjett tilordnet personen − buffer/antall`. Felles gjenstående fordeles med kategori-%. Spare utenfor.

**Plan-modus**: `planInn − utgifter (egne + felles-andel) − gjenstående faste`.

## Backup

Stor **Ta backup**-knapp på Oversikt, under Mer og i Innstillinger → samme JSON-eksport. Anbefalt før telefonbytte. CSV finnes fortsatt under Innstillinger.

## Excel-demo

Under **Mer → Fyll budsjett fra Excel**: setter forventet inntekt og kategori-budsjett for **alle 12 måneder**:

- **Felles** (summert fra begge Excel-rader): Lån 23440, Strøm 1900, Internett 869, Forsikring 732 (= 26941)
- **Mathias**: lønn 42500 + ekstra 2400; personlige variable + Mobil 498
- **Andrea**: lønn 30000; personlige variable (inkl. Baby 2319)

Plan-fanen: Mathias | Andrea | Felles. I Oversikt er personens planUt = egne beløp + lik andel av Felles. Lager ikke fake kjøp eller saldo.


## Sky-synk (gratis) – PC ↔ telefon

Under **Mer → Konto / Synk**: opprett konto med **brukernavn + passord** (ingen e-post). Første innlogging på PC oppretter husstanden «Familie» og **laster opp** lokal `familie-budsjett-v1`. På telefon: samme brukernavn, eller egen konto + **invitasjonskode**.

- localStorage beholdes som offline cache/backup (nøkkel **`familie-budsjett-v1`** – aldri wipe).
- Ved lagring: debounced push hvis innlogget.
- Ved start/fokus: pull hvis skyen er nyere (last-write-wins; ved konflikt foreslås sky med mulighet til å beholde lokal).
- Export backup fungerer som før. **Ingen bankkobling.**

### Wake-up (én gang – gratis Supabase)

1. Opprett gratis prosjekt på supabase.com (Free tier).
2. SQL Editor: kjør hele filen `supabase-schema.sql`.
3. Authentication → Providers → Email: slå AV «Confirm email» (vi bruker brukernavn, ikke ekte e-post).
4. Project Settings → API: kopier Project URL og anon public key inn i `supabase-config.js` (feltene `url` og `anonKey`).
5. Valgfritt: Auth → URL Configuration → Site URL = https://mathiashav123.github.io/familie-budsjett/
6. Commit/push config (anon key er offentlig i klienten – aldri `service_role`).
7. Åpne Pages → Mer → Konto / Synk → opprett konto på PC. På telefon: samme bruker eller bli med med kode.

Uten fylt config viser UI «Kun lokalt»; resten av appen fungerer offline.

## Tester

```bash
node test-calc.mjs          # beregninger (må være grønne)
python3 test-browser.py     # krever Chrome + selenium (valgfritt)
```

## Filer

| Fil | Beskrivelse |
|-----|-------------|
| `index.html` / `styles.css` / `app.js` / `calc-core.js` | App |
| `test-calc.mjs` | Automatiske kalkulasjonstester |
| `manifest.webmanifest` + ikoner | PWA |
| `start.sh` | Lokal server |

## Teknisk

- Ren HTML/CSS/JS. Valgfri gratis Supabase-synk (brukernavn + passord).
- Tall: `nb-NO`; komma/punktum som desimal
- Fellesutgifter deles likt på antall *aktive* personer
