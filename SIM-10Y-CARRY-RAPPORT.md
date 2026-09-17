# Sim 10 år – Virtuell carry-pot (rapport til Mathias)

**Dato:** 17. september 2026 (UTC+2)  
**Script:** `sim-10y-carry-user.mjs` (120 måneder fra Sep 2026)  
**Datagrunnlag:** `familie-budsjett-export-live.json`  
**Resultat:** **706 assertions OK, 0 feilet**

## Hva som er nytt

**På konto nå** er et **rettingsverktøy** — ikke månedlig plikt.  
**Trygg å bruke** drives av en **virtuell carry-pot** som ruller automatisk:

```
pot_neste = pot + månedlig_netto − variabelt_forbruk − planlagt (én gang)
```

- Start: sist kjente bank **eller** envelope etter planlagt (f.eks. 231 223 − 160 000 bil = **71 223**).
- Hopper du over På konto, ruller pot likevel (kan bli negativ).
- Bekrefter/retter du bank, **nullstilles** pot til oppgitt saldo (override).

## Mathias-baseline

| Felt | Verdi |
|------|-------|
| Sep 2026 bank (p1) | 231 223 kr |
| Planlagt bil (okt 2026) | 160 000 kr |
| Oct start-pot | **71 223** kr |
| Plan inntekt (typisk) | 76 142 kr |
| Fast-budsjett | ~31 323 kr |
| Variabelt budsjett | ~14 700 kr |

## Sim-oppsett (120 mnd)

- Underspend (~55 %): variabelt ~35–70 % av budsjett → surplus
- Overspend (~35 %): variabelt over budsjett
- Ekstra planlagte utlegg i 6 spredte måneder (ferie, hvitevarer, …)
- **Bil 160k trukket én gang** (oktober 2026)
- På konto-bekreftelse i ~25 % av måneder; resten **skip** (automatisk pot)

## Nøkkeltall pot (p1 bruk / carry)

| Metrikk | Verdi |
|---------|-------|
| Min pot | 71 223 kr |
| Snitt pot | 629 975 kr |
| Maks pot | 1 234 671 kr |
| Min Trygg | 71 223 kr |
| Snitt Trygg | 628 641 kr |
| Maks Trygg | 1 234 671 kr |
| Måneder med På konto-retting | 29 |
| Måneder uten (auto-carry) | 90 |

## Assertions (utvalg)

1. Oct pot = 231 223 − 160 000 = 71 223 (bil én gang)
2. Oct futureReserve = 0 (ikke dobbelt)
3. Aldri `needsSaldo`-blokk / «Sett på konto» som Trygg-verdi
4. God måned (lav variabel) → høyere pot neste måned
5. Dårlig måned (høy variabel) → lavere/negativ pot neste
6. Bank-bekreftelse overstyrer virtuell pot

## Formel (kort)

| Situasjon | Pot |
|-----------|-----|
| Ny måned uten bank | `forrige_sluttpot − planlagt_denne_mnd` |
| Virtuell månedslutt | `start + (inntekt) − Fast auto − sparing − logget forbruk` |
| Etter «Rett saldo» | `oppgitt bank` (sannhet) |

## UX

- Overskrift: **På konto nå (valgfritt)**
- Knapp: **Rett saldo**
- Hint: Trygg ruller automatisk — rett bare hvis noe er feil

Lagring: `familie-budsjett-v1` uendret; additivt felt `carryPot` / `fromCarryPot` OK.
