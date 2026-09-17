# Endringslogg – Familiebudsjett

## 2026-09-17 – Fix: Fremover/Oversikt trekker Fast i pot-projeksjon

### Rotårsak
`projectPotFollowBudget` gjorde `pot += planInn − planUtVariable − planned` og **hoppet over Fast**. Med ~76k planInn og ~12.6k variabelt ble månedsdelta **+63 542** → Nov 2038 ≈ **9,34 M** — fantasi for ~40k-lønnshusholdning.

### Fix
1. **Formel:** `pot += planInn − planUtFixed − planUtVariable − plannedThatMonth` (lønn minus *alle* planlagte utgifter).
2. Ny helper `plannedFixedBudgetTotal`; rader eksponerer `planUtFixed` + `delta`.
3. **Oversikt:** bekreftet På konto beholder bank-Trygg (Fast allerede i saldo — ikke dobbelt). Tomme fremtidige måneder bruker realistisk rull.
4. UI-hint/Fremover-formel + tester §37–§40 oppdatert.

### Tall (live export, start Sep bruk 231 223)

| | Gammel delta | Ny delta |
| --- | ---: | ---: |
| Steady (etter bil) | +63 542 | **+32 219** |

| Måned | Gammel pot | Ny pot |
| --- | ---: | ---: |
| 2026-09 (bank/Trygg) | 71 223 | 71 223 (uendret) |
| 2026-10 | 130 123 | **98 800** |
| 2026-11 | 193 665 | **131 019** |
| 2038-11 | 9 343 713 | **4 750 647** |

### Deploy
- `pack-mobil.mjs` + synk host/pages; Pages `main`.

## 2026-09-17 – Fix: nære tomme måneder ruller projisert pot (Oct ≠ Nov ≠ Dec)

### Rotårsak
Etter forrige fix projiserte Oversikt Trygg kun når måneden var **>12 mnd** frem. Nære tomme måneder (okt/nov/des 2026) ble stående på **samme seed ~71 223**, selv om Fremover allerede viste stigende pot (+planInn − variabelt − bil).

### Fix
1. **Oversikt Trygg:** alle **tomme fremtidige** måneder (`ahead > 0`) med kun seed/fallback bruker `projectPotFollowBudget` (samme som Fremover) — ikke bare >12 mnd.
2. Bekreftet På konto og måneder med utgifter uendret (Sep 2026 forblir 71 223 med bil-reserve).
3. Hint: «akkumulert pot (ruller måned for måned)».
4. **Tester §40** + `shouldUseProjectedPotForOversikt`.

### Tall (Mathias / live export, start Sep bruk 231 223)
| Måned | Før (Trygg UI) | Etter (projeksjon) |
| --- | --- | --- |
| 2026-09 | 71 223 (live) | 71 223 (uendret) |
| 2026-10 | 71 223 seed | 130 123 |
| 2026-11 | 71 223 seed | 193 665 |
| 2026-12 | 71 223 seed | 257 207 |
| 2027-01 | 71 223 seed | 320 749 |

### Deploy
- `pack-mobil.mjs` + synk host/pages; Pages `main`.

## 2026-09-17 – Fix: månedhelse-lekkasje + Fremover delta til 2038

### Rotårsak
Tomme måneder (okt/nov/…) kopierte budsjett fra forrige måned. **Månedhelse** brukte `actualBudgeted` som inkluderer Fast-auto — så «brukt 31 323 av 43 923 (71 %)» ble vist selv uten utgifter. Trygg seed ~71 223 for alle fremtidige måneder (carry uten planInn) fikk Nov 2038 til å se lik Nov 2026 ut.

### Fix
1. **Månedisolasjon / helse:** `healthBudgeted` = 0 når måneden har 0 utgifter; ellers `actualBudgeted` (Fast-auto kun når det faktisk er logget forbruk). UI viser «Ingen forbruk logget». Over-liste bruker `loggedActual`.
2. **Fremover:** hver månedskort viser **akkumulert pot + månedsdelta** (`+63 542 denne mnd`), årsmarkører i lista, år-for-år med delta. Projeksjon deler ikke expenses-array med template-måned.
3. **Trygg langt frem (>12 mnd tom):** Oversikt viser **projisert pot** (følg budsjett fra nærmeste bekreftede bank-måned) så Nov 2038 ≫ Nov 2026. Nære tomme måneder beholder seed ~71 223.
4. **Tester §39** + `monthsBetweenKeys`.

### Deploy
- `pack-mobil.mjs` + synk host/pages; Pages `main`.

## 2026-09-17 – Fremover: flerårig projeksjon til ~2038

### Ønske
Se hva pot/Trygg kan bli hvis budsjettet følges langt frem (f.eks. **november 2038**), ikke bare 12 måneder.

### Endring
- **Calc:** `projectPotFollowBudget` støtter horizon opptil **240 mnd**; tomme måneder **gjenbruker siste kjente** planInn/variabelt budsjett (virtuelt, uten å fylle localStorage). Returnerer `potByKey`, `byYear` (desember), `milestones` (1/5/12 år).
- **Oversikt → Fremover:** beholder **Har nå** + neste 6 mnd; legger til **Om 1 / 5 / 12 år**, **Se måned** (år+måned, standard nov 2038), og utvidbar **År for år**.
- **Formel i UI:** start fra effektiv pot/Trygg (etter planlagte utlegg som bil én gang); hver måned `pot += planInn − planUtVariable − openPlannedThatMonth`. Fast ikke på nytt.

### Tester / deploy
- §38 multi-year roll (144 mnd, Nov 2038, bil én gang, ingen persist-bloat).
- `pack-mobil.mjs` + synk host/pages; Pages `main`.


## 2026-09-17 – Calc-time bruk-fallback + Fremover-panel (persist-fail safe)

### Problem
På Pages fantes seed-kode, men Oct/Nov viste Trygg **0** / plan-modus fordi `bruk`/`carryPot` ikke ble persistert i nettleseren (`carryPot`/`balancesSuggested` undefined).

### Fix
- **A) Calc-time fallback:** `resolveDisplayBrukFallback` — når måned mangler bruk, regnes display-bruk = nærmeste forrige bekreftet/carry − åpne planlagte i (prev, M]. `calcFamily` bruker dette automatisk (Oct/Nov → **71223**, ikke 0/blank). Bil telles ikke dobbelt.
- **B) Alltid seed i getMonth/render:** eksplisitt `ensureSuggestedBalances` + `save()` ved seed; også i starten av `render()` så navigasjon ikke hopper over persist.
- **C) Fremover-panel (Oversikt):** «Har nå» (Trygg), neste 6 mnd-kort, «Om 12 måneder». Formel i UI: `pot + planInn − variabelt budsjett − planlagte utlegg` (Fast ikke på nytt).
- **D) QA-script:** `scripts/qa-live-fallback.mjs` mot live export.

### Forventet (Mathias live)
| Måned | Trygg | Merknad |
|-------|------:|---------|
| Sep 2026 | **71223** | bank 231223 − bil-reserve 160000 |
| Okt 2026 | **71223** | fallback/seed (ikke 0) |
| Nov 2026 | **71223** | fallback ved hopp (ikke blank) |

### Tester
§37 display-fallback + 12-mnd `projectPotFollowBudget` (702 passed).

## 17. september 2026 (UTC+2) – Fix: månedshopp-seed + Trygg alltid tall + carry uten lønns-stack

- **Bug 1 (Sep→Nov):** Seed trakk bare `plannedSpends` med `monthKey ===` ny måned. Hopp over Oct lot bil 160k stå → Nov tom/feil. **Fix:** `openPlannedSpendDeductionForPersonRange(prev … through new)` — Oct bil trekkes én gang ved Sep→Nov → seed **~71223**.
- **Bug 2:** Fremtidige måneder viste «—» når bruk/seed manglet. **Fix:** alltid tall (seed/pot eller plan-rå, kan være negativ) + hint.
- **Bug 3 (app.js):** `getMonth` refresher `refreshMonthCarryPot` på forrige måned før seed; lagrer når `suggestedBalances` seeded.
- **Bug 4 (carry-pot):** Virtuell månedslutt la til full `planInn` → Oct carry ~111223 / pot eksploderte. **Ny formel uten bankbekreftelse:**
  `end = startSuggestedBruk − logget variabel − same-month planlagt (hvis ikke i start) + logget inntekt (kun hvis finnes)`
  Ikke automatisk planlagt lønn. Bekreftet bank = bruk (uendret).
- **Beholdt:** Sep=Oct begge ~71223 til Oct-forbruk endres.
- Tester §36 (Sep→Oct 71223; Sep→Nov 71223; Oct −10k → Nov 61223) + oppdaterte §11e/§35/sim-10y-carry.
- Additiv (`familie-budsjett-v1`).

## 17. september 2026 (UTC+2) – Valgfri På konto + virtuell carry-pot

- **Produkt:** «På konto nå» er **rettingsverktøy** (når noe er feil) — ikke månedlig plikt. Trygg pluss/minus drives av **virtuell carry-pot**.
- **Formel:** `pot_neste = pot + månedlig_netto − variabelt_forbruk − planlagt (én gang)`.
  - Start fra sist kjente bank **eller** envelope etter planlagt (f.eks. 231223 − 160000 bil = **71223**).
  - Uten bankbekreftelse ruller pot likevel (kan bli negativ).
  - «Rett saldo» / bankbekreftelse **nullstiller** pot til oppgitt tall (override).
- **UI:** «På konto nå *(valgfritt)*», knapp **Rett saldo**, hint om automatisk rull vs valgfri retting. Ingen blokkerende «Sett på konto» som Trygg-verdi — faller tilbake til plan/pot.
- **Lagring:** `familie-budsjett-v1` uendret; additive felt `carryPot` / `fromCarryPot` OK.
- **Sim:** `sim-10y-carry-user.mjs` + `SIM-10Y-CARRY-RAPPORT.md` (120 mnd, live export, bil én gang, mix confirm/skip).
- Tester §35 + oppdaterte awaiting/hint-tester.

## 17. september 2026 (UTC+2) – Rullerende saldo: rest midler inn i neste måned

- **Ønske:** Trygg å bruke skal gå pluss/minus etter hvordan måneden gikk. Bekreftet På konto (f.eks. Oct 81223 etter godt overskudd) skal foreslå samme tall i neste måned — ikke sitte fast på gammel Sep-seed (71223).
- **Formel:** `suggestedBruk = nearestPrev.confirmedBruk − openPlannedSpends(newMonth)`  
  der `nearestPrev` = nærmeste tidligere måned med `balancesUpdatedAt` (ikke bare −1 mnd).
- **Alltid seed** når ny måned mangler bekreftet saldo og forrige bekreftet finnes — også når planlagte utlegg = 0 (overskudd/underskudd ruller). Underskudd (f.eks. 50000) seeds videre; negativ Trygg tillatt som før.
- **Ikke** re-seed over måned med `balancesUpdatedAt` / eksisterende ikke-foreslått bruk. Soft-cleanup rører fortsatt ikke `suggested`.
- Same-month reserve-regler uendret (ingen dobbelttelling av planlagte).
- **Hint:** «Bygger på forrige bekreftede saldo (± planlagte utlegg). Bekreft eller endre.»
- Tester §11 / §11b / §11d / §11e (Sep→Oct bil 71223; Oct 81223→Nov 81223; Oct 50000→Nov 50000; nearest confirmed hopper over gap).
- Additiv (`familie-budsjett-v1`).

## 17. september 2026 (UTC+2) – Fix: dobbelttelling + negativ Trygg

- **Bug (mål-måned):** Oktober med foreslått/seeda bruk 71223 *uten* `suggested`/`suggestedAfterPlans` (delvis migrering) trakk fortsatt samme måneds bil (160000) i `futureReserve` → `71223−160000` → `Math.max(0,…)` → **0**.
- **Same-month reserve skip** når bruk allerede speiler planene:
  - `suggested` / `suggestedAfterPlans` / `reflectedInBalance`, **eller**
  - husstands-bruk ≈ `computeSuggestedBrukFromPrev(prev,…)` (±1 kr), **eller**
  - sterkere: `bruk ≤ prevBruk − planlagt + 1` (prev bekreftet + åpne same-month plans).
- `calcFamily` får `months` (via app) for prev-heuristikk. `ensureSuggestedBalances` **healer** manglende flagg → `reflectedInBalance`; seed setter alltid `suggested` + `suggestedAfterPlans`.
- **Negativ Trygg tillatt:** primær «Trygg å bruke nå» / raw / plan-modus / «hvis hele budsjettet» — **ingen** `Math.max(0,…)`. Negativ = må spare inn. UI: `is-neg` (rød).
- Tester §34 (Sep 71223; Oct uten flagg → future 0 / safe 71223; negativ ved senere plan). Additiv (`familie-budsjett-v1`).


## 17. september 2026 (UTC+2) – Fix: planlagt utlegg ikke dobbelttelt i Trygg

- **Bug:** «Ny bil» 160000 i oktober: september reserverte korrekt (231223−160000=**71223**), oktober foreslo seed 71223 — men etter **Bekreft** (eller uten `suggested`-flagg) trakk `futureReserve` 160k **på nytt** → Trygg ≈0.
- **Regler (én gang totalt):**
  - **Før mål-måned** (`monthKey >` vist M): hold-back i `futureReserve` (som før).
  - **I mål-måned:** trekkes via foreslått På konto (`prev − planlagt`) **eller** reserve hvis rå/full bank før betaling. Ikke begge.
  - **Etter Bekreft** av foreslått saldo: `reflectedInBalance: true` på planlagte i måneden → aldri reserve igjen. `suggested` / `suggestedAfterPlans` fjernes, beløpene beholdes.
  - Manuell full bank i mål-måned (uten seed) reserverer fortsatt samme måneds plan til kjøpt/done.
- **UI:** hint «trukket én gang»; planlagt rad «· i saldo»; sumlinje når allerede i På konto nå.
- Tester §11d + §33 (Sep 71223; Oct seed+Bekreft 71223; manuell full bank reserverer). Additiv (`familie-budsjett-v1`).

## 17. september 2026 (UTC+2) – Fix: planlagt utlegg ikke dobbelttelt i Trygg

- **Bug:** «Ny bil» 160000 i oktober: september reserverte korrekt (231223−160000=**71223**), oktober foreslo seed 71223 — men etter **Bekreft** (eller uten `suggested`-flagg) trakk `futureReserve` 160k **på nytt** → Trygg ≈0.
- **Regler (én gang totalt):**
  - **Før mål-måned** (`monthKey >` vist M): hold-back i `futureReserve` (som før).
  - **I mål-måned:** trekkes via foreslått På konto (`prev − planlagt`) **eller** reserve hvis rå/full bank før betaling. Ikke begge.
  - **Etter Bekreft** av foreslått saldo: `reflectedInBalance: true` på planlagte i måneden → aldri reserve igjen. `suggested` / `suggestedAfterPlans` fjernes, beløpene beholdes.
  - Manuell full bank i mål-måned (uten seed) reserverer fortsatt samme måneds plan til kjøpt/done.
- **UI:** hint «trukket én gang»; planlagt rad «· i saldo»; sumlinje når allerede i På konto nå.
- Tester §11d + §33 (Sep 71223; Oct seed+Bekreft 71223; manuell full bank reserverer). Additiv (`familie-budsjett-v1`).

## 17. september 2026 (UTC+2) – Foreslått saldo + Trygg uten skummelt 0

- **Bug:** Ny måned uten bruk falt til plan-modus; stort planlagt utlegg → Trygg **0**. Rå `before_salary`-kopi er også feil.
- **Foreslått På konto nå** (kun når ny måned mangler `balancesUpdatedAt` / bekreftet bruk, og forrige måned er bekreftet, og det finnes åpne `plannedSpends` med `monthKey ===` ny måned):
  - **Formel:** `foreslått bruk = forrige bekreftede bruk − åpne planlagte utlegg (egen fullt; felles / antall personer)`
  - **Ikke** råkopi av forrige saldo; **ikke** oppdiktet lønn i seed (payment-after fra sist kjente banktall).
  - Markeres `suggested: true`, `when: after_salary`. Soft-cleanup rører ikke foreslåtte verdier.
  - Hint: «Foreslått etter planlagte utlegg — bekreft eller endre». Bekreft/endre fjerner `suggested` + setter `balancesUpdatedAt`.
- **Trygg:** Med foreslått saldo brukes saldo-modus; samme måneds planlagte trekkes **ikke** på nytt i `futureReserve` (allerede i seed). Senere måneder reserveres som før.
- Uten forrige bekreftet bruk: `awaiting_saldo` → UI «Sett på konto nå» (ikke 0).
- **Uendret:** September med bekreftet saldo (f.eks. 231223 − 160000 = **71223** i Trygg).
- Tester §11d + §33. Additiv (`familie-budsjett-v1`).

## 17. september 2026 (UTC+2) – Fix: På konto Fast-lekkasje + saldo-sim

- **Bug:** Fast budsjettert som felles men logget på én person → `autoSpendExtraForPerson` ble ikke nullstilt. **På konto forventet** trakk Fast på nytt (falsk differanse). Plan-modus per person samme lekkasje.
- **Fix:** `autoSpendExtraForPerson` = kategori-nivå `(plan−logget totalt)` fordelt etter budsjettvekt (egen + fellesandel). Samme nulling som husstands-auto.
- **Trygg saldo** uendret og bekreftet: nå = `bruk − futureReserve − buffer`; hvis hele budsjettet = `bruk − remAll − future − buffer`; **ingen** `autoSpendExtra` på nytt.
- **UI:** Skjuler «Etter lønn (plan)» når saldo allerede er etter lønn (unngår forvirring vs Trygg). Breakdown skiller Fast uten auto-tell. Hint: faste allerede i banksaldo.
- **Sim:** `sim-10y-saldo.mjs` + `SIM-10Y-SALDO-RAPPORT.md` — 120 mnd, 1534 assertions (inkl. cross-owner Fast).
- Tester §32. Lagring `familie-budsjett-v1` additiv, ingen wipe.

## 17. september 2026 (UTC+2) – Fix: Fast ikke dobbelttelt i Trygg (saldo)

- **Bug:** Når «På konto nå» oppgis *etter* at faste regninger har gått fra banken, trakk saldo-modus også `autoSpendExtra` (Fast) — Fast ble trukket to ganger.
- **Saldo-formler (samlet + per person):**
  - Trygg nå: `bruk − futureReserve − buffer`
  - Hvis hele budsjettet brukes: `bruk − remainingBudgetAll − futureReserve − buffer`
  - Trekker **ikke** `autoSpendExtra` på nytt (Fast allerede i banksaldo).
- **Plan-modus** uendret: fortsatt `planInn − effectiveUtgifter − remainingFast − futureReserve` (bruker Fast auto).
- **Beholdt Fast auto** for kategori-igjen (effectiveActual) og **På konto forventet**-reconcile (`prev.bruk + tilOvers − autoSpendExtra`).
- Breakdown UI: ingen «− Fast (auto)»-linje under Trygg; hint: «Faste er allerede i banksaldo — ikke trukket på nytt».
- Tester: ingen dobbelttelling (scenario bank etter Fast) + oppdaterte saldo-identiteter.
- Additiv (`familie-budsjett-v1`).

## 17. september 2026 (UTC+2) – Dual Trygg å bruke (nå + hvis hele budsjettet)

- **Primært tall «Trygg å bruke nå»** (saldo-modus, samlet + per person): `bruk − Fast autoSpendExtra − futureReserve − buffer`. Trekker **ikke** fra gjenstående variable kategori-budsjetter.
- **Sekundær linje «Hvis hele budsjettet brukes»**: konservativ formel `bruk − remainingBudgetAll − autoSpendExtra − futureReserve − buffer` (Fast dobbelttelles ikke: remAll bruker effectiveActual).
- Breakdown UI: På konto − Fast (auto) − planlagte − buffer = nå; derunder hvis-hele med variabelt igjen.
- Norske hint: Fast holdes av automatisk; variabelt telles via **Kjøpt noe**.
- Additiv (`familie-budsjett-v1`). Plan-modus uendret. Tester for dual-identitet + per person.

## 17. september 2026 (UTC+2) – På konto: ingen auto-kopiering til ny måned

- **Bugfix:** `copyBalancesFrom` / `ensureMonthExpected` kopierer ikke lenger bruk/spare (eller when/asOf) inn i nye måneder. Point-in-time «På konto nå» må bekreftes på nytt hver måned — ellers følger f.eks. oktober «før lønn» 50k feilaktig inn i november.
- Ny måned starter med tom På konto nå. UI-hint: «Ny måned — bekreft På konto nå (kopieres ikke automatisk fra forrige).»
- Soft cleanup ved migrering: måneder uten `balancesUpdatedAt` med identisk bruk/spare som forrige måned tømmes (utilsiktet carry). Måneder med `balancesUpdatedAt` røres ikke.
- Budsjett og planlagt inntekt carry-forward som før. Tester: ny måned etter before_salary arver ikke bruk; soft cleanup.
- Allerede feil november: tøm bruk (og spare) og bekreft saldo på nytt.

## 17. september 2026 (UTC+2) – Trygg å bruke: saldo-breakdown

- Under **Trygg å bruke** (samlet og per person) i saldo-modus: kompakt regnestykke — På konto (bruk) − Rest av budsjett (igjen) − Planlagte utlegg − Buffer = Trygg å bruke.
- Kort hint: «På konto er ikke det samme som trygg å bruke — appen holder av budsjett som gjenstår.»
- Forklarer hvorfor bank ~71k ≠ trygg ~49k (budsjett som gjenstår + planlagte utlegg holdes av).
- Hjelper `safeToSpendSaldoBreakdown` + tester. Additiv UI, ingen wipe.

## 17. september 2026 (UTC+2) – På konto: Bekreft saldo + forventet-breakdown

- **Bekreft saldo**-knapp per person: parser bruk (+ spare hvis åpen), lagrer `balances`, stamp `balancesUpdatedAt`, toast «Saldo lagret», re-render. Blur/change beholder backup-lagring.
- Under sammenligningen: **Slik er forventet regnet** — Forrige måneds bruk + Inn (lønn/ekstra per modus) − Utgifter (inkl. fellesandel) − Sparing − Fast auto = Forventet. Tall fra `reconcilePaKonto` / `personCashflowParts`.
- Mangler forrige måneds bruk: tydelig CTA «Gå til [måned]» + hint — uten den er forventet ubrukelig.
- Audit dobbelttelling Fast auto vs logget Fast: **ingen bug** (partial/full log gir samme forventet; auto = max(0, plan−logget)). Tester for breakdown-identitet.
- Lagring additiv (`familie-budsjett-v1`). Norsk UI.

## 17. september 2026 (UTC+2) – På konto: når gjelder saldoen

- Per person på Oversikt **På konto nå**: segment **Før lønn** | **Etter lønn** | **På dato** (+ datovelger ved På dato, standard i dag).
- Lagres additivt på `balances[person]`: `{ bruk, spare, when: 'before_salary'|'after_salary'|'dated', asOf: 'YYYY-MM-DD'|null }` + eksisterende `balancesUpdatedAt`.
- Badge på kortet: «Oppgitt før lønn», «Oppgitt etter lønn», «Oppgitt 12. sep».
- **Forventet**-regler:
  - **Etter lønn:** `prev.bruk + tilOvers − autoSpendExtra` (som før; logget lønn/ekstra teller).
  - **Før lønn:** samme, men logget **lønn + ekstra** trekkes ut av cashflow (som om månedens inntekt ikke har landet). Sparing, utgifter og auto Fast telles.
  - **På dato:** hvis måneden har datostemplede poster, cashflow med `date <= asOf` (uten dato beholdes); ellers full måned som etter lønn. `asOf` vises uansett. Auto Fast fortsatt hele måneden.
- Differanse-tekst / «Kjøpt noe» uendret. Nøkkel `familie-budsjett-v1` additiv, ingen wipe.
- Tester: before vs after vs dated (+ migrate when/asOf).

## 17. september 2026 (UTC+2) – På konto: forventet inkl. auto Fast

- **Forventet** cashflow: `prev.bruk + tilOvers − autoSpendExtra` (logget inn/ut/sparing **pluss** Fast auto-trekk som har forlatt konto).
- Etter faste regninger matcher forventet bank når variable kjøp er logget; gap peker på glemt loggføring (ikke «falsk» Fast-diff).
- Differanse-tekst (nb): bank lavere → «Ca. X kr lavere enn loggen tilsier — sjekk om du har glemt kjøp» (+ knapp **Kjøpt noe**); høyere → «Ca. X kr høyere — glemt inntekt, eller logget for mye?»; nær null → «Ser riktig ut».
- Bruk-saldo kan fortsatt redigeres når som helst. Lagring additiv (`familie-budsjett-v1`).
- Tester: reconcile med auto Fast + glemt variabelt kjøp.


## 17. september 2026 (UTC+2) – På konto nå (avstemming)

- Oversikt: nytt fremhevet kort **«På konto nå»** rett under Trygg å bruke (per person + samlet).
- Stor **bruk**-saldo (kalkulator), spare under valgfri detalj. Lagrer `balances[person].bruk` med en gang; stamp `balancesUpdatedAt`.
- **Forventet** = forrige måneds bruk + faktisk til overs denne måneden (inn − ut − sparing, inkl. fellesandel).
- **Oppgitt nå** vs **Differanse** (grønn/rød): «X kr mer/mindre enn forventet». Etter lønn (plan) vises fortsatt.
- Hint: oppdater når du sjekker banken — ingen bankinnlogging. Trygg å bruke bruker oppdatert bruk.
- Lagring additiv (`familie-budsjett-v1`). Tester for variance-hjelpere / reconcile.


## 17. september 2026 (UTC+2) – Fix: planlagt utlegg matches kun samme måned

- Bug: `plannedSpendReserve` / `plannedSpendReserveForPerson` matchet kategori+eier mot **vist måneds** utgifter også for *senere* planlagte utlegg. Oktober-plan ble nullstilt i september-visning hvis september hadde utgift i samme kategori.
- Fix: kategori-match kun når `item.monthKey ===` vist måned. Senere måneder (`monthKey >` vist) reserveres fullt (med mindre `done` / `doneExpenseId`).
- Dialog-hint: beløpet reserveres allerede før kjøpemåneden. Oversikt / Trygg å bruke: synlig linje «Reservert til planlagte utlegg: X».
- Lagring fortsatt additiv (`familie-budsjett-v1`). Regresjonstest: sep-visning + okt-plan + sep-utgift samme kategori → reserve inkluderer okt-beløp.

## 17. september 2026 (UTC+2) – Planlagte utlegg reserveres før kjøpemåned

- `futureReserve` summerer åpne `plannedSpends` med `monthKey >=` vist måned (samme + senere), ikke bare mål-måneden.
- Eksempel: plan for oktober trekker allerede fra Trygg å bruke i september. Etter at måneden er passert uten kjøp, faller planen ut av eldre visninger (`monthKey <` vist måned).
- Dobbelttelling uendret (matchende loggført kjøp nuller det ene utlegget).
- UI: hint «Reserveres også i måneder før kjøpet»; Oversikt viser kommende poster + total reserve inkl. senere måneder.
- Lagring fortsatt additiv (`familie-budsjett-v1`). Tester for reserve-vindu.

## 17. september 2026 (UTC+2) – Fast auto-tell + planlagte utlegg

### 1. Faste utgifter telles automatisk som brukt
- Kategorier med type **Fast** teller planlagt beløp som faktisk/brukt for «igjen», fremdrift og Trygg å bruke (fra månedens start).
- **Dobbelttelling:** `effektivFaktisk = max(planlagt, logget)`. Har du logget mer enn plan, brukes det loggførte. Har du logget mindre/ingenting, brukes planen.
- Årlige/kvartalsvise underlinjer: kun i månedene planen treffer (Fordel vs I måned / Betales i) – samme `budgetFor`-logikk som før.
- Variabel forblir manuell via «Kjøpt noe».
- UI: merke **Auto** + hint «Fast — telt automatisk» på Plan; avkrysning **Auto-tell som brukt** / «Ikke auto-tell» per kategori (felt `autoSpend`, standard på for Fast).

### 2. Planlagte utlegg (fremtidig bruk)
- Nytt: **Planlegg utlegg** (Oversikt-kort + Mer): beløp, valgfri kategori, hvem, måned, notat.
- Reserverer beløpet i Trygg å bruke / remaining for mål-måneden (`futureReserve`).
- **Dobbelttelling:** matching loggført kjøp (samme eier + kategori) i måneden nuller reserven for det utlegget; ellers til `done` markeres.
- Lagres additivt som `plannedSpends[]` på state. Nøkkel uendret: **`familie-budsjett-v1`**.

### Formler (Trygg å bruke)
- `autoSpendExtra = Σ max(0, plan−logget)` for Fast med auto-tell
- `effectiveUtgifter = samletUtgifter + autoSpendExtra`
- Plan: `planInn − effectiveUtgifter − remainingFast − futureReserve`
- Saldo: `totalBruk − remainingBudgetAll − autoSpendExtra − futureReserve − buffer`  
  (remaining* bruker effektiv faktisk, så Fast-auto har remain 0; autoSpendExtra holder reservasjonen)

### Tester / deploy
- `test-calc.mjs` utvidet (auto-spend max-regel, opt-out, yearly once, plannedSpends). Ingen wipe.


## 7. september 2026 (UTC+2) – 20-års forbedringer (arkiv, sparemål, synk)

### 1. Årsarkiv / kompakt historikk
- **Mer → År**: «Arkiver år 20XX», gjenopprett og eksporter (JSON). Aldri slett uten eksportsti.
- Arkiverte år flyttes til `archives[]` (full månedsdata + `rollup`-aggregater); aktive `months` krymper.
- Årsvisning leser aggregater fra arkiv når måneder mangler. Forslag etter ~3 år.

### 2. Sparemål status + historikk
- Status: **aktiv** | **nådd** | **arkivert** | **forlatt** (+ `statusAt`).
- Auto-**nådd** når spart (effektivt) ≥ mål. Manuell arkiver/forlat/aktiver i dialogen.
- Sparing-fanen: aktive mål + seksjon «Fullførte / arkiverte».

### 3. Kobling spareinnskudd → sparemål
- Ved spareinnskudd: valgfritt **Sparemål**.
- Modell: `saved` = manuelt startbeløp; koblede innskudd (`goalId`) summeres → effektiv spart. ETA oppdateres automatisk.

### 4. Multi-year UI
- Mer → År: kort og søyler år-for-år (`yearRollup` / `multiYearSummaries`).
- Sparing: «Sparing over år» med kort/søyler (`sparingStats` + års-summer). Mobilvennlig.

### 5. Smartere sky-synk
- Payload: strukturert `{ _fb, activePayload, archives, archiveRefs }` ved arkiv/stor data; valgfri **gzip-b64** over terskel.
- Hopp over uendret push via fingerprint. Last-write-wins. localStorage `familie-budsjett-v1` offline som før.
- Bakoverkompatibel: eldre plain JSON pakkes ut trygt.

### Datasikkerhet / tester
- Lagringsnøkkel uendret: **`familie-budsjett-v1`**. Kun additive felt (`archives[]`, goal `status`, `goalId`). Ingen wipe.
- `test-calc.mjs` + `test-sync.mjs` utvidet (arkiv, kobling, pack/unpack).

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
