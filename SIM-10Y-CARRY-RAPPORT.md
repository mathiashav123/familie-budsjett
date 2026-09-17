# Sim 10 år – Virtuell carry-pot (rapport til Mathias)

**Dato:** 17. september 2026 (UTC+2)  
**Script:** `sim-10y-carry-user.mjs` (120 måneder fra Sep 2026)  
**Datagrunnlag:** `familie-budsjett-export-live.json`  
**Resultat:** **709 assertions OK, 0 feilet**

## Hva som er nytt

**På konto nå** er et **rettingsverktøy** — ikke månedlig plikt.  
**Trygg å bruke** drives av en **virtuell carry-pot** som ruller automatisk:

```
end = start − variabelt_logget − planlagt(én gang hvis ikke i start) + logget_inntekt(kun hvis finnes)
```

- **Ikke** automatisk planlagt lønn inn i pot (unngår eksplosiv vekst uten bank).
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
| Min pot | −1 774 156 kr |
| Snitt pot | −865 904 kr |
| Maks pot | 231 223 kr |
| Min Trygg | −1 774 156 kr |
| Snitt Trygg | −867 238 kr |
| Maks Trygg | 71 223 kr |
| Måneder med På konto-retting | 29 |
| Måneder uten (auto-carry) | 90 |

## Assertions (utvalg)

1. Oct pot = 231 223 − 160 000 = 71 223 (bil én gang)
2. Oct futureReserve = 0 (ikke dobbelt)
3. Aldri `needsSaldo`-blokk / «Sett på konto» som Trygg-verdi
4. Lav variabel → neste pot ≈ start − lite forbruk (ikke lønns-stack)
5. Høy variabel → neste pot lavere/negativ
6. Bank-bekreftelse overstyrer virtuell pot
7. Sep→Nov-hopp trekker Oct bil én gang

## Formel (kort)

| Situasjon | Pot |
|-----------|-----|
| Ny måned uten bank | `forrige_sluttpot − planlagt (etter prev … gjennom ny)` |
| Virtuell månedslutt | `start − logget forbruk − planlagt(hvis ikke i start) + logget inntekt` |
| Etter «Rett saldo» | `oppgitt bank` (sannhet) |

## UX

- Overskrift: **På konto nå (valgfritt)**
- Knapp: **Rett saldo**
- Hint: Trygg ruller automatisk — rett bare hvis noe er feil

Lagring: `familie-budsjett-v1` uendret; additivt felt `carryPot` / `fromCarryPot` OK.
