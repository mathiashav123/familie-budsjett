/**
 * Automated calc tests for Familiebudsjett
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");

let passed = 0;
let failed = 0;
const errors = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ✓", msg);
  } else {
    failed++;
    errors.push(msg);
    console.log("  ✗", msg);
  }
}

function assertEq(actual, expected, msg) {
  const ok = Object.is(actual, expected) || (typeof actual === "number" && typeof expected === "number" && Math.abs(actual - expected) < 1e-9);
  assert(ok, `${msg} (got ${actual}, expected ${expected})`);
}

function assertNotNaN(n, msg) {
  assert(typeof n === "number" && !Number.isNaN(n), `${msg} is not NaN (got ${n})`);
}

console.log("\n=== Familiebudsjett calc tests ===\n");

// --- Migration ---
console.log("1. Migration from legacy a/b");
{
  const legacy = {
    version: 1,
    names: { a: "Mathias", b: "Andrea" },
    view: { year: 2026, month: 8 },
    categories: [{ id: "c1", name: "Mat", type: "variabel", owner: "a", autoFill: false }],
    months: {
      "2026-09": {
        plannedIncome: {
          a: { lønn: 30000, ekstra: null },
          b: { lønn: 28000, ekstra: 500 }
        },
        budgets: { c1: 4000 },
        incomes: [{ id: "i1", person: "a", type: "lønn", amount: 30000 }],
        savings: [{ id: "s1", person: "b", amount: 1000 }],
        expenses: [
          { id: "e1", owner: "a", categoryId: "c1", amount: 200 },
          { id: "e2", owner: "felles", categoryId: "c1", amount: 800 }
        ]
      }
    },
    settings: {}
  };
  const s = Calc.migrateState(legacy);
  assert(s.version === 2, "version bumped to 2");
  assert(s.people.length === 2, "two people");
  assertEq(s.people[0].id, "p1", "a → p1");
  assertEq(s.people[1].id, "p2", "b → p2");
  assertEq(s.people[0].name, "Mathias", "Mathias name");
  assertEq(s.people[1].name, "Andrea", "Andrea name");
  const m = s.months["2026-09"];
  assertEq(m.plannedIncome.p1.lønn, 30000, "planned p1 lønn migrated");
  assertEq(m.plannedIncome.p2.lønn, 28000, "planned p2 lønn migrated");
  assertEq(m.incomes[0].person, "p1", "income person migrated");
  assertEq(m.expenses[0].owner, "p1", "expense owner migrated");
  assertEq(s.categories[0].owner, "p1", "category owner migrated");
}

console.log("\n1b. Migrate legacy saldoBefore → balances on first person");
{
  const legacy = {
    version: 2,
    people: [
      { id: "p1", name: "Mathias", archived: false },
      { id: "p2", name: "Andrea", archived: false }
    ],
    view: { year: 2026, month: 8 },
    categories: [],
    months: {
      "2026-09": {
        saldoBefore: 15000,
        budgets: {},
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: []
      }
    },
    settings: {}
  };
  const s = Calc.migrateState(legacy);
  const m = s.months["2026-09"];
  assertEq(m.balances.p1.bruk, 15000, "old saldo → p1 bruk");
  assertEq(m.balances.p2.bruk, 0, "p2 bruk 0");
  assert(m.balances.p1.spare == null, "p1 spare null");
  assert(s.settings.pendingBalancesMigrationToast === true, "toast flag set");
  const c = Calc.calcFamily(m, s.people, []);
  assertEq(c.totalBruk, 15000, "totalBruk 15000");
  assertEq(c.totalSpare, 0, "totalSpare 0");
  assertEq(c.totalAlt, 15000, "totalAlt 15000");
  assertEq(c.forventet, 15000, "forventet uses bruk only");
}

// --- Empty start ---
console.log("\n2. Empty start — zeros, no NaN");
{
  const people = Calc.defaultPeople();
  const m = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthShape(m, people);
  const c = Calc.calcFamily(m, people, []);
  assertEq(c.planInn, 0, "empty planInn");
  assertEq(c.plannedTotal, 0, "empty plannedTotal");
  assertEq(c.samletInntekt, 0, "empty samletInntekt");
  assertEq(c.samletUtgifter, 0, "empty samletUtgifter");
  assertEq(c.netPlan, 0, "empty netPlan");
  assertEq(c.netActual, 0, "empty netActual");
  assert(c.forventet === null, "forventet null without saldo");
  assertNotNaN(c.planInn, "planInn");
  assertNotNaN(c.netActual, "netActual");
  const p1 = c.byPerson.p1;
  assertNotNaN(p1.tilOvers, "p1 tilOvers");
  assertEq(p1.tilOvers, 0, "p1 tilOvers zero");
  assertEq(p1.utgifter, 0, "p1 utgifter zero");
}

// --- Planned income sum ---
console.log("\n3. Two people planned lønn 30000 + 28000 → planInn 58000");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false },
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false }
  ];
  const m = {
    saldoBefore: null,
    budgets: { cMat: 5000, cLan: 12000 },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 28000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const c = Calc.calcFamily(m, people, cats);
  assertEq(c.planInn, 58000, "planInn = 58000");
  assertEq(c.plannedTotal, 17000, "category budgets sum = 17000");
  assertEq(c.netPlan, 41000, "netPlan = 58000 - 17000");
  assertEq(c.byPerson.p1.planInn, 30000, "p1 planInn");
  assertEq(c.byPerson.p2.planInn, 28000, "p2 planInn");
  // Felles budgets split equally: 17000/2 = 8500 each
  assertEq(c.byPerson.p1.planUt, 8500, "p1 planUt share of felles");
  assertEq(c.byPerson.p2.planUt, 8500, "p2 planUt share of felles");
}

// --- Expense ownership + felles split ---
console.log("\n4. Expense ownership + felles equal split");
{
  const people = Calc.defaultPeople();
  const cats = [{ id: "c1", name: "Mat", type: "variabel", owner: "felles", archived: false }];
  const m = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: { p1: { lønn: null, ekstra: null }, p2: { lønn: null, ekstra: null } },
    incomes: [
      { id: "i1", person: "p1", type: "lønn", amount: 30000 },
      { id: "i2", person: "p2", type: "lønn", amount: 28000 }
    ],
    savings: [{ id: "s1", person: "p1", amount: 2000 }],
    expenses: [
      { id: "e1", owner: "p1", categoryId: "c1", amount: 1000 },
      { id: "e2", owner: "p2", categoryId: "c1", amount: 500 },
      { id: "e3", owner: "felles", categoryId: "c1", amount: 2000 }
    ]
  };
  const c = Calc.calcFamily(m, people, cats);
  assertEq(c.samletInntekt, 58000, "actual inn 58000");
  assertEq(c.samletUtgifter, 3500, "actual ut 3500");
  // p1: own 1000 + felles/2 = 1000 → utgifter 2000
  assertEq(c.byPerson.p1.utgifter, 2000, "p1 ut = own + half felles");
  assertEq(c.byPerson.p1.ownExp, 1000, "p1 ownExp");
  assertEq(c.byPerson.p1.fellesShare, 1000, "p1 fellesShare");
  // p2: own 500 + 1000 = 1500
  assertEq(c.byPerson.p2.utgifter, 1500, "p2 ut = own + half felles");
  // til overs = inn - sparing - ut
  assertEq(c.byPerson.p1.tilOvers, 30000 - 2000 - 2000, "p1 tilOvers");
  assertEq(c.byPerson.p2.tilOvers, 28000 - 0 - 1500, "p2 tilOvers");
  // family: samletTilOvers = inn - sparing - ut (full felles, not double-counted)
  assertEq(c.samletTilOvers, 58000 - 2000 - 3500, "family til overs");
  assertEq(c.netActual, 58000 - 3500, "netActual = inn - ut (no sparing)");
}

// --- Three people felles split ---
console.log("\n5. Three people — felles / 3");
{
  const people = [
    { id: "p1", name: "Mathias", archived: false },
    { id: "p2", name: "Andrea", archived: false },
    { id: "p3", name: "Ola", archived: false }
  ];
  const m = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: [{ id: "e1", owner: "felles", amount: 3000 }]
  };
  Calc.ensureMonthShape(m, people);
  const c = Calc.calcFamily(m, people, []);
  assertEq(c.peopleCount, 3, "3 people");
  assertEq(c.byPerson.p1.utgifter, 1000, "felles/3");
  assertEq(c.byPerson.p2.utgifter, 1000, "felles/3");
  assertEq(c.byPerson.p3.utgifter, 1000, "felles/3");
}

// --- Archived person excluded from split ---
console.log("\n6. Archived person excluded from felles split");
{
  const people = [
    { id: "p1", name: "Mathias", archived: false },
    { id: "p2", name: "Andrea", archived: false },
    { id: "p3", name: "Ola", archived: true }
  ];
  const m = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: [{ id: "e1", owner: "felles", amount: 2000 }]
  };
  const c = Calc.calcFamily(m, people, []);
  assertEq(c.peopleCount, 2, "2 active");
  assertEq(c.byPerson.p1.utgifter, 1000, "split among 2");
  assert(!c.byPerson.p3, "archived not in byPerson");
}


// --- Carry-forward expected to empty next month ---
console.log("\n7. Carry-forward planned income/budgets to empty next month");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false, autoFill: false },
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false, autoFill: true }
  ];
  const months = {
    "2026-08": {
      saldoBefore: null,
      budgets: { cMat: 5000, cLan: 12000 },
      plannedIncome: {
        p1: { lønn: 30000, ekstra: 1000, sparing: 3000 },
        p2: { lønn: 28000, ekstra: null, sparing: 1500 }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  // Empty September — should get ALL budgets + planned income
  months["2026-09"] = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: []
  };
  const r1 = Calc.ensureMonthExpected(months, "2026-09", people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  assert(r1.copied === true, "empty Sep gets carry-forward");
  assertEq(r1.sourceKey, "2026-08", "source is Aug");
  assertEq(r1.mode, "all", "mode all");
  assertEq(Calc.budgetFor(months["2026-09"], "cMat"), 5000, "Mat budget carried (not only autoFill)");
  assertEq(Calc.budgetFor(months["2026-09"], "cLan"), 12000, "Lån budget carried");
  assertEq(Calc.budgetForOwner(months["2026-09"], "cMat", "felles"), 5000, "legacy scalar carried as felles");
  assertEq(months["2026-09"].plannedIncome.p1.lønn, 30000, "p1 lønn carried");
  assertEq(months["2026-09"].plannedIncome.p1.ekstra, 1000, "p1 ekstra carried");
  assertEq(months["2026-09"].plannedIncome.p1.sparing, 3000, "p1 sparing carried");
  assertEq(months["2026-09"].plannedIncome.p2.lønn, 28000, "p2 lønn carried");
  assertEq(months["2026-09"].plannedIncome.p2.sparing, 1500, "p2 sparing carried");

  // Customized October must NOT be overwritten
  months["2026-10"] = {
    saldoBefore: null,
    budgets: { cMat: 999 },
    plannedIncome: {
      p1: { lønn: 11111, ekstra: null },
      p2: { lønn: null, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const r2 = Calc.ensureMonthExpected(months, "2026-10", people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  assert(r2.copied === false, "customized Oct not overwritten");
  assertEq(Calc.budgetFor(months["2026-10"], "cMat"), 999, "Oct Mat stays 999");
  assertEq(months["2026-10"].plannedIncome.p1.lønn, 11111, "Oct p1 lønn stays");
  assert(months["2026-10"].budgets.cLan == null, "Oct Lån not injected");

  // Nearest previous with expected (skip empty)
  months["2026-11"] = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: [{ id: "e1", owner: "felles", amount: 50 }]
  };
  const r3 = Calc.ensureMonthExpected(months, "2026-11", people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  assert(r3.copied === true, "Nov copies from nearest (Oct)");
  assertEq(r3.sourceKey, "2026-10", "Nov source is Oct not Aug");
  assertEq(Calc.budgetFor(months["2026-11"], "cMat"), 999, "Nov got Oct Mat");
  assertEq(months["2026-11"].plannedIncome.p1.lønn, 11111, "Nov got Oct lønn");

  // Setting OFF → only autoFill categories (+ planned income)
  months["2026-12"] = {
    saldoBefore: null,
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: []
  };
  const r4 = Calc.ensureMonthExpected(months, "2026-12", people, {
    copyExpectedToNewMonths: false,
    categories: cats
  });
  assert(r4.copied === true, "setting OFF still copies autofill+income");
  assertEq(r4.mode, "autofill", "mode autofill when setting off");
  // Nov only has cMat (not autoFill) → Dec must not get cMat
  assert(months["2026-12"].budgets.cMat == null, "non-autoFill Mat not copied when OFF");
  assertEq(months["2026-12"].plannedIncome.p1.lønn, 11111, "planned income still copied when OFF");

  assert(Calc.monthHasExpected(months["2026-08"]) === true, "Aug has expected");
  assert(Calc.monthHasExpected({ budgets: {}, plannedIncome: {} }) === false, "empty has no expected");
}


// --- Trygg å bruke (safeToSpend) ---
console.log("\n8. safeToSpend = planInn − actualExpenses − remainingFast");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cStr", name: "Strøm", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const m = {
    saldoBefore: null,
    budgets: { cLan: 10000, cStr: 2000, cMat: 5000 },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: [
      { id: "e1", owner: "felles", categoryId: "cLan", amount: 10000 }, // fast fully spent
      { id: "e2", owner: "felles", categoryId: "cStr", amount: 500 },   // fast 1500 remain
      { id: "e3", owner: "felles", categoryId: "cMat", amount: 3000 }   // variabel — not in remainingFast
    ]
  };
  const c = Calc.calcFamily(m, people, cats);
  assertEq(c.planInn, 50000, "planInn 50000");
  assertEq(c.samletUtgifter, 13500, "actual expenses 13500");
  // remainingFast = max(0,10000-10000)+max(0,2000-500) = 0+1500 = 1500
  assertEq(c.remainingFastBudgets, 1500, "remainingFast 1500");
  // safe = max(0, 50000 - 13500 - 1500) = 35000
  assertEq(c.safeToSpend, 35000, "safeToSpend 35000");
  assertEq(c.safeToSpendRaw, 35000, "safeToSpendRaw 35000");

  // Overspending so raw negative → clamped to 0
  m.expenses.push({ id: "e4", owner: "felles", categoryId: "cMat", amount: 40000 });
  const c2 = Calc.calcFamily(m, people, cats);
  assert(c2.safeToSpendRaw < 0, "raw negative when overspent");
  assertEq(c2.safeToSpend, 0, "safeToSpend clamped to 0");
}


// --- Per-person balances + totals ---
console.log("\n9. Per-person balances totals + forventet uses bruk only");
{
  const people = Calc.defaultPeople();
  const m = {
    balances: {
      p1: { bruk: 10000, spare: 5000 },
      p2: { bruk: 3000, spare: 2000 }
    },
    budgets: {},
    plannedIncome: {
      p1: { lønn: 1000, ekstra: null },
      p2: { lønn: null, ekstra: null }
    },
    incomes: [{ id: "i1", person: "p1", type: "lønn", amount: 1000 }],
    savings: [{ id: "s1", person: "p1", amount: 200 }],
    expenses: [{ id: "e1", owner: "felles", amount: 100 }]
  };
  const c = Calc.calcFamily(m, people, []);
  assertEq(c.totalBruk, 13000, "totalBruk 13000");
  assertEq(c.totalSpare, 7000, "totalSpare 7000");
  assertEq(c.totalAlt, 20000, "totalAlt 20000");
  assertEq(c.balanceByPerson.p1.sum, 15000, "p1 sum");
  assertEq(c.balanceByPerson.p2.sum, 5000, "p2 sum");
  // til overs = 1000 - 200 - 100 = 700; forventet = bruk 13000 + 700
  assertEq(c.samletTilOvers, 700, "til overs 700");
  assertEq(c.forventet, 13700, "forventet = bruk + til overs (not spare)");
}

// --- safeToSpend: spare ignored; bruk used when saldo-mode ON ---
console.log("\n10. safeToSpend uses bruk (not spare); spare ignored");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const base = {
    balances: {
      p1: { bruk: 50000, spare: 100000 },
      p2: { bruk: 20000, spare: 80000 }
    },
    budgets: { cLan: 10000, cMat: 5000 },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: [
      { id: "e1", owner: "felles", categoryId: "cLan", amount: 4000 },
      { id: "e2", owner: "felles", categoryId: "cMat", amount: 1000 }
    ]
  };
  // remainingFast=6000; remainingAll=6000+4000=10000
  // saldo safe = 70000 - 10000 - 0 = 60000
  // plan safe = 50000 - 5000 - 6000 = 39000
  const cHighSpare = Calc.calcFamily(base, people, cats);
  const noSpare = JSON.parse(JSON.stringify(base));
  noSpare.balances.p1.spare = null;
  noSpare.balances.p2.spare = 0;
  const cNoSpare = Calc.calcFamily(noSpare, people, cats);
  assertEq(cHighSpare.remainingFastBudgets, 6000, "remainingFast 6000");
  assertEq(cHighSpare.remainingBudgetAll, 10000, "remainingBudgetAll 10000");
  assertEq(cHighSpare.safeToSpendMode, "saldo", "mode saldo when bruk set");
  assertEq(cHighSpare.safeToSpend, 60000, "safeToSpend from saldo");
  assertEq(cHighSpare.safeToSpendPlan, 39000, "plan formula still available");
  assertEq(cNoSpare.safeToSpend, 60000, "spare does not affect safeToSpend");
  assertEq(cHighSpare.safeToSpend, cNoSpare.safeToSpend, "spare ignored");
  const moreBruk = JSON.parse(JSON.stringify(base));
  moreBruk.balances.p1.bruk = 1;
  const cBruk = Calc.calcFamily(moreBruk, people, cats);
  // totalBruk = 1+20000=20001; safe = 20001-10000 = 10001
  assertEq(cBruk.safeToSpend, 10001, "bruk balance affects saldo safeToSpend");
  // Toggle OFF → plan formula
  const cOff = Calc.calcFamily(base, people, cats, { useSaldoInSafeToSpend: false });
  assertEq(cOff.safeToSpendMode, "plan", "mode plan when toggle off");
  assertEq(cOff.safeToSpend, 39000, "plan safe when toggle off");
}

// --- Carry-forward copies balances ---
console.log("\n11. Carry-forward copies balances when target empty");
{
  const people = Calc.defaultPeople();
  const months = {
    "2026-08": {
      balances: {
        p1: { bruk: 8000, spare: 1000 },
        p2: { bruk: 4000, spare: 500 }
      },
      budgets: { c1: 1000 },
      plannedIncome: {
        p1: { lønn: 30000, ekstra: null },
        p2: { lønn: 28000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    },
    "2026-09": {
      balances: {},
      budgets: {},
      plannedIncome: {},
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  const r = Calc.ensureMonthExpected(months, "2026-09", people, {
    copyExpectedToNewMonths: true,
    categories: [{ id: "c1", name: "Mat", type: "variabel", owner: "felles", archived: false, autoFill: true }]
  });
  assert(r.copied === true, "copied expected+balances");
  assertEq(months["2026-09"].balances.p1.bruk, 8000, "p1 bruk carried");
  assertEq(months["2026-09"].balances.p2.spare, 500, "p2 spare carried");
  assertEq(months["2026-09"].plannedIncome.p1.lønn, 30000, "planned income carried");

  // Do not overwrite existing balances
  months["2026-10"] = {
    balances: { p1: { bruk: 1, spare: null }, p2: { bruk: null, spare: null } },
    budgets: {},
    plannedIncome: {},
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthExpected(months, "2026-10", people, {
    copyExpectedToNewMonths: true,
    categories: [{ id: "c1", name: "Mat", type: "variabel", owner: "felles", archived: false, autoFill: true }]
  });
  assertEq(months["2026-10"].balances.p1.bruk, 1, "existing balances kept");
}


// --- Excel fill: Felles household + personal variable lines ---
console.log("\n12. Excel fill — Felles + personal planInn / planUt / til overs");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cFelleskost", name: "Felleskost", type: "fast", owner: "felles", archived: false },
    { id: "cForsikring", name: "Forsikring", type: "fast", owner: "felles", archived: false },
    { id: "cStrom", name: "Strøm", type: "fast", owner: "felles", archived: false },
    { id: "cNett", name: "Internett", type: "fast", owner: "felles", archived: false },
    { id: "cMobil", name: "Mobil", type: "fast", owner: "p1", archived: false },
    { id: "cBil", name: "Bil", type: "variabel", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false },
    { id: "cHygiene", name: "Hygiene", type: "variabel", owner: "felles", archived: false },
    { id: "cKlar", name: "Klær", type: "variabel", owner: "felles", archived: false },
    { id: "cAbo", name: "Abonnement", type: "variabel", owner: "felles", archived: false },
    { id: "cRest", name: "Restaurant", type: "variabel", owner: "felles", archived: false },
    { id: "cGoy", name: "Gøy", type: "variabel", owner: "felles", archived: false },
    { id: "cSpill", name: "Spill", type: "variabel", owner: "felles", archived: false },
    { id: "cTipp", name: "Tipping", type: "variabel", owner: "felles", archived: false },
    { id: "cFond", name: "Fond", type: "variabel", owner: "felles", archived: false },
    { id: "cHund", name: "Hund", type: "variabel", owner: "felles", archived: false },
    { id: "cFelles", name: "Felles", type: "variabel", owner: "felles", archived: false },
    { id: "cFerie", name: "Ferie", type: "variabel", owner: "felles", archived: false },
    { id: "cBaby", name: "Baby", type: "variabel", owner: "felles", archived: false }
  ];
  // Felles = summed Excel household rows; personal = variable lines (+ Mobil on Mathias)
  const mPersonal = 2500 + 250 + 250 + 1500 + 500 + 500 + 1000 + 200 + 500 + 1319 + 498; // 9017
  const aPersonal = 2500 + 500 + 800 + 500 + 500 + 500 + 200 + 1000 + 2319; // 8819
  const fellesPlan = 23440 + 1900 + 869 + 732; // 26941
  const m = {
    balances: {},
    budgets: {
      cLan: { felles: 23440 },
      cForsikring: { felles: 732 },
      cStrom: { felles: 1900 },
      cNett: { felles: 869 },
      cMobil: { p1: 498 },
      cMat: { p1: 2500, p2: 2500 },
      cHygiene: { p1: 250, p2: 500 },
      cKlar: { p1: 250, p2: 800 },
      cAbo: { p1: 1500, p2: 500 },
      cRest: { p1: 500, p2: 500 },
      cGoy: { p1: 500, p2: 500 },
      cSpill: { p1: 1000 },
      cTipp: { p1: 200, p2: 200 },
      cFond: { p1: 500 },
      cHund: { p1: 1319, p2: 1000 },
      cBaby: { p2: 2319 }
    },
    plannedIncome: {
      p1: { lønn: 42500, ekstra: 2400 },
      p2: { lønn: 30000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthShape(m, people);
  const c = Calc.calcFamily(m, people, cats);

  const mPlanUt = mPersonal + fellesPlan / 2; // 22487.5
  const aPlanUt = aPersonal + fellesPlan / 2; // 22289.5

  console.log("   Excel Felles+personal report:");
  console.log("   Mathias personal=", mPersonal, " planUt=", c.byPerson.p1.planUt, " til overs=", c.byPerson.p1.netPlan);
  console.log("   Andrea  personal=", aPersonal, " planUt=", c.byPerson.p2.planUt, " til overs=", c.byPerson.p2.netPlan);
  console.log("   Felles   planUt=", c.planUtFelles);
  console.log("   Samlet   planInn=", c.planInn, " planUt=", c.plannedTotal, " til overs=", c.netPlan);

  assertEq(c.byPerson.p1.planInn, 44900, "Mathias planInn");
  assertEq(mPersonal, 9017, "Mathias personal sum");
  assertEq(aPersonal, 8819, "Andrea personal sum");
  assertEq(c.planUtFelles, fellesPlan, "Felles planUt = 26941");
  assertEq(c.byPerson.p1.planUt, mPlanUt, "Mathias planUt = personal + half Felles");
  assertEq(c.byPerson.p1.netPlan, 44900 - mPlanUt, "Mathias til overs plan");
  assertEq(c.byPerson.p2.planInn, 30000, "Andrea planInn");
  assertEq(c.byPerson.p2.planUt, aPlanUt, "Andrea planUt = personal + half Felles");
  assertEq(c.byPerson.p2.netPlan, 30000 - aPlanUt, "Andrea til overs plan");
  assertEq(c.planInn, 74900, "Samlet planInn = 74900");
  assertEq(c.plannedTotal, fellesPlan + mPersonal + aPersonal, "Samlet planUt = felles + personals");
  assertEq(c.plannedTotal, 44777, "Samlet planUt = 44777");
  assertEq(c.netPlan, 30123, "Samlet til overs = 30123");
  assertEq(Calc.budgetForOwner(m, "cLan", "felles"), 23440, "Lån under Felles 23440");
  assertEq(Calc.budgetForOwner(m, "cLan", "p1"), 0, "Lån not on Mathias");
  assertEq(Calc.budgetForOwner(m, "cLan", "p2"), 0, "Lån not on Andrea");
  assertEq(Calc.budgetForOwner(m, "cStrom", "felles"), 1900, "Strøm Felles 1900");
  assertEq(Calc.budgetForOwner(m, "cNett", "felles"), 869, "Internett Felles 869");
  assertEq(Calc.budgetForOwner(m, "cForsikring", "felles"), 732, "Forsikring Felles 732");
  assertEq(Calc.budgetForOwner(m, "cMobil", "p1"), 498, "Mobil under Mathias");
  assertEq(Calc.budgetFor(m, "cLan"), 23440, "Lån household 23440");
  assertEq((m.expenses || []).length, 0, "no fake expenses");
  assertEq((m.incomes || []).length, 0, "no fake incomes");
  assert(c.saldo === null || c.saldo === 0, "no invented saldo");
}

// --- Legacy scalar budget → felles ---
console.log("\n13. Legacy scalar budget counts as felles (split for planUt)");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const m = {
    budgets: { cMat: 5000 },
    plannedIncome: { p1: { lønn: 10000, ekstra: null }, p2: { lønn: 10000, ekstra: null } },
    incomes: [], savings: [], expenses: []
  };
  const c = Calc.calcFamily(m, people, cats);
  assertEq(Calc.budgetForOwner(m, "cMat", "felles"), 5000, "legacy → felles");
  assertEq(Calc.budgetForOwner(m, "cMat", "p1"), 0, "legacy not on p1");
  assertEq(c.byPerson.p1.planUt, 2500, "p1 gets half of felles budget");
  assertEq(c.plannedTotal, 5000, "household plannedTotal");
}


// --- Default / migrate: no auto-seeded categories ---
console.log("\n14. Default seed is empty (no auto categories)");
{
  const empty = Calc.migrateState(null);
  assert(Array.isArray(empty.categories), "categories is array");
  assertEq(empty.categories.length, 0, "fresh migrateState → 0 categories");
  const emptyObj = Calc.migrateState({});
  assertEq(emptyObj.categories.length, 0, "migrateState({}) → 0 categories");
  const withCats = Calc.migrateState({
    categories: [
      { id: "c1", name: "Mat", type: "variabel", owner: "felles", order: 3 },
      { id: "c2", name: "Lån", type: "fast", owner: "felles", order: 1 }
    ]
  });
  assertEq(withCats.categories.length, 2, "existing categories kept");
  assertEq(withCats.categories[0].order, 3, "order preserved on first");
  assertEq(withCats.categories[1].order, 1, "order preserved on second");
}


// --- Custom felles % split 60/40 ---
console.log("\n15. Custom felles split 60/40 (plan + actual)");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false, split: { p1: 60, p2: 40 } },
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false, split: { p1: 60, p2: 40 } }
  ];
  const m = {
    saldoBefore: null,
    budgets: { cMat: { felles: 5000 }, cLan: { felles: 10000 } },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 28000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: [
      { id: "e1", owner: "felles", categoryId: "cMat", amount: 2000 },
      { id: "e2", owner: "felles", categoryId: "cLan", amount: 10000 }
    ]
  };
  const c = Calc.calcFamily(m, people, cats);
  // planUt: 15000 felles → p1 9000, p2 6000
  assertEq(c.byPerson.p1.planUt, 9000, "p1 planUt 60% of 15000");
  assertEq(c.byPerson.p2.planUt, 6000, "p2 planUt 40% of 15000");
  assertEq(c.byPerson.p1.planUt + c.byPerson.p2.planUt, 15000, "sum person planUt = full felles");
  assertEq(c.planUtFelles, 15000, "samlet felles unchanged");
  assertEq(c.plannedTotal, 15000, "samlet plannedTotal full once");
  // actual: 12000 → p1 7200, p2 4800
  assertEq(c.byPerson.p1.fellesShare, 7200, "p1 fellesShare 60%");
  assertEq(c.byPerson.p2.fellesShare, 4800, "p2 fellesShare 40%");
  assertEq(c.byPerson.p1.fellesShare + c.byPerson.p2.fellesShare, 12000, "sum shares = full felles actual");
  assertEq(Calc.fellesShare(cats[0], "p1", people, 5000), 3000, "fellesShare helper 60%");
  assertEq(Calc.fellesShare(cats[0], "p2", people, 5000), 2000, "fellesShare helper 40%");
}

// --- Default 50/50 still works; custom cleared when equal ---
console.log("\n16. Default 50/50 + setCategorySplit equal clears");
{
  const people = Calc.defaultPeople();
  const cat = { id: "c1", name: "Mat", type: "variabel", owner: "felles", archived: false };
  assertEq(Calc.fellesSharePercent(cat, "p1", people), 50, "default 50");
  assertEq(Calc.fellesSharePercent(cat, "p2", people), 50, "default 50 b");
  Calc.setCategorySplit(cat, { p1: 70, p2: 30 }, people);
  assertEq(cat.split.p1, 70, "custom stored");
  assertEq(Calc.fellesSharePercent(cat, "p1", people), 70, "custom 70");
  Calc.setCategorySplit(cat, { p1: 50, p2: 50 }, people);
  assert(!cat.split, "equal split not persisted");
  // 3rd person: default equal rebalances; custom kept with 0 for new
  const people3 = people.concat([{ id: "p3", name: "Ola", archived: false }]);
  const eq = Calc.equalSplit(people3);
  assertEq(eq.p1 + eq.p2 + eq.p3, 100, "equal sum 100");
  assertEq(Calc.fellesSharePercent(cat, "p1", people3), eq.p1, "3-way p1");
  assertEq(Calc.fellesSharePercent(cat, "p2", people3), eq.p2, "3-way p2");
  assertEq(Calc.fellesSharePercent(cat, "p3", people3), eq.p3, "3-way p3");
  const custom = { id: "c2", name: "Bil", type: "variabel", owner: "felles", archived: false, split: { p1: 60, p2: 40 } };
  Calc.ensureCategorySplits([custom], people3);
  assertEq(custom.split.p1, 60, "custom kept after 3rd person");
  assertEq(custom.split.p3, 0, "new person gets 0 on custom");
}


// --- Saldo safeToSpend + buffer + etterLonn ---
console.log("\n14. Saldo safeToSpend, buffer, etterLonn, fallback without bruk");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const m = {
    balances: {
      p1: { bruk: 10000, spare: 99999 },
      p2: { bruk: 5000, spare: null }
    },
    budgets: { cLan: 8000, cMat: 4000 },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: [
      { id: "e1", owner: "felles", categoryId: "cLan", amount: 2000 },
      { id: "e2", owner: "felles", categoryId: "cMat", amount: 1000 }
    ]
  };
  // remainingAll = max(0,8000-2000)+max(0,4000-1000) = 6000+3000 = 9000
  // totalBruk = 15000; buffer 3000 → safe = max(0,15000-9000-3000)=3000
  const c = Calc.calcFamily(m, people, cats, { spendBuffer: 3000 });
  assertEq(c.totalBruk, 15000, "totalBruk");
  assertEq(c.remainingBudgetAll, 9000, "remainingBudgetAll");
  assertEq(c.spendBuffer, 3000, "buffer applied");
  assertEq(c.safeToSpendMode, "saldo", "saldo mode");
  assertEq(c.safeToSpend, 3000, "safe with buffer");
  assertEq(c.safeToSpendRaw, 3000, "raw with buffer");
  // etterLonn = 15000 + 50000 - 12000 = 53000
  assertEq(c.planInn, 50000, "planInn");
  assertEq(c.plannedTotal, 12000, "planUt");
  assertEq(c.etterLonn, 53000, "etterLonn = bruk+planInn-planUt");
  // No bruk → plan fallback
  const emptyBal = JSON.parse(JSON.stringify(m));
  emptyBal.balances = { p1: { bruk: null, spare: 100 }, p2: { bruk: null, spare: null } };
  const cEmpty = Calc.calcFamily(emptyBal, people, cats, { spendBuffer: 3000 });
  assertEq(cEmpty.safeToSpendMode, "plan", "fallback plan without bruk");
  assert(cEmpty.etterLonn == null, "etterLonn null without bruk");
  // plan: planInn 50000 - actual 3000 - remainingFast 6000 = 41000
  assertEq(cEmpty.safeToSpend, 41000, "plan safe without bruk");
  assertEq(cEmpty.safeToSpendPlan, 41000, "plan mirror");
  // migrate settings defaults
  const migrated = Calc.migrateState({ version: 2, people, categories: [], months: {}, settings: {} });
  assert(migrated.settings.useSaldoInSafeToSpend === true, "useSaldo default ON");
  assertEq(migrated.settings.spendBuffer, 0, "buffer default 0");
}



// --- Per-person Trygg å bruke ---
console.log("\n15. Per-person safeToSpend (saldo + plan + felles % + equal buffer)");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false },
    { id: "cMatP1", name: "Mat Mathias", type: "variabel", owner: "p1", archived: false }
  ];
  // Custom felles split 60/40 on Lån; Mat equal (no split)
  cats[0].split = { p1: 60, p2: 40 };
  const m = {
    balances: {
      p1: { bruk: 20000, spare: 99999 },
      p2: { bruk: 10000, spare: 50000 }
    },
    budgets: {
      cLan: { felles: 10000 },
      cMat: { felles: 4000 },
      cMatP1: { p1: 2000 }
    },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: [
      { id: "e1", owner: "felles", categoryId: "cLan", amount: 4000 }, // rem felles fast 6000
      { id: "e2", owner: "felles", categoryId: "cMat", amount: 1000 }, // rem felles var 3000
      { id: "e3", owner: "p1", categoryId: "cMatP1", amount: 500 },   // rem own 1500
      { id: "e4", owner: "p1", categoryId: "cMat", amount: 200 }      // own spend on mat (not felles rem)
    ]
  };
  const c = Calc.calcFamily(m, people, cats, { spendBuffer: 2000 });
  // Household remAll uses category totals (all owners):
  //   Lån max(0,10000-4000)=6000
  //   Mat max(0,4000-(1000+200))=2800  (felles+p1 spend on Mat)
  //   MatP1 max(0,2000-500)=1500
  //   → 10300; totalBruk 30000; buffer 2000 → safe 17700
  assertEq(c.safeToSpendMode, "saldo", "household saldo");
  assertEq(c.remainingBudgetAll, 10300, "household remAll");
  assertEq(c.safeToSpend, 17700, "household safe");

  const m1 = c.byPerson.p1;
  const m2 = c.byPerson.p2;
  // p1 remAll: own MatP1 1500
  //   + Lån felles rem 6000 * 60% = 3600
  //   + Mat felles rem 3000 * 50% = 1500
  //   = 6600
  assertEq(Math.round(m1.remainingBudgetAll * 100) / 100, 6600, "p1 remAll");
  // p2 remAll: Lån 6000*40%=2400 + Mat 3000*50%=1500 = 3900
  assertEq(Math.round(m2.remainingBudgetAll * 100) / 100, 3900, "p2 remAll");
  // buffer share = 1000 each
  assertEq(m1.spendBufferShare, 1000, "p1 buffer share");
  assertEq(m2.spendBufferShare, 1000, "p2 buffer share");
  // p1 saldo: 20000 - 6600 - 1000 = 12400
  assertEq(m1.safeToSpendMode, "saldo", "p1 saldo mode");
  assertEq(Math.round(m1.safeToSpend * 100) / 100, 12400, "p1 safe saldo");
  // p2 saldo: 10000 - 3900 - 1000 = 5100
  assertEq(Math.round(m2.safeToSpend * 100) / 100, 5100, "p2 safe saldo");
  // Spare never counted — huge spare does not change
  assert(m1.safeToSpend < 50000, "spare not in p1 safe");

  // Plan mode (toggle off): planInn − utgifter − remainingFast
  const cPlan = Calc.calcFamily(m, people, cats, {
    useSaldoInSafeToSpend: false,
    spendBuffer: 2000
  });
  const p1p = cPlan.byPerson.p1;
  const p2p = cPlan.byPerson.p2;
  // p1 utgifter = ownExp (500+200) + fellesShare (4000*0.6 + 1000*0.5) = 700 + 2400 + 500 = 3600
  assertEq(Math.round(p1p.utgifter * 100) / 100, 3600, "p1 utgifter");
  // p1 remFast = Lån 6000 * 60% = 3600 (MatP1/Mat variabel)
  assertEq(Math.round(p1p.remainingFastBudgets * 100) / 100, 3600, "p1 remFast");
  // p1 plan safe = 30000 - 3600 - 3600 = 22800
  assertEq(p1p.safeToSpendMode, "plan", "p1 plan mode");
  assertEq(Math.round(p1p.safeToSpend * 100) / 100, 22800, "p1 plan safe");
  // p2 utgifter = 4000*0.4 + 1000*0.5 = 1600+500 = 2100
  assertEq(Math.round(p2p.utgifter * 100) / 100, 2100, "p2 utgifter");
  // p2 remFast = 6000*0.4 = 2400
  assertEq(Math.round(p2p.remainingFastBudgets * 100) / 100, 2400, "p2 remFast");
  // p2 plan = 20000 - 2100 - 2400 = 15500
  assertEq(Math.round(p2p.safeToSpend * 100) / 100, 15500, "p2 plan safe");
}


// --- Safe amount expression evaluator ---
console.log("\nN. Safe evalAmountExpression");
{
  assertEq(Calc.evalAmountExpression("199+49+12"), 260, "199+49+12");
  assertEq(Calc.evalAmountExpression("100+50"), 150, "100+50");
  assertEq(Calc.evalAmountExpression("10×5"), 50, "unicode multiply");
  assertEq(Calc.evalAmountExpression("100÷4"), 25, "unicode divide");
  assertEq(Calc.evalAmountExpression("10,5+1,5"), 12, "Norwegian commas");
  assertEq(Calc.evalAmountExpression("(100+50)×2"), 300, "parentheses");
  assertEq(Calc.evalAmountExpression("200−50"), 150, "unicode minus");
  assertEq(Calc.evalAmountExpression("-10+5"), -5, "unary minus");
  assert(Calc.evalAmountExpression("alert(1)") === null, "rejects JS");
  assert(Calc.evalAmountExpression("100+evil") === null, "rejects letters");
  assert(Calc.evalAmountExpression("") === null, "empty null");
  assert(Calc.evalAmountExpression("10/0") === null, "div by zero null");
  assert(Calc.looksLikeAmountExpression("100+50") === true, "looks like expr");
  assert(Calc.looksLikeAmountExpression("100") === false, "plain number not expr");
  assert(Calc.looksLikeAmountExpression("1,5") === false, "decimal not expr");
}


// --- Category underlinjer (budget lines) ---
console.log("\n17. Category underlinjer: old budget still works; lines drive planUt");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cSub", name: "Abonnement", type: "fast", owner: "felles", archived: false }
  ];
  const m = {
    balances: {},
    budgets: { cSub: { felles: 500 } },
    plannedIncome: { p1: { lønn: 10000, ekstra: null }, p2: { lønn: 10000, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthShape(m, people);
  assertEq(Calc.budgetForOwner(m, "cSub", "felles"), 500, "old single budget without lines");
  const c0 = Calc.calcFamily(m, people, cats, {});
  assertEq(c0.plannedTotal, 500, "planUt uses old budget number");

  Calc.setBudgetLines(m, "cSub", "felles", [
    { id: "l1", name: "Netflix", amount: 159 },
    { id: "l2", name: "Spotify", amount: 119 },
    { id: "l3", name: "Annet", amount: 222 }
  ]);
  assertEq(Calc.sumBudgetLines(Calc.getBudgetLines(m, "cSub", "felles")), 500, "sum lines 500");
  assertEq(Calc.budgetForOwner(m, "cSub", "felles"), 500, "budgetForOwner = sum lines");
  assertEq(m.budgets.cSub.felles, 500, "synced into budgets number");
  const c1 = Calc.calcFamily(m, people, cats, {});
  assertEq(c1.plannedTotal, 500, "planUt uses sum of lines");

  // Migration: month without budgetLines still loads
  const migrated = Calc.migrateState({
    version: 2,
    people,
    categories: cats,
    months: {
      "2026-01": {
        budgets: { cSub: { felles: 400 } },
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: []
      }
    },
    settings: {}
  });
  const mm = migrated.months["2026-01"];
  assert(mm.budgetLines && typeof mm.budgetLines === "object", "budgetLines shape added");
  assertEq(Calc.budgetForOwner(mm, "cSub", "felles"), 400, "legacy number unchanged after migrate");
  assertEq(Calc.getBudgetLines(mm, "cSub", "felles").length, 0, "no lines unless added");
}

console.log("\n18. Carry-forward copies underlinjer");
{
  const people = Calc.defaultPeople();
  const cats = [{ id: "cSub", name: "Abonnement", type: "fast", owner: "felles", archived: false }];
  const months = {};
  months["2026-01"] = {
    balances: {},
    budgets: {},
    budgetLines: {},
    plannedIncome: { p1: { lønn: 20000, ekstra: null }, p2: { lønn: 18000, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.setBudgetLines(months["2026-01"], "cSub", "felles", [
    { id: "a", name: "Netflix", amount: 159 },
    { id: "b", name: "Spotify", amount: 119 }
  ]);
  const res = Calc.ensureMonthExpected(months, "2026-02", people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  assert(res.copied, "copied to Feb");
  const feb = months["2026-02"];
  const lines = Calc.getBudgetLines(feb, "cSub", "felles");
  assertEq(lines.length, 2, "two lines carried");
  assertEq(Calc.sumBudgetLines(lines), 278, "carried sum");
  assertEq(Calc.budgetForOwner(feb, "cSub", "felles"), 278, "budget matches lines");
  // Excel-style: empty month without copy leaves lines empty
  months["2026-03"] = {
    balances: {},
    budgets: { cSub: { felles: 278 } },
    budgetLines: {},
    plannedIncome: { p1: { lønn: 1, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  assertEq(Calc.getBudgetLines(months["2026-03"], "cSub", "felles").length, 0, "lines start empty when not copied");
}


console.log("\n20. Yearly/quarterly underlinjer: spread, once, legacy, carry");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cSub", name: "Abonnement", type: "fast", owner: "felles", archived: false }
  ];
  // Yearly 1200 spread → 100/month
  const mSpread = {
    balances: {},
    budgets: {},
    budgetLines: {},
    plannedIncome: { p1: { lønn: 10000, ekstra: null }, p2: { lønn: 10000, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthShape(mSpread, people);
  Calc.setBudgetLines(mSpread, "cSub", "felles", [
    { id: "y1", name: "Adobe", amount: 1200, interval: "year", mode: "spread", month: 2 }
  ], 0);
  assertEq(Calc.budgetForOwner(mSpread, "cSub", "felles", 0), 100, "spread Jan = 100");
  assertEq(Calc.budgetForOwner(mSpread, "cSub", "felles", 5), 100, "spread Jun = 100");
  const cSpread = Calc.calcFamily(mSpread, people, cats, {}, 3);
  assertEq(cSpread.plannedTotal, 100, "planUt yearly spread 100");
  const stored = Calc.getBudgetLines(mSpread, "cSub", "felles")[0];
  assertEq(stored.month, 2, "Fordel still stores payment month");
  assertEq(stored.interval, "year", "interval year stored");

  // Yearly 1200 once in March → 1200 March, 0 else
  const mOnce = {
    balances: {},
    budgets: {},
    budgetLines: {},
    plannedIncome: { p1: { lønn: 10000, ekstra: null }, p2: { lønn: 10000, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.setBudgetLines(mOnce, "cSub", "felles", [
    { id: "y2", name: "Adobe", amount: 1200, interval: "year", mode: "once", month: 2 }
  ], 2);
  assertEq(Calc.budgetForOwner(mOnce, "cSub", "felles", 2), 1200, "once March = 1200");
  assertEq(Calc.budgetForOwner(mOnce, "cSub", "felles", 0), 0, "once Jan = 0");
  assertEq(Calc.budgetForOwner(mOnce, "cSub", "felles", 11), 0, "once Dec = 0");
  assertEq(Calc.calcFamily(mOnce, people, cats, {}, 2).plannedTotal, 1200, "planUt March 1200");
  assertEq(Calc.calcFamily(mOnce, people, cats, {}, 4).plannedTotal, 0, "planUt May 0");

  // Legacy line without interval = full amount every month
  Calc.setBudgetLines(mOnce, "cSub", "felles", [
    { id: "leg", name: "Spotify", amount: 119 }
  ], 0);
  assertEq(Calc.budgetForOwner(mOnce, "cSub", "felles", 0), 119, "legacy Jan");
  assertEq(Calc.budgetForOwner(mOnce, "cSub", "felles", 6), 119, "legacy Jul");
  const leg = Calc.getBudgetLines(mOnce, "cSub", "felles")[0];
  assert(!leg.interval, "legacy has no interval field");

  // Carry-forward keeps interval
  const months = {};
  months["2026-01"] = {
    balances: {},
    budgets: {},
    budgetLines: {},
    plannedIncome: { p1: { lønn: 20000, ekstra: null }, p2: { lønn: 18000, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.setBudgetLines(months["2026-01"], "cSub", "felles", [
    { id: "a", name: "Adobe", amount: 1200, interval: "year", mode: "once", month: 2 },
    { id: "b", name: "Spotify", amount: 119 }
  ], 0);
  const res = Calc.ensureMonthExpected(months, "2026-02", people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  assert(res.copied, "copied Feb with intervals");
  const febLines = Calc.getBudgetLines(months["2026-02"], "cSub", "felles");
  assertEq(febLines.length, 2, "two lines carried");
  const adobe = febLines.find((l) => l.name === "Adobe");
  assert(adobe && adobe.interval === "year", "carried interval");
  assertEq(adobe.mode, "once", "carried mode");
  assertEq(adobe.month, 2, "carried payment month");
  assertEq(Calc.budgetForOwner(months["2026-02"], "cSub", "felles", 1), 119, "Feb: only Spotify (Adobe once=March)");
  const res3 = Calc.ensureMonthExpected(months, "2026-03", people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  assert(res3.copied, "copied Mar");
  assertEq(
    Calc.budgetForOwner(months["2026-03"], "cSub", "felles", 2),
    1200 + 119,
    "March: Adobe full + Spotify"
  );
}

console.log("\n19. Year rollup sums months correctly");
{
  const people = Calc.defaultPeople();
  const cats = [{ id: "c1", name: "Mat", type: "variabel", owner: "felles", archived: false }];
  const months = {};
  for (let i = 0; i < 3; i++) {
    const key = "2026-" + String(i + 1).padStart(2, "0");
    months[key] = {
      balances: {},
      budgets: { c1: { felles: 1000 * (i + 1) } },
      plannedIncome: {
        p1: { lønn: 10000, ekstra: null },
        p2: { lønn: 5000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: [{ id: "e" + i, owner: "felles", categoryId: "c1", amount: 100 * (i + 1) }]
    };
  }
  const roll = Calc.yearRollup(months, 2026, people, cats, {});
  assertEq(roll.months.length, 12, "12 months");
  assertEq(roll.totals.planInn, 15000 * 3, "planInn only months with data (3*15000)");
  // empty months contribute 0 — so planInn = 45000
  assertEq(roll.totals.planUt, 1000 + 2000 + 3000, "planUt sum");
  assertEq(roll.totals.actualUt, 100 + 200 + 300, "actualUt sum");
  assertEq(roll.totals.tilOvers, roll.totals.planInn - roll.totals.planUt, "til overs = planInn - planUt");
  assertEq(roll.months[0].planUt, 1000, "jan planUt");
  assertEq(roll.months[1].actualUt, 200, "feb actual");
}


console.log("\n20. Sparing stats: Nå / denne måneden / i år / totalt");
{
  const people = Calc.defaultPeople();
  const months = {
    "2025-12": {
      balances: {
        p1: { bruk: 1000, spare: 5000 },
        p2: { bruk: 2000, spare: 3000 }
      },
      savings: [{ id: "sold", person: "p1", amount: 400, date: "2025-12-10" }]
    },
    "2026-01": {
      balances: {
        p1: { bruk: 1000, spare: 8000 },
        p2: { bruk: 2000, spare: 4500 }
      },
      savings: [
        { id: "s1", person: "p1", amount: 1000, date: "2026-01-05" },
        { id: "s2", person: "p2", amount: 500, date: "2026-01-12" }
      ]
    },
    "2026-02": {
      balances: {
        p1: { bruk: 900, spare: 9000 },
        p2: { bruk: 1800, spare: 5000 }
      },
      savings: [{ id: "s3", person: "p1", amount: 2000, date: "2026-02-01" }]
    }
  };
  // View February 2026
  const st = Calc.sparingStats(months, 2026, 1, people);
  assertEq(st.samlet.naa, 9000 + 5000, "samlet Nå = spare saldo feb");
  assertEq(st.samlet.denneManeden, 2000, "samlet denne måneden = feb deposits");
  assertEq(st.samlet.iAar, 1000 + 500 + 2000, "samlet i år = jan+feb (not 2025)");
  assertEq(st.samlet.totalt, 400 + 1000 + 500 + 2000, "samlet totalt = all months");
  assertEq(st.byPerson.p1.naa, 9000, "p1 Nå");
  assertEq(st.byPerson.p1.denneManeden, 2000, "p1 denne måneden");
  assertEq(st.byPerson.p1.iAar, 1000 + 2000, "p1 i år");
  assertEq(st.byPerson.p2.denneManeden, 0, "p2 denne måneden 0 in feb");
  assertEq(st.byPerson.p2.iAar, 500, "p2 i år");
  assertEq(Calc.sumSavingsForMonth(months["2026-01"], "p2"), 500, "sumSavingsForMonth p2 jan");
  assertEq(Calc.sumSavingsForMonth(months["2026-01"], "samlet"), 1500, "sumSavingsForMonth samlet jan");
  assert(st.samlet.hasNaa === true, "hasNaa true when spare set");
}

console.log("\n21. Sparing stats: empty / missing spare");
{
  const people = Calc.defaultPeople();
  const st = Calc.sparingStats({}, 2026, 8, people);
  assertEq(st.samlet.naa, 0, "empty naa 0");
  assert(st.samlet.hasNaa === false, "hasNaa false when unset");
  assertEq(st.samlet.denneManeden, 0, "empty denne 0");
  assertEq(st.samlet.iAar, 0, "empty iAar 0");
  assertEq(st.samlet.totalt, 0, "empty totalt 0");
}

console.log("\n22. Sparemål ETA / progress / migrate");
{
  const people = Calc.defaultPeople();
  const g = Calc.normalizeSavingsGoal(
    { name: "Buffer", target: 12000, monthly: 2000, saved: 0, person: "p1" },
    people
  );
  assertEq(g.name, "Buffer", "goal name");
  assertEq(g.person, "p1", "goal person");
  const prog = Calc.savingsGoalProgress(g);
  assertEq(prog.remaining, 12000, "remaining full");
  assertEq(prog.pct, 0, "pct 0");
  assert(prog.reached === false, "not reached");

  const from = new Date(2026, 8, 6); // Sep 2026
  const eta = Calc.savingsGoalEta(g, from);
  assertEq(eta.status, "eta", "eta status");
  assertEq(eta.monthsNeeded, 6, "6 months needed");
  assertEq(eta.month, 2, "ETA March (month index 2)"); // Sep+6 = Mar
  assertEq(eta.year, 2027, "ETA year 2027");
  assert(eta.label.indexOf("mar 2027") >= 0, "label ca. mar 2027: " + eta.label);

  const reached = Calc.savingsGoalEta({ target: 5000, monthly: 1000, saved: 5000 }, from);
  assertEq(reached.status, "reached", "reached status");
  assertEq(reached.label, "nådd", "nådd label");

  const need = Calc.savingsGoalEta({ target: 5000, monthly: 0, saved: 100 }, from);
  assertEq(need.status, "need_monthly", "need monthly");
  assert(need.label.indexOf("månedlig") >= 0, "need monthly label");

  const half = Calc.savingsGoalProgress({ target: 10000, saved: 2500 });
  assertEq(half.pct, 25, "25% progress");

  const migrated = Calc.migrateState({
    people,
    savingsGoals: [{ name: "Ferie", target: "8000", monthly: "1000", saved: "2000", person: "p2" }],
    months: {},
    settings: {}
  });
  assert(Array.isArray(migrated.savingsGoals), "migrated goals array");
  assertEq(migrated.savingsGoals.length, 1, "one goal migrated");
  assertEq(migrated.savingsGoals[0].target, 8000, "target number");
  assertEq(migrated.savingsGoals[0].saved, 2000, "saved number");
  assertEq(migrated.savingsGoals[0].person, "p2", "person kept");

  const emptyMig = Calc.migrateState({ people, months: {}, settings: {} });
  assertEq(emptyMig.savingsGoals.length, 0, "missing goals → []");
}


// --- Planlagt sparing (Plan → Sparing standing monthly plan) ---
console.log("\n16. Planlagt sparing per måned (plannedIncome.sparing)");
{
  const people = Calc.defaultPeople();
  const m = {
    budgets: {},
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null, sparing: 3000 },
      p2: { lønn: 28000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthShape(m, people);
  assertEq(m.plannedIncome.p1.sparing, 3000, "p1 sparing kept");
  assertEq(m.plannedIncome.p2.sparing, null, "p2 sparing default null");
  assert("sparing" in m.plannedIncome.p2, "sparing key additive on shape");
  assertEq(Calc.plannedSparingFor(m, "p1"), 3000, "plannedSparingFor p1");
  assertEq(Calc.plannedSparingFor(m, "p2"), 0, "plannedSparingFor missing → 0");
  assertEq(Calc.plannedSparingTotal(m, people), 3000, "plannedSparingTotal");

  // Not counted as income
  const c = Calc.calcFamily(m, people, []);
  assertEq(c.byPerson.p1.planInn, 30000, "planInn ignores sparing");

  const stats = Calc.sparingStats({ "2026-09": m }, 2026, 8, people);
  assertEq(stats.byPerson.p1.planlagt, 3000, "stats planlagt p1");
  assertEq(stats.byPerson.p2.planlagt, 0, "stats planlagt p2");
  assertEq(stats.samlet.planlagt, 3000, "stats samlet planlagt");

  // Additive: old month without sparing key still works
  const legacy = {
    budgets: {},
    plannedIncome: { p1: { lønn: 10000, ekstra: 0 }, p2: { lønn: 9000, ekstra: null } },
    incomes: [],
    savings: [],
    expenses: []
  };
  Calc.ensureMonthShape(legacy, people);
  assertEq(legacy.plannedIncome.p1.sparing, null, "legacy gains sparing:null");
  assertEq(Calc.plannedSparingTotal(legacy, people), 0, "legacy total 0");
}


console.log("\n24. Årsarkiv / sparemål-status / koblede innskudd / flerår");
{
  const people = Calc.defaultPeople();
  const cats = [];
  const months = {};
  for (let m = 0; m < 12; m++) {
    const k = "2021-" + String(m + 1).padStart(2, "0");
    months[k] = {
      balances: {},
      budgets: {},
      budgetLines: {},
      plannedIncome: { p1: { lønn: 20000, ekstra: null, sparing: 1000 } },
      incomes: [],
      savings: [
        {
          id: "s" + m,
          person: "p1",
          amount: 500,
          note: "",
          date: k + "-10",
          goalId: "goal1"
        }
      ],
      expenses: [
        {
          id: "e" + m,
          owner: "felles",
          categoryId: null,
          category: "Mat",
          amount: 100,
          note: "",
          date: k + "-05"
        }
      ]
    };
  }
  assert(Calc.yearHasMonthData(months, 2021), "2021 has data");
  const built = Calc.buildYearArchive(months, 2021, people, cats, {});
  assertEq(built.year, 2021, "archive year");
  assertEq(built.sparingYear, 6000, "archive sparing 12*500");
  assertEq(Object.keys(built.months).length, 12, "12 archived months");

  const archived = Calc.archiveYearInState(months, [], 2021, people, cats, {});
  assertEq(Object.keys(archived.months).length, 0, "hot months cleared");
  assertEq(archived.archives.length, 1, "one archive entry");
  const rollArch = Calc.yearRollup(archived.months, 2021, people, cats, {}, archived.archives);
  assertEq(rollArch.totals.savingsSum, 6000, "rollup from archive sparing");
  assertEq(rollArch.totals.actualUt, 1200, "rollup from archive actualUt");

  const restored = Calc.restoreYearFromArchive(archived.months, archived.archives, 2021);
  assert(restored, "restore ok");
  assertEq(Object.keys(restored.months).length, 12, "restored 12 months");
  assertEq(restored.archives.length, 0, "archive removed after restore");

  const sug = Calc.yearsSuggestedForArchive(
    { "2018-01": months["2021-01"], "2024-01": months["2021-01"] },
    [],
    2026,
    3
  );
  assert(sug.indexOf(2018) >= 0, "suggest 2018");
  assert(sug.indexOf(2024) < 0, "do not suggest 2024");

  let goal = Calc.normalizeSavingsGoal(
    { id: "goal1", name: "Buffer", target: 5000, monthly: 500, saved: 500, person: "samlet" },
    people
  );
  assertEq(goal.status, "aktiv", "default aktiv");
  const eff = Calc.effectiveGoalSaved(goal, months, []);
  assertEq(eff, 6500, "base 500 + linked 6000");
  const prog = Calc.savingsGoalProgress(goal, { months, archives: [] });
  assertEq(prog.linkedSaved, 6000, "linkedSaved");
  assert(prog.reached, "reached via deposits");
  goal = Calc.applyGoalAutoStatus(goal, months, []);
  assertEq(goal.status, "nådd", "auto nådd");

  const abandoned = Calc.normalizeSavingsGoal(
    { name: "PC", target: 10000, monthly: 100, saved: 2000, status: "forlatt", person: "p1" },
    people
  );
  assertEq(abandoned.status, "forlatt", "forlatt status");
  const etaA = Calc.savingsGoalEta(abandoned, new Date(2026, 0, 1));
  assertEq(etaA.status, "abandoned", "eta abandoned");

  const multi = Calc.multiYearSummaries(restored.months, [], people, cats, {}, [2021]);
  assertEq(multi.length, 1, "one year summary");
  assertEq(multi[0].savingsSum, 6000, "multi savings");

  const mig = Calc.migrateState({
    people,
    months: {
      "2022-03": {
        savings: [{ id: "x", person: "p1", amount: 10, goalId: "g9", date: "2022-03-01" }],
        expenses: [],
        incomes: []
      }
    },
    savingsGoals: [{ id: "g9", name: "X", target: 10, monthly: 1, saved: 0, status: "aktiv" }],
    archives: [built]
  });
  assertEq(mig.months["2022-03"].savings[0].goalId, "g9", "migrate goalId");
  assertEq(mig.archives.length, 1, "migrate archives");
  assertEq(mig.archives[0].year, 2021, "migrate archive year");
}


console.log("\n=== Results:", passed, "passed,", failed, "failed ===\n");
if (failed) {
  console.error("FAILURES:");
  errors.forEach((e) => console.error(" -", e));
  process.exit(1);
}
process.exit(0);
