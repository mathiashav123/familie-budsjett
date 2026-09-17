# 10-års realistisk økonomisim – Zeekr 7GT (elbil) – Mathias

**Dato:** 17. september 2026 (Europe/Oslo, UTC+2)  
**Periode:** sep 2026 – aug 2036 (120 måneder)  
**Datagrunnlag:** `familie-budsjett-export-live.json`  
**Script:** `familie-budsjett/scripts/sim-10y-zeekr.py`  
**RNG-seed:** 42 (livsjokk) + deterministiske ferier  
**Bil:** Zeekr 7GT Long Range RWD (~500k-klasse)

## Det Mathias bryr seg om: leftover per måned

**Kort for parent (uten ny stor sim):** Med leftover Mathias ~14,5k/mnd i dag: når Zeekr kommer, legg til ~6000 lån + ~1600 forsikring + ~280 TFA + ~1050 lading/service ≈ **~9k/mnd** ekstra (pluss 160k engangs). Grov leftover da ~14,5k − 9k ≈ **~5–6k/mnd** før ferie — stramt, men ikke blakk hvis Andrea deler husstand.


**Leftover** = inntekt − utgifter den måneden (netto som går inn/ut av potten). **Pot** = akkumulert buffer ved månedsslutt.

### Scenario A – Mathias alene (fellesandel) — snitt leftover / fase

| Fase | Snitt leftover/mnd | Min leftover (mnd) |
|------|--------------------|--------------------|
| Før barn | **−929** | −155 548 (2026-10) |
| 1 barn | **1 709** | −30 259 (2029-07) |
| 2 barn (med billån) | **−2 662** | −34 591 (2031-07) |
| Etter billån | **6 946** | −42 597 (2034-10) |
| **Sluttpot (aug 2036)** | | **626 091** |
| **Worst leftover totalt** | | **−155 548** (2026-10) |
| **Laveste pot** | | **75 675** (2026-10) |

### Scenario B – Husstand — snitt leftover / fase

| Fase | Snitt leftover/mnd | Min leftover (mnd) |
|------|--------------------|--------------------|
| Før barn | **12 213** | −142 653 (2026-10) |
| 1 barn | **15 806** | −16 408 (2029-07) |
| 2 barn (med billån) | **12 219** | −19 749 (2031-07) |
| Etter billån | **23 373** | −25 660 (2034-10) |
| **Sluttpot (aug 2036)** | | **2 429 313** |
| **Worst leftover totalt** | | **−142 653** (2026-10) |
| **Laveste pot** | | **88 570** (2026-10) |

#### A alene – snitt leftover per kalenderår

| År | Snitt leftover | Min leftover | Pot des |
|----|----------------|--------------|---------|
| 2026 | −45 786 | −155 548 (10) | 93 864 |
| 2027 | 6 236 | −15 906 (07) | 168 695 |
| 2028 | 3 479 | −22 230 (07) | 210 446 |
| 2029 | 1 621 | −30 259 (07) | 229 896 |
| 2030 | 957 | −20 215 (07) | 241 383 |
| 2031 | 818 | −34 591 (07) | 251 203 |
| 2032 | 8 097 | −18 353 (07) | 348 365 |
| 2033 | 4 444 | −35 872 (07) | 401 688 |
| 2034 | 5 439 | −42 597 (10) | 466 951 |
| 2035 | 7 658 | −22 937 (07) | 558 847 |
| 2036 | 8 406 | −19 452 (07) | 626 091 |

#### B husstand – snitt leftover per kalenderår

| År | Snitt leftover | Min leftover | Pot des |
|----|----------------|--------------|---------|
| 2026 | −32 892 | −142 653 (10) | 132 548 |
| 2027 | 19 289 | −3 011 (07) | 364 012 |
| 2028 | 17 009 | −8 862 (07) | 568 115 |
| 2029 | 15 636 | −16 408 (07) | 755 742 |
| 2030 | 15 466 | −5 872 (07) | 941 339 |
| 2031 | 15 831 | −19 749 (07) | 1 131 307 |
| 2032 | 23 622 | −3 001 (07) | 1 414 769 |
| 2033 | 20 491 | −20 001 (07) | 1 660 655 |
| 2034 | 22 017 | −25 660 (10) | 1 924 859 |
| 2035 | 24 778 | −6 000 (07) | 2 222 190 |
| 2036 | 25 890 | −1 967 (07) | 2 429 313 |

### Månedlig leftover + pot (utdrag + full JSON)

Full 120-måneders serie ligger i `SIM-10Y-ZEEKR-summary.json` (`scenarios.A_shock.monthly` / `B_shock.monthly`). Under: utdrag + kritiske måneder.

#### A – utvalgte måneder

| Måned | Inn | Ut | **Leftover** | Pot slutt | Ferie/sjokk |
|-------|-----|----|--------------|-----------|-------------|
| 2026-09 | 0 | 0 | **0** | 231 223 | — |
| 2026-10 | 40 000 | 195 548 | **−155 548** | 75 675 | bilkjøp 160k |
| 2026-11 | 44 642 | 35 548 | **9 094** | 84 769 | — |
| 2026-12 | 44 642 | 35 548 | **9 094** | 93 864 | — |
| 2027-02 | 44 642 | 47 548 | **−2 906** | 100 052 | ferie 12 000 |
| 2027-07 | 44 642 | 60 548 | **−15 906** | 120 523 | ferie 25 000 |
| 2028-05 | 45 535 | 40 765 | **4 770** | 212 543 | ferie 5 000 |
| 2028-07 | 45 535 | 67 765 | **−22 230** | 200 082 | ferie 32 000 |
| 2028-09 | 48 458 | 60 716 | **−12 259** | 197 593 | fødsel+ |
| 2028-10 | 48 458 | 51 088 | **−2 631** | 194 963 | sjokk 10 372 |
| 2029-02 | 48 458 | 55 716 | **−7 259** | 210 929 | ferie 15 000 |
| 2029-07 | 48 458 | 78 716 | **−30 259** | 200 606 | ferie 38 000 |
| 2029-09 | 49 386 | 41 601 | **7 785** | 216 133 | — |
| 2030-07 | 49 386 | 69 601 | **−20 215** | 248 488 | ferie 28 000 |
| 2030-09 | 52 346 | 66 937 | **−14 591** | 236 284 | fødsel+ |
| 2031-07 | 52 346 | 86 937 | **−34 591** | 221 245 | ferie 40 000 |
| 2031-09 | 53 312 | 63 703 | **−10 390** | 216 263 | ferie 5 000, sjokk 11 037 |
| 2031-10 | 53 312 | 41 666 | **11 647** | 227 910 | — |
| 2032-07 | 53 312 | 71 666 | **−18 353** | 288 271 | ferie 30 000 |
| 2034-10 | 56 329 | 98 926 | **−42 597** | 440 826 | sjokk 55 660 |
| 2035-07 | 56 329 | 79 266 | **−22 937** | 496 590 | ferie 36 000 |
| 2036-08 | 57 375 | 43 827 | **13 548** | 626 091 | — |

#### B – utvalgte måneder

| Måned | Inn | Ut | **Leftover** | Pot slutt | Ferie/sjokk |
|-------|-----|----|--------------|-----------|-------------|
| 2026-09 | 0 | 0 | **0** | 231 223 | — |
| 2026-10 | 71 500 | 214 153 | **−142 653** | 88 570 | bilkjøp 160k |
| 2026-11 | 76 142 | 54 153 | **21 989** | 110 559 | — |
| 2026-12 | 76 142 | 54 153 | **21 989** | 132 548 | — |
| 2027-02 | 76 142 | 66 153 | **9 989** | 164 526 | ferie 12 000 |
| 2027-07 | 76 142 | 79 153 | **−3 011** | 249 471 | ferie 25 000 |
| 2028-05 | 77 665 | 59 527 | **18 138** | 474 703 | ferie 5 000 |
| 2028-07 | 77 665 | 86 527 | **−8 862** | 488 979 | ferie 32 000 |
| 2028-09 | 81 230 | 79 638 | **1 592** | 513 710 | fødsel+ |
| 2028-10 | 81 230 | 70 010 | **11 220** | 524 930 | sjokk 10 372 |
| 2029-02 | 81 230 | 74 638 | **6 592** | 596 300 | ferie 15 000 |
| 2029-07 | 81 230 | 97 638 | **−16 408** | 655 232 | ferie 38 000 |
| 2029-09 | 82 814 | 60 687 | **22 128** | 698 952 | — |
| 2030-07 | 82 814 | 88 687 | **−5 872** | 874 731 | ferie 28 000 |
| 2030-09 | 86 443 | 86 191 | **251** | 891 712 | fødsel+ |
| 2031-07 | 86 443 | 106 191 | **−19 749** | 1 025 098 | ferie 40 000 |
| 2031-09 | 88 091 | 83 129 | **4 962** | 1 050 311 | ferie 5 000, sjokk 11 037 |
| 2031-10 | 88 091 | 61 092 | **26 999** | 1 077 310 | — |
| 2032-07 | 88 091 | 91 092 | **−3 001** | 1 275 839 | ferie 30 000 |
| 2034-10 | 93 236 | 118 897 | **−25 660** | 1 864 860 | sjokk 55 660 |
| 2035-07 | 93 236 | 99 237 | **−6 000** | 2 073 057 | ferie 36 000 |
| 2036-08 | 95 021 | 63 987 | **31 033** | 2 429 313 | — |

### Typisk leftover (uten bilkjøp, fødsel-engangs og storferie ≥20k)

Phase-snittet over er trukket ned av sommer/vinterferie. Tabellen under er «vanlige» måneder:

| Fase | A typisk snitt | A worst typisk | B typisk snitt | B worst typisk |
|------|----------------|----------------|----------------|----------------|
| Før barn | **8 616** | −2 906 (2027-02) | **21 771** | 9 989 (2027-02) |
| 1 barn | **4 941** | −7 259 (2029-02) | **19 049** | 6 592 (2029-02) |
| 2 barn (med billån) | **1 325** | −12 591 (2031-02) | **16 213** | 2 251 (2031-02) |
| Etter billån | **9 976** | −42 597 (2034-10) | **26 415** | −25 660 (2034-10) |

Bil-påslag Zeekr: **8130** kr/mnd med lån · **2130** etter lån (fullkasko 1600, TFA 280, opsΔ 250 = lading+service − Bil 800).

## Scenarier

| | A) Mathias alene | B) Husstand |
|---|---|---|
| Inntekt | Kun Mathias lønn+ekstra | Mathias + Andrea lønn |
| Utgifter | Hans direkte + fellesandel + Zeekr-delta + barn (100 %) | Begge + hele felles + Zeekr + barn |
| Formål | Stress-test: klarer *han* seg | «Klarer *vi* oss» |

## Zeekr 7GT – bilantakelser

| Felt | Verdi |
|------|-------|
| Modell | Zeekr 7GT Long Range RWD (~500k-klasse) |
| Prisliste (orientering) | Core RWD 399 900 · Long Range RWD **498 400** · Privilege AWD 599 900 |
| Antatt kjøpsklasse | Long Range ~498 400 kr |
| Egenkapital (eksport okt 2026) | 160 000 kr |
| Billån | **6000** kr/mnd × 60 mnd (okt 2026–sep 2031) |
| Merk | Dealer-eksempler ofte 10 år / lavere termin — vi følger bruker 6k/5 år |

### Bil / forsikring – unngå dobbelttelling

| Allerede i budsjett | Behandling i sim |
|---------------------|------------------|
| Forsikring p1 **2 727** kr/mnd | Beholdes (bolig/liv-pakke). **Legger til** Zeekr fullkasko **1600** kr/mnd (intervall 1400–1800). |
| Bil p1 **800** kr/mnd | **Erstattes** av EV-drift: lading 750 + service 300 = **1050**. Beholder Bil-linje (inflatert) + ops_delta **+250** → total drift 1050. Ingen dobbel drivstoff. |
| Billån | **Nytt:** 6000 kr/mnd × 60 mnd fra okt 2026 |
| Trafikkforsikringsavgift | **Elbil 2026:** 9,16 kr/døgn ≈ 3 343 kr/år → **280** kr/mnd |

**Sum bil-påslag (med lån):** 8130 kr/mnd  
**Sum bil-påslag (etter lån):** 2130 kr/mnd  
(vs. gammel ICE-sim: 7800 / 1800 — Zeekr litt høyere pga. premium-fullkasko, delvis kompensert av lavere drift 1050 vs 1500.)

### Kilder / antakelser

- **Fullkasko ny premium kinesisk EV:** brukt **1600** (range 1400–1800).
- **TFA elbil 2026:** 9,16 kr/døgn → **280** kr/mnd.
- **Hjemmelading:** 750 kr/mnd (range 600–900).
- **Service-buffer EV:** 300 kr/mnd (lavere enn ICE).
- **Barnehage / barnetrygd / barn:** samme som REALISTISK (bhg 1500/1200, BT 2012, år0 4500).
- **Inflasjon:** 2,5 %/år variabel; **lønnsvekst 2 %/år**.
- **Ferier:** hvert år sommer 25–40k; hvert annet år vinter 12–20k; 4× langhelg 5k.

## Månedlige påslag per fase (nominelt)

| Fase | Periode | Lån | Fullkasko | TFA | OpsΔ | Barn netto | Sum |
|------|---------|-----|-----------|-----|------|------------|-----|
| Før barn (med billån, fra okt 2026) | okt 2026 – aug 2028 | 6000 | 1600 | 280 | 250 | 0 | **8130** |
| 1 barn år 0 (bleier, før bhg) + billån | sep 2028 – aug 2029 | 6000 | 1600 | 280 | 250 | 2488 | **10618** |
| 1 barn med bhg + billån | sep 2029 – aug 2030 | 6000 | 1600 | 280 | 250 | 2988 | **11118** |
| 2 barn (barn2 år 0) + billån | sep 2030 – sep 2031 | 6000 | 1600 | 280 | 250 | 5476 | **13606** |
| 2 barn etter billån ferdig | okt 2031 – aug 2036 | 0 | 1600 | 280 | 250 | 5676 | **7806** |

Engangs: 20 000 kr ved fødsel (sep 2028 + sep 2030). Bil egenkapital 160 000 kr okt 2026.

## Scenario A – Mathias alene

### Dom: **Ja – klarer seg** i denne simuleringen. Laveste buffer: 75 675 kr (2026-10). Sluttpot: 626 091 kr. Snitt leftover etter billån: 6 946 kr/mnd.

| Metrikk | Med sjokk+ferie | Uten livsjokk (ferie på) |
|---------|-----------------|--------------------------|
| Min pot | **75 675** (2026-10) | 75 675 (2026-10) |
| Sluttpot | **626 091** | 821 524 |
| Min leftover | **−155 548** (2026-10) | −155 548 (2026-10) |
| Mnd negativ pot | 0 | 0 |

#### Pot desember (+ start/okt)

| Måned | Pot med sjokk | Pot uten livsjokk |
|-------|---------------|-------------------|
| 2026-09 (start) | 231 223 | 231 223 |
| 2026-10 (etter bil) | 75 675 | 75 675 |
| 2026-12 | 93 864 | 93 864 |
| 2027-12 | 168 695 | 168 695 |
| 2028-12 | 210 446 | 220 818 |
| 2029-12 | 229 896 | 260 891 |
| 2030-12 | 241 383 | 296 807 |
| 2031-12 | 251 203 | 317 664 |
| 2032-12 | 348 365 | 429 285 |
| 2033-12 | 401 688 | 521 517 |
| 2034-12 | 466 951 | 642 440 |
| 2035-12 | 558 847 | 746 137 |

*Ingen negative måneder med sjokk+ferie.*

## Scenario B – Husstand (Mathias + Andrea)

### Dom: **Ja – klarer seg** i denne simuleringen. Laveste buffer: 88 570 kr (2026-10). Sluttpot: 2 429 313 kr. Snitt leftover etter billån: 23 373 kr/mnd.

| Metrikk | Med sjokk+ferie | Uten livsjokk (ferie på) |
|---------|-----------------|--------------------------|
| Min pot | **88 570** (2026-10) | 88 570 (2026-10) |
| Sluttpot | **2 429 313** | 2 624 746 |
| Min leftover | **−142 653** (2026-10) | −142 653 (2026-10) |
| Mnd negativ pot | 0 | 0 |

#### Pot desember (+ start/okt)

| Måned | Pot med sjokk | Pot uten livsjokk |
|-------|---------------|-------------------|
| 2026-09 (start) | 231 223 | 231 223 |
| 2026-10 (etter bil) | 88 570 | 88 570 |
| 2026-12 | 132 548 | 132 548 |
| 2027-12 | 364 012 | 364 012 |
| 2028-12 | 568 115 | 578 487 |
| 2029-12 | 755 742 | 786 737 |
| 2030-12 | 941 339 | 996 763 |
| 2031-12 | 1 131 307 | 1 197 768 |
| 2032-12 | 1 414 769 | 1 495 689 |
| 2033-12 | 1 660 655 | 1 780 484 |
| 2034-12 | 1 924 859 | 2 100 348 |
| 2035-12 | 2 222 190 | 2 409 480 |

*Ingen negative måneder med sjokk+ferie.*

## Ferier / leisure (alle måneder)

| Måned | Type | Beløp |
|-------|------|-------|
| 2027-02 | Vinterferie | 12 000 |
| 2027-07 | Sommerferie | 25 000 |
| 2028-05 | Langhelg | 5 000 |
| 2028-07 | Sommerferie | 32 000 |
| 2029-02 | Vinterferie | 15 000 |
| 2029-07 | Sommerferie | 38 000 |
| 2030-07 | Sommerferie | 28 000 |
| 2031-02 | Vinterferie | 18 000 |
| 2031-07 | Sommerferie | 40 000 |
| 2031-09 | Langhelg | 5 000 |
| 2032-07 | Sommerferie | 30 000 |
| 2033-02 | Vinterferie | 20 000 |
| 2033-07 | Sommerferie | 35 000 |
| 2034-04 | Langhelg | 5 000 |
| 2034-07 | Sommerferie | 27 000 |
| 2035-02 | Vinterferie | 14 000 |
| 2035-07 | Sommerferie | 36 000 |
| 2035-11 | Langhelg | 5 000 |
| 2036-07 | Sommerferie | 33 000 |

**Antall ferier:** 19  |  **Sum 10 år:** 423 000 kr  |  **Snitt/år:** 42 300 kr

## «Livet skjer»-sjokk (seed=42)

| Måned | Type | Beløp |
|-------|------|-------|
| 2028-10 | Bilreparasjon | 10 372 |
| 2029-06 | Tannlege/helse | 11 030 |
| 2029-12 | Bilreparasjon | 9 593 |
| 2030-04 | Tannlege/helse | 7 904 |
| 2030-08 | Hvitevarer/hus | 5 398 |
| 2030-11 | Reise/familie | 5 065 |
| 2030-12 | Tannlege/helse | 6 062 |
| 2031-09 | Reise/familie | 11 037 |
| 2032-02 | Bilreparasjon | 14 459 |
| 2033-03 | Tannlege/helse | 11 758 |
| 2033-06 | Tannlege/helse | 10 755 |
| 2033-07 | Bilreparasjon | 12 984 |
| 2033-12 | Tannlege/helse | 3 412 |
| 2034-10 | Stor uhell (vaskemaskin/tak) | 55 660 |
| 2035-02 | Hvitevarer/hus | 11 801 |
| 2036-01 | Hvitevarer/hus | 8 143 |

**Antall sjokk:** 16  |  **Sum:** 195 433 kr  |  **Snitt/år:** 19 543 kr

## Sensitivitet

| | A alene | B husstand |
|---|---------|------------|
| Min pot MED sjokk+ferie | 75 675 | 88 570 |
| Slutt MED | 626 091 | 2 429 313 |
| Slutt UTEN livsjokk | 821 524 | 2 624 746 |
| Livsjokk-effekt på slutt | −195 433 | −195 433 |
| Snitt leftover etter billån | 6 946 | 23 373 |

## Ekstra stress: Mathias betaler 100 % felles

| Metrikk | Med sjokk+ferie | Uten livsjokk |
|---------|-----------------|---------------|
| Min pot | **−944 515** (2036-07) | −749 082 (2036-07) |
| Sluttpot | **−944 258** | −748 825 |
| Mnd negativ | 110 | 110 |

## Metode

```
leftover[t] = inntekt[t] − utgifter[t]
pot[t] = pot[t-1] + leftover[t]
inntekt = lønn(+ekstra)[+Andrea] + barnetrygd
utgifter = fast + var(infl) + felles + Zeekr-delta + barn + engangs
         + livsjokk + ferie + egenkapital bil
```

Sep 2026 = hold på faktisk bank **231 223** kr. Okt trekker 160 000 egenkapital. Ingen app-data endret.

---
*Rapport generert for Mathias – Zeekr 7GT-variant. Kun analyse.*