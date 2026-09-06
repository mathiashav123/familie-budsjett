# Endringslogg – Familiebudsjett

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
