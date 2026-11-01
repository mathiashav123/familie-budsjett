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
