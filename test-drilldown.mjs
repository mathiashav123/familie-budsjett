/**
 * Drilldown tests: entries behind every Oversikt number must sum to the overview figure.
 * Uses synthetic data, plus a local export file if one is present (never committed).
 */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");
let passed = 0, failed = 0;
function near(a, b, msg) {
  if (Math.abs(a - b) < 0.005) passed++;
  else { failed++; console.log("  ✗", msg, "got", a, "expected", b); }
}
function check(label, m, people, cats, mi, opts) {
  const before = JSON.stringify(m);
  const act = people.filter((p) => !p.archived);
  const scopes = act.map((p) => p.id).concat(["felles", "alle"]);
  scopes.forEach((sc) => {
    const o = Calc.monthOverview(m, sc, people, cats, mi);
    const d = (k) => Calc.monthOverviewDrilldown(m, sc, people, cats, mi, k);
    const t = label + " [" + sc + "]";
    near(d({ kind: "used" }).total, o.usedOut, t + " used");
    near(d({ kind: "planned" }).plannedTotal, o.plannedOut, t + " planned");
    near(d({ kind: "income" }).total, o.receivedIncome, t + " income");
    near(d({ kind: "pm" }).total, o.plusMinusNow, t + " plusMinus");
    let fastSum = 0; o.rows.filter((r) => r.fast).forEach((r) => { fastSum += Math.max(r.planned, r.used); });
    near(d({ kind: "fast" }).total, fastSum, t + " fast");
    o.rows.forEach((r) => {
      const x = d({ kind: "row", catId: r.id, owner: r.owner });
      near(x.total, r.used, t + " row used " + r.name);
      near(x.plannedTotal, r.planned, t + " row planned " + r.name);
      // Oversikt row tap shows logged purchases only: sum must equal logged amount (own share)
      const cat = cats.find((c) => c.id === r.id);
      const ownerKey = r.owner || cat.owner;
      const pct = sc !== "felles" && sc !== "alle" && ownerKey === "felles" ? r.sharePct : 100;
      const logged = x.entries.filter((e) => e.type === "expense").reduce((a, e) => a + e.amount, 0);
      near(logged, Calc.actualForCategoryOwner(m, r.id, r.name, ownerKey) * pct / 100, t + " row logged-only " + r.name);
      x.entries.forEach((e) => { if (e.categoryId !== r.id) { failed++; console.log("  ✗ wrong cat", e); } });
    });
    (o.shareTotals || []).forEach((st) => {
      const x = d({ kind: "share", personId: st.personId });
      near(x.total, st.used, t + " share used " + st.name);
      near(x.plannedTotal, st.planned, t + " share planned " + st.name);
    });
    const u = d({ kind: "used" }).entries;
    for (let i = 1; i < u.length; i++) if ((u[i - 1].date || "9999") > (u[i].date || "9999")) { failed++; console.log("  ✗ not sorted", t); break; }
  });
  if (JSON.stringify(m) !== before) { failed++; console.log("  ✗ month mutated", label); } else passed++;
}

// Synthetic
const people = [{ id: "p1", name: "Mathias" }, { id: "p2", name: "Andrea" }];
const cats = [
  { id: "mat", name: "Mat", type: "variabel", owner: "felles", split: { p1: 60, p2: 40 } },
  { id: "abo", name: "Abonnement", type: "fast", owner: "p1" },
  { id: "lan", name: "Lån", type: "fast", owner: "felles" },
  { id: "kl", name: "Klær", type: "variabel", owner: "p2" },
];
const m = {
  budgets: { mat: { felles: 8000 }, abo: { p1: 500 }, lan: { felles: 12000 }, kl: { p2: 1500 } },
  budgetLines: { abo: { p1: [{ id: "a", name: "Netflix", amount: 219 }, { id: "b", name: "MS", amount: 1200, interval: "year", mode: "once", month: 3 }] } },
  incomes: [{ person: "p1", type: "lønn", amount: 32000, date: "2026-10-20" }, { person: "p2", type: "lønn", amount: 28000, date: "2026-10-12" }],
  expenses: [
    { owner: "felles", categoryId: "mat", category: "Mat", amount: 979, note: "Rema", date: "2026-10-05" },
    { owner: "p1", categoryId: "mat", category: "Mat", amount: 130, note: "Pizza", date: "2026-10-02" },
    { categoryId: "mat", category: "Mat", amount: 55.5, note: "uten eier", date: "2026-10-01" },
    { owner: "felles", categoryId: "lan", category: "Lån", amount: 5000, date: "2026-10-15" },
    { owner: "p2", categoryId: "kl", category: "Klær", amount: 2100, date: "2026-10-09" },
    { owner: "p1", category: "Abonnement", amount: 99, date: "2026-10-03" },
  ],
};
check("synthetic okt", m, people, cats, 9);
check("synthetic apr", m, people, cats, 3);
check("solo", m, [people[0]], cats, 9);
check("archived Andrea", m, [people[0], { id: "p2", name: "Andrea", archived: true }], cats, 9);
const dm = Calc.monthOverviewDrilldown(m, "p1", people, cats, 9, { kind: "row", catId: "mat" });
near(dm.entries.find((e) => e.note === "Rema").amount, 979 * 0.6, "share amount 60%");
near(dm.entries.find((e) => e.note === "Rema").full, 979, "full amount shown");

// Local export (optional, not in git)
const f = "/workspace/familie-budsjett-rettet-2026-10-28.json";
if (fs.existsSync(f)) {
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  Object.keys(s.months).forEach((k) => check("export " + k, s.months[k], s.people, s.categories, Number(k.slice(5)) - 1));
}
console.log(`\nDrilldown: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
