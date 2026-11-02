/** Tests for Brukskort (spending card / two-account method). Read-only calc. */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");
const Sync = require("./sync-core.js");
let passed = 0, failed = 0;
const ok = (c, msg) => { if (c) passed++; else { failed++; console.log("  ✗", msg); } };
const people = [{ id: "pa", name: "A" }, { id: "pb", name: "B" }];
const cats = [
  { id: "mat", name: "Mat", type: "variabel", owner: "felles", split: { pa: 60, pb: 40 } },
  { id: "ff", name: "Fastfood", type: "variabel", owner: "pa" },
  { id: "lan", name: "Lån", type: "fast", owner: "pa" },
  { id: "bf", name: "Klær", type: "variabel", owner: "pb" }
];
const month = (extra) => Object.assign({ budgets: { mat: { felles: 5000 }, ff: { pa: 1000 }, lan: { pa: 8000 }, bf: { pb: 700 } }, expenses: [], incomes: [], savings: [] }, extra || {});
const base = () => ({ people, categories: cats, settings: { spendCard: { pa: { on: true } } }, months: { "2026-11": month() } });
const nov = new Date(2026, 10, 11);

// off → null, nothing changes
let st = base(); st.settings.spendCard = {};
ok(Calc.spendCardMonth(st, "2026-11", "pa", nov) === null, "av = null");
const before = JSON.stringify(Calc.calcFamily ? Calc.monthOverview(st.months["2026-11"], "pa", people, cats, 10) : {});
st = base();
ok(JSON.stringify(Calc.monthOverview(st.months["2026-11"], "pa", people, cats, 10)) === before, "månedsoversikt uendret med kort på");

// recommended = variable own share
let r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
const matShare = Calc.monthOverview(st.months["2026-11"], "pa", people, cats, 10).rows.find((x) => x.id === "mat").planned;
ok(Math.abs(r.recommended - Math.ceil(matShare + 1000)) < 1, "anbefalt = Mat (egen del) + Fastfood (" + r.recommended + ")");
ok(!r.rows.some((x) => x.fast), "faste ikke med");
ok(!r.rows.some((x) => x.id === "bf"), "andres kategori ikke med");
ok(r.toTransfer === r.recommended && r.left === 0, "ingenting overført ennå");

// transfers in parts + purchases
st.months["2026-11"].cardTransfers = [{ id: "t1", person: "pa", amount: 2000, date: "2026-11-01" }, { id: "t2", person: "pa", amount: 1000, date: "2026-11-05" }, { id: "t3", person: "pb", amount: 999 }];
st.months["2026-11"].expenses = [{ id: "e1", owner: "pa", categoryId: "ff", category: "Fastfood", amount: 400, date: "2026-11-03" },
  { id: "e2", owner: "pa", categoryId: "lan", category: "Lån", amount: 8000, date: "2026-11-01" }];
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(r.transferred === 3000, "overført i flere deler");
ok(r.used === 400 && r.left === 2600, "igjen på kortet = 3000 − 400 (lån ikke med)");
ok(r.daysLeft === 20 && r.perDay === 130, "per dag: 2600/20 = 130");
ok(r.toTransfer === Math.max(0, r.recommended - 3000), "gjenstår å føre over");

// category choice
st.settings.spendCard.pa.cats = ["ff"];
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(r.recommended === 1000 && r.rows.length === 1, "bare valgte kategorier");
st.settings.spendCard.pa.cats = ["ff", "lan"];
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(r.recommended === 9000 && r.rows.some((x) => x.id === "lan"), "fast kategori kan hukes av (abonnement på kortet)");
st.settings.spendCard.pa.cats = [];
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(r.recommended === 0 && r.rows.length === 0, "ingen avhuket = 0 kr");
delete st.settings.spendCard.pa.cats;
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(!r.rows.some((x) => x.id === "lan"), "standard: faste ikke med");

// reconcile
st.months["2026-11"].cardBalance = { pa: { amount: 2300, at: "2026-11-11" } };
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(r.diff === -300, "saldo 2300 vs forventet 2600 → −300 (uførte kjøp)");

// carry over + move to savings
st.months["2026-10"] = month({ cardTransfers: [{ id: "o1", person: "pa", amount: 3000 }], expenses: [{ id: "x", owner: "pa", categoryId: "ff", category: "Fastfood", amount: 2000 }],
  cardMoves: [{ id: "mv", person: "pa", amount: 200 }] });
r = Calc.spendCardMonth(st, "2026-11", "pa", nov);
ok(Math.abs(r.carryIn - (3000 - 2000 - 200 - (Calc.monthOverview(st.months["2026-10"], "pa", people, cats, 9).rows.filter((x) => !x.fast).reduce((a, x) => a + x.used, 0) - 2000))) < 1, "overført fra forrige mnd");
ok(r.carryIn === 800 && r.left === 800 + 3000 - 400, "rest 800 blir med");
ok(r.recommended === Math.max(0, Math.ceil(r.planned - 800)), "anbefalt trekker fra rest");
st.settings.spendCard.pa.since = "2026-11";
ok(Calc.spendCardMonth(st, "2026-11", "pa", nov).carryIn === 0, "since: ingen rest før start");
ok(Calc.spendCardMonth(st, "2026-10", "pa", new Date(2026, 10, 2)).monthEnd, "måned slutt");

// normalize / export-import / sync
const mig = Calc.migrateState({ people, categories: cats, months: {}, settings: { spendCard: { pa: { on: 1, cats: ["ff|pa", 5], since: "2026-11" }, pb: "x" } } });
ok(mig.settings.spendCard.pa.on === true && mig.settings.spendCard.pa.cats.length === 1 && !mig.settings.spendCard.pb, "spendCard normaliseres");
ok(JSON.stringify(Calc.migrateState({ people, categories: [], months: {} }).settings.spendCard) === "{}", "bakoverkompatibel");
const M = Sync.mergeStates({ settings: { spendCard: {} }, months: { "2026-11": { cardTransfers: [] } } },
  { settings: { spendCard: { pa: { on: true } } }, months: { "2026-11": { cardTransfers: [{ id: "a1", person: "pa", amount: 100 }] } } },
  { settings: { spendCard: { pb: { on: true } } }, months: { "2026-11": { cardTransfers: [{ id: "b1", person: "pb", amount: 200 }] } } });
ok(M.settings.spendCard.pa && M.settings.spendCard.pb, "innstilling flettes per person");
ok(M.months["2026-11"].cardTransfers.length === 2, "overføringer flettes per post");

// regression: transfers survive save → reload (migrateState) and sync merge
{
  const S0 = base();
  S0.months["2026-11"].cardTransfers = [{ id: "t1", person: "pa", amount: 4000, date: "2026-11-02" }];
  S0.months["2026-11"].cardMoves = [{ id: "mv1", person: "pa", amount: 500, date: "2026-11-30", goalId: null }];
  S0.months["2026-11"].cardBalance = { pa: { amount: 3500, at: "2026-11-02" } };
  const R = Calc.migrateState(JSON.parse(JSON.stringify(S0)));
  const rm = R.months["2026-11"];
  ok(rm.cardTransfers && rm.cardTransfers.length === 1 && rm.cardTransfers[0].amount === 4000 && rm.cardTransfers[0].person === "pa", "overføring overlever omlasting");
  ok(rm.cardMoves && rm.cardMoves.length === 1 && rm.cardBalance.pa.amount === 3500, "flytt og saldo overlever omlasting");
  const R2 = Calc.migrateState(JSON.parse(JSON.stringify(R)));
  ok(Calc.spendCardMonth(R2, "2026-11", "pa", nov).transferred === 4000, "overført beregnes etter to omlastinger");
  const B0 = Calc.migrateState(base()); const Mg = Sync.mergeStates(B0, R2, B0);
  const Mm = Calc.migrateState(Mg);
  ok(Mm.months["2026-11"].cardTransfers.length === 1, "overføring overlever synk + omlasting");
}

// regression: shared-category purchase stored with a person owner is counted (not hidden)
{
  const S1 = base();
  S1.months["2026-11"].expenses = [{ id: "x1", owner: "pa", categoryId: "mat", category: "Mat", amount: 849, date: "2026-11-02" },
    { id: "x2", owner: "pa", categoryId: "ff", category: "Fastfood", amount: 100, date: "2026-11-02", oneOff: true }];
  const R1 = Calc.migrateState(JSON.parse(JSON.stringify(S1)));
  const e1 = R1.months["2026-11"].expenses;
  ok(e1[0].owner === "felles", "felles-kjøp lagret på person flyttes til felles");
  ok(Calc.monthOverview(R1.months["2026-11"], "felles", people, cats, 10).rows.find((x) => x.id === "mat").used === 849, "felles-kjøp synes i felles");
  ok(e1[1].owner === "pa" && e1[1].oneOff === true, "engangs-merke overlever omlasting");
}

// regression: one big one-off does not inflate the "over plan" yearly estimate
{
  const S2 = base();
  const ex = (k, a) => ({ id: k + a, owner: "pa", categoryId: "ff", category: "Fastfood", amount: a, date: k + "-05" });
  S2.months["2026-09"] = month({ expenses: [ex("2026-09", 10651)] });
  S2.months["2026-10"] = month({ expenses: [ex("2026-10", 1605)] });
  const tips = Calc.savingsRecommendations({ state: S2, monthKey: "2026-11", personId: "pa", today: nov, leftAfterBudget: 0, max: 10 });
  const t = tips.find((x) => x.kind === "over");
  ok(t && /7 ?300/.test(t.text.replace(/\u00a0/g, " ")), "overforbruk-tips bruker laveste måned: " + (t && t.text));
}

// regression: year view with an archived partner matches the active person's plan
{
  const S3 = base();
  S3.people = [{ id: "pa", name: "A" }, { id: "pb", name: "B", archived: true }];
  S3.months["2026-11"].plannedIncome = { pa: { "lønn": 20000 }, pb: { "lønn": 30000 } };
  const R3 = Calc.migrateState(JSON.parse(JSON.stringify(S3)));
  const yr = Calc.yearRollup(R3.months, 2026, R3.people, R3.categories, R3.settings, []);
  const ov = Calc.monthOverview(R3.months["2026-11"], "pa", R3.people, R3.categories, 10);
  ok(Math.abs(yr.months[10].planUt - ov.plannedOut) < 1, "årsoversikt = aktiv persons plan ved arkivert partner (" + yr.months[10].planUt + " / " + ov.plannedOut + ")");
}

// regression: no card / goal deduction before they started
{
  const S4 = base();
  S4.settings.spendCard.pa.since = "2026-11";
  S4.months["2026-10"] = month();
  ok(Calc.spendCardMonth(S4, "2026-10", "pa", nov) === null, "ingen brukskort før startmåned");
  S4.savingsGoals = [{ id: "g1", name: "Buffer", target: 80000, monthly: 5000, person: "pa", status: "aktiv", createdAt: "2026-11" }];
  const R4 = Calc.migrateState(JSON.parse(JSON.stringify(S4)));
  ok(Calc.savingsForMonth(R4, "2026-10", "pa", nov).goalMonthly === 0, "sparemål trekkes ikke før det ble laget");
  ok(Calc.savingsForMonth(R4, "2026-11", "pa", nov).goalMonthly === 5000, "sparemål trekkes fra startmåned");
}

// real data, read only
const P = "/workspace/familie-budsjett-rettet-2026-10-28.json";
if (fs.existsSync(P)) {
  const raw = fs.readFileSync(P, "utf8");
  const S = Calc.migrateState(JSON.parse(raw));
  ok(Calc.spendCardMonth(S, "2026-11", "p1", nov) === null, "ekte data: av som standard");
  S.settings.spendCard = { p1: { on: true } };
  const x = Calc.spendCardMonth(S, "2026-11", "p1", new Date(2026, 10, 1));
  ok(x && x.recommended > 0 && x.rows.every((q) => !q.fast), "ekte data: anbefalt " + (x && x.recommended));
  ok(fs.readFileSync(P, "utf8") === raw, "datafil uendret");
}
console.log(`Brukskort: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
