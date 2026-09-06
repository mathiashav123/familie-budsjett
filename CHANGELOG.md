# Endringslogg – Familiebudsjett

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
