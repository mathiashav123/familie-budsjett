# Sim 10 år – Saldo / Trygg å bruke (rapport til Mathias)

**Dato:** 17. september 2026 (UTC+2)  
**Script:** `sim-10y-saldo.mjs` (120 måneder, 2016–2025)  
**Resultat:** **1534 assertions OK, 0 feilet**

## Hva som var feil (etter f147829)

Saldo-formlene for **Trygg å bruke** var allerede rettet (ikke dobbelttell Fast når «På konto nå» er etter at faste har gått).

Men **På konto → forventet** kunne fortsatt bli feil:

- Fast budsjettert som **felles**, men logget som utgift på **én person** (f.eks. Mathias betaler hele huslånet).
- Da ble `autoSpendExtra` per person **ikke** nullstilt (appen så bare på felles-eier).
- Forventet trakk Fast på nytt → falsk differanse («Ca. X kr høyere…») selv når banken stemte.
- Samme lekkasje påvirket plan-modus per person.

## Fiks

1. **`autoSpendExtraForPerson`** bruker nå kategori-nivå (`plan − logget totalt`), fordelt etter budsjettvekt (egen + fellesandel). Logg under person mot felles-budsjett nuller auto for alle.
2. **UI:** Skjuler «Etter lønn (plan)» når saldo allerede er **Etter lønn** (den linjen la plan-inn/ut oppå bank og forvirret vs Trygg).
3. **Breakdown:** Mer presis tekst hvis noe Fast *uten* auto-tell fortsatt er i «igjen».
4. **Hint** i `index.html`: «Fast holdes av automatisk» → «Faste er allerede i banksaldo — ikke trukket på nytt».

Lagring: fortsatt `familie-budsjett-v1`, kun additivt. Ingen wipe.

## Formler (saldo-modus, bank etter Fast)

| Tall | Formel |
|------|--------|
| **Trygg å bruke nå** | `bruk − futureReserve − buffer` |
| **Hvis hele budsjettet brukes** | `bruk − remainingBudgetAll − futureReserve − buffer` |
| **Ikke** | minus `autoSpendExtra` (Fast allerede i bank) |
| `remainingBudgetAll` | bruker `effectiveActual` → Fast med auto har ~0 igjen |

Plan-modus uendret: fortsatt med Fast auto.

## Sim-metrikker (120 mnd)

| Metrikk | Verdi |
|---------|-------|
| Assertions | 1534 OK / 0 feil |
| Trygg nå (min / snitt / maks) | ~126k / ~135k / ~138k kr |
| Buffer i sim | 2 000 kr |
| Fast budsjett / mnd | 16 999 kr |
| Variabelt budsjett / mnd | 13 000 kr (delvis brukt) |
| Måneder med planlagt utlegg | 14 |
| Måneder med sparemål-notis | 12 |
| Cross-owner Fast-logg (regresjon) | 12 — alle med auto=0 etter logg |

Hver måned:

1. Setter bruk = bank **etter** at Fast har gått
2. Har Fast-kategorier med autoSpend
3. Logger noe variabelt, lar noe budsjett stå ubrukt
4. Assert: Trygg nå == bruk − future − buffer
5. Assert: konservativ linje trekker **ikke** autoSpendExtra på nytt
6. Ny måned uten å kopiere saldo (`copyBalancesFrom` er no-op)
7. Av og til planlagte utlegg / sparemål

## UX-risiko som gjenstår

- **Trygg nå ≈ På konto** når buffer/planlagte er små — det er meningen (Fast allerede ute). Bruk «Hvis hele budsjettet brukes» for variabelt som gjenstår.
- **Forventet** trekker fortsatt Fast auto når Fast *ikke* er logget (riktig for avstemming). Ikke bland den linjen med Trygg-regnestykket.
- **Samlet saldo** summerer bare personer som har oppgitt bruk. Mangler én person, blir husstands-Trygg for lav.
- **Etter lønn (plan)** er skjult ved «Etter lønn»-saldo; vises fortsatt ved «Før lønn» / «På dato».
- Plan-modus (innstilling av) trekker fortsatt Fast auto — bevisst.

## Tester

`test-calc.mjs`: 539 passed (inkl. ny §32 cross-owner Fast).
