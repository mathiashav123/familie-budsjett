# Endringslogg – Familiebudsjett

## 7. september 2026 (UTC+2) – Konto / Synk UX

### Mer → Konto / Synk
- Tydelig valg: **Opprett husstand** vs **Logg inn** (brukernavn + passord).
- Forklaring: synker PC og telefon; lokal sikkerhetskopi beholdes. Ingen bank.
- Status med prikk: **Kun lokalt** / **Synket** / **Synker…** (+ feil).
- Invitasjonskode som egen kort for andre enhet (Kopier kode).
- Feilmeldinger og hint på norsk; ingen leverandørnavn i brukergrensesnitt.
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**.

## 6. september 2026 (UTC+2) – Husstands-synk (gratis)

### Konto / Synk
- **Mer → Konto / Synk**: brukernavn + passord (ingen e-post / magic link).
- Første innlogging oppretter husstand «Familie» og laster opp lokal state.
- Andre enhet: samme bruker **eller** invitasjonskode → hent sky.
- Status: Synket / Kun lokalt / Synker… + sist synket.
- Debounced push ved lagring; pull ved start/fokus. Last-write-wins; konflikt → foreslå sky, behold lokal mulig.
- localStorage `familie-budsjett-v1` beholdes som cache/backup. Export backup uendret. Ingen bank.

### Backend (gratis Supabase Free)
- `supabase-schema.sql` + tom `supabase-config.js`.
- Tynn fetch-klient (ingen betalt tjeneste).

### Tester / deploy
- `test-sync.mjs` (rene hjelpere). Calc-tester grønne.
- Pages kan deployes med tom config; synk aktiveres når nøkler fylles.

## 6. september 2026 (UTC+2) – Planlagt sparing per måned

### Plan → Sparing (ved lønn)
- Nytt felt **Sparing** under Lønn/Ekstra for hver person: beløp du vil sette av hver måned (f.eks. 3000 kr).
- Hint: «Beløp du vil sette av hver måned».
- Lagres additivt som `plannedIncome[personId].sparing` (samme objekt som lønn/ekstra). **Ikke** inntekt – teller ikke i planInn.
- Videreføres til nye måneder på samme måte som lønn/ekstra.

### Sparing-fanen
- Ny metrikk **Planlagt denne måneden** (per person / Samlet) fra Plan-feltet.
- Ved **+ Nytt sparemål**: forhåndsutfyller «per måned» fra planlagt sparing (hvis satt). Sparemål beholdes som før.

### Datasikkerhet
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Kun additivt felt. Ingen wipe.


## 6. september 2026 (UTC+2) – Sparing-fane + sparemål

### Sparing som bunnfane
- **Sparing** er egen fane i bunnlinjen: Plan | Oversikt | **Kjøpt noe** | Sparing | Mer (balansert 2|buy|2).
- **Logg** er flyttet til Mer → Logg (samme panel som før).
- Mer → Sparing er demotert (ghost «Sparing (fane)») – ikke lenger eneste inngang.

### Sparemål
- Opprett/rediger/slett mål: navn, målbeløp (kr), spare per måned (kr/mnd), «Spart mot dette målet», eier (Husstand / Felles / person).
- Liste på Sparing-fanen med progresjonsbar + ETA («ca. mnd ÅÅÅÅ», «nådd», eller «Sett månedlig beløp»).
- **Formel:** `monthsNeeded = ceil((mål − spart) / månedsbeløp)`; ETA = inneværende kalendermåned + monthsNeeded.
- **Fremdrift:** eksplisitt felt «Spart mot dette målet» per mål (ikke auto-koblet til spare saldo / spareinnskudd – unngår tvetydighet ved flere mål). Saldo og innskudd forblir egen oversikt.

### Datasikkerhet
- Additivt `savingsGoals[]` på state. Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Ingen wipe.


## 6. september 2026 (UTC+2) – Sparing-seksjon

### Mer → Sparing
- Ny snarvei **Sparing** under Mer (egen seksjon – uten å trenge i bunnfanene / «Kjøpt noe»).
- Faner **Samlet / Mathias / Andrea** (samme chip-mønster som Inn/ut).
- **Nå**: spare saldo fra Kontoer (utenfor Trygg å bruke).
- **Denne måneden**: sum av loggførte spareinnskudd i valgt måned.
- **I år**: sum spareinnskudd i valgt kalenderår.
- **Totalt**: alle lagrede spareinnskudd (alle måneder).
- **+ Spareinnskudd** gjenbruker eksisterende sparing-dialog (beløp, hvem, dato, notat).
- Ingen tips, benchmarks eller sparingsmål (kun «kommer senere»).

### Formel / data
- `sparingStats` + `sumSavingsForMonth` i calc-core.
- Bruker eksisterende `balances[].spare` og `months[].savings[]`.
- Additiv setting `sparingView` (standard `samlet`). Lagringsnøkkel uendret: **`familie-budsjett-v1`**.

## 6. september 2026 (UTC+2) – Trygg å bruke per person

### Trygg å bruke følger Inn/Ut-fanen
- **Samlet**: husstandens Trygg å bruke (som før).
- **Mathias / Andrea** (eller annen person): personens eget tall. Tittel f.eks. `Trygg å bruke · Mathias`.
- Samme faner som Inn og ut på Oversikt; Plan-mini følger samme valg.

### Formel per person
- **Saldo-modus** (når personens bruk er satt): `bruk − gjenstående budsjett tilordnet personen − buffer/antall personer`. Spare utenfor.
- **Gjenstående**: egne kategorier `max(0, plan−faktisk)` + **%-andel av Felles** gjenstående (samme split som planUt).
- **Plan-modus**: `planInn − utgifter (egne + felles-andel) − gjenstående faste` (med felles-attribusjon).
- Buffer fordeles **likt** på aktive personer.

### Datasikkerhet
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Ingen wipe/auto-reset.

## 6. september 2026 (UTC+2) – Kjøpt noe: kategori etter hvem + hurtig ny kategori

### Kategori filtrert etter «Hvem»
- Velger du **Mathias** (eller annen person): kun **deres** kategorier **+ Felles**.
- Velger du **Andrea**: kun hennes **+ Felles**.
- Velger du **Felles**: kun felles-kategorier.
- Byttes «Hvem», nullstilles kategori hvis den ikke lenger er gyldig.
- Siste huskede kategori brukes bare hvis den fortsatt passer til valgt «Hvem».

### + Ny kategori inne i Kjøpt noe
- Knapp **«+ Ny kategori»** åpner kompakt skjema (navn + Fast/Variabel).
- Eier forhåndssettes fra «Hvem» (person eller Felles).
- Lagre → kategorien opprettes, velges i listen, dialog for kjøp forblir åpen.

### Datasikkerhet
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Ingen wipe/auto-reset.

## 6. september 2026 (UTC+2) – Årlige/kvartalsvise underlinjer

### Intervall på underlinjer
- Hver underlinje kan være **Månedlig** (standard), **Årlig** eller **Kvartalsvis**.
- Ved Årlig/Kvartalsvis: velg **Fordel** (beløp /12 eller /3 hver måned) eller **I måned** (fullt beløp kun i valgt måned).
- **Betales i**-månedsvelger (Januar–Desember) vises alltid for Årlig/Kvartalsvis – også ved Fordel (lagres for senere påminnelser).
- Kategoriens forventet / planUt = sum av hver linjes **månedlige bidrag** for den måneden du ser på.
- Hint: «1199 kr/år ≈ 100 kr/mnd» ved Fordel.

### Datasikkerhet
- Additive felt på linjer: `interval`, `mode`, `month`. Manglende felt = månedlig (gammel data uendret).
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Ingen auto-reset. Carry-forward kopierer intervallfeltene.

## 6. september 2026 (UTC+2) – Årsoversikt + underlinjer

### Feature A — År
- **Mer → År**: velg år, tabell med plan inn / plan ut / faktisk ut / til overs per måned.
- Årstotaler + enkel SVG-søylediagram (plan ut vs faktisk ut), uten ekstra biblioteker.
- Trykk på en månedrad for å hoppe dit. Valgfritt **Hele året** i Logg-filter.

### Feature B — Underlinjer
- Utvid en kategori → **+ Linje** for abonnement o.l. (navn + beløp, slett, kalkulator).
- Når underlinjer finnes, er **Forventet** = summen (skrivebeskyttet); linjene styrer budsjetttallet.
- Lagres additivt som `budgetLines` per måned. Gammel `budgets[catId][owner]=tall` fungerer uendret uten linjer.
- Carry-forward / «Kopier budsjett» kopierer også underlinjer. Excel-fyll lar linjer stå tomme.

### Datasikkerhet
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Kun additiv migrering. Ingen auto-reset.

## 6. september 2026 (UTC+2) – Trygge UX-fikser — sletter ikke data

### Trygge UX-fikser — sletter ikke data
- **Lagringsnøkkel uendret:** `familie-budsjett-v1`. Kun additive/trygge migreringer. Ingen auto-reset.
- **Manglende forventet inntekt:** Rolig banner på Plan: «Sett forventet inntekt for [navn]» med hopp til feltet.
- **Felles % ≠ 100:** Tydelig hint + knapp **Fordel likt (100 %)** / **Normaliser til 100 %**.
- **Trygg å bruke = 0 med lav saldo:** Klar norsk tekst når saldo-modus ikke dekker gjenstående budsjett.
- **Arkiver person:** Bekreftelse forklarer at utgifter → Felles, mens inntekter blir i historikken (Logg-filter).

### Simulering
- `sim-10y.mjs`: syntetisk 10-års husstandsliv (2020–2029) – berører ikke live localStorage.

## 6. september 2026 (UTC+2) – Plan-kalkulator + Familie/Personer

### Plan – kalkulator på forventet inntekt
- **Kalkulator**-knapp ved **Lønn** og **Ekstra** under Plan → Forventet inntekt (samme UX som «Kjøpt noe»).
- Delt trykkpad (`planIncCalc`) som flytter seg under feltet du redigerer; **Bruk** lagrer beløpet.
- Inntekt-dialog (lønn/ekstra) beholder `incCalc` – uendret og i bruk.

### Mer → Familie / Personer
- Egen seksjon med store navnefelt (endre på stedet), tydelig **+ Legg til person**, og **Fjern** med bekreftelse.
- Har data → arkiveres (skjules) og eierskap flyttes til **Felles**. Uten data → slettes permanent.
- **Felles** vises som ikke-slettbar info. Mathias & Andrea er standard til du endrer.

### Visuell polish
- Kalkulator-pad: bedre spacing, større taster, mykere flate.
- Personkort mer romslige og mobilvennlige.


## 6. september 2026 (UTC+2) – Beløp-kalkulator

### Kalkulator for beløp
- **Kalkulator**-knapp i «Kjøpt noe», inntekt- og sparing-dialoger (trykkpad: sifre, +, −, ×, ÷, =, C, ⌫, komma).
- **Bruk** setter resultatet i beløpsfeltet. Hurtigbeløp-chips er uendret.
- Beløpsfelt godtar **uttrykk** som `199+49+12` (evalueres trygt ved Enter/blur/lagring – ingen vilkårlig JS).
- Samme uttrykk-støtte for forventet inntekt, kategori-forventet og saldo-felt.

## 6. september 2026 (UTC+2)

### Saldo i trygg-å-bruke
- **Trygg å bruke (fra saldo)** når brukssaldo er satt: `sum bruk − gjenstående budsjett − buffer` (spare utenfor).
- Uten brukssaldo: gammel plan-formel + hint «Sett brukssaldo for mer treffsikkert tall».
- Innstilling **«Bruk saldo i trygg-å-bruke»** (standard på) og valgfri **buffer** (standard 0).
- Oversikt: kort med **Nå på bruk** + **Etter lønn (plan)** = bruk + forventet inn − forventet ut (erstatter duplikat «Forventet på konto etter»).

### Visuell polish (valgfri)
- Roligere teal/amber-palett, mykere kort og færre harde kanter.
- **Trygg å bruke** tydeligere som hovedtall på Oversikt (større tabular-nums).
- Fanelinje med små ikoner + etiketter; midtknappen «Kjøpt noe» fortsatt hevet i midten.
- Progresjonsbar («igjen») beholdt – litt bedre kontrast/avstand; dialoger mer sheet-følelse på mobil.

### Kategorier – hurtigvalg per person
- Forslagschips ligger **under hver Plan-seksjon** (Mathias / Andrea / Felles), ikke som én global rad.
- Under person: egne forslag (Mat, Hygiene, …) + liten gruppe **Felles-forslag** (legges til som Felles).
- Under Felles: kun delte forslag (Lån, Strøm, …, Mobil, Baby).
- Chip skjules bare når **samme navn + eier** finnes. Mat hos Mathias skjuler ikke Mat hos Andrea.
- **+ Ny kategori** i hver seksjon forhåndsvelger riktig eier.

### Kjøpt noe – mindre friksjon
- Husker **siste kategori og hvem**.
- Beløp får fokus med en gang; dato er i dag.
- Valgfritt: **«Legg til mer etter lagring»** (dialog blir stående åpen).

### Roligere tall og tekster
- Litt over budsjett = **amber** («Litt over»), hard rød først ved mer enn ~15 % over.
- Oppmuntrende tomtilstander; mindre «skyld»-språk.
- **Trygg å bruke** er tydeligere forklart på Oversikt (vanlig norsk).

### Kom i gang og Plan
- Onboarding i **3 steg** (kategorier → inntekt → forventet).
- **Kopier budsjett** mer synlig på Plan.
- Små polish: større trykkflater (≥44px), fokususstil, scroll huskes bedre ved oppdatering.

Backup-knapp og midtfanens «Kjøpt noe», progresjonsbar («igjen»), %-fordeling på felles og Mer-fanen er uendret i funksjon.
