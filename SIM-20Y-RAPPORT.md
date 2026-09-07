# Familiebudsjett – 20-års simulering (2020–2039)

**Dato:** 7. september 2026 (UTC+2)  
**Type:** Syntetisk husstandsbruk (Mathias + Andrea + Felles) — **ingen** lokal brukerdata / localStorage berørt.  
**Skript:** `sim-20y.mjs` (bygger på `sim-10y.mjs` / `sim-2y.mjs`)

---

## Kort svar: Holder det i 20 år?

**Teknisk: ja.** Kalkulasjoner er raske (~0.21 ms/mnd, hele 240 mnd på ~27 ms), carry-forward av plan fungerer, felles-fordeling summerer til 100 %, underlinjer (år/kvartal) synker budsjett riktig, safe-to-spend per person er endelig, og `yearRollup` / `sparingStats` tåler to tiår.

**Som daglig produkt over 20 år: delvis.** Appen forblir nyttig som **månedsstyring** (budsjett, safe-to-spend, sparing-innskudd, sparemål). Den blir gradvis mindre behagelig som **livshistorikk** fordi logg, navigasjon og sync-payload vokser lineært uten sterke flerårsverktøy, og sparemål krever manuell oppdatering av «spart».

**Assertions:** 5459 OK / 0 feil  
**Payload etter 20 år:** 1767.2 KiB (~1.73 MiB)

---

## Hva ble simulert

| Område | Dekning |
|--------|---------|
| Personer | Mathias (p1), Andrea (p2); Emma (p3) lagt til år 11, omdøpt, arkivert år 15 |
| Budsjetter | Felles + personlige kategorier, inflasjon ~2–3 %/år, Lån-justeringer |
| Underlinjer | Netflix (år/once), Spotify (mnd), Disney+ (kvartal/spread); bilforsikring (år), innbo (kvartal/once) |
| Inntekt | Lønn + ekstra, lønnsøkning år 5 og 10, jobbytte/inntektsfall Andrea år 7 |
| Sparing | Planlagt sparing nær lønn, spareinnskudd, spare saldo, `sparingStats` |
| Sparemål | 5 mål over tid: fullført / forlatt / justert / aktive |
| Safe-to-spend | Saldo-modus per person + samlet |
| Edge cases | 4 glemte måneder, 3 engangsutgifter, nye kategorier midt i løpet |
| Årsvisning | `yearRollup` hvert år (~2.1 ms snitt) |

### Livshendelser (utvalg)
- 2021-07: MISSED month (minimal logging — ferie/liv)
- 2022-01: added Baby category (year 3)
- 2022-07: sparemål «Sommerferie Italia» justert → 75k / 2.8k mnd
- 2023-01: felles split → 55/45 on Lån/Strøm/Felleskost
- 2023-01: sparemål «Bufferkonto» nådd (102257.52 / 100000)
- 2023-05: engangsutgift Motorbytte 28500
- 2023-05: sparemål «Sommerferie Italia» nådd (76530 / 75000)
- 2024-01: Barnehage + salary bump (+12% / +8%)
- 2025-01: sparemål «Ny PC» forlatt (21688/25000)
- 2025-03: MISSED month (minimal logging — ferie/liv)
- 2026-01: p2 job change (income drop to 72%)
- 2028-01: nytt sparemål Elbil-nedbetaling
- 2029-01: nytt sparemål Kamerautstyr
- 2029-03: engangsutgift Bryllupsreise 42000
- 2030-01: Elbil-lading + salary bump #2
- 2030-07: sparemål «Kamerautstyr» forlatt (12389.55/22000)
- 2030-10: sparemål «Elbil-nedbetaling» nådd (122611.36 / 120000)
- 2031-01: person Emma (p3) lagt til
- 2031-08: MISSED month (minimal logging — ferie/liv)
- 2032-01: person p3 omdøpt til Emma H.
- 2032-07: nytt sparemål Hyttefond
- 2035-01: Emma arkivert (flyttet ut), Lån tilbake 55/45
- 2035-11: engangsutgift Tannlege 15000
- 2036-02: MISSED month (minimal logging — ferie/liv)
- 2037-05: sparemål «Hyttefond» nådd (253346.51 / 250000)

---

## Nøkkeltall

| Metrikk | Verdi |
|---------|-------|
| Måneder | 240 |
| Utgiftsposter | 11208 |
| Inntektsrader | 754 |
| Spareinnskudd | 449 |
| Snitt utgifter/mnd | 46.7 |
| Maks utgifter i én mnd | 60 |
| Carry-forward | 239 |
| Over budsjett (kat·mnd) | 2448 |
| calcFamily snitt/maks | 0.212 / 3.006 ms |
| Sync JSON (20 år) | 1767.2 KiB |
| Sparemål fullført | 4 |
| Sparemål forlatt | 2 |
| Sparemål justert | 2 |

### Payload-vekst (viktig for sky-synk)

| År | JSON-størrelse | Måneder lagret |
|----|----------------|----------------|
| 2020 | 78.0 KiB | 12 |
| 2021 | 149.7 KiB | 24 |
| 2022 | 233.2 KiB | 36 |
| 2023 | 314.5 KiB | 48 |
| 2024 | 400.9 KiB | 60 |
| 2025 | 485.8 KiB | 72 |
| 2026 | 571.9 KiB | 84 |
| 2027 | 657.2 KiB | 96 |
| 2028 | 744.8 KiB | 108 |
| 2029 | 828.0 KiB | 120 |
| 2030 | 922.4 KiB | 132 |
| 2031 | 1012.8 KiB | 144 |
| 2032 | 1106.4 KiB | 156 |
| 2033 | 1200.4 KiB | 168 |
| 2034 | 1290.8 KiB | 180 |
| 2035 | 1385.8 KiB | 192 |
| 2036 | 1475.5 KiB | 204 |
| 2037 | 1570.9 KiB | 216 |
| 2038 | 1664.5 KiB | 228 |
| 2039 | 1756.8 KiB | 240 |

**Tolkning:** Veksten er ~lineær med antall måneder/transaksjoner. Etter 20 år er ~1767 KiB fortsatt **under** typiske localStorage-grenser (~5 MiB), men for **sky-synk** (hele JSON opp/ned) begynner det å merkes: tregere sync, større konfliktrisiko, dyrere båndbredde på mobil. Uten komprimering / inkrementell sync / arkiv av gamle år vil 30–40 år bli ubehagelig.

### Sample safe-to-spend

| Måned | Utgifter | Safe-to-spend | Modus | Personer | Calc |
|-------|----------|---------------|-------|----------|------|
| 2020-01 | 42 | 17007.09 | saldo | 2 | 3.01 ms |
| 2022-01 | 49 | 12178.65 | saldo | 2 | 0.17 ms |
| 2024-01 | 43 | 16165.27 | saldo | 2 | 0.17 ms |
| 2026-01 | 47 | 10428.3 | saldo | 2 | 0.12 ms |
| 2028-01 | 40 | 16062.96 | saldo | 2 | 0.19 ms |
| 2030-01 | 49 | 14266.66 | saldo | 2 | 0.17 ms |
| 2031-01 | 52 | 23289.66 | saldo | 3 | 0.28 ms |
| 2035-01 | 52 | 7791.57 | saldo | 2 | 0.17 ms |
| 2036-09 | 51 | 8503.23 | saldo | 2 | 0.16 ms |
| 2039-12 | 57 | 11104.51 | saldo | 2 | 0.14 ms |

---

## Sparemål – funn

| Navn | Person | Status | Spart / mål | % | Mnd-beløp | ETA | Når |
|------|--------|--------|-------------|---|-----------|-----|-----|
| Sommerferie Italia | samlet | completed | 76530 / 75000 | 100% | 2800 | nådd | 2023-05 |
| Bufferkonto | samlet | completed | 102257.52 / 100000 | 100% | 3000 | nådd | 2023-01 |
| Ny PC | p1 | abandoned | 21688 / 25000 | 87% | 400 | ca. sep 2040 | 2025-01 |
| Elbil-nedbetaling | felles | completed | 122611.36 / 120000 | 100% | 4000 | nådd | 2030-10 |
| Kamerautstyr | p2 | abandoned | 12389.55 / 22000 | 56% | 800 | ca. jan 2041 | 2030-07 |
| Hyttefond | samlet | completed | 253346.51 / 250000 | 100% | 3500 | nådd | 2037-05 |

### Hva fungerer
- **ETA og progresjon** (`savingsGoalEta` / `savingsGoalProgress`) er stabile over 20 år: «nådd», «ca. mnd ÅÅÅÅ», «Sett månedlig beløp».
- Flere mål samtidig (personlig + felles + samlet) er støttet.
- Justering av target/monthly midt i løpet fungerer uten å ødelegge lagret `saved`.

### Smertepunkter (sparemål)
1. **Ingen auto-kobling til spareinnskudd** — `saved` er eksplisitt felt. Over 20 år med flere mål er det lett å glemme å oppdatere, eller å doble-telle mellom bufferkonto og hyttefond.
2. **Ingen historikk/UI for forlatte/fullførte mål** i datamodellen utover det appen selv lagrer — simuleringen trengte `_meta` for status. Produktene bør ha status (aktiv/nådd/arkivert) + dato.
3. **Ingen «bidra denne måneden»-flyt** knyttet til planlagt sparing nær lønn — brukeren må tenke to steder (sparing-logg vs. sparemål).
4. **ETA antar konstant monthly** — livshendelser (jobbytte, barn) endrer sparingsevne; ETA blir optimistisk uten replanlegging.
5. **Felles vs. samlet vs. person** er fleksibelt, men uten aggregert «hvor mye er øremerket» mot spare saldo kan man tro man har mer fri sparekapital enn man har.

---

## Pain points (produkt)

### UX
- **Måned-for-måned** over 240 måneder uten rik flerårs-tidslinje.
- **Logg** med ~11208 poster: søk hjelper, men mangler år/kategori-aggregat og «arkiver gamle år».
- **Glemte måneder:** carry-forward redder budsjettplan, men faktiske tall får hull — mangler «fyll inn forrige måned»-påminnelse / estimat.
- **Person add/rename/arkiv** fungerer i modellen; felles-% må justeres manuelt når husstanden endres (vi så Lån 40/40/20 → tilbake 55/45).

### Ytelse
- **calcFamily** er ikke flaskehalsen (~0.21 ms).
- **UI-rendering** av logg/år med tusenvis av DOM-noder er den sannsynlige flaskehalsen (ikke målt her, men forventet).
- **yearRollup** ~2.1 ms/år er greit; 20 år i én graf er fortsatt billig på calc-siden.

### Data / sync
- Payload ~1767 KiB etter 20 år — OK lokalt, **bør planlegges** for sky (inkrementell sync, komprimering, eller år-arkiv).
- Hele state som én JSON er sårbart for store merge-konflikter ved samtidige enheter.

### Manglende funksjoner
- Flerårig trend (sparerate, utgifter/kategori, safe-to-spend over tid).
- Kobling sparing ↔ sparemål.
- Arkiv/eksport av gamle år uten å slette.
- Bedre engangsutgift-håndtering (merket one-off som ikke ødelegger «vanlig måned»-snitt).

---

## Anbefalte endringer (prioritert)

### Must (bør på plass for 10–20 års bruk)
1. **Årsarkiv / kompakt historikk** — behold aggregater (månedssummer per kategori), detalj-transaksjoner kan eksporteres eller lastes lazy. Mål: holde aktiv sync-payload under ~500–800 KiB.
2. **Sparemål-status + historikk** — aktiv / nådd / arkivert, med dato; ikke bare slette fullførte mål.
3. **Valgfri kobling: spareinnskudd → sparemål** — «fordel denne sparing til mål X» (evt. automatisk %-fordeling), slik at `saved` ikke er rent manuelt i 20 år.
4. **Flerårsoversikt i UI** — bygg på `yearRollup` + `sparingStats`: sparerate, utgifter, safe-to-spend-trend.

### Should
5. **Inkrementell / delt sky-sync** — ikke alltid full JSON; eller gzip + diff. Reduserer konflikter og mobilkost.
6. **«Glemt måned»-flyt** — detekter hull, foreslå kopi av forrige plan + estimat basert på snitt.
7. **Engangsutgift-flagg** — holdes utenfor «vanlig forbruk»-snitt og budsjettvarsler.
8. **Husstandsendring-veiviser** — ved ny person/arkiv: foreslå nye felles-% og oppdater alle felles-kategorier.

### Nice
9. **Virtuell logg-liste** (windowing) så 10k+ poster ikke henger UI.
10. **Sparemål-scenarioer** — «hva hvis monthly −500 kr?» uten å endre lagret mål.
11. **Inflasjonsjusterte budsjettforslag** ved årsskifte (simuleringen gjorde dette manuelt).
12. **Eksport til regneark/PDF** per år for skatt/boliglån-samtaler.

---

## Konklusjon for Mathias

Familiebudsjett **skalerer teknisk til 20 år aktiv bruk** uten kalkfeil i denne simuleringen. Det som avgjør om det forblir *behagelig* er produktvalg rundt **historikkvolum**, **sky-sync**, og **sparemål-arbeidsflyt**. Prioriter arkiv + sparemål-kobling + flerårsvisning før kosmetikk.

Ingen calc-bug blokkerte simuleringen — **ingen deploy** anbefalt fra denne kjøringen (kun rapport).

---

*Generert av `sim-20y.mjs` — assertions grønne.*
