/** Tests for Igjen per dag, warnings, plan suggestions and budget proposal (read-only calc). */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");
let passed = 0, failed = 0;
const ok = (c, msg) => { if (c) passed++; else { failed++; console.log("  ✗", msg); } };
const near = (a, b, msg) => ok(Math.abs(a - b) < 0.005, `${msg} (got ${a}, expected ${b})`);

// monthDayInfo
let di = Calc.monthDayInfo(2026, 9, new Date(2026, 9, 30));
ok(di.state === "current" && di.daysLeft === 2, "30. okt → 2 dager igjen inkl. i dag");
ok(Calc.monthDayInfo(2026, 9, new Date(2026, 9, 1)).daysLeft === 31, "1. okt → 31 dager");
ok(Calc.monthDayInfo(2026, 8, new Date(2026, 9, 5)).state === "past", "sep er fortid i okt");
ok(Calc.monthDayInfo(2026, 10, new Date(2026, 9, 5)).state === "future", "nov er fremtid i okt");
ok(Calc.monthDayInfo(2026, 1, new Date(2026, 1, 28)).daysLeft === 1, "28. feb → 1 dag");

// perDayLeft
let pd = Calc.perDayLeft(3000, 1860, 12);
near(pd.perDay, 95, "(3000-1860)/12 = 95 kr/dag"); ok(!pd.over, "ikke over");
pd = Calc.perDayLeft(3000, 3500, 5);
ok(pd.over && Math.abs(pd.overBy - 500) < 1e-9 && pd.perDay === 0, "over med 500");
ok(Calc.perDayLeft(100, 100, 0).perDay === 0, "0 dager → 0/dag, ingen deling på 0");
const vt = Calc.variableLeftPerDay({ rows: [{ fast: false, planned: 3000, used: 1000 }, { fast: true, planned: 9000, used: 9000 }, { fast: false, planned: 1000, used: 1200 }] }, 10);
near(vt.perDay, 180, "variabel total: (4000-2200)/10, faste ignoreres");

// overviewRowStatus thresholds (warnings)
ok(Calc.overviewRowStatus({ planned: 1000, used: 799 }) === "ok", "79,9 % ok");
ok(Calc.overviewRowStatus({ planned: 1000, used: 800 }) === "near", "80 % gul");
ok(Calc.overviewRowStatus({ planned: 1000, used: 1001 }) === "over", "over → rød");

// roundTo100
ok(Calc.roundTo100(5849) === 5800 && Calc.roundTo100(5850) === 5900 && Calc.roundTo100(5899.9) === 5900, "rund til nærmeste 100");

// Synthetic months for suggestions / proposal
const people = [{ id: "p1", name: "Mathias" }, { id: "p2", name: "Andrea" }];
const cats = [
  { id: "mat", name: "Mat", type: "variabel", owner: "p1" },
  { id: "ff", name: "Fastfood", type: "variabel", owner: "p1" },
  { id: "kl", name: "Klær", type: "variabel", owner: "p1" },
  { id: "fm", name: "Felles mat", type: "variabel", owner: "felles", split: { p1: 50, p2: 50 } },
  { id: "lan", name: "Lån", type: "fast", owner: "felles", split: { p1: 50, p2: 50 } },
  { id: "abo", name: "Abo", type: "fast", owner: "p1" },
];
const mk = (mat, ff, kl, fm) => ({
  budgets: { mat: { p1: 3000 }, ff: { p1: 1000 }, kl: { p1: 500 }, fm: { felles: 4000 }, lan: { felles: 10000 }, abo: { p1: 800 } },
  plannedIncome: {}, incomes: [{ person: "p1", type: "lønn", amount: 30000 }],
  expenses: [
    { owner: "p1", categoryId: "mat", amount: mat }, { owner: "p1", categoryId: "ff", amount: ff },
    { owner: "p1", categoryId: "kl", amount: kl }, { owner: "felles", categoryId: "fm", amount: fm },
  ],
});
const months = { "2026-07": mk(5800, 900, 100, 5000), "2026-08": mk(6000, 1200, 700, 4500), "2026-09": mk(5900, 1100, 200, 4200), "2026-10": mk(100, 0, 0, 0), "2026-11": { budgets: { mat: { p1: 3000 }, ff: { p1: 1000 }, kl: { p1: 500 }, fm: { felles: 4000 }, lan: { felles: 10000 }, abo: { p1: 800 } }, expenses: [], incomes: [] } };
const snap = JSON.stringify(months);
let sg = Calc.planSuggestions(months, "p1", people, cats, { today: new Date(2026, 9, 30), targetKey: "2026-10" });
const mat = sg.find((x) => x.catId === "mat");
ok(!!mat, "Mat over 3 mnd → forslag");
ok(mat && mat.months.map((m) => m.key).join() === "2026-07,2026-08,2026-09", "bruker siste 3 fullførte måneder (ikke inneværende)");
ok(mat && mat.suggested === 5900 && mat.increase === 2900 && mat.pmImpact === 2900, "Mat: snitt 5 900, plan 3 000 → +2 900");
ok(!sg.find((x) => x.catId === "ff"), "Fastfood ikke over hver måned → ikke forslag");
ok(!sg.find((x) => x.catId === "kl"), "Klær ikke over hver måned → ikke forslag");
const fm = sg.find((x) => x.catId === "fm");
ok(fm && fm.suggested === 4600 && fm.sharePct === 50 && fm.pmImpact === 300, "Felles mat: din del 50 % av +600");
ok(!sg.find((x) => x.catId === "lan" || x.catId === "abo"), "faste kategorier gir aldri forslag");
ok(Calc.planSuggestions(months, "felles", people, cats, { today: new Date(2026, 9, 30) }).every((x) => x.owner === "felles"), "felles-filter");
// Only real-data months; need >= 2
const two = { "2026-08": months["2026-08"], "2026-09": months["2026-09"], "2026-10": months["2026-10"], "2026-06": { budgets: { mat: { p1: 3000 } }, expenses: [], incomes: [] } };
sg = Calc.planSuggestions(two, "p1", people, cats, { today: new Date(2026, 9, 30) });
ok(sg.find((x) => x.catId === "mat") && sg.find((x) => x.catId === "mat").months.length === 2, "2 måneder med data holder, tom måned ignoreres");
const one = { "2026-09": months["2026-09"], "2026-10": months["2026-10"] };
ok(Calc.planSuggestions(one, "p1", people, cats, { today: new Date(2026, 9, 30) }).length === 0, "bare 1 måned → ingen forslag");
// When plan already raised → no suggestion
const raised = JSON.parse(JSON.stringify(months)); raised["2026-10"].budgets.mat.p1 = 6000;
ok(!Calc.planSuggestions(raised, "p1", people, cats, { today: new Date(2026, 9, 30), targetKey: "2026-10" }).find((x) => x.catId === "mat"), "plan ≥ snitt → ikke forslag");

// Budget proposal
let bp = Calc.budgetProposal(months, "2026-11", "p1", people, cats, { saving: 3000, income: 30000 });
near(bp.fixed, 800 + 5000, "faste: egne + 50 % av felles lån");
near(bp.fellesVariable, 2000, "felles variabel (din del) beholdes");
near(bp.available, 30000 - 5800 - 2000 - 3000, "til variable");
ok(bp.historyKeys.join() === "2026-08,2026-09,2026-10", "snitt fra siste 3 mnd med data før målmåned");
ok(bp.fits && bp.items.find((i) => i.catId === "mat").suggested === Calc.roundTo100((6000 + 5900 + 100) / 3), "får plass → forslag = snitt avrundet");
ok(bp.items.every((i) => i.owner === "p1"), "bare egne variable kategorier");
bp = Calc.budgetProposal(months, "2026-11", "p1", people, cats, { saving: 19000, income: 30000 });
ok(!bp.fits && bp.sumSuggested <= bp.available + 1e-9, "går ikke → skaleres ned innenfor tilgjengelig");
const bm = bp.items.find((i) => i.catId === "mat");
ok(bm.suggested >= Math.floor((bm.avg * 0.8) / 100) * 100, "Mat har gulv (80 % av snitt)");
ok(bp.cutTotal > 0 && bp.biggestCuts.length > 0, "ærlig melding: kutt og størst kutt");
ok(bp.items.every((i) => i.suggested % 100 === 0 && i.suggested >= 0), "hele hundre, aldri negativt");
bp = Calc.budgetProposal(months, "2026-11", "p1", people, cats, { saving: 30000, income: 30000 });
ok(bp.impossible && bp.missing > 0 && bp.items.every((i) => i.suggested === 0 || i.essential), "umulig mål → bare gulv for nødvendige, mangler oppgis");
ok(JSON.stringify(months) === snap, "ingen mutasjon av måneder");


// Rebalance after manual edits
{
  const items = [{ avg: 4000, essential: true, currentPlan: 3000 }, { avg: 2000, currentPlan: 1000 }, { avg: 1000, currentPlan: 500 }];
  let r = Calc.rebalanceProposal(items, 7000, {});
  ok(r.values.join() === "4000,2000,1000" && r.fits, "uten låsing: proporsjonalt etter snitt");
  r = Calc.rebalanceProposal(items, 7000, { 1: 500 });
  ok(r.values[1] === 500, "låst verdi beholdes");
  ok(r.values[0] === 4000 && r.values[2] === 1000 && r.total === 5500, "senkes én: de andre beholder snitt (ingen oppblåsing)" + r.values);
  r = Calc.rebalanceProposal(items, 7000, { 1: 500 }, { fill: true });
  ok(r.values[0] === 5200 && r.values[2] === 1300, "fill: resten fordeles proporsjonalt 4:1" + r.values);
  r = Calc.rebalanceProposal(items, 7000, { 1: 2500 });
  ok(r.values[0] === 3600 && r.values[2] === 900 && r.total === 7000, "økes én: de andre skaleres ned proporsjonalt" + r.values);
  r = Calc.rebalanceProposal(items, 7000, { 1: 3500 });
  ok(r.values[0] >= 3200 && r.total <= 7000 && r.fits, "gulv for Mat respekteres (80 % av 4000)" + r.values);
  r = Calc.rebalanceProposal(items, 7000, { 1: 6000 });
  ok(!r.fits && Math.abs(r.missing - 2200) < 1e-9 && r.values[0] === 3200 && r.values[2] === 0, "får ikke plass → mangler 2 200, aldri negativt");
  ok(r.values.every((v) => v >= 0), "ingen negative verdier");
  r = Calc.rebalanceProposal(items, 7000, { 0: 1000, 1: 1000, 2: 1000 });
  ok(r.total === 3000 && r.fits, "alt låst → summen er låste beløp");
  r = Calc.rebalanceProposal(items, 7000, { 0: 5000, 1: 1500, 2: 1500 });
  ok(!r.fits && r.missing === 1000, "alt låst og for mye → mangler 1 000");
  r = Calc.rebalanceProposal([{ avg: 0, currentPlan: 300 }, { avg: 0, currentPlan: 100 }], 1000, {});
  ok(r.values.join() === "300,100", "uten snitt: nåværende plan beholdes når det får plass" + r.values);
  r = Calc.rebalanceProposal([{ avg: 0, currentPlan: 300 }, { avg: 0, currentPlan: 100 }], 200, {});
  ok(r.values.join() === "100,0" || r.values.join() === "100,000", "uten snitt: skaleres etter nåværende plan" + r.values);
  r = Calc.rebalanceProposal(items, -500, {});
  ok(!r.fits && r.values[0] === 3200 && r.missing === 3700, "negativt tilgjengelig → gulv og mangler");
  ok(Calc.rebalanceProposal(items, 7000, { 1: 500 }).values.every((v) => v % 100 === 0), "rundet til 100");
}

// Starter budget (new user, no history)
{
  const s1 = Calc.starterBudget({ income: 35000, fixed: 15000 });
  ok(s1.mode === "starter" && /Startforslag/.test(s1.label), "startforslag merket");
  ok(s1.saving === 7000 && s1.savingDefaulted, "standard sparing 20 % av inntekt");
  ok(s1.fits && s1.items.find((i) => i.name === "Mat").suggested === 4500, "typiske beløp når det er plass");
  ok(s1.items.every((i) => i.tip && i.suggested % 100 === 0), "tips og hele hundre");
  ok(s1.bufferGoal === Calc.roundTo100(15000 + s1.sumSuggested) && s1.bufferMonths === Math.ceil(s1.bufferGoal / 7000), "buffermål ≈ 1 mnd utgifter");
  const s2 = Calc.starterBudget({ income: 25000, fixed: 18000, saving: 2000 });
  ok(!s2.fits && s2.sumSuggested <= s2.available, "trang økonomi → skaleres ned innenfor");
  ok(s2.items.find((i) => i.name === "Mat").suggested >= Math.floor(Calc.starterAmount(4500, 25000) * 0.8 / 100) * 100, "Mat-gulv i startforslag");
  const s3 = Calc.starterBudget({ income: 20000, fixed: 22000, saving: 0 });
  ok(s3.available < 0 && s3.missing > 0 && s3.items.every((i) => i.suggested >= 0), "faste > inntekt → mangler, aldri negativt");
  ok(Calc.starterBudget({ income: 80000, fixed: 20000 }).items.find((i) => i.name === "Mat").suggested === 7200, "skalering er begrenset (maks 1,6×)");
  // Blank new user through budgetProposal → starter mode, uses own categories
  const nu = Calc.wizardState ? Calc.wizardState({ people: [{ name: "Ny", salary: 30000 }], fixed: [{ name: "Husleie", amount: 9000, pct: 100 }], budgets: [{ name: "Mat", amount: 0 }, { name: "Transport", amount: 0 }, { name: "Gøy", amount: 0 }], planned: [], now: new Date(2026, 9, 30) }) : null;
  if (nu) {
    const key = Object.keys(nu.months).sort()[0];
    const before = JSON.stringify(nu);
    const r = Calc.budgetProposal(nu.months, key, nu.people[0].id, nu.people, nu.categories, { saving: 3000 });
    ok(r.mode === "starter" && r.historyKeys.length === 0, "ny bruker uten historikk → startforslag");
    ok(r.items.length === 3 && r.items.find((i) => i.name === "Mat").avg === Calc.starterAmount(4500, r.income), "egne kategorier får typiske startbeløp");
    ok(r.fits && r.sumSuggested <= r.available, "startforslag får plass");
    ok(JSON.stringify(nu) === before, "ny bruker: ingen endring uten klikk");
  } else ok(false, "wizardState mangler");
}

// Real data (optional, never committed)
const f = "/workspace/familie-budsjett-rettet-2026-10-28.json";
if (fs.existsSync(f)) {
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  const before = JSON.stringify(s);
  ["p1", "p2", "felles", "alle"].forEach((sc) => {
    Calc.planSuggestions(s.months, sc, s.people, s.categories, { today: new Date(2026, 10, 2) }).forEach((x) => {
      ok(x.months.every((m) => m.used > m.planned), "ekte data: alle måneder over plan " + x.name);
      ok(x.suggested % 100 === 0 && x.increase > 0, "ekte data: rundet og økning " + x.name);
    });
  });
  const r = Calc.budgetProposal(s.months, "2026-12", "p1", s.people, s.categories, { saving: 3000, income: 35500 });
  near(r.available, r.income - r.fixed - r.fellesVariable - r.saving, "ekte data: tilgjengelig");
  ok(r.sumSuggested <= Math.max(r.available, r.sumAvg) + 100, "ekte data: forslag innenfor");
  ok(JSON.stringify(s) === before, "ekte data uendret");
}
console.log(`\nInsights: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
