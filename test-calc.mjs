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
  const planOpts = { useSaldoInSafeToSpend: false };
  const c = Calc.calcFamily(m, people, cats, planOpts);
  assertEq(c.planInn, 50000, "planInn 50000");
  assertEq(c.samletUtgifter, 13500, "actual expenses 13500");
  // Fast auto-spend: effectiveActual=max(plan,logged) → remFast=0; autoSpendExtra=1500 (Strøm)
  assertEq(c.remainingFastBudgets, 0, "remainingFast 0 with auto-spend");
  assertEq(c.autoSpendExtra, 1500, "autoSpendExtra 1500");
  assertEq(c.effectiveUtgifter, 15000, "effectiveUtgifter 15000");
  // safe = planInn − effectiveUtgifter − remFast = 50000 − 15000 − 0 = 35000
  assertEq(c.safeToSpendMode, "plan", "explicit plan mode");
  assertEq(c.safeToSpend, 35000, "safeToSpend 35000");
  assertEq(c.safeToSpendRaw, 35000, "safeToSpendRaw 35000");

  // Overspending so raw negative → shown as need-to-save (no Math.max 0)
  m.expenses.push({ id: "e4", owner: "felles", categoryId: "cMat", amount: 40000 });
  const c2 = Calc.calcFamily(m, people, cats, planOpts);
  assert(c2.safeToSpendRaw < 0, "raw negative when overspent");
  assertEq(c2.safeToSpend, c2.safeToSpendRaw, "safeToSpend allows negative (no clamp)");
  assert(c2.safeToSpend < 0, "primary Trygg negative when overspent");
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
  // Auto-spend still computed (category bars / cashflow), but saldo Trygg does NOT re-subtract it
  // remFast=0, autoSpendExtra=6000, remAll (variabel only)=4000
  // Primary nå: 70000 (NOT subtracting Fast auto — already in bank)
  // Conservative if-used: 70000 - 4000 = 66000
  // plan = 50000 - (5000+6000) - 0 = 39000 (still uses autoSpendExtra)
  const cHighSpare = Calc.calcFamily(base, people, cats);
  const noSpare = JSON.parse(JSON.stringify(base));
  noSpare.balances.p1.spare = null;
  noSpare.balances.p2.spare = 0;
  const cNoSpare = Calc.calcFamily(noSpare, people, cats);
  assertEq(cHighSpare.remainingFastBudgets, 0, "remainingFast 0 auto-spend");
  assertEq(cHighSpare.autoSpendExtra, 6000, "autoSpendExtra 6000");
  assertEq(cHighSpare.remainingBudgetAll, 4000, "remainingBudgetAll variabel only");
  assertEq(cHighSpare.remainingVariableBudgets, 4000, "remainingVariable 4000");
  assertEq(cHighSpare.safeToSpendMode, "saldo", "mode saldo when bruk set");
  assertEq(cHighSpare.safeToSpend, 70000, "safeToSpend nå from saldo (no Fast re-sub)");
  assertEq(cHighSpare.safeToSpendNow, 70000, "safeToSpendNow alias");
  assertEq(cHighSpare.safeToSpendIfBudgetUsed, 66000, "conservative if budget used");
  assertEq(cHighSpare.safeToSpendSaldo, 66000, "safeToSpendSaldo = if-used");
  assertEq(cHighSpare.safeToSpendPlan, 39000, "plan formula still available");
  assertEq(cNoSpare.safeToSpend, 70000, "spare does not affect safeToSpend");
  assertEq(cHighSpare.safeToSpend, cNoSpare.safeToSpend, "spare ignored");
  const moreBruk = JSON.parse(JSON.stringify(base));
  moreBruk.balances.p1.bruk = 1;
  const cBruk = Calc.calcFamily(moreBruk, people, cats);
  // totalBruk = 1+20000=20001; nå = 20001; if-used = 20001-4000 = 16001
  assertEq(cBruk.safeToSpend, 20001, "bruk balance affects nå safeToSpend");
  assertEq(cBruk.safeToSpendIfBudgetUsed, 16001, "bruk balance affects if-used");
  // Toggle OFF → plan formula
  const cOff = Calc.calcFamily(base, people, cats, { useSaldoInSafeToSpend: false });
  assertEq(cOff.safeToSpendMode, "plan", "mode plan when toggle off");
  assertEq(cOff.safeToSpend, 39000, "plan safe when toggle off");
}

// --- Carry-forward: budgets yes; balances only as suggested seed (not raw copyBalances) ---
console.log("\n11. Carry-forward budgets; balances via suggested seed (not raw copy)");
{
  const people = Calc.defaultPeople();
  const months = {
    "2026-08": {
      balances: {
        p1: { bruk: 8000, spare: 1000, when: "before_salary", asOf: null },
        p2: { bruk: 4000, spare: 500 }
      },
      balancesUpdatedAt: "2026-08-15T10:00:00.000Z",
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
  assert(r.copied === true, "copied expected budgets/income");
  assertEq(r.mode, "all", "mode all");
  assertEq(months["2026-09"].plannedIncome.p1.lønn, 30000, "planned income carried");
  assertEq(Calc.budgetFor(months["2026-09"], "c1"), 1000, "budget carried");
  // Rolling suggested seed from confirmed Aug (not silent raw copy / not confirmed)
  assert(r.suggestedBalances === true, "Sep got suggested balances");
  assertEq(months["2026-09"].balances.p1.bruk, 8000, "p1 suggested from Aug");
  assertEq(months["2026-09"].balances.p2.bruk, 4000, "p2 suggested from Aug");
  assert(months["2026-09"].balances.p1.suggested === true, "p1 suggested flag");
  assert(!months["2026-09"].balancesUpdatedAt, "Sep not auto-confirmed");
  assert(
    months["2026-09"].balances.p1.spare == null || months["2026-09"].balances.p1.spare === "",
    "p1 spare NOT carried"
  );
  assert(
    months["2026-09"].balances.p2.spare == null || months["2026-09"].balances.p2.spare === "",
    "p2 spare NOT carried"
  );
  // copyBalancesFrom remains explicit no-op (does not overwrite suggested)
  const sep = months["2026-09"];
  const beforeCopy = sep.balances.p1.bruk;
  Calc.copyBalancesFrom(months["2026-08"], sep, people);
  assertEq(sep.balances.p1.bruk, beforeCopy, "copyBalancesFrom is no-op");
  assert(
    sep.balances.p1.spare == null || sep.balances.p1.spare === "",
    "copyBalancesFrom still does not add spare"
  );

  // Existing non-suggested balances in a month are still left alone
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

// --- New month after confirmed before_salary: suggested rolling carry (not silent raw) ---
console.log("\n11b. New month after confirmed balance gets suggested rolling carry");
{
  const people = Calc.defaultPeople();
  const months = {
    "2026-10": {
      balances: {
        p1: { bruk: 50000, spare: 2000, when: "before_salary", asOf: null },
        p2: { bruk: 12000, spare: null, when: "before_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-10-20T08:00:00.000Z",
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 30000, ekstra: null },
        p2: { lønn: 28000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  const r = Calc.ensureMonthExpected(months, "2026-11", people, {
    copyExpectedToNewMonths: true,
    categories: [{ id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }]
  });
  assert(r.copied === true, "Nov gets budgets/income");
  assertEq(months["2026-11"].plannedIncome.p1.lønn, 30000, "Nov income carried");
  assert(r.suggestedBalances === true, "Nov suggested rolling carry");
  assertEq(months["2026-11"].balances.p1.bruk, 50000, "Nov p1 suggested 50k from Oct");
  assertEq(months["2026-11"].balances.p2.bruk, 12000, "Nov p2 suggested 12k");
  assert(months["2026-11"].balances.p1.suggested === true, "Nov suggested flag");
  assert(!months["2026-11"].balancesUpdatedAt, "Nov not auto-confirmed");
  assert(
    months["2026-11"].balances.p1.spare == null ||
      months["2026-11"].balances.p1.spare === "",
    "spare still not carried"
  );
}

// --- Soft cleanup: identical bruk without stamp cleared; stamped kept ---
console.log("\n11c. Soft cleanup clears accidental carry without balancesUpdatedAt");
{
  assert(typeof Calc.clearAccidentalBalanceCarry === "function", "helper exported");
  const months = {
    "2026-10": {
      balances: {
        p1: { bruk: 50000, spare: 1000 },
        p2: { bruk: 8000, spare: null }
      },
      balancesUpdatedAt: "2026-10-20T08:00:00.000Z"
    },
    "2026-11": {
      // Accidental carry: same bruk/spare, no stamp
      balances: {
        p1: { bruk: 50000, spare: 1000 },
        p2: { bruk: 8000, spare: null }
      }
    },
    "2026-12": {
      // Deliberately saved with same numbers — has stamp → keep
      balances: {
        p1: { bruk: 50000, spare: 1000 },
        p2: { bruk: 9000, spare: null }
      },
      balancesUpdatedAt: "2026-12-01T12:00:00.000Z"
    }
  };
  const n = Calc.clearAccidentalBalanceCarry(months);
  assert(n >= 2, "cleared at least accidental bruk fields");
  assert(
    months["2026-11"].balances.p1.bruk == null,
    "Nov accidental p1 bruk cleared"
  );
  assert(
    months["2026-11"].balances.p1.spare == null,
    "Nov accidental p1 spare cleared"
  );
  assert(
    months["2026-11"].balances.p2.bruk == null,
    "Nov accidental p2 bruk cleared"
  );
  assertEq(months["2026-12"].balances.p1.bruk, 50000, "Dec stamped kept");
  assertEq(months["2026-12"].balances.p2.bruk, 9000, "Dec different p2 kept");
  assertEq(months["2026-10"].balances.p1.bruk, 50000, "Oct source kept");

  // migrateState runs soft cleanup
  const migrated = Calc.migrateState({
    people: Calc.defaultPeople(),
    months: {
      "2026-10": {
        balances: { p1: { bruk: 111, spare: null }, p2: { bruk: null, spare: null } },
        balancesUpdatedAt: "2026-10-01T00:00:00.000Z"
      },
      "2026-11": {
        balances: { p1: { bruk: 111, spare: null }, p2: { bruk: null, spare: null } }
      }
    }
  });
  assert(
    migrated.months["2026-11"].balances.p1.bruk == null,
    "migrate soft-clears accidental Nov"
  );
  assertEq(
    migrated.months["2026-10"].balances.p1.bruk,
    111,
    "migrate keeps stamped Oct"
  );
}



// --- Suggested balances: prev confirmed − same-month planned (not raw copy) ---
console.log("\n11d. Suggested bruk seed = prev confirmed − plannedSpends (not raw copy)");
{
  const people = Calc.defaultPeople();
  const planned = [
    {
      id: "ps1",
      name: "Ny bil",
      amount: 160000,
      monthKey: "2026-10",
      categoryId: "cBil",
      owner: "felles",
      done: false
    }
  ];
  const months = {
    "2026-09": {
      balances: {
        p1: { bruk: 150000, spare: 5000, when: "after_salary", asOf: null },
        p2: { bruk: 81223, spare: 1000, when: "after_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-09-17T12:00:00.000Z",
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 25000, ekstra: null },
        p2: { lønn: 15000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  const r = Calc.ensureMonthExpected(months, "2026-10", people, {
    copyExpectedToNewMonths: true,
    categories: [{ id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }],
    plannedSpends: planned
  });
  assert(r.suggestedBalances === true, "October got suggested balances");
  assert(months["2026-10"].balancesSuggested === true, "month balancesSuggested");
  assert(!months["2026-10"].balancesUpdatedAt, "no confirm stamp yet");
  // felles 160k / 2 = 80k each
  assertEq(months["2026-10"].balances.p1.bruk, 70000, "p1 seed 150000-80000");
  assertEq(months["2026-10"].balances.p2.bruk, 1223, "p2 seed 81223-80000");
  assert(months["2026-10"].balances.p1.suggested === true, "p1 suggested");
  assert(months["2026-10"].balances.p2.suggested === true, "p2 suggested");
  assertEq(months["2026-10"].balances.p1.when, "after_salary", "marked after_salary");
  assert(
    months["2026-10"].balances.p1.spare == null ||
      months["2026-10"].balances.p1.spare === "",
    "spare not copied"
  );
  // Soft cleanup must NOT wipe suggested
  const cleared = Calc.clearAccidentalBalanceCarry(months);
  assertEq(months["2026-10"].balances.p1.bruk, 70000, "suggested survives soft cleanup");
  // Trygg: suggested excludes same-month planned from reserve
  const cOct = Calc.calcFamily(months["2026-10"], people, [], {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOct.safeToSpendMode, "saldo", "oct saldo with suggested");
  assert(cOct.hasSuggestedBalances === true, "hasSuggestedBalances");
  assertEq(cOct.futureReserve, 0, "same-month planned already in seed");
  assertEq(cOct.totalBruk, 71223, "total suggested bruk");
  assertEq(cOct.safeToSpend, 71223, "Trygg = seed (not 0)");
  // Confirm clears suggested; mark plans reflected so Trygg does not double-count
  const was1 = Calc.clearSuggestedBalanceFlag(months["2026-10"], "p1");
  assert(was1 === true, "p1 was seeded");
  assert(months["2026-10"].balances.p1.suggested === false, "p1 cleared");
  assert(months["2026-10"].balances.p1.suggestedAfterPlans === false, "p1 afterPlans cleared");
  assert(months["2026-10"].balances.p2.suggested === true, "p2 still suggested");
  Calc.markPlannedSpendsReflectedInBalance(planned, "2026-10");
  assert(planned[0].reflectedInBalance === true, "plan marked reflected");
  const cOctAfterP1 = Calc.calcFamily(months["2026-10"], people, [], {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOctAfterP1.futureReserve, 0, "after p1 confirm: still no double (p2 suggested or reflected)");
  const was2 = Calc.clearSuggestedBalanceFlag(months["2026-10"], "p2");
  assert(was2 === true, "p2 was seeded");
  assert(!months["2026-10"].balancesSuggested, "month flag cleared");
  const cOctConfirmed = Calc.calcFamily(months["2026-10"], people, [], {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOctConfirmed.futureReserve, 0, "after both confirm: reflected blocks reserve");
  assertEq(cOctConfirmed.safeToSpend, 71223, "Trygg stays 71223 after Bekreft");
  assertEq(cOctConfirmed.totalBruk, 71223, "bruk unchanged after Bekreft");

  // Rolling carry: confirmed prev WITHOUT planned in next month → seed = prev bruk
  const months2 = {
    "2026-10": {
      balances: {
        p1: { bruk: 50000, spare: 0, when: "before_salary", asOf: null },
        p2: { bruk: 12000, spare: null, when: "before_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-10-20T08:00:00.000Z",
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 30000, ekstra: null },
        p2: { lønn: 28000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  const r2 = Calc.ensureMonthExpected(months2, "2026-11", people, {
    copyExpectedToNewMonths: true,
    categories: [{ id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }],
    plannedSpends: []
  });
  assert(r2.suggestedBalances === true, "Nov seeds without planned (rolling carry)");
  assert(months2["2026-11"].balancesSuggested === true, "Nov balancesSuggested");
  assertEq(months2["2026-11"].balances.p1.bruk, 50000, "p1 carry 50000");
  assertEq(months2["2026-11"].balances.p2.bruk, 12000, "p2 carry 12000");
  assert(months2["2026-11"].balances.p1.suggested === true, "p1 suggested carry");
  assert(!months2["2026-11"].balancesUpdatedAt, "Nov not auto-confirmed");
  assertEq(
    Calc.computeSuggestedBrukFromPrev(231223, 160000),
    71223,
    "helper formula"
  );
  assertEq(
    Calc.balanceSuggestedHint(),
    "Trygg ruller automatisk (virtuell pot). Rett saldo bare hvis noe er feil — ikke nødvendig hver måned.",
    "hint nb"
  );
}

// --- Rolling carry: leftover / deficit into next month ---
console.log("\n11e. Rolling carry: Oct confirm leftover/deficit → Nov seed");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  // Sep → Oct with bil: seed 71223 total (already covered in 11d). Here Oct confirmed
  // at end-of-month leftover 81223 → Nov should suggest 81223 (no Nov plans).
  const monthsSurplus = {
    "2026-10": {
      balances: {
        p1: { bruk: 70000, spare: null, when: "after_salary", asOf: null },
        p2: { bruk: 11223, spare: null, when: "after_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-10-31T18:00:00.000Z",
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 25000, ekstra: null },
        p2: { lønn: 15000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  assertEq(
    monthsSurplus["2026-10"].balances.p1.bruk +
      monthsSurplus["2026-10"].balances.p2.bruk,
    81223,
    "Oct confirmed total 81223"
  );
  const rNov = Calc.ensureMonthExpected(monthsSurplus, "2026-11", people, {
    copyExpectedToNewMonths: true,
    categories: cats,
    plannedSpends: []
  });
  assert(rNov.suggestedBalances === true, "Nov got suggested from Oct leftover");
  assertEq(monthsSurplus["2026-11"].balances.p1.bruk, 70000, "Nov p1 = Oct p1");
  assertEq(monthsSurplus["2026-11"].balances.p2.bruk, 11223, "Nov p2 = Oct p2");
  const cNov = Calc.calcFamily(monthsSurplus["2026-11"], people, [], {
    monthKey: "2026-11",
    monthIndex: 10,
    plannedSpends: [],
    spendBuffer: 0
  });
  assertEq(cNov.totalBruk, 81223, "Nov totalBruk 81223");
  assertEq(cNov.safeToSpend, 81223, "Nov Trygg 81223 (surplus carried)");
  assert(cNov.hasSuggestedBalances === true, "Nov hasSuggested");

  // Deficit: Oct ends at 50000 total → Nov seeds 50000
  const monthsDef = {
    "2026-10": {
      balances: {
        p1: { bruk: 30000, spare: null, when: "after_salary", asOf: null },
        p2: { bruk: 20000, spare: null, when: "after_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-10-31T18:00:00.000Z",
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 25000, ekstra: null },
        p2: { lønn: 15000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  Calc.ensureMonthExpected(monthsDef, "2026-11", people, {
    copyExpectedToNewMonths: true,
    categories: cats,
    plannedSpends: []
  });
  assertEq(monthsDef["2026-11"].balances.p1.bruk, 30000, "Nov deficit p1");
  assertEq(monthsDef["2026-11"].balances.p2.bruk, 20000, "Nov deficit p2");
  const cDef = Calc.calcFamily(monthsDef["2026-11"], people, [], {
    monthKey: "2026-11",
    monthIndex: 10,
    plannedSpends: [],
    spendBuffer: 0
  });
  assertEq(cDef.totalBruk, 50000, "Nov total 50000");
  assertEq(cDef.safeToSpend, 50000, "Nov Trygg 50000");

  // Do not re-seed over confirmed Nov
  monthsDef["2026-11"].balancesUpdatedAt = "2026-11-02T10:00:00.000Z";
  monthsDef["2026-11"].balances.p1.bruk = 99999;
  delete monthsDef["2026-11"].balancesSuggested;
  monthsDef["2026-11"].balances.p1.suggested = false;
  monthsDef["2026-11"].balances.p2.suggested = false;
  const rConf = Calc.ensureSuggestedBalances(
    monthsDef,
    "2026-11",
    people,
    []
  );
  assert(rConf.seeded === false, "no re-seed when confirmed");
  assertEq(rConf.reason, "confirmed", "reason confirmed");
  assertEq(monthsDef["2026-11"].balances.p1.bruk, 99999, "confirmed bruk kept");

  // Nearest confirmed skips unconfirmed gap month
  const monthsGap = {
    "2026-09": {
      balances: {
        p1: { bruk: 40000, spare: null, when: "after_salary", asOf: null },
        p2: { bruk: 41223, spare: null, when: "after_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-09-30T12:00:00.000Z",
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 25000, ekstra: null },
        p2: { lønn: 15000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    },
    "2026-10": {
      // suggested only — not confirmed
      balances: {
        p1: { bruk: 1, spare: null, when: "after_salary", asOf: null, suggested: true },
        p2: { bruk: 1, spare: null, when: "after_salary", asOf: null, suggested: true }
      },
      balancesSuggested: true,
      budgets: { cMat: 5000 },
      plannedIncome: {
        p1: { lønn: 25000, ekstra: null },
        p2: { lønn: 15000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  assertEq(
    Calc.findNearestPreviousWithConfirmedBalances(monthsGap, "2026-11"),
    "2026-09",
    "nearest confirmed is Sep not Oct"
  );
  assertEq(
    Calc.findNearestPreviousWithCarrySource(monthsGap, "2026-11"),
    "2026-10",
    "carry source prefers virtual Oct over skipping to Sep"
  );
  Calc.ensureMonthExpected(monthsGap, "2026-11", people, {
    copyExpectedToNewMonths: true,
    categories: cats,
    plannedSpends: []
  });
  // Virtual roll without bank: no planInn stacking — flat leftover pot
  assertEq(monthsGap["2026-11"].balances.p1.bruk, 1, "Nov from virtual Oct p1 (flat, no planInn)");
  assertEq(monthsGap["2026-11"].balances.p2.bruk, 1, "Nov from virtual Oct p2 (flat, no planInn)");
  assert(monthsGap["2026-11"].balances.p1.fromCarryPot === true, "Nov marked fromCarryPot");
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
  // Auto-spend computed but NOT re-subtracted in saldo: remAll var=3000, auto=6000; buffer 3000
  // nå = 15000 - 3000 = 12000; if-used = 15000 - 3000 - 3000 = 9000
  const c = Calc.calcFamily(m, people, cats, { spendBuffer: 3000 });
  assertEq(c.totalBruk, 15000, "totalBruk");
  assertEq(c.remainingBudgetAll, 3000, "remainingBudgetAll variabel");
  assertEq(c.autoSpendExtra, 6000, "autoSpendExtra");
  assertEq(c.spendBuffer, 3000, "buffer applied");
  assertEq(c.safeToSpendMode, "saldo", "saldo mode");
  assertEq(c.safeToSpend, 12000, "nå safe with buffer (no Fast re-sub)");
  assertEq(c.safeToSpendRaw, 12000, "nå raw with buffer");
  assertEq(c.safeToSpendIfBudgetUsed, 9000, "if-used with buffer");
  // etterLonn = 15000 + 50000 - 12000 = 53000
  assertEq(c.planInn, 50000, "planInn");
  assertEq(c.plannedTotal, 12000, "planUt");
  assertEq(c.etterLonn, 53000, "etterLonn = bruk+planInn-planUt");
  // No bruk + saldo intended → awaiting_saldo (do NOT show plan-clamped 0/plan as primary)
  const emptyBal = JSON.parse(JSON.stringify(m));
  emptyBal.balances = { p1: { bruk: null, spare: 100 }, p2: { bruk: null, spare: null } };
  const cEmpty = Calc.calcFamily(emptyBal, people, cats, { spendBuffer: 3000 });
  // På konto optional: without bruk fall back to plan (not blocking awaiting_saldo)
  assertEq(cEmpty.safeToSpendMode, "plan", "plan fallback without bruk (På konto optional)");
  assert(cEmpty.needsSaldoForSafeToSpend !== true, "needsSaldo not blocking");
  assert(cEmpty.safeToSpend != null, "primary safe from plan when no bruk");
  assert(cEmpty.safeToSpendRaw != null, "raw from plan when no bruk");
  // plan mirror still available: 50000 - (3000+6000 auto) - remFast0 = 41000
  assertEq(cEmpty.autoSpendExtra, 6000, "autoSpend still computed");
  assertEq(cEmpty.safeToSpendPlan, 41000, "plan mirror");
  // Explicit plan toggle still uses plan primary
  const cEmptyPlan = Calc.calcFamily(emptyBal, people, cats, {
    spendBuffer: 3000,
    useSaldoInSafeToSpend: false
  });
  assertEq(cEmptyPlan.safeToSpendMode, "plan", "plan when toggle off");
  assertEq(cEmptyPlan.safeToSpend, 41000, "plan safe when toggle off");
  assert(cEmptyPlan.needsSaldoForSafeToSpend !== true, "no needsSaldo when plan toggle");
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
  // Auto still 6000 for cashflow; remAll = Mat 2800 + MatP1 1500 = 4300
  // Saldo nå = 30000 - 2000 = 28000; if-used = 30000 - 4300 - 2000 = 23700 (no auto re-sub)
  assertEq(c.safeToSpendMode, "saldo", "household saldo");
  assertEq(c.remainingBudgetAll, 4300, "household remAll");
  assertEq(c.autoSpendExtra, 6000, "household autoSpendExtra");
  assertEq(c.safeToSpend, 28000, "household nå safe (no Fast re-sub)");
  assertEq(c.safeToSpendIfBudgetUsed, 23700, "household if-used");

  const m1 = c.byPerson.p1;
  const m2 = c.byPerson.p2;
  // p1 remAll without Lån: MatP1 1500 + Mat felles 3000*50% = 3000
  // p1 autoExtra = Lån 6000*60% = 3600 (kept for plan/cashflow)
  assertEq(Math.round(m1.remainingBudgetAll * 100) / 100, 3000, "p1 remAll");
  assertEq(Math.round(m1.autoSpendExtra * 100) / 100, 3600, "p1 autoSpendExtra");
  // p2 remAll: Mat 1500; autoExtra 2400
  assertEq(Math.round(m2.remainingBudgetAll * 100) / 100, 1500, "p2 remAll");
  assertEq(Math.round(m2.autoSpendExtra * 100) / 100, 2400, "p2 autoSpendExtra");
  // buffer share = 1000 each
  assertEq(m1.spendBufferShare, 1000, "p1 buffer share");
  assertEq(m2.spendBufferShare, 1000, "p2 buffer share");
  // p1 nå: 20000 - 1000 = 19000; if-used: 20000 - 3000 - 1000 = 16000
  assertEq(m1.safeToSpendMode, "saldo", "p1 saldo mode");
  assertEq(Math.round(m1.safeToSpend * 100) / 100, 19000, "p1 nå safe");
  assertEq(Math.round(m1.safeToSpendIfBudgetUsed * 100) / 100, 16000, "p1 if-used");
  // p2 nå: 10000 - 1000 = 9000; if-used: 10000 - 1500 - 1000 = 7500
  assertEq(Math.round(m2.safeToSpend * 100) / 100, 9000, "p2 nå safe");
  assertEq(Math.round(m2.safeToSpendIfBudgetUsed * 100) / 100, 7500, "p2 if-used");
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
  // remFast 0 with auto-spend; autoExtra replaces it
  assertEq(Math.round(p1p.remainingFastBudgets * 100) / 100, 0, "p1 remFast");
  assertEq(Math.round(p1p.autoSpendExtra * 100) / 100, 3600, "p1 autoExtra plan");
  // p1 plan = 30000 - 3600 utgifter - 3600 auto - 0 remFast = 22800
  assertEq(p1p.safeToSpendMode, "plan", "p1 plan mode");
  assertEq(Math.round(p1p.safeToSpend * 100) / 100, 22800, "p1 plan safe");
  // p2 utgifter = 4000*0.4 + 1000*0.5 = 1600+500 = 2100
  assertEq(Math.round(p2p.utgifter * 100) / 100, 2100, "p2 utgifter");
  assertEq(Math.round(p2p.remainingFastBudgets * 100) / 100, 0, "p2 remFast");
  assertEq(Math.round(p2p.autoSpendExtra * 100) / 100, 2400, "p2 autoExtra plan");
  // p2 plan = 20000 - 2100 - 2400 - 0 = 15500
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


// --- Feature 1: Fast auto-spend + Feature 2: planned spends ---
console.log("\n25. Fast auto-spend max-rule + opt-out + yearly once + plannedSpends");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cRent", name: "Husleie", type: "fast", owner: "felles", archived: false },
    { id: "cIns", name: "Forsikring", type: "fast", owner: "felles", archived: false, autoSpend: false },
    { id: "cFood", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const m = {
    balances: {},
    budgets: { cRent: 12000, cIns: 3000, cFood: 5000 },
    budgetLines: {
      cIns: {
        felles: [
          { id: "l1", name: "Årlig", amount: 12000, interval: "year", mode: "once", month: 2 }
        ]
      }
    },
    plannedIncome: {
      p1: { lønn: 40000, ekstra: null },
      p2: { lønn: 30000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: [
      { id: "e1", owner: "felles", categoryId: "cRent", amount: 5000 } // partial log
    ]
  };
  // March (monthIndex 2): Forsikring once hits; but autoSpend false → not auto
  const cMar = Calc.calcFamily(m, people, cats, {}, 2);
  assertEq(cMar.catStats.find(s => s.cat.id === "cRent").actual, 12000, "rent effective max(12000,5000)");
  assertEq(cMar.catStats.find(s => s.cat.id === "cRent").loggedActual, 5000, "rent logged 5000");
  assertEq(cMar.catStats.find(s => s.cat.id === "cRent").autoSpent, 7000, "rent autoSpent 7000");
  assert(cMar.catStats.find(s => s.cat.id === "cRent").remain === 0, "rent remain 0");
  assertEq(cMar.autoSpendExtra, 7000, "only rent auto (ins opted out)");
  // Ins planned 12000 in March but no auto → remain 12000 in remFast
  assertEq(cMar.remainingFastBudgets, 12000, "ins remainingFast (no auto)");
  // April: yearly once = 0 for ins
  const cApr = Calc.calcFamily(m, people, cats, {}, 3);
  assertEq(cApr.remainingFastBudgets, 0, "ins not in April");
  assertEq(cApr.autoSpendExtra, 7000, "rent still auto in April");

  // Opt-out toggle off → both auto
  cats[1].autoSpend = true;
  // But budget lines: need monthIndex for contribution — March gets 12000
  const cMar2 = Calc.calcFamily(m, people, cats, {}, 2);
  assertEq(cMar2.autoSpendExtra, 7000 + 12000, "rent+ins auto");
  assertEq(cMar2.remainingFastBudgets, 0, "no remFast when both auto");

  // Planned future spend — later months always; same-month unless seeded/reflected
  const planned = Calc.normalizePlannedSpends([
    { amount: 8000, owner: "p1", monthKey: "2026-09", note: "Sofa", categoryId: "cFood" },
    { amount: 2000, owner: "felles", monthKey: "2026-10", note: "Gave" }
  ], people);
  assertEq(planned.length, 2, "2 planned spends");
  const cAug = Calc.calcFamily(m, people, cats, {}, 7, planned, "2026-08");
  assertEq(cAug.futureReserve, 10000, "aug reserves sep+oct (8000+2000)");
  const cSep = Calc.calcFamily(m, people, cats, {}, 8, planned, "2026-09");
  assertEq(cSep.futureReserve, 10000, "sept reserves own + later (8000+2000)");
  // Matching expense covers sep plan; oct still reserved in sept view
  m.expenses.push({ id: "eSofa", owner: "p1", categoryId: "cFood", amount: 8000 });
  const cSep2 = Calc.calcFamily(m, people, cats, {}, 8, planned, "2026-09");
  assertEq(cSep2.futureReserve, 2000, "sep covered; oct still reserved from sept");
  // Target month still reserved; earlier plans drop out (monthKey < viewed)
  const cOct = Calc.calcFamily(m, people, cats, {}, 9, planned, "2026-10");
  assertEq(cOct.futureReserve, 2000, "oct still reserved (own only)");
  const cNov = Calc.calcFamily(m, people, cats, {}, 10, planned, "2026-11");
  assertEq(cNov.futureReserve, 0, "nov: past plans no longer reserve");
  // Direct helper
  assertEq(Calc.plannedSpendReserve(planned, "2026-09", []), 10000, "helper: same+later");
  assertEq(Calc.plannedSpendReserve(planned, "2026-10", []), 2000, "helper from oct");
  assertEq(Calc.plannedSpendReserve(planned, "2026-11", []), 0, "helper after");
  assertEq(Calc.plannedSpendsFromMonth(planned, "2026-09").length, 2, "fromMonth lists 2");
  assertEq(Calc.plannedSpendsFromMonth(planned, "2026-10").length, 1, "fromMonth lists 1");

  // Bugfix: Sep view + Oct plan + Sep expense same category must NOT clear Oct reserve
  const plannedOctOnly = Calc.normalizePlannedSpends([
    { amount: 5000, owner: "p1", monthKey: "2026-10", note: "PC", categoryId: "cFood" }
  ], people);
  const sepExpSameCat = [{ id: "eSepFood", owner: "p1", categoryId: "cFood", amount: 300 }];
  assertEq(
    Calc.plannedSpendReserve(plannedOctOnly, "2026-09", sepExpSameCat),
    5000,
    "sep view: oct plan still reserved despite sep expense same cat"
  );
  assertEq(
    Calc.plannedSpendReserveForPerson(plannedOctOnly, "2026-09", sepExpSameCat, "p1", people),
    5000,
    "sep view person: oct plan still reserved despite sep expense same cat"
  );
  // Same-month match still clears
  assertEq(
    Calc.plannedSpendReserve(plannedOctOnly, "2026-10", sepExpSameCat),
    0,
    "oct view: same-month expense same cat clears oct plan"
  );
  // Explicit done / doneExpenseId still clears future
  const plannedDone = Calc.normalizePlannedSpends([
    { amount: 5000, owner: "p1", monthKey: "2026-10", note: "PC", categoryId: "cFood", done: true }
  ], people);
  assertEq(Calc.plannedSpendReserve(plannedDone, "2026-09", []), 0, "done item not reserved");
  const plannedLinked = Calc.normalizePlannedSpends([
    { amount: 5000, owner: "p1", monthKey: "2026-10", note: "PC", categoryId: "cFood", doneExpenseId: "eSepFood" }
  ], people);
  assertEq(
    Calc.plannedSpendReserve(plannedLinked, "2026-09", sepExpSameCat),
    0,
    "doneExpenseId in viewed expenses clears even future month"
  );

  // migrate keeps plannedSpends
  const mig = Calc.migrateState({
    version: 2,
    people,
    categories: cats,
    months: {},
    plannedSpends: planned
  });
  assertEq(mig.plannedSpends.length, 2, "migrate plannedSpends");
}



// --- På konto nå reconciliation ---
console.log("\n25. På konto nå: expected vs oppgitt variance");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  // prev ending: p1 10000, p2 8000
  // this month: p1 inn 2000, ut own 500, felles 1000 → share 500 → tilOvers = 2000-0-1000 = 1000
  // p2: inn 0, ut felles share 500 → tilOvers = -500
  const m = {
    balances: {
      p1: { bruk: 11500, spare: null },
      p2: { bruk: 7000, spare: 1000 }
    },
    budgets: { cMat: 0 },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [
      { id: "i1", person: "p1", type: "lønn", amount: 2000 }
    ],
    savings: [],
    expenses: [
      { id: "e1", owner: "p1", categoryId: "cMat", amount: 500 },
      { id: "e2", owner: "felles", categoryId: "cMat", amount: 1000 }
    ]
  };
  const prevBalances = {
    p1: { bruk: 10000, spare: null },
    p2: { bruk: 8000, spare: null }
  };

  assertEq(Calc.parseBalanceAmount(""), null, "parse empty");
  assertEq(Calc.parseBalanceAmount("1200"), 1200, "parse number");
  assertEq(Calc.balanceVariance(11500, 11000), 500, "variance +");
  assertEq(Calc.balanceVariance(null, 100), null, "variance null");
  assertEq(Calc.expectedBrukFromPrev(10000, 1000), 11000, "expected from prev");
  assertEq(Calc.etterLonnFromBruk(10000, 50000, 12000), 48000, "etterLonn helper");

  const ok = Calc.varianceMeta(0.2);
  assertEq(ok.kind, "ok", "near-zero is ok");
  const more = Calc.varianceMeta(500);
  assertEq(more.kind, "more", "more kind");
  assertEq(more.abs, 500, "more abs");
  const less = Calc.varianceMeta(-300);
  assertEq(less.kind, "less", "less kind");
  assertEq(less.abs, 300, "less abs");

  // p1 tilOvers: 2000 - 0 - (500+500) = 1000 → forventet 11000; oppgitt 11500 → +500
  // p2 tilOvers: 0 - 0 - 500 = -500 → forventet 7500; oppgitt 7000 → -500
  const rec = Calc.reconcilePaKonto(m, people, cats, 8, prevBalances);
  assertEq(rec.byPerson.p1.forventet, 11000, "p1 forventet");
  assertEq(rec.byPerson.p1.oppgitt, 11500, "p1 oppgitt");
  assertEq(rec.byPerson.p1.differanse, 500, "p1 diff");
  assertEq(rec.byPerson.p1.variance.kind, "more", "p1 more");
  assertEq(rec.byPerson.p2.forventet, 7500, "p2 forventet");
  assertEq(rec.byPerson.p2.differanse, -500, "p2 diff");
  assertEq(rec.byPerson.p2.variance.kind, "less", "p2 less");
  assertEq(rec.totalOppgitt, 18500, "samlet oppgitt");
  assertEq(rec.totalForventet, 18500, "samlet forventet");
  assertEq(rec.totalDifferanse, 0, "samlet diff nets to 0");
  assertEq(rec.totalVariance.kind, "ok", "samlet ok");
  // etterLonn p1 = 11500 + 30000 - planUt(felles mat 0) = 41500
  assertEq(rec.byPerson.p1.etterLonn, 41500, "p1 etterLonn");

  const noPrev = Calc.reconcilePaKonto(m, people, cats, 8, null);
  assert(noPrev.byPerson.p1.forventet == null, "no prev → no forventet");
  assert(noPrev.byPerson.p1.differanse == null, "no prev → no diff");
  assertEq(noPrev.byPerson.p1.oppgitt, 11500, "oppgitt still set");

  // autoSpendExtra defaults to 0 → same as two-arg form
  assertEq(Calc.expectedBrukFromPrev(10000, 1000, 0), 11000, "expected +0 auto");
  assertEq(Calc.expectedBrukFromPrev(10000, 1000, 3000), 8000, "expected −autoFast");
}

// --- På konto: auto Fast in forventet + forgotten variable ---
console.log("\n26. På konto nå: auto Fast + glemt variabelt kjøp");
{
  const people = Calc.defaultPeople();
  // Fast auto rent 3000 (felles 50/50) + variabel Mat (not logged)
  const cats = [
    {
      id: "cHus",
      name: "Husleie",
      type: "fast",
      owner: "felles",
      archived: false,
      autoSpend: true
    },
    {
      id: "cMat",
      name: "Mat",
      type: "variabel",
      owner: "felles",
      archived: false
    }
  ];
  // prev p1 10000. This month: no logged income/expense.
  // Fast husleie plan felles 3000 → autoExtra p1 = 1500, p2 = 1500
  // Bank after fixed bill + forgotten mat 500 (p1 own): p1 bank = 10000-1500-500 = 8000
  // Old (wrong) forventet ignored auto → 10000; new forventet = 10000 - 1500 = 8500
  // Diff = 8000 - 8500 = -500 → points to forgotten 500 variable
  const m = {
    balances: {
      p1: { bruk: 8000, spare: null },
      p2: { bruk: 8500, spare: null }
    },
    budgets: {
      cHus: { felles: 3000 },
      cMat: { felles: 0 }
    },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const prevBalances = {
    p1: { bruk: 10000, spare: null },
    p2: { bruk: 10000, spare: null }
  };

  const rec = Calc.reconcilePaKonto(m, people, cats, 8, prevBalances);
  assertEq(rec.byPerson.p1.autoSpendExtra, 1500, "p1 auto Fast share");
  assertEq(rec.byPerson.p1.tilOvers, 0, "p1 logged tilOvers 0");
  assertEq(rec.byPerson.p1.forventet, 8500, "p1 forventet = prev − autoFast");
  assertEq(rec.byPerson.p1.differanse, -500, "p1 gap = forgotten variable");
  assertEq(rec.byPerson.p1.variance.kind, "less", "p1 less → glemt kjøp");
  // p2: bank matches expected after auto Fast only
  assertEq(rec.byPerson.p2.autoSpendExtra, 1500, "p2 auto Fast share");
  assertEq(rec.byPerson.p2.forventet, 8500, "p2 forventet after auto");
  assertEq(rec.byPerson.p2.differanse, 0, "p2 no forgotten log");
  assertEq(rec.byPerson.p2.variance.kind, "ok", "p2 ser riktig ut");

  // If Fast were logged fully, autoExtra=0 and forventet stays at prev+tilOvers
  const mLogged = {
    ...m,
    expenses: [
      { id: "eHus", owner: "felles", categoryId: "cHus", amount: 3000 }
    ],
    balances: {
      p1: { bruk: 8500, spare: null },
      p2: { bruk: 8500, spare: null }
    }
  };
  const recL = Calc.reconcilePaKonto(mLogged, people, cats, 8, prevBalances);
  assertEq(recL.byPerson.p1.autoSpendExtra, 0, "logged Fast → no autoExtra");
  // tilOvers p1 = 0 - 1500 (felles share) = -1500 → forventet 8500
  assertEq(recL.byPerson.p1.tilOvers, -1500, "p1 tilOvers after logged Fast");
  assertEq(recL.byPerson.p1.forventet, 8500, "logged Fast same forventet");
  assertEq(recL.byPerson.p1.differanse, 0, "bank matches when only Fast left");
}



// --- På konto: før vs etter lønn + på dato ---
console.log("\n27. På konto nå: before_salary vs after_salary vs dated");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  // prev p1 10000.
  // Logged: lønn 30000, expense own 500, felles 1000 → p1 share 500
  // tilOvers after = 30000 - 0 - 1000 = 29000 → forventet 39000
  // tilOvers before (excl lønn) = 0 - 1000 = -1000 → forventet 9000
  const base = {
    balances: {
      p1: { bruk: 9000, spare: null, when: "after_salary", asOf: null },
      p2: { bruk: null, spare: null }
    },
    budgets: { cMat: 0 },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 20000, ekstra: null }
    },
    incomes: [
      { id: "i1", person: "p1", type: "lønn", amount: 30000, date: "2026-09-15" },
      { id: "i2", person: "p1", type: "ekstra", amount: 1000, date: "2026-09-20" }
    ],
    savings: [],
    expenses: [
      { id: "e1", owner: "p1", categoryId: "cMat", amount: 500, date: "2026-09-05" },
      { id: "e2", owner: "felles", categoryId: "cMat", amount: 1000, date: "2026-09-10" }
    ]
  };
  const prevBalances = {
    p1: { bruk: 10000, spare: null },
    p2: { bruk: 8000, spare: null }
  };

  assertEq(Calc.normalizeBalanceWhen(undefined), "after_salary", "default when");
  assertEq(Calc.normalizeBalanceWhen("before_salary"), "before_salary", "before when");
  assertEq(Calc.balanceWhenLabel("before_salary", null), "Oppgitt før lønn", "label før");
  assertEq(Calc.balanceWhenLabel("after_salary", null), "Oppgitt etter lønn", "label etter");
  assertEq(Calc.balanceWhenLabel("dated", "2026-09-12"), "Oppgitt 12. sep", "label dato");

  // after_salary
  const mAfter = {
    ...base,
    balances: {
      p1: { bruk: 39000, spare: null, when: "after_salary", asOf: null },
      p2: { bruk: null, spare: null }
    }
  };
  // tilOvers = 30000+1000 - 0 - (500+500) = 30000 → forventet 40000
  const recA = Calc.reconcilePaKonto(mAfter, people, cats, 8, prevBalances);
  assertEq(recA.byPerson.p1.when, "after_salary", "after when");
  assertEq(recA.byPerson.p1.tilOversForMode, 30000, "after tilOvers incl salary");
  assertEq(recA.byPerson.p1.forventet, 40000, "after forventet");
  assertEq(recA.byPerson.p1.differanse, -1000, "after diff (oppgitt 39000)");
  assertEq(recA.byPerson.p1.source, "prev+cashflow+autoFast", "after source");

  // before_salary — exclude lønn+ekstra
  const mBefore = {
    ...base,
    balances: {
      p1: { bruk: 9000, spare: null, when: "before_salary", asOf: null },
      p2: { bruk: null, spare: null }
    }
  };
  // tilOvers = 0 - (500+500) = -1000 → forventet 9000
  const recB = Calc.reconcilePaKonto(mBefore, people, cats, 8, prevBalances);
  assertEq(recB.byPerson.p1.when, "before_salary", "before when");
  assertEq(recB.byPerson.p1.tilOversForMode, -1000, "before tilOvers excl salary");
  assertEq(recB.byPerson.p1.forventet, 9000, "before forventet");
  assertEq(recB.byPerson.p1.differanse, 0, "before matches bank");
  assertEq(recB.byPerson.p1.source, "prev+cashflowBeforeSalary+autoFast", "before source");
  assertEq(recB.byPerson.p1.whenLabel, "Oppgitt før lønn", "before label");

  // Same month data: before forventet < after forventet by lønn+ekstra
  assertEq(
    recA.byPerson.p1.forventet - recB.byPerson.p1.forventet,
    31000,
    "after−before = lønn+ekstra"
  );

  // dated asOf 2026-09-12: incomes after 12 excluded; expenses on/before included
  // lønn 15th out, ekstra 20th out; e1 5th + e2 10th in → tilOvers = 0 - 1000 = -1000
  const mDated = {
    ...base,
    balances: {
      p1: { bruk: 9000, spare: null, when: "dated", asOf: "2026-09-12" },
      p2: { bruk: null, spare: null }
    }
  };
  const recD = Calc.reconcilePaKonto(mDated, people, cats, 8, prevBalances);
  assertEq(recD.byPerson.p1.when, "dated", "dated when");
  assertEq(recD.byPerson.p1.asOf, "2026-09-12", "dated asOf");
  assert(recD.byPerson.p1.filteredByDate === true, "dated filters");
  assertEq(recD.byPerson.p1.tilOversForMode, -1000, "dated tilOvers to 12th");
  assertEq(recD.byPerson.p1.forventet, 9000, "dated forventet");
  assertEq(recD.byPerson.p1.whenLabel, "Oppgitt 12. sep", "dated label");
  assertEq(recD.byPerson.p1.source, "prev+cashflowToDate+autoFast", "dated source");

  // dated after salary date → includes lønn
  const mDatedLate = {
    ...base,
    balances: {
      p1: { bruk: 40000, spare: null, when: "dated", asOf: "2026-09-30" },
      p2: { bruk: null, spare: null }
    }
  };
  const recDL = Calc.reconcilePaKonto(mDatedLate, people, cats, 8, prevBalances);
  assertEq(recDL.byPerson.p1.tilOversForMode, 30000, "dated end-of-month = full");
  assertEq(recDL.byPerson.p1.forventet, 40000, "dated late = after");

  // dated with NO dates on cashflow → treat like after_salary
  const mNoDates = {
    balances: {
      p1: { bruk: 11000, spare: null, when: "dated", asOf: "2026-09-12" },
      p2: { bruk: null, spare: null }
    },
    budgets: { cMat: 0 },
    plannedIncome: { p1: { lønn: 30000 }, p2: { lønn: 20000 } },
    incomes: [{ id: "i1", person: "p1", type: "lønn", amount: 2000 }],
    savings: [],
    expenses: [
      { id: "e1", owner: "p1", categoryId: "cMat", amount: 500 },
      { id: "e2", owner: "felles", categoryId: "cMat", amount: 1000 }
    ]
  };
  // tilOvers = 2000 - 1000 = 1000 → 11000 (same as classic after)
  const recND = Calc.reconcilePaKonto(mNoDates, people, cats, 8, prevBalances);
  assert(recND.byPerson.p1.filteredByDate === false, "no dates → no filter");
  assertEq(recND.byPerson.p1.forventet, 11000, "no dates dated = after semantics");
  assertEq(recND.byPerson.p1.source, "prev+cashflow+autoFast", "no dates source");
  assertEq(recND.byPerson.p1.asOf, "2026-09-12", "asOf kept for display");

  // migrate preserves when/asOf
  const migrated = Calc.migrateState({
    people,
    months: {
      "2026-09": {
        balances: {
          p1: { bruk: 1, spare: 2, when: "before_salary", asOf: null }
        },
        balancesUpdatedAt: "2026-09-17T10:00:00.000Z"
      }
    }
  });
  assertEq(
    migrated.months["2026-09"].balances.p1.when,
    "before_salary",
    "migrate when"
  );
  assertEq(
    migrated.months["2026-09"].balancesUpdatedAt,
    "2026-09-17T10:00:00.000Z",
    "migrate balancesUpdatedAt"
  );
}


// --- På konto: breakdown parts + no double-count Fast ---
console.log("\n28. På konto nå: forventet breakdown + Fast partial log");
{
  const people = Calc.defaultPeople();
  const cats = [
    {
      id: "cHus",
      name: "Husleie",
      type: "fast",
      owner: "felles",
      archived: false,
      autoSpend: true
    },
    {
      id: "cMat",
      name: "Mat",
      type: "variabel",
      owner: "felles",
      archived: false
    }
  ];
  // prev 20000. Logged: lønn 30000, sparing 2000, own mat 500, felles mat 1000 (share 500)
  // Fast husleie plan 4000 felles — only 1000 logged → autoExtra share = (4000-1000)/2 = 1500
  // utgifter = 500 + 500 (mat felles) + 500 (hus logged share) = 1500
  // inn = 30000; sparing = 2000
  // tilOvers = 30000 - 2000 - 1500 = 26500
  // forventet = 20000 + 26500 - 1500 = 45000
  const m = {
    balances: {
      p1: { bruk: 45000, spare: null, when: "after_salary", asOf: null },
      p2: { bruk: null, spare: null }
    },
    budgets: {
      cHus: { felles: 4000 },
      cMat: { felles: 0 }
    },
    plannedIncome: { p1: { lønn: 30000 }, p2: { lønn: 20000 } },
    incomes: [{ id: "i1", person: "p1", type: "lønn", amount: 30000 }],
    savings: [{ id: "s1", person: "p1", amount: 2000 }],
    expenses: [
      { id: "eMat1", owner: "p1", categoryId: "cMat", amount: 500 },
      { id: "eMat2", owner: "felles", categoryId: "cMat", amount: 1000 },
      { id: "eHus", owner: "felles", categoryId: "cHus", amount: 1000 }
    ]
  };
  const prevBalances = {
    p1: { bruk: 20000, spare: null },
    p2: { bruk: 10000, spare: null }
  };
  const rec = Calc.reconcilePaKonto(m, people, cats, 8, prevBalances);
  const r = rec.byPerson.p1;
  assert(r.parts && typeof r.parts === "object", "parts exposed");
  assertEq(r.inn, 30000, "inn = lønn+ekstra");
  assertEq(r.sparing, 2000, "sparing part");
  assertEq(r.utgifter, 1500, "utgifter = own+felles shares");
  assertEq(r.autoSpendExtra, 1500, "partial Fast → remaining auto only");
  assertEq(r.prevBruk, 20000, "prevBruk");
  assertEq(r.forventet, 45000, "forventet = prev+inn−ut−sparing−auto");
  // Identity: prev + inn − utgifter − sparing − auto === forventet
  const rebuilt =
    r.prevBruk + r.inn - r.utgifter - r.sparing - r.autoSpendExtra;
  assertEq(rebuilt, r.forventet, "breakdown identity holds");
  // Full Fast logged → auto 0, utgifter includes full share 2000, same forventet
  const mFull = {
    ...m,
    expenses: [
      { id: "eMat1", owner: "p1", categoryId: "cMat", amount: 500 },
      { id: "eMat2", owner: "felles", categoryId: "cMat", amount: 1000 },
      { id: "eHus", owner: "felles", categoryId: "cHus", amount: 4000 }
    ]
  };
  const recF = Calc.reconcilePaKonto(mFull, people, cats, 8, prevBalances);
  const rf = recF.byPerson.p1;
  assertEq(rf.autoSpendExtra, 0, "full Fast log → no auto");
  assertEq(rf.utgifter, 3000, "utgifter includes full Fast share");
  assertEq(rf.forventet, 45000, "no double-count vs partial");
  assertEq(
    rf.prevBruk + rf.inn - rf.utgifter - rf.sparing - rf.autoSpendExtra,
    rf.forventet,
    "full-log identity"
  );

  // before_salary: inn excluded
  m.balances.p1.when = "before_salary";
  const recB = Calc.reconcilePaKonto(m, people, cats, 8, prevBalances);
  const rb = recB.byPerson.p1;
  assertEq(rb.inn, 0, "before_salary inn 0");
  assert(rb.excludeSalaryIncome === true, "excludeSalary flag");
  assertEq(
    rb.prevBruk + rb.inn - rb.utgifter - rb.sparing - rb.autoSpendExtra,
    rb.forventet,
    "before_salary identity"
  );
}


// --- Trygg å bruke: dual saldo breakdown (nå vs hvis hele budsjettet) ---
console.log("\n29. safeToSpendSaldoBreakdown dual (nå vs if-used)");
{
  assert(typeof Calc.safeToSpendSaldoBreakdown === "function", "helper exported");
  // Example: 71k bruk, rem var 12k, Fast auto 3k (NOT re-subtracted), future 7k
  // nå = 71k - 7k = 64k; if-used = 71k - 12k - 7k = 52k
  const bd = Calc.safeToSpendSaldoBreakdown({
    bruk: 71000,
    remainingBudgetAll: 12000,
    remainingVariableBudgets: 12000,
    autoSpendExtra: 3000,
    futureReserve: 7000,
    spendBuffer: 0
  });
  assertEq(bd.bruk, 71000, "bruk 71000");
  assertEq(bd.restBudget, 12000, "restBudget = rem only (Fast in bank)");
  assertEq(bd.autoSpendExtra, 3000, "auto kept for transparency");
  assertEq(bd.futureReserve, 7000, "futureReserve");
  assertEq(bd.spendBuffer, 0, "buffer 0");
  assertEq(bd.safeToSpendNow, 64000, "nå 64000");
  assertEq(bd.safeToSpend, 64000, "primary safe = nå");
  assertEq(bd.raw, 64000, "raw = nå");
  assertEq(bd.safeToSpendIfBudgetUsed, 52000, "if-used 52000");
  assertEq(
    bd.bruk - bd.futureReserve - bd.spendBuffer,
    bd.safeToSpendNowRaw,
    "nå identity holds (no auto)"
  );
  assertEq(
    bd.bruk - bd.remainingBudgetAll - bd.futureReserve - bd.spendBuffer,
    bd.safeToSpendIfBudgetUsedRaw,
    "if-used identity holds (no auto)"
  );

  // Buffer + clamp on nå (auto 0, future+buffer > bruk)
  const bd2 = Calc.safeToSpendSaldoBreakdown({
    bruk: 10000,
    remainingBudgetAll: 8000,
    autoSpendExtra: 0,
    futureReserve: 5000,
    spendBuffer: 2000
  });
  assertEq(bd2.safeToSpendNowRaw, 3000, "nå raw ignores rem var");
  assertEq(bd2.safeToSpendNow, 3000, "nå positive unclamped");
  assertEq(bd2.safeToSpendIfBudgetUsedRaw, -5000, "if-used raw negative");
  assertEq(bd2.safeToSpendIfBudgetUsed, -5000, "if-used allows negative (no clamp)");

  // Mirrors calcFamily saldo mode (correct arg order: settings then monthIndex)
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false },
    { id: "cHus", name: "Hus", type: "fast", owner: "felles", archived: false, autoSpend: true }
  ];
  const m = {
    balances: {
      p1: { bruk: 40000, spare: 100000 },
      p2: { bruk: 31000, spare: 0 }
    },
    budgets: { cMat: { felles: 10000 }, cHus: { felles: 6000 } },
    plannedIncome: { p1: { lønn: 30000 }, p2: { lønn: 25000 } },
    incomes: [],
    savings: [],
    expenses: []
  };
  const planned = [
    { id: "ps1", amount: 7000, monthKey: "2026-10", person: "felles", categoryId: null, done: false }
  ];
  const c = Calc.calcFamily(m, people, cats, {
    useSaldoInSafeToSpend: true,
    spendBuffer: 0,
    monthKey: "2026-09",
    plannedSpends: planned
  }, 8);
  // autoSpendExtra = 6000 (Hus, for cashflow), remAll = 10000 (Mat), future = 7000
  // nå = 71000 - 7000 = 64000; if-used = 71000 - 10000 - 7000 = 54000 (no Fast re-sub)
  assertEq(c.totalBruk, 71000, "samlet bruk 71000");
  assertEq(c.autoSpendExtra, 6000, "auto Fast 6000");
  assertEq(c.remainingBudgetAll, 10000, "rem var 10000");
  assertEq(c.futureReserve, 7000, "future 7000");
  assertEq(c.safeToSpend, 64000, "calcFamily nå");
  assertEq(c.safeToSpendIfBudgetUsed, 54000, "calcFamily if-used");
  const bdFam = Calc.safeToSpendSaldoBreakdown({
    bruk: c.totalBruk,
    remainingBudgetAll: c.remainingBudgetAll,
    remainingVariableBudgets: c.remainingVariableBudgets,
    autoSpendExtra: c.autoSpendExtra,
    futureReserve: c.futureReserve,
    spendBuffer: c.spendBuffer
  });
  assertEq(bdFam.safeToSpend, c.safeToSpend, "breakdown matches nå");
  assertEq(bdFam.safeToSpendIfBudgetUsed, c.safeToSpendIfBudgetUsed, "breakdown matches if-used");
  assertEq(bdFam.raw, c.safeToSpendRaw, "breakdown raw matches nå raw");
}

// --- Dual Trygg: variable remaining does not reduce "nå" ---
console.log("\n30. Dual Trygg — variable rem excluded from nå, included in if-used");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cFast", name: "Strøm", type: "fast", owner: "felles", archived: false, autoSpend: true },
    { id: "cVar", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const m = {
    balances: { p1: { bruk: 20000 }, p2: { bruk: 10000 } },
    budgets: { cFast: { felles: 5000 }, cVar: { felles: 8000 } },
    plannedIncome: { p1: { lønn: 20000 }, p2: { lønn: 15000 } },
    incomes: [],
    savings: [],
    expenses: []
  };
  const c = Calc.calcFamily(m, people, cats, { spendBuffer: 1000 });
  // auto=5000 (cashflow only), remVar=8000, buffer=1000, future=0
  assertEq(c.autoSpendExtra, 5000, "auto 5000");
  assertEq(c.remainingVariableBudgets, 8000, "var rem 8000");
  assertEq(c.safeToSpendNow, 29000, "nå = 30000-1000 (no Fast re-sub)");
  assertEq(c.safeToSpend, 29000, "primary = nå");
  assertEq(c.safeToSpendIfBudgetUsed, 21000, "if-used = 30000-8000-1000");
  // Difference between nå and if-used equals remaining variable
  assertEq(
    c.safeToSpendNowRaw - c.safeToSpendIfBudgetUsedRaw,
    c.remainingVariableBudgets,
    "gap = remaining variable"
  );
  // Per person: equal felles split
  const p1 = c.byPerson.p1;
  assertEq(Math.round(p1.autoSpendExtra * 100) / 100, 2500, "p1 auto half");
  assertEq(Math.round(p1.remainingVariableBudgets * 100) / 100, 4000, "p1 var half");
  // p1 nå = 20000 - 500 = 19500; if-used = 20000 - 4000 - 500 = 15500
  assertEq(Math.round(p1.safeToSpend * 100) / 100, 19500, "p1 nå");
  assertEq(Math.round(p1.safeToSpendIfBudgetUsed * 100) / 100, 15500, "p1 if-used");
}

// --- Explicit no double-count: bank after Fast vs saldo Trygg ---
console.log("\n31. Saldo Trygg does not double-count Fast already in bank");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cRent", name: "Husleie", type: "fast", owner: "felles", archived: false, autoSpend: true },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  // Scenario: fixed 12000 already left bank; Mathias enters På konto = 50000 after that.
  // Logged Fast = 0 so autoSpendExtra = 12000 (still for category bars / forventet).
  const m = {
    balances: { p1: { bruk: 30000 }, p2: { bruk: 20000 } },
    budgets: { cRent: { felles: 12000 }, cMat: { felles: 5000 } },
    plannedIncome: { p1: { lønn: 25000 }, p2: { lønn: 20000 } },
    incomes: [],
    savings: [],
    expenses: []
  };
  const c = Calc.calcFamily(m, people, cats, { spendBuffer: 0 });
  assertEq(c.autoSpendExtra, 12000, "auto still 12000 for cashflow");
  assertEq(c.remainingFastBudgets, 0, "Fast rem ~0 via effectiveActual");
  assertEq(c.remainingBudgetAll, 5000, "only variable rem");
  // Must NOT be 50000-12000=38000 (old double-count)
  assertEq(c.safeToSpend, 50000, "nå = bruk only (Fast already in bank)");
  assertEq(c.safeToSpendIfBudgetUsed, 45000, "if-used = bruk - var rem");
  assertEq(
    c.safeToSpendNowRaw,
    c.totalBruk - c.futureReserve - c.spendBuffer,
    "nå identity excludes auto"
  );
  assertEq(
    c.safeToSpendIfBudgetUsedRaw,
    c.totalBruk - c.remainingBudgetAll - c.futureReserve - c.spendBuffer,
    "if-used identity excludes auto"
  );
  // Plan mode still accounts for Fast via autoSpendExtra
  const cPlan = Calc.calcFamily(m, people, cats, { useSaldoInSafeToSpend: false });
  assertEq(cPlan.safeToSpendMode, "plan", "plan mode");
  assert(
    cPlan.safeToSpend < c.safeToSpend,
    "plan still subtracts Fast (lower than saldo)"
  );
  assertEq(cPlan.autoSpendExtra, 12000, "plan keeps auto");
}


// --- Fast logged under person vs felles budget: no autoExtra leak ---
console.log("\n32. autoSpendExtraForPerson: cross-owner Fast log clears auto");
{
  const people = [
    { id: "p1", name: "M", active: true },
    { id: "p2", name: "A", active: true }
  ];
  const cats = [
    { id: "cHus", name: "Hus", type: "fast", owner: "felles" },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles" }
  ];
  const prevBalances = {
    p1: { bruk: 40000, spare: null },
    p2: { bruk: 35000, spare: null }
  };
  // Fast paid from p1 account, logged as owner=p1 (not felles)
  const m = {
    balances: {
      p1: { bruk: 57000, spare: null, when: "after_salary" },
      p2: { bruk: 59000, spare: null, when: "after_salary" }
    },
    budgets: { cHus: { felles: 12000 }, cMat: { felles: 8000 } },
    plannedIncome: {
      p1: { lønn: 30000, ekstra: null },
      p2: { lønn: 25000, ekstra: null }
    },
    incomes: [
      { person: "p1", type: "lønn", amount: 30000 },
      { person: "p2", type: "lønn", amount: 25000 }
    ],
    savings: [],
    expenses: [
      { id: "eMat", owner: "felles", categoryId: "cMat", amount: 2000 },
      { id: "eHus", owner: "p1", categoryId: "cHus", amount: 12000, category: "Hus" }
    ]
  };
  assertEq(Calc.autoSpendExtraTotal(m, cats, 8), 0, "household auto 0 when fully logged");
  assertEq(
    Calc.autoSpendExtraForPerson(m, "p1", people, cats, 8),
    0,
    "p1 auto 0 even though log owner≠felles"
  );
  assertEq(
    Calc.autoSpendExtraForPerson(m, "p2", people, cats, 8),
    0,
    "p2 auto 0 — no ghost Fast share"
  );
  const rec = Calc.reconcilePaKonto(m, people, cats, 8, prevBalances);
  assertEq(rec.byPerson.p1.forventet, 57000, "p1 forventet matches bank (no Fast re-sub)");
  assertEq(rec.byPerson.p2.forventet, 59000, "p2 forventet matches bank");
  assertEq(rec.byPerson.p1.differanse, 0, "p1 diff 0");
  assertEq(rec.byPerson.p2.differanse, 0, "p2 diff 0");

  const c = Calc.calcFamily(
    m,
    people,
    cats,
    { useSaldoInSafeToSpend: true, spendBuffer: 0 },
    8,
    [],
    "2026-09"
  );
  assertEq(c.safeToSpendMode, "saldo", "saldo mode");
  assertEq(c.autoSpendExtra, 0, "family auto 0");
  assertEq(c.remainingFastBudgets, 0, "Fast rem 0");
  assertEq(c.safeToSpend, c.totalBruk, "Trygg nå = bruk (no future/buffer)");
  assertEq(
    c.safeToSpendIfBudgetUsed,
    c.totalBruk - c.remainingBudgetAll,
    "if-used = bruk − remAll (no auto)"
  );
  assert(
    Math.abs(
      (c.byPerson.p1.autoSpendExtra || 0) + (c.byPerson.p2.autoSpendExtra || 0)
    ) < 0.01,
    "per-person autos sum ~0"
  );
}





// --- Awaiting saldo: October without bruk must not show scary 0 ---
console.log("\n33. awaiting_saldo — Oct no bruk + plannedSpend; Sep saldo unchanged");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cBil", name: "Bil", type: "variabel", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const planned = [
    {
      id: "ps1",
      name: "Ny bil",
      amount: 160000,
      monthKey: "2026-10",
      categoryId: "cBil",
      owner: "felles",
      done: false
    }
  ];

  // September WITH bruk (Mathias scenario): 231223 − 160000 = 71223
  const sep = {
    balances: {
      p1: { bruk: 150000, spare: 0 },
      p2: { bruk: 81223, spare: 0 }
    },
    budgets: { cMat: { felles: 5000 } },
    plannedIncome: {
      p1: { lønn: 25000, ekstra: null },
      p2: { lønn: 15000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const cSep = Calc.calcFamily(sep, people, cats, {
    monthKey: "2026-09",
    monthIndex: 8,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cSep.safeToSpendMode, "saldo", "sep saldo mode");
  assertEq(cSep.totalBruk, 231223, "sep totalBruk");
  assertEq(cSep.futureReserve, 160000, "sep reserves Ny bil");
  assertEq(cSep.safeToSpend, 71223, "sep trygg = 231223-160000");
  assert(cSep.needsSaldoForSafeToSpend !== true, "sep no needsSaldo");

  // October empty + no prev in this isolated calc → awaiting (not scary 0)
  const octEmpty = {
    balances: {
      p1: { bruk: null, spare: null },
      p2: { bruk: null, spare: null }
    },
    budgets: { cMat: { felles: 5000 } },
    plannedIncome: {
      p1: { lønn: 25000, ekstra: null },
      p2: { lønn: 15000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const cOctEmpty = Calc.calcFamily(octEmpty, people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOctEmpty.safeToSpendMode, "plan", "oct empty plan fallback (På konto optional)");
  assert(cOctEmpty.needsSaldoForSafeToSpend !== true, "oct empty needsSaldo not blocking");
  assert(cOctEmpty.safeToSpend != null, "oct empty primary from plan (not forced Sett på konto)");
  assert(cOctEmpty.safeToSpendPlanRaw < 0, "oct plan raw negative (old scary path)");
  assertEq(
    cOctEmpty.safeToSpendPlan,
    cOctEmpty.safeToSpendPlanRaw,
    "oct plan allows negative (primary unused while awaiting)"
  );

  // Suggested seed from confirmed Sep: Trygg = 71223 (planned already in seed)
  const monthsSeed = {
    "2026-09": {
      balances: {
        p1: { bruk: 150000, spare: 0 },
        p2: { bruk: 81223, spare: 0 }
      },
      balancesUpdatedAt: "2026-09-17T12:00:00.000Z",
      budgets: { cMat: { felles: 5000 } },
      plannedIncome: {
        p1: { lønn: 25000, ekstra: null },
        p2: { lønn: 15000, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };
  const sug = Calc.ensureSuggestedBalances(monthsSeed, "2026-10", people, planned);
  assert(sug.seeded === true, "seeded oct from sep");
  const cOctSeed = Calc.calcFamily(monthsSeed["2026-10"], people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOctSeed.safeToSpendMode, "saldo", "oct seeded saldo");
  assertEq(cOctSeed.totalBruk, 71223, "oct seeded total");
  assertEq(cOctSeed.futureReserve, 0, "oct reserve excludes baked-in planned");
  assertEq(cOctSeed.safeToSpend, 71223, "oct Trygg after seed");
  assert(monthsSeed["2026-10"].balances.p1.suggestedAfterPlans === true, "suggestedAfterPlans");

  // Bekreft clears suggested — without reflectedInBalance would double-hit to ~0
  Calc.clearSuggestedBalanceFlag(monthsSeed["2026-10"], "p1");
  Calc.clearSuggestedBalanceFlag(monthsSeed["2026-10"], "p2");
  monthsSeed["2026-10"].balancesUpdatedAt = "2026-10-01T12:00:00.000Z";
  Calc.markPlannedSpendsReflectedInBalance(planned, "2026-10");
  const cOctConfirmed = Calc.calcFamily(monthsSeed["2026-10"], people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOctConfirmed.futureReserve, 0, "after Bekreft: no second reserve");
  assertEq(cOctConfirmed.safeToSpend, 71223, "after Bekreft Trygg still 71223");
  assert(cOctConfirmed.hasSuggestedBalances !== true, "no suggested after confirm");

  // Manual full bank in target month (no seed) still reserves same-month until done
  const octManual = {
    balances: {
      p1: { bruk: 150000, spare: 0 },
      p2: { bruk: 81223, spare: 0 }
    },
    budgets: { cMat: { felles: 5000 } },
    plannedIncome: {
      p1: { lønn: 25000, ekstra: null },
      p2: { lønn: 15000, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const plannedOpen = [
    {
      id: "ps1",
      amount: 160000,
      monthKey: "2026-10",
      categoryId: "cBil",
      owner: "felles",
      done: false
    }
  ];
  const cOctManual = Calc.calcFamily(octManual, people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: plannedOpen,
    spendBuffer: 0
  });
  assertEq(cOctManual.futureReserve, 160000, "manual full bank still reserves same-month");
  assertEq(cOctManual.safeToSpend, 71223, "manual Trygg = bruk − reserve");

  // Sep still holds back strictly later month
  assertEq(
    Calc.plannedSpendReserve(plannedOpen, "2026-09", []),
    160000,
    "sep hold-back monthKey > Sep"
  );

  // Estimate helper: prev bruk − planned
  assert(typeof Calc.estimateSafeFromPrevBruk === "function", "estimate helper");
  assertEq(
    Calc.estimateSafeFromPrevBruk(231223, 160000),
    71223,
    "estimate from prev"
  );
  assert(Calc.estimateSafeFromPrevBruk(null, 160000) == null, "estimate null prev");
}


// --- No-flag seed match: Oct bruk=71223 without suggested → future 0 ---
console.log("\n34. Same-month planned: no-flag seed match + negative Trygg");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cBil", name: "Bil", type: "variabel", owner: "felles", archived: false }
  ];
  const planned = [
    {
      id: "ps1",
      amount: 160000,
      monthKey: "2026-10",
      categoryId: "cBil",
      owner: "felles",
      done: false
    }
  ];
  const months = {
    "2026-09": {
      balances: {
        p1: { bruk: 150000, spare: 0 },
        p2: { bruk: 81223, spare: 0 }
      },
      balancesUpdatedAt: "2026-09-17T12:00:00.000Z",
      budgets: {},
      plannedIncome: { p1: { lønn: 25000 }, p2: { lønn: 15000 } },
      incomes: [],
      savings: [],
      expenses: []
    },
    "2026-10": {
      // Live data after partial migrate: seed amount WITHOUT flags
      balances: {
        p1: { bruk: 70000, spare: null, suggested: false, suggestedAfterPlans: false },
        p2: { bruk: 1223, spare: null, suggested: false, suggestedAfterPlans: false }
      },
      budgets: {},
      plannedIncome: { p1: { lønn: 25000 }, p2: { lønn: 15000 } },
      incomes: [],
      savings: [],
      expenses: []
    }
  };

  assertEq(
    Calc.computeSuggestedBrukFromPrev(231223, 160000),
    71223,
    "Sep 231223 − bil 160000 = 71223"
  );

  const cSep = Calc.calcFamily(months["2026-09"], people, cats, {
    monthKey: "2026-09",
    monthIndex: 8,
    plannedSpends: planned,
    spendBuffer: 0,
    months: months
  });
  assertEq(cSep.safeToSpend, 71223, "Sep Trygg 71223 (hold-back)");
  assertEq(cSep.futureReserve, 160000, "Sep futureReserve bil");

  // Without months map (old bug path): would reserve 160k → 0
  const cOctNoMap = Calc.calcFamily(months["2026-10"], people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  // No prev → cannot heuristic; still reserves (manual-looking)
  assertEq(cOctNoMap.futureReserve, 160000, "without months: still reserves (no prev)");

  const cOct = Calc.calcFamily(months["2026-10"], people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0,
    months: months
  });
  assertEq(cOct.totalBruk, 71223, "Oct bruk 71223 without flags");
  assertEq(cOct.futureReserve, 0, "Oct future 0 — seed match prevents double hit");
  assertEq(cOct.safeToSpend, 71223, "Oct Trygg 71223 (no Math.max 0)");
  assert(
    Calc.brukReflectsSameMonthPlans(
      months["2026-10"],
      months["2026-09"],
      "2026-10",
      planned,
      people
    ) === true,
    "heuristic: bruk reflects plans"
  );

  // Heal path marks reflected
  const planned2 = [
    {
      id: "ps1",
      amount: 160000,
      monthKey: "2026-10",
      categoryId: "cBil",
      owner: "felles",
      done: false
    }
  ];
  const heal = Calc.ensureSuggestedBalances(months, "2026-10", people, planned2);
  assertEq(heal.reason, "healed-reflected", "ensure heals reflected");
  assert(planned2[0].reflectedInBalance === true, "plan marked reflected by heal");

  // Negative Trygg: bruk < strictly-later plans (no same-month bake-in)
  const plannedLater = [
    {
      id: "ps2",
      amount: 100000,
      monthKey: "2026-11",
      categoryId: "cBil",
      owner: "felles",
      done: false
    }
  ];
  const octLow = {
    balances: {
      p1: { bruk: 20000, spare: 0 },
      p2: { bruk: 10000, spare: 0 }
    },
    budgets: {},
    plannedIncome: { p1: { lønn: 25000 }, p2: { lønn: 15000 } },
    incomes: [],
    savings: [],
    expenses: []
  };
  const cNeg = Calc.calcFamily(octLow, people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: plannedLater,
    spendBuffer: 0
  });
  assertEq(cNeg.futureReserve, 100000, "later-month reserve");
  assertEq(cNeg.totalBruk, 30000, "low bruk");
  assertEq(cNeg.safeToSpendNowRaw, -70000, "nå raw negative");
  assertEq(cNeg.safeToSpendNow, -70000, "nå allows negative (no Math.max 0)");
  assertEq(cNeg.safeToSpend, -70000, "primary Trygg negative");
  assert(cNeg.safeToSpendIfBudgetUsed <= cNeg.safeToSpend, "if-used ≤ nå");
  assert(cNeg.safeToSpendIfBudgetUsed < 0, "secondary also negative");

  // Plan mode primary also unclamped
  const cPlanNeg = Calc.calcFamily(octLow, people, cats, {
    useSaldoInSafeToSpend: false,
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: plannedLater,
    spendBuffer: 0
  });
  assertEq(cPlanNeg.safeToSpendMode, "plan", "plan mode");
  assert(cPlanNeg.safeToSpendRaw < 0, "plan raw negative");
  assertEq(cPlanNeg.safeToSpend, cPlanNeg.safeToSpendRaw, "plan primary no clamp");
}


// --- Virtual carry pot: optional På konto, automatic roll ---
console.log("\n35. Virtual carry pot — skip På konto, bil once, good/bad months");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cLan", name: "Lån", type: "fast", owner: "felles", archived: false, autoSpend: true },
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const planned = [
    {
      id: "bil1",
      amount: 160000,
      owner: "p1",
      monthKey: "2026-10",
      note: "Ny bil",
      done: false
    }
  ];
  const months = {
    "2026-09": {
      balances: {
        p1: { bruk: 231223, spare: null, when: "dated", asOf: "2026-09-17" },
        p2: { bruk: null, spare: null, when: "after_salary", asOf: null }
      },
      balancesUpdatedAt: "2026-09-17T17:32:19.592Z",
      budgets: { cLan: { felles: 20000 }, cMat: { felles: 5000 } },
      plannedIncome: {
        p1: { lønn: 40910, ekstra: 3732 },
        p2: { lønn: 31500, ekstra: null }
      },
      incomes: [],
      savings: [],
      expenses: []
    }
  };

  // Oct seed = 231223 − 160000 = 71223 (bil once), no bank confirm
  const rOct = Calc.ensureSuggestedBalances(months, "2026-10", people, {
    plannedSpends: planned,
    categories: cats
  });
  assert(rOct.seeded === true, "oct seeded");
  assertEq(months["2026-10"].balances.p1.bruk, 71223, "oct pot after bil");
  assert(!months["2026-10"].balancesUpdatedAt, "oct not confirmed");
  const cOct = Calc.calcFamily(months["2026-10"], people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: planned,
    spendBuffer: 0
  });
  assertEq(cOct.safeToSpendMode, "saldo", "oct saldo from pot");
  assertEq(cOct.safeToSpend, 71223, "oct Trygg from pot (bil not double)");
  assert(cOct.needsSaldoForSafeToSpend !== true, "oct no blocking needsSaldo");

  // Modest variable only (no planInn invent): end = 71223 − 2000
  months["2026-10"].plannedIncome = {
    p1: { lønn: 40000, ekstra: null },
    p2: { lønn: 31500, ekstra: null }
  };
  months["2026-10"].budgets = { cLan: { felles: 20000 }, cMat: { felles: 5000 } };
  months["2026-10"].expenses = [
    { id: "e1", owner: "p1", categoryId: "cMat", amount: 2000 }
  ];
  const endGood = Calc.computeCarryEndBrukForPerson(
    months["2026-10"],
    "p1",
    people,
    { categories: cats, monthIndex: 9, monthKey: "2026-10", plannedSpends: planned }
  );
  assertEq(endGood, 69223, "modest spend end = start − 2000 (no planInn)");
  const rNov = Calc.ensureSuggestedBalances(months, "2026-11", people, {
    plannedSpends: planned,
    categories: cats
  });
  assert(rNov.seeded === true, "nov seeded from virtual");
  assert(rNov.fromCarry === true, "nov fromCarry");
  assertEq(
    months["2026-11"].balances.p1.bruk,
    69223,
    "nov pot = oct end after modest spend"
  );

  // Logged income may raise pot; planned lønn alone must not
  months["2026-10"].incomes = [
    { id: "i1", person: "p1", type: "lønn", amount: 40000 }
  ];
  delete months["2026-10"].carryPot;
  const endWithLogged = Calc.computeCarryEndBrukForPerson(
    months["2026-10"],
    "p1",
    people,
    { categories: cats, monthIndex: 9, monthKey: "2026-10", plannedSpends: planned }
  );
  assertEq(endWithLogged, 109223, "logged income added: 71223-2000+40000");
  months["2026-10"].incomes = [];

  // Bad month path: overspend → lower / negative
  const monthsBad = JSON.parse(JSON.stringify({
    "2026-10": months["2026-10"]
  }));
  // reset oct to seed only
  monthsBad["2026-10"].balances.p1.bruk = 71223;
  monthsBad["2026-10"].balances.p1.suggested = true;
  monthsBad["2026-10"].balancesSuggested = true;
  delete monthsBad["2026-10"].balancesUpdatedAt;
  monthsBad["2026-10"].expenses = [
    { id: "eBig", owner: "p1", categoryId: "cMat", amount: 120000 }
  ];
  const endBad = Calc.computeCarryEndBrukForPerson(
    monthsBad["2026-10"],
    "p1",
    people,
    { categories: cats, monthIndex: 9 }
  );
  assert(endBad < 71223, "bad month lowers pot");
  Calc.ensureSuggestedBalances(monthsBad, "2026-11", people, {
    plannedSpends: [],
    categories: cats
  });
  assert(
    monthsBad["2026-11"].balances.p1.bruk < 71223,
    "nov lower/negative after bad oct"
  );

  // Optional bank confirm resets pot
  months["2026-11"].balances.p1.bruk = 95000;
  months["2026-11"].balances.p1.suggested = false;
  months["2026-11"].balances.p1.fromCarryPot = false;
  months["2026-11"].balancesUpdatedAt = "2026-11-15T12:00:00.000Z";
  delete months["2026-11"].balancesSuggested;
  const rDec = Calc.ensureSuggestedBalances(months, "2026-12", people, {
    plannedSpends: [],
    categories: cats
  });
  assert(rDec.seeded === true, "dec from bank reset");
  assertEq(months["2026-12"].balances.p1.bruk, 95000, "dec pot = confirmed bank");
}



// --- Month jump seed + no planInn explode + always Trygg number ---
console.log("\n36. Sep→Nov jump seed; Oct spend → Nov; no blank Trygg");
{
  const people = Calc.defaultPeople();
  const cats = [
    { id: "cMat", name: "Mat", type: "variabel", owner: "felles", archived: false }
  ];
  const bil = [
    {
      id: "bil1",
      amount: 160000,
      owner: "p1",
      monthKey: "2026-10",
      note: "Ny bil",
      done: false
    }
  ];
  const sep = {
    balances: {
      p1: { bruk: 231223, spare: null, when: "dated", asOf: "2026-09-17" },
      p2: { bruk: null, spare: null, when: "after_salary", asOf: null }
    },
    balancesUpdatedAt: "2026-09-17T17:32:19.592Z",
    budgets: { cMat: { felles: 5000 } },
    plannedIncome: {
      p1: { lønn: 40910, ekstra: 3732 },
      p2: { lønn: 31500, ekstra: null }
    },
    incomes: [],
    savings: [],
    expenses: []
  };

  // Sep→Oct both ~71223
  const monthsOct = { "2026-09": JSON.parse(JSON.stringify(sep)) };
  const rOct = Calc.ensureSuggestedBalances(monthsOct, "2026-10", people, {
    plannedSpends: bil,
    categories: cats
  });
  assert(rOct.seeded === true, "36 oct seeded");
  assertEq(monthsOct["2026-10"].balances.p1.bruk, 71223, "36 oct 71223");
  const cSep = Calc.calcFamily(monthsOct["2026-09"], people, cats, {
    monthKey: "2026-09",
    monthIndex: 8,
    plannedSpends: bil,
    spendBuffer: 0
  });
  assertEq(cSep.safeToSpend, 71223, "36 sep Trygg 71223 (reserve bil)");
  const cOct = Calc.calcFamily(monthsOct["2026-10"], people, cats, {
    monthKey: "2026-10",
    monthIndex: 9,
    plannedSpends: bil,
    spendBuffer: 0
  });
  assertEq(cOct.safeToSpend, 71223, "36 oct Trygg 71223");

  // Sep→Nov jump (Oct never seeded): subtract Oct bil once → ~71223, not 231223, not empty
  const monthsJump = { "2026-09": JSON.parse(JSON.stringify(sep)) };
  const rJump = Calc.ensureSuggestedBalances(monthsJump, "2026-11", people, {
    plannedSpends: bil,
    categories: cats
  });
  assert(rJump.seeded === true, "36 nov jump seeded");
  assertEq(
    monthsJump["2026-11"].balances.p1.bruk,
    71223,
    "36 nov jump 71223 (oct bil once)"
  );
  assert(
    monthsJump["2026-11"].balances.p1.bruk !== 231223,
    "36 nov not raw sep bank"
  );
  const cNovJump = Calc.calcFamily(monthsJump["2026-11"], people, cats, {
    monthKey: "2026-11",
    monthIndex: 10,
    plannedSpends: bil,
    spendBuffer: 0
  });
  assert(typeof cNovJump.safeToSpend === "number", "36 nov Trygg is number");
  assertEq(cNovJump.safeToSpend, 71223, "36 nov Trygg 71223");
  assert(cNovJump.needsSaldoForSafeToSpend !== true, "36 nov not blank/needsSaldo");

  // After Oct variable 10k, Nov lower by ~10k
  const monthsSpend = { "2026-09": JSON.parse(JSON.stringify(sep)) };
  Calc.ensureSuggestedBalances(monthsSpend, "2026-10", people, {
    plannedSpends: bil,
    categories: cats
  });
  monthsSpend["2026-10"].expenses = [
    { id: "e10k", owner: "p1", categoryId: "cMat", amount: 10000 }
  ];
  const endOct = Calc.computeCarryEndBrukForPerson(
    monthsSpend["2026-10"],
    "p1",
    people,
    { categories: cats, monthKey: "2026-10", plannedSpends: bil }
  );
  assertEq(endOct, 61223, "36 oct end after 10k = 61223");
  Calc.refreshMonthCarryPot(monthsSpend, "2026-10", people, {
    categories: cats,
    monthKey: "2026-10",
    plannedSpends: bil
  });
  const rNovSpend = Calc.ensureSuggestedBalances(monthsSpend, "2026-11", people, {
    plannedSpends: bil,
    categories: cats
  });
  assert(rNovSpend.seeded === true, "36 nov after spend seeded");
  assertEq(
    monthsSpend["2026-11"].balances.p1.bruk,
    61223,
    "36 nov lower by 10k"
  );

  // Range helper
  const rangeDeduct = Calc.openPlannedSpendDeductionForPersonRange(
    bil,
    "2026-09",
    "2026-11",
    "p1",
    people
  );
  assertEq(rangeDeduct, 160000, "36 range Sep..Nov = oct bil");
}



// --- §37 Calc-time display bruk fallback (persist-fail safe) + 12m projection ---
{
  console.log("\n§37 display-fallback + projectPotFollowBudget");
  const people = [
    { id: "p1", name: "Mathias", archived: false },
    { id: "p2", name: "Andrea", archived: false }
  ];
  const cats = [
    { id: "cFast", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "p1", archived: false }
  ];
  const bil = [
    {
      id: "bil1",
      amount: 160000,
      owner: "p1",
      monthKey: "2026-10",
      note: "Ny bil",
      done: false
    }
  ];
  function emptyM() {
    return {
      balances: {
        p1: { bruk: null, spare: null, when: "after_salary", asOf: null },
        p2: { bruk: null, spare: null, when: "after_salary", asOf: null }
      },
      budgets: { cFast: { felles: 30000 }, cMat: { p1: 10000 } },
      budgetLines: {},
      plannedIncome: {
        p1: { lønn: 40000, ekstra: 0 },
        p2: { lønn: 30000, ekstra: 0 }
      },
      incomes: [],
      savings: [],
      expenses: []
    };
  }
  const sep = emptyM();
  sep.balances.p1.bruk = 231223;
  sep.balancesUpdatedAt = "2026-09-17T17:32:19.592Z";

  // Unseeded Oct/Nov (persist failed) — calc-time fallback must still show 71223
  const months = {
    "2026-09": JSON.parse(JSON.stringify(sep)),
    "2026-10": emptyM(),
    "2026-11": emptyM()
  };
  // Copy budgets into oct/nov
  months["2026-10"].budgets = JSON.parse(JSON.stringify(sep.budgets));
  months["2026-10"].plannedIncome = JSON.parse(JSON.stringify(sep.plannedIncome));
  months["2026-11"].budgets = JSON.parse(JSON.stringify(sep.budgets));
  months["2026-11"].plannedIncome = JSON.parse(JSON.stringify(sep.plannedIncome));

  assert(
    months["2026-10"].balances.p1.bruk == null,
    "37 oct bruk still null (unpersisted)"
  );

  const fbOct = Calc.resolveDisplayBrukFallback(
    months,
    "2026-10",
    people,
    bil,
    cats
  );
  assert(fbOct && fbOct.fromFallback, "37 oct fallback object");
  assertEq(fbOct.byPerson.p1, 71223, "37 oct fallback 71223");

  const cOct = Calc.calcFamily(
    months["2026-10"],
    people,
    cats,
    { useSaldoInSafeToSpend: true, spendBuffer: 0, months: months },
    9,
    bil,
    "2026-10"
  );
  assertEq(cOct.totalBruk, 71223, "37 oct totalBruk via fallback");
  assertEq(cOct.safeToSpend, 71223, "37 oct Trygg 71223 not 0");
  assert(cOct.brukFromDisplayFallback === true, "37 oct flag fallback");
  assertEq(cOct.futureReserve, 0, "37 oct bil not double-counted");
  assert(cOct.safeToSpendMode === "saldo", "37 oct saldo mode");

  const cNov = Calc.calcFamily(
    months["2026-11"],
    people,
    cats,
    { useSaldoInSafeToSpend: true, spendBuffer: 0, months: months },
    10,
    bil,
    "2026-11"
  );
  assertEq(cNov.totalBruk, 71223, "37 nov totalBruk via fallback (jump)");
  assertEq(cNov.safeToSpend, 71223, "37 nov Trygg 71223 not blank");
  assert(cNov.brukFromDisplayFallback === true, "37 nov flag fallback");

  const cSep = Calc.calcFamily(
    months["2026-09"],
    people,
    cats,
    { useSaldoInSafeToSpend: true, spendBuffer: 0, months: months },
    8,
    bil,
    "2026-09"
  );
  assertEq(cSep.safeToSpend, 71223, "37 sep Trygg 71223 (reserve bil)");
  assert(cSep.brukFromDisplayFallback !== true, "37 sep not fallback");

  // 12-month projection unit test
  assert(typeof Calc.projectPotFollowBudget === "function", "37 project fn");
  // Ensure a few future months exist with budgets
  for (const k of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
    if (!months[k]) months[k] = emptyM();
    months[k].budgets = JSON.parse(JSON.stringify(sep.budgets));
    months[k].plannedIncome = JSON.parse(JSON.stringify(sep.plannedIncome));
  }
  const proj = Calc.projectPotFollowBudget({
    months: months,
    fromKey: "2026-09",
    people: people,
    categories: cats,
    plannedSpends: bil,
    startPot: 231223,
    horizon: 12
  });
  assertEq(proj.months.length, 12, "37 proj 12 rows");
  // Oct: 231223 + 70000 - 30000 Fast - 10000 var - 160000 = 101223
  assertEq(proj.months[0].monthKey, "2026-10", "37 proj first oct");
  assertEq(proj.months[0].plannedSpends, 160000, "37 proj oct bil once");
  assertEq(proj.months[0].planUtFixed, 30000, "37 proj oct Fast");
  assertEq(proj.months[0].pot, 101223, "37 proj oct pot");
  assert(typeof proj.potAtHorizon === "number", "37 potAtHorizon number");
  assert(Number.isFinite(proj.potAtHorizon), "37 potAtHorizon finite");
  // Bil not applied again in Nov
  assertEq(proj.months[1].plannedSpends, 0, "37 proj nov no bil");
}

// --- §38 Multi-year pot projection (12y / Nov 2038) ---
{
  console.log("\n§38 multi-year projectPotFollowBudget");
  const people = [
    { id: "p1", name: "Mathias", archived: false },
    { id: "p2", name: "Andrea", archived: false }
  ];
  const cats = [
    { id: "cFast", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "p1", archived: false }
  ];
  // Only Sep present — future months must virtual-carry budget/income
  const sep = {
    balances: {
      p1: { bruk: 100000, spare: null, when: "after_salary", asOf: null },
      p2: { bruk: null, spare: null, when: "after_salary", asOf: null }
    },
    budgets: { cFast: { felles: 20000 }, cMat: { p1: 5000 } },
    budgetLines: {},
    plannedIncome: {
      p1: { lønn: 30000, ekstra: 0 },
      p2: { lønn: 20000, ekstra: 0 }
    },
    incomes: [],
    savings: [],
    expenses: []
  };
  const bil = [
    {
      id: "bil1",
      amount: 40000,
      owner: "p1",
      monthKey: "2026-10",
      note: "Bil",
      done: false
    }
  ];
  const months = { "2026-09": sep };
  // Monthly net = planInn 50000 − Fast 20000 − planUtVar 5000 = +25000
  // Oct: 100000 + 25000 − 40000 = 85000
  const long = Calc.projectPotFollowBudget({
    months: months,
    fromKey: "2026-09",
    people: people,
    categories: cats,
    plannedSpends: bil,
    startPot: 100000,
    horizon: 144
  });
  assertEq(long.months.length, 144, "38 144 months");
  assertEq(long.months[0].monthKey, "2026-10", "38 first oct");
  assertEq(long.months[0].pot, 85000, "38 oct after bil once");
  assertEq(long.months[1].monthKey, "2026-11", "38 nov key");
  assertEq(long.months[1].plannedSpends, 0, "38 bil not repeated");
  assertEq(long.months[1].pot, 110000, "38 nov +25000");
  // Empty months still have planInn via virtual carry
  assertEq(long.months[1].planInn, 50000, "38 virtual planInn");
  assertEq(long.months[1].planUtFixed, 20000, "38 virtual planUtFixed");
  assertEq(long.months[1].planUtVariable, 5000, "38 virtual planUtVar");
  // Horizon = Sep 2026 + 144m = Sep 2038
  assertEq(long.months[143].monthKey, "2038-09", "38 horizon Sep 2038");
  assert(long.milestones && long.milestones.m12, "38 m12 milestone");
  assertEq(long.milestones.m12.monthKey, "2027-09", "38 om 1 år = Sep 2027");
  assertEq(long.milestones.m60.monthKey, "2031-09", "38 om 5 år = Sep 2031");
  assertEq(long.milestones.m144.monthKey, "2038-09", "38 om 12 år = Sep 2038");
  // Nov 2038 not in 144 from Sep (ends Sep 2038) — extend for pick
  const longer = Calc.projectPotFollowBudget({
    months: months,
    fromKey: "2026-09",
    people: people,
    categories: cats,
    plannedSpends: bil,
    startPot: 100000,
    horizon: 146 // through Nov 2038
  });
  assertEq(longer.potByKey["2038-11"], longer.months[145].pot, "38 potByKey Nov 2038");
  assert(Number.isFinite(longer.potByKey["2038-11"]), "38 Nov 2038 finite");
  // After Oct bil: pot at month index i = 85000 + 25000*i
  assertEq(longer.months[145].monthKey, "2038-11", "38 row Nov 2038");
  assertEq(longer.months[145].pot, 3710000, "38 Nov 2038 pot formula");
  // byYear has Dec entries
  assert(longer.byYear.length >= 12, "38 byYear >= 12 decembers");
  assertEq(longer.byYear[0].monthKey, "2026-12", "38 first year-end Dec 2026");
  // Dec 2026 = month index 2 → 85000 + 25000*2 = 135000
  assertEq(longer.byYear[0].pot, 135000, "38 Dec 2026 pot");
  // Does not mutate months map with shells
  assertEq(Object.keys(months).length, 1, "38 no month persist bloat");
  assert(
    typeof longer.formula === "string" &&
      longer.formula.indexOf("planInn") >= 0 &&
      longer.formula.indexOf("planUtFixed") >= 0,
    "38 formula includes Fast"
  );
}


// --- §39 Month isolation (health) + Fremover delta / 2038 ---
{
  console.log("\n§39 month health isolation + forward delta to 2038");
  const fs = require("fs");
  const path = require("path");
  const { fileURLToPath } = require("url");
  const livePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "familie-budsjett-export-live.json");
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(livePath, "utf8"));
  } catch (e) {
    live = null;
  }
  assert(live && live.months, "39 live export present");
  if (!live || !live.months) {
    console.log("  (skipping §39 body — no live export)");
  } else {
  const months = JSON.parse(JSON.stringify(live.months));
  const people = live.people;
  const cats = live.categories;
  const planned = live.plannedSpends || [];
  const settings = Object.assign({}, live.settings || {}, { months });

  function ensureAndCalc(key) {
    Calc.ensureMonthExpected(months, key, people, {
      copyExpectedToNewMonths: true,
      categories: cats,
      plannedSpends: planned
    });
    if (typeof Calc.ensureSuggestedBalances === "function") {
      Calc.ensureSuggestedBalances(months, key, people, {
        plannedSpends: planned,
        categories: cats
      });
    }
    const mi = Number(key.split("-")[1]) - 1;
    return Calc.calcFamily(months[key], people, cats, settings, mi, planned, key);
  }

  const sep = ensureAndCalc("2026-09");
  const oct = ensureAndCalc("2026-10");
  const nov = ensureAndCalc("2026-11");
  assertEq(sep.expenseCount, 23, "39 sep has expenses");
  assertEq(oct.expenseCount, 0, "39 oct empty expenses");
  assertEq(nov.expenseCount, 0, "39 nov empty expenses");
  assert(sep.healthBudgeted > 0, "39 sep healthBudgeted > 0");
  assertEq(sep.healthBudgeted, sep.actualBudgeted, "39 sep health = actual (has logs)");
  assertEq(oct.healthBudgeted, 0, "39 oct healthBudgeted 0 (no invent Fast)");
  assertEq(nov.healthBudgeted, 0, "39 nov healthBudgeted 0");
  assert(oct.actualBudgeted > 0, "39 oct actualBudgeted still has Fast auto for Trygg math");
  assertEq(oct.loggedBudgeted, 0, "39 oct loggedBudgeted 0");
  // Expense arrays must not be shared
  assert(
    months["2026-10"].expenses !== months["2026-11"].expenses,
    "39 oct/nov expenses distinct refs"
  );
  assert(
    months["2026-09"].expenses !== months["2026-10"].expenses,
    "39 sep/oct expenses distinct refs"
  );

  // Past empty month must not inherit 2026 health
  const jan24 = ensureAndCalc("2024-01");
  assertEq(jan24.healthBudgeted, 0, "39 jan 2024 health 0");
  assertEq(jan24.expenseCount, 0, "39 jan 2024 no expenses");

  // Projection deltas + Nov 2026 ≠ Nov 2038
  assert(typeof Calc.monthsBetweenKeys === "function", "39 monthsBetweenKeys");
  assertEq(Calc.monthsBetweenKeys("2026-09", "2026-11"), 2, "39 between 2");
  assertEq(Calc.monthsBetweenKeys("2026-09", "2038-11"), 146, "39 between to 2038-11");

  const proj = Calc.projectPotFollowBudget({
    months,
    fromKey: "2026-09",
    people,
    categories: cats,
    plannedSpends: planned,
    startPot: 231223,
    horizon: 156
  });
  assert(proj.months[0].delta != null, "39 first row has delta");
  assert(
    Number.isFinite(proj.potByKey["2026-11"]),
    "39 pot Nov 2026"
  );
  assert(
    Number.isFinite(proj.potByKey["2038-11"]),
    "39 pot Nov 2038"
  );
  assert(
    proj.potByKey["2038-11"] !== proj.potByKey["2026-11"],
    "39 Nov 2038 ≠ Nov 2026"
  );
  assert(
    proj.potByKey["2038-11"] > proj.potByKey["2026-11"],
    "39 Nov 2038 accumulates above Nov 2026"
  );
  // Fast must be in the monthly delta (not the old +63542 fantasy without Fast)
  assertEq(proj.months[2].planUtFixed, 31323, "39 Dec includes Fast");
  assertEq(proj.months[2].delta, 32219, "39 steady delta = inn−Fast−var");
  assert(
    proj.potByKey["2038-11"] < 5000000,
    "39 Nov 2038 not ~9.8M fantasy (Fast subtracted)"
  );
  assertEq(proj.potByKey["2026-10"], 98800, "39 Oct pot after bil+Fast");
  assertEq(proj.potByKey["2026-11"], 131019, "39 Nov 2026 pot");
  assertEq(proj.potByKey["2038-11"], 4750647, "39 Nov 2038 pot");
  // Flat monthly delta after bil month should be explained (same delta, rising pot)
  const d1 = proj.months[2].delta;
  const d2 = proj.months[3].delta;
  assertEq(d1, d2, "39 steady delta after bil month");
  assert(
    proj.months[3].pot > proj.months[2].pot,
    "39 cumulative pot still rises when delta flat"
  );
  assert(proj.byYear.length >= 12, "39 byYear has many years");
  const y2038 = proj.byYear.find((y) => y.year === 2038);
  assert(y2038, "39 byYear includes 2038");
  } // end live export body
}


// --- §40 Near empty months: Oversikt projects pot (Oct ≠ Nov ≠ Dec) ---
{
  console.log("\n§40 near-empty Oversikt projection (not frozen seed)");
  assert(
    typeof Calc.shouldUseProjectedPotForOversikt === "function",
    "40 helper exported"
  );
  // Gate: near seeded empty → project; confirmed → no; current month ahead=0 → no
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 1,
      viewEmpty: true,
      balancesSuggested: true,
      balancesUpdatedAt: false
    }) === true,
    "40 Oct seed empty → use projection"
  );
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 2,
      viewEmpty: true,
      balancesSuggested: true,
      balancesUpdatedAt: false
    }) === true,
    "40 Nov seed empty → use projection"
  );
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 3,
      viewEmpty: true,
      balancesSuggested: true,
      balancesUpdatedAt: false
    }) === true,
    "40 Dec seed empty → use projection"
  );
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 0,
      viewEmpty: true,
      balancesSuggested: true,
      balancesUpdatedAt: false
    }) === false,
    "40 current month ahead=0 → no projection override"
  );
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 1,
      viewEmpty: true,
      balancesSuggested: true,
      balancesUpdatedAt: true
    }) === false,
    "40 confirmed På konto → keep real Trygg"
  );
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 1,
      viewEmpty: false,
      balancesSuggested: true,
      balancesUpdatedAt: false
    }) === false,
    "40 month with expenses → no projection override"
  );
  assert(
    Calc.shouldUseProjectedPotForOversikt({
      ahead: 146,
      viewEmpty: true,
      balancesSuggested: false,
      balancesUpdatedAt: false
    }) === true,
    "40 far future without seed still projects"
  );

  const fs = require("fs");
  const path = require("path");
  const { fileURLToPath } = require("url");
  const livePath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "familie-budsjett-export-live.json"
  );
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(livePath, "utf8"));
  } catch (e) {
    live = null;
  }
  assert(live && live.months, "40 live export present");
  if (live && live.months) {
    const months = JSON.parse(JSON.stringify(live.months));
    const people = live.people;
    const cats = live.categories;
    const planned = live.plannedSpends || [];
    ["2026-09", "2026-10", "2026-11", "2026-12", "2027-01"].forEach((key) => {
      Calc.ensureMonthExpected(months, key, people, {
        copyExpectedToNewMonths: true,
        categories: cats,
        plannedSpends: planned
      });
    });
    // Seed left Oct/Nov/Dec at same ~71223 — that freeze was the bug on Oversikt
    assertEq(months["2026-10"].balances.p1.bruk, 71223, "40 oct seed 71223");
    assertEq(months["2026-11"].balances.p1.bruk, 71223, "40 nov seed 71223");
    assertEq(months["2026-12"].balances.p1.bruk, 71223, "40 dec seed 71223");

    const proj = Calc.projectPotFollowBudget({
      months,
      fromKey: "2026-09",
      people,
      categories: cats,
      plannedSpends: planned,
      startPot: 231223,
      horizon: 16
    });
    const oct = proj.potByKey["2026-10"];
    const nov = proj.potByKey["2026-11"];
    const dec = proj.potByKey["2026-12"];
    const jan = proj.potByKey["2027-01"];
    assertEq(oct, 98800, "40 oct projected pot after bil+Fast+flows");
    assertEq(nov, 131019, "40 nov projected pot");
    assertEq(dec, 163238, "40 dec projected pot");
    assertEq(jan, 195457, "40 jan 2027 projected pot");
    assert(oct !== nov, "40 Oct ≠ Nov");
    assert(nov !== dec, "40 Nov ≠ Dec");
    assert(dec !== jan, "40 Dec ≠ Jan");
    assert(nov > oct, "40 pot rises Nov after Oct bil hit");
    assert(dec > nov, "40 pot rises Dec");
    // UI gate would replace seed with these pots for ahead 1..3
    assert(
      Calc.shouldUseProjectedPotForOversikt({
        ahead: 1,
        viewEmpty: true,
        balancesSuggested: true
      }),
      "40 UI would show oct projection not seed"
    );
  }
}


// --- §41 Personal-scope projectPotFollowBudget (p1 ≠ household dual income) ---
{
  console.log("\n§41 personal scope: Mathias planInn only, not dual income");
  const fs = require("fs");
  const path = require("path");
  const { fileURLToPath } = require("url");
  const livePathQa = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "familie-budsjett-export-live-qa.json"
  );
  let live = null;
  try {
    live = JSON.parse(fs.readFileSync(livePathQa, "utf8"));
  } catch (e) {
    live = null;
  }
  // Synthetic fallback if QA export missing
  const people = (live && live.people) || [
    { id: "p1", name: "Mathias", archived: false },
    { id: "p2", name: "Andrea", archived: false }
  ];
  const cats = (live && live.categories) || [
    { id: "cFast", name: "Lån", type: "fast", owner: "felles", archived: false },
    { id: "cMat", name: "Mat", type: "variabel", owner: "p1", archived: false }
  ];
  const planned = (live && live.plannedSpends) || [
    {
      id: "bil1",
      amount: 160000,
      owner: "p1",
      monthKey: "2026-10",
      note: "Ny bil",
      done: false
    }
  ];
  const months = live && live.months
    ? JSON.parse(JSON.stringify(live.months))
    : {
        "2026-09": {
          balances: {
            p1: { bruk: 231223, spare: null, when: "after_salary", asOf: null },
            p2: { bruk: null, spare: null, when: "after_salary", asOf: null }
          },
          balancesUpdatedAt: "2026-09-17T17:32:19.592Z",
          budgets: { cFast: { felles: 20000 }, cMat: { p1: 5000 } },
          budgetLines: {},
          plannedIncome: {
            p1: { lønn: 40000, ekstra: 0 },
            p2: { lønn: 30000, ekstra: 0 }
          },
          incomes: [],
          savings: [],
          expenses: []
        }
      };

  assert(
    typeof Calc.plannedIncomeForPerson === "function",
    "41 plannedIncomeForPerson exported"
  );
  assert(
    typeof Calc.plannedFixedBudgetForPerson === "function",
    "41 plannedFixedBudgetForPerson exported"
  );
  assert(
    typeof Calc.plannedVariableBudgetForPerson === "function",
    "41 plannedVariableBudgetForPerson exported"
  );

  const hh = Calc.projectPotFollowBudget({
    months,
    fromKey: "2026-09",
    people,
    categories: cats,
    plannedSpends: planned,
    startPot: 231223,
    horizon: 156
  });
  const mathias = Calc.projectPotFollowBudget({
    months,
    fromKey: "2026-09",
    people,
    categories: cats,
    plannedSpends: planned,
    startPot: 231223,
    horizon: 156,
    personId: "p1"
  });
  assertEq(hh.personId, null, "41 household personId null");
  assertEq(mathias.personId, "p1", "41 personal personId p1");

  const octH = hh.months[0];
  const novH = hh.months[1];
  const octP = mathias.months[0];
  const novP = mathias.months[1];
  assertEq(octH.monthKey, "2026-10", "41 hh oct key");
  assertEq(octP.monthKey, "2026-10", "41 p1 oct key");

  // Household still dual-income (~76k) — personal must be Mathias only (~40–45k)
  assert(octH.planInn > 60000, "41 hh oct planInn dual");
  assert(octP.planInn < 50000, "41 p1 oct planInn ~40k only");
  assert(novP.planInn < 50000, "41 p1 nov planInn personal");
  assert(novP.planInn !== novH.planInn, "41 p1 planInn ≠ household");

  // Expenses: personal share < household totals
  assert(
    octP.planUtFixed + octP.planUtVariable <
      octH.planUtFixed + octH.planUtVariable,
    "41 p1 utgifter < household"
  );

  // Bil is Mathias-owned → full amount on personal
  assertEq(octP.plannedSpends, 160000, "41 p1 oct bil once");
  assertEq(novP.plannedSpends, 0, "41 p1 nov no bil");

  // Steady delta after bil: personal ≪ household +32k dual-income surplus
  assert(
    Math.abs(novP.delta) < Math.abs(novH.delta) || novP.delta < novH.delta,
    "41 p1 nov delta smaller than household dual-income"
  );
  assert(novP.delta < 25000, "41 p1 nov delta not +32k dual");
  assert(novH.delta > 30000, "41 hh nov still ~+32k (unchanged)");

  const pot38H = hh.potByKey["2038-11"];
  const pot38P = mathias.potByKey["2038-11"];
  assert(Number.isFinite(pot38H) && Number.isFinite(pot38P), "41 2038 pots");
  assert(pot38P < pot38H, "41 p1 2038 pot < household fantasy");
  // Live QA export: Mathias ~+19.3k/mo → Nov 2038 ≈ 2.87M (not 4.75M)
  if (live && live.months && live.months["2026-09"]) {
    assertEq(octP.planInn, 40000, "41 live p1 oct planInn 40000");
    assertEq(novP.planInn, 44642, "41 live p1 nov planInn 44642");
    assertEq(novP.delta, 19324.2, "41 live p1 nov delta 19324.2");
    assertEq(octP.delta, -145317.8, "41 live p1 oct delta with bil");
    assertEq(pot38P, 2868006.2, "41 live p1 Nov 2038 pot");
    assertEq(novH.delta, 32219, "41 live hh nov delta unchanged 32219");
    assertEq(pot38H, 4750647, "41 live hh Nov 2038 unchanged");
  }

  // plannedUtForPerson == fixed+var person helpers
  const mNov = months["2026-11"] || months["2026-09"];
  const mi = Calc.monthIndexFromKey(
    months["2026-11"] ? "2026-11" : "2026-09"
  );
  const ut = Calc.plannedUtForPerson(mNov, "p1", cats, people, mi);
  const fx = Calc.plannedFixedBudgetForPerson(mNov, "p1", cats, people, mi);
  const vr = Calc.plannedVariableBudgetForPerson(mNov, "p1", cats, people, mi);
  assertEq(fx + vr, ut, "41 fixed+var == plannedUtForPerson");
}

console.log("\n=== Results:", passed, "passed,", failed, "failed ===\n");
if (failed) {
  console.error("FAILURES:");
  errors.forEach((e) => console.error(" -", e));
  process.exit(1);
}
process.exit(0);
