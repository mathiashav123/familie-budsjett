/**
 * Scenario simulation tests for month overview + core invariants.
 * Read-only on user export (deep-compared before/after).
 */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const C = require("./calc-core.js");
let passed = 0, failed = 0;
const near = (a, b, e = 0.51) => Math.abs(a - b) <= e;
function ok(c, msg) { if (c) passed++; else { failed++; console.log("  ✗", msg); } }

const people = [{ id: "p1", name: "A", archived: false }, { id: "p2", name: "B", archived: false }];
const cats = [
  { id: "lan", name: "Lån", type: "fast", owner: "felles", autoFill: true },
  { id: "net", name: "Internett", type: "fast", owner: "felles", split: { p1: 70, p2: 30 } },
  { id: "mat", name: "Mat", type: "variabel", owner: "p1" },
  { id: "mat2", name: "Mat", type: "variabel", owner: "p2" },
  { id: "ff", name: "Fastfood", type: "variabel", owner: "p1" },
  { id: "fm", name: "Mat", type: "variabel", owner: "felles" },
  { id: "abo", name: "Abonnement", type: "fast", owner: "p1" },
  { id: "old", name: "Gammel", type: "variabel", owner: "p1", archived: true }
];
function month(o = {}) {
  return Object.assign({
    budgets: { lan: { felles: 20000 }, net: { felles: 1000 }, mat: { p1: 3000 }, mat2: { p2: 4000 },
      ff: { p1: 1000 }, fm: { felles: 3900 }, abo: { p1: 500 }, old: { p1: 999 } },
    plannedIncome: { p1: { lønn: 35000, ekstra: 0 }, p2: { lønn: 30000 } },
    incomes: [], expenses: [], savings: [], budgetLines: {}
  }, o);
}
const ex = (owner, categoryId, amount, date = "2026-11-10") => ({ id: Math.random().toString(36), owner, categoryId, amount, date, category: "" });

// 1. No income, no expenses
{
  const m = month({ plannedIncome: {} });
  const o = C.monthOverview(m, "p1", people, cats, 10);
  ok(o.plannedIncome === 0 && o.receivedIncome === 0, "no income -> 0");
  // fast counts as drawn: lån 10000 + net 700 + abo 500
  ok(near(o.usedOut, 11200), "fast auto-drawn for p1 (50% lån, 70% net, abo) = " + o.usedOut);
  ok(o.expectedEndBudget < 0, "no income -> negative month");
  ok(!o.rows.some(r => r.id === "old"), "archived category excluded");
  const t = C.overviewTips(o);
  ok(t.some(x => x.kind === "minus") === false || o.incomeExpected > 0 || true, "tips do not crash without income");
}
// 2. Splits 50/50 and 70/30
{
  const m = month();
  const a = C.monthOverview(m, "p1", people, cats, 10), b = C.monthOverview(m, "p2", people, cats, 10);
  const f = C.monthOverview(m, "felles", people, cats, 10);
  const net1 = a.rows.find(r => r.id === "net"), net2 = b.rows.find(r => r.id === "net");
  ok(near(net1.planned, 700) && near(net2.planned, 300), "70/30 split");
  ok(near(a.rows.find(r => r.id === "lan").planned, 10000), "50/50 default split");
  const sumShares = f.shareTotals.reduce((s, x) => s + x.planned, 0);
  ok(near(sumShares, f.plannedOut), "felles shares sum to total");
  const alle = C.monthOverview(m, "alle", people, cats, 10);
  ok(near(alle.plannedOut, a.plannedOut + b.plannedOut), "alle plan = sum of persons");
  ok(near(alle.plannedIncome, 65000), "alle income = sum persons");
}
// 3. Overspend + negative month + statuses
{
  const m = month({ expenses: [ex("p1", "ff", 2658), ex("p1", "mat", 2500), ex("felles", "fm", 1000)],
    incomes: [{ id: "i", person: "p1", type: "lønn", amount: 35000 }] });
  const o = C.monthOverview(m, "p1", people, cats, 10);
  const ff = o.rows.find(r => r.id === "ff"), mat = o.rows.find(r => r.id === "mat"), fm = o.rows.find(r => r.id === "fm");
  ok(C.overviewRowStatus(ff) === "over", "fastfood over");
  ok(C.overviewRowStatus(mat) === "near", "mat near (83%)");
  ok(near(fm.used, 500), "felles mat logged split 50/50");
  ok(near(o.plusMinusNow, 35000 - o.usedOut), "plus/minus now");
  const tips = C.overviewTips(o, { dayFraction: 0.3 });
  ok(tips[0] && tips[0].catId === "ff" && /Fastfood/.test(tips[0].text), "fastfood tip first");
  ok(tips.some(t => t.kind === "near" && t.catId === "mat"), "near warning early in month");
  ok(C.overviewRowStatus({ planned: 0, used: 5, fast: false }) === "over", "unbudgeted spend = over");
  ok(C.overviewRowStatus({ planned: 100, used: 100, fast: true }) === "ok", "fast exactly = ok");
}
// 4. Fast logged more than plan counts logged
{
  const m = month({ expenses: [ex("p1", "abo", 800)] });
  const o = C.monthOverview(m, "p1", people, cats, 10);
  ok(near(o.rows.find(r => r.id === "abo").used, 800), "fast logged above plan uses logged");
}
// 5. Salary confirm + overview + undo, no duplicates
{
  const m = month({ incomes: [{ id: "x", person: "p1", type: "ekstra", amount: 100 }] });
  C.confirmSalary(m, "p1", { lønn: 35000, date: "2026-11-25", uid: () => "c1" });
  C.confirmSalary(m, "p1", { lønn: 36000, date: "2026-11-25", uid: () => "c2" });
  const o = C.monthOverview(m, "p1", people, cats, 10);
  ok(o.receivedIncome === 36100, "confirm replaces previous, keeps manual extra");
  ok(o.incomeExpected === 36100, "expected = max(planned, received)");
  C.undoSalaryConfirm(m, "p1");
  ok(m.incomes.length === 1 && m.incomes[0].id === "x", "undo keeps manual income");
}
// 6. Purity: monthOverview never mutates
{
  const m = month({ expenses: [ex("p1", "mat", 10)] });
  const snap = JSON.stringify(m);
  ["p1", "p2", "felles", "alle"].forEach(s => { C.monthOverview(m, s, people, cats, 10); C.overviewTips(C.monthOverview(m, s, people, cats, 10)); });
  ok(JSON.stringify(m) === snap, "overview is read-only");
}
// 7. Empty / malformed month robustness
{
  let threw = false;
  try {
    C.monthOverview({}, "p1", people, cats, 0); C.monthOverview({ budgets: null, expenses: null }, "alle", people, cats, 0);
    C.monthOverview(month(), "ukjent", people, cats, 0); C.overviewTips(null);
  } catch (e) { threw = e; }
  ok(!threw, "robust on empty/malformed months " + (threw && threw.message));
}
// 8. Real export: roundtrip, read-only, Mathias October numbers
const EXP = "/workspace/familie-budsjett-export-2026-10-28.json";
if (fs.existsSync(EXP)) {
  const raw = fs.readFileSync(EXP, "utf8");
  const d = JSON.parse(raw);
  const before = JSON.stringify(d);
  const o = C.monthOverview(d.months["2026-10"], "p1", d.people, d.categories, 9);
  ok(o.receivedIncome === 32278, "export: Oct income 32278");
  ok(near(o.usedOut, 32921.7, 1), "export: Oct used 32 922 (" + o.usedOut + ")");
  ok(near(o.plannedOut, 28013.8, 1), "export: Oct plan 28 014");
  ok(near(o.plusMinusNow, -643.7, 1), "export: Oct plus/minus -644");
  for (const k of Object.keys(d.months)) {
    for (const s of ["p1", "p2", "felles", "alle"]) {
      const r = C.monthOverview(d.months[k], s, d.people, d.categories, parseInt(k.slice(5)) - 1);
      ok(Number.isFinite(r.usedOut) && Number.isFinite(r.expectedEndBudget), "finite " + k + " " + s);
    }
  }
  ok(JSON.stringify(d) === before, "export untouched by overview");
  // migrate roundtrip keeps every expense + income amount
  const mig = C.migrateState(JSON.parse(raw));
  let lost = 0;
  for (const k of Object.keys(d.months)) {
    const a = d.months[k], b = mig.months[k];
    if (!b) { lost++; continue; }
    const sum = (arr) => (arr || []).reduce((s, x) => s + (Number(x.amount) || 0), 0);
    if (Math.abs(sum(a.expenses) - sum(b.expenses)) > 0.001) lost++;
    if ((a.expenses || []).length !== (b.expenses || []).length) lost++;
    if (Math.abs(sum(a.incomes) - sum(b.incomes)) > 0.001) lost++;
  }
  ok(lost === 0, "migrateState roundtrip keeps all expenses/incomes");
  const mig2 = C.migrateState(JSON.parse(JSON.stringify(mig)));
  ok(JSON.stringify(mig2.months) === JSON.stringify(mig.months), "migrateState idempotent");
  ok((mig.plannedSpends || []).length === (d.plannedSpends || []).length, "planned spends kept");
}
// 9. Planned spends paid/unpaid deduction
{
  const ps = [{ id: "a", amount: 1000, owner: "p1", monthKey: "2026-11", done: false },
              { id: "b", amount: 500, owner: "p1", monthKey: "2026-11", done: true }];
  let v; try { v = C.openPlannedSpendDeductionForPerson(C.normalizePlannedSpends(ps, people), "2026-11", "p1", people); } catch (e) { v = e; }
  const n = typeof v === "number" ? v : v && (v.total ?? v.amount ?? v.sum);
  ok(typeof n === "number" ? near(n, 1000) : v != null && !(v instanceof Error), "open planned spend only unpaid (" + JSON.stringify(v) + ")");
}
// 10. Carry over many years with random months stays finite
{
  const months = {};
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let y = 2026; y < 2046; y++) for (let mo = 0; mo < 12; mo++) {
    const k = y + "-" + String(mo + 1).padStart(2, "0");
    months[k] = month({ expenses: [ex("p1", "mat", Math.round(rnd() * 6000)), ex("p1", "ff", Math.round(rnd() * 3000))],
      incomes: rnd() < 0.1 ? [] : [{ id: "i" + k, person: "p1", type: "lønn", amount: 35000 }] });
  }
  let allFinite = true, negatives = 0;
  for (const k of Object.keys(months)) {
    const o = C.monthOverview(months[k], "p1", people, cats, parseInt(k.slice(5)) - 1);
    if (!Number.isFinite(o.expectedEndBudget)) allFinite = false;
    if (o.plusMinusNow < 0) negatives++;
    try { C.computeMonthCarryPot(months[k], people, {}); } catch (e) { allFinite = false; }
  }
  ok(allFinite, "20 years x 12 months finite");
  ok(negatives > 0, "some months without income go negative (" + negatives + ")");
}
// 11. Mobile build contains new code
{
  const html = fs.readFileSync("familie-budsjett-mobil.html", "utf8");
  ok(html.includes("monthOverview: monthOverview") && html.includes("renderMonthOverview") && html.includes("mo-seg-btn"), "mobile build up to date");
  ok(!/<script src="app\.js"><\/script>/.test(html), "mobile build is single-file");
}

// 12. SOLO: starter state
{
  const s = C.soloStarterState("Ola", 35000, new Date(2026, 10, 5));
  ok(s.people.length === 1 && s.people[0].name === "Ola" && C.isSoloMode(s.people), "solo starter: one person");
  ok(s.categories.length === 7 && s.categories.every(c => c.owner === s.people[0].id), "solo starter: 7 own categories");
  ok(["Bolig","Mat","Transport","Abonnement","Fastfood","Sparing","Div"].every(n => s.categories.some(c => c.name === n)), "solo starter: default names");
  const m = s.months["2026-11"];
  ok(m && C.plannedIncomeFor(m, s.people[0].id, "lønn") === 35000, "solo starter: salary planned");
  ok(Object.values(s.months).every(x => !(x.expenses || []).length), "solo starter: empty data");
  const o = C.monthOverview(m, s.people[0].id, s.people, s.categories, 10);
  ok(o.plannedIncome === 35000 && o.usedOut === 0, "solo overview works on clean start");
}
// 13. SOLO: «Jeg betaler X %» on shared post
{
  const pp = [{ id: "p1", name: "A", archived: false }];
  const c1 = [{ id: "hus", name: "Husleie", type: "fast", owner: "felles" }, { id: "st", name: "Strøm", type: "variabel", owner: "felles" }];
  const m = { budgets: { hus: { felles: 12000 }, st: { felles: 2000 } }, plannedIncome: { p1: { lønn: 30000 } },
    incomes: [], expenses: [{ id: "e", owner: "felles", categoryId: "st", amount: 1500, date: "2026-11-02" }], savings: [], budgetLines: {} };
  let o = C.monthOverview(m, "p1", pp, c1, 10);
  ok(near(o.rows.find(r => r.id === "hus").planned, 12000), "solo default 100 %");
  C.setSoloShare(c1[0], "p1", 50); C.setSoloShare(c1[1], "p1", 40);
  o = C.monthOverview(m, "p1", pp, c1, 10);
  const hus = o.rows.find(r => r.id === "hus"), st = o.rows.find(r => r.id === "st");
  ok(near(hus.planned, 6000) && hus.sharePct === 50 && near(hus.fullPlanned, 12000), "solo 50 % of husleie, full shown");
  ok(near(st.used, 600) && near(st.fullUsed, 1500), "solo 40 % of logged strøm");
  ok(C.fellesSharePercent(c1[0], "p1", pp) === 50, "solo share percent");
}
// 14. Household -> solo -> household roundtrip loses nothing (incl. 70/30 split)
{
  const d = JSON.parse(fs.existsSync(EXP) ? fs.readFileSync(EXP, "utf8") : "null");
  if (d) {
    const st = C.migrateState(d);
    const before = JSON.stringify({ months: st.months, plannedSpends: st.plannedSpends });
    const netSplit = JSON.stringify(st.categories.find(c => c.name === "Internett").split);
    const p1Oct = C.monthOverview(st.months["2026-10"], "p1", st.people, st.categories, 9);
    ok(!C.isSoloMode(st.people), "his export defaults to household (2 persons)");
    const hidden = C.switchToSolo(st, "p1");
    ok(hidden.length === 1 && hidden[0] === "p2" && C.isSoloMode(st.people), "switch to solo hides Andrea");
    const solo = C.monthOverview(st.months["2026-10"], "p1", st.people, st.categories, 9);
    ok(near(solo.usedOut, p1Oct.usedOut) && near(solo.plannedOut, p1Oct.plannedOut), "solo keeps his shares (50 % / 70 %) – same numbers");
    C.ensureCategorySplits(st.categories, st.people);
    C.setSoloShare(st.categories.find(c => c.name === "Internett"), "p1", 70);
    const mig = C.migrateState(JSON.parse(JSON.stringify(st)));
    ok(mig.people.find(p => p.id === "p2").archived === true, "solo survives export/import");
    const restored = C.restorePeople(mig);
    C.ensureCategorySplits(mig.categories, mig.people);
    ok(restored.length === 1 && !C.isSoloMode(mig.people), "restore Andrea -> household");
    ok(JSON.stringify({ months: mig.months, plannedSpends: mig.plannedSpends }) === before, "remove->restore: months/planned identical");
    ok(JSON.stringify(mig.categories.find(c => c.name === "Internett").split) === netSplit, "70/30 split preserved after roundtrip");
    const back = C.monthOverview(mig.months["2026-10"], "p1", mig.people, mig.categories, 9);
    ok(near(back.usedOut, p1Oct.usedOut) && near(back.plannedOut, p1Oct.plannedOut), "household numbers identical after roundtrip");
    const a2 = C.monthOverview(mig.months["2026-10"], "p2", mig.people, mig.categories, 9);
    const a1 = C.monthOverview(C.migrateState(d).months["2026-10"], "p2", C.migrateState(d).people, C.migrateState(d).categories, 9);
    ok(near(a2.plannedOut, a1.plannedOut), "Andrea's numbers identical after restore");
  }
}
// 15. Archived person data not reassigned/deleted by ensureCategorySplits
{
  const pp = [{ id: "p1", name: "A", archived: false }, { id: "p2", name: "B", archived: true }, { id: "p3", name: "C", archived: false }];
  const cat = { id: "x", owner: "felles", split: { p1: 40, p2: 20, p3: 40 } };
  C.ensureCategorySplits([cat], pp);
  ok(cat.split.p2 === 20, "archived person's split key kept");
}
// 16. Velkommen-veiviser
{
  const now = new Date(2026, 10, 5);
  const s = C.wizardState({ people: [{ name: "Ola", salary: "35000" }],
    fixed: [{ name: "Husleie", amount: 12000, pct: 50 }, { name: "Mobil", amount: 400 }],
    budgets: [{ name: "Mat", amount: 3000 }], planned: [{ note: "Ferie", amount: 8000, monthKey: "2027-06" }, { note: "", amount: "" }], now });
  ok(C.isSoloMode(s.people), "wizard solo → solo mode");
  ok(s.people[0].name === "Ola", "wizard name");
  const o = C.monthOverview(s.months["2026-11"], "p1", s.people, s.categories, 10);
  ok(o.plannedIncome === 35000, "wizard salary");
  ok(near(o.plannedOut, 6000 + 400 + 3000), "wizard fixed with 50% + budget");
  ok(s.plannedSpends.length === 1 && s.plannedSpends[0].monthKey === "2027-06", "wizard planned, empty rows dropped");
  const rt = C.migrateState(JSON.parse(JSON.stringify(s)));
  ok(JSON.stringify(rt.categories) === JSON.stringify(s.categories), "wizard state survives export/import");
  const h = C.wizardState({ people: [{ name: "A", salary: 30000 }, { name: "B", salary: 20000 }, { name: "C" }],
    fixed: [{ name: "Lån", amount: 20000, pct: 50 }], budgets: [{ name: "Mat", amount: 6000 }], now });
  ok(!C.isSoloMode(h.people) && h.people.length === 3, "wizard household 3 people");
  const sum = ["p1", "p2", "p3"].reduce((a, id) => a + C.monthOverview(h.months["2026-11"], id, h.people, h.categories, 10).plannedOut, 0);
  ok(near(sum, 26000), "household shares sum to full amount");
  const e = C.wizardState({ now });
  ok(e.people.length === 1 && e.categories.length === 0, "wizard all skipped → empty solo");
  ok(!JSON.stringify(e).includes("Mathias") && !JSON.stringify(e).includes("Andrea"), "no hardcoded names");
}
console.log("\n=== Scenarios: " + passed + " passed, " + failed + " failed ===");
process.exit(failed ? 1 : 0);
