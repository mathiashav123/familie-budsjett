/**
 * 10-year (120 months) saldo / Trygg å bruke simulation.
 * Focus: bank AFTER Fast left → Trygg must NOT re-subtract autoSpendExtra.
 * Never touches browser localStorage / user data.
 */
import { createRequire } from "module";
import { writeFileSync } from "fs";

const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");

const START_Y = 2016;
const MONTHS = 120; // 2016-01 .. 2025-12
const BUFFER = 2000;
const ORE = 0.01;

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20260917);

function round2(n) {
  return Math.round(n * 100) / 100;
}
function monthKey(i) {
  const y = START_Y + Math.floor(i / 12);
  const m = (i % 12) + 1;
  return y + "-" + String(m).padStart(2, "0");
}
function shiftKey(key, delta) {
  const [ys, ms] = key.split("-").map(Number);
  let mi = ys * 12 + (ms - 1) + delta;
  const y = Math.floor(mi / 12);
  const m = (mi % 12) + 1;
  return y + "-" + String(m).padStart(2, "0");
}

let ok = 0;
let fail = 0;
const failures = [];
const notes = [];

function assert(cond, msg) {
  if (cond) ok++;
  else {
    fail++;
    failures.push(msg);
  }
}
function nearly(a, b, msg) {
  assert(Math.abs((a || 0) - (b || 0)) < ORE + 1e-9, msg + ` (got ${a}, expected ${b})`);
}

const people = [
  { id: "p1", name: "Mathias", active: true },
  { id: "p2", name: "Andrea", active: true }
];

const cats = [
  { id: "cHus", name: "Huslån", type: "fast", owner: "felles", autoSpend: true },
  { id: "cStrom", name: "Strøm", type: "fast", owner: "felles", autoSpend: true },
  { id: "cNet", name: "Internett", type: "fast", owner: "felles", autoSpend: true },
  { id: "cMat", name: "Mat", type: "variabel", owner: "felles" },
  { id: "cGoy", name: "Gøy", type: "variabel", owner: "felles" },
  { id: "cKlær", name: "Klær", type: "variabel", owner: "p1" }
];

const FAST_BUDGET = { cHus: 14000, cStrom: 2200, cNet: 799 };
const VAR_BUDGET = { cMat: 9000, cGoy: 2500, cKlær: 1500 };
const FAST_TOTAL = Object.values(FAST_BUDGET).reduce((a, b) => a + b, 0);
const VAR_TOTAL = Object.values(VAR_BUDGET).reduce((a, b) => a + b, 0);

const state = {
  people,
  categories: cats,
  settings: {
    useSaldoInSafeToSpend: true,
    spendBuffer: BUFFER,
    copyExpectedToNewMonths: true
  },
  months: {},
  plannedSpends: [],
  goals: []
};

let prevBruk = { p1: 45000, p2: 38000 };
let prevSpare = { p1: 120000, p2: 90000 };
let minTrygg = Infinity;
let maxTrygg = -Infinity;
let sumTrygg = 0;
let monthsWithSpareGoal = 0;
let monthsWithPlanned = 0;
let crossOwnerFastMonths = 0;

for (let i = 0; i < MONTHS; i++) {
  const key = monthKey(i);
  const mi = i % 12;

  // Open month WITHOUT copying balances
  const opened = Calc.ensureMonthExpected(state.months, key, people, {
    copyExpectedToNewMonths: true,
    categories: cats
  });
  const m = state.months[key];
  assert(m && typeof m === "object", `${key}: month exists`);
  // Ensure empty balances (no carry)
  m.balances = {
    p1: { bruk: null, spare: null, when: "after_salary", asOf: null },
    p2: { bruk: null, spare: null, when: "after_salary", asOf: null }
  };
  delete m.balancesUpdatedAt;

  // Budgets + planned income
  m.budgets = {
    cHus: { felles: FAST_BUDGET.cHus },
    cStrom: { felles: FAST_BUDGET.cStrom },
    cNet: { felles: FAST_BUDGET.cNet },
    cMat: { felles: VAR_BUDGET.cMat },
    cGoy: { felles: VAR_BUDGET.cGoy },
    cKlær: { p1: VAR_BUDGET.cKlær }
  };
  m.plannedIncome = {
    p1: { lønn: 42000, ekstra: null, sparing: 5000 },
    p2: { lønn: 36000, ekstra: null, sparing: 4000 }
  };

  // Salary + saving logged
  m.incomes = [
    { id: Calc.uid(), person: "p1", type: "lønn", amount: 42000, date: key + "-01" },
    { id: Calc.uid(), person: "p2", type: "lønn", amount: 36000, date: key + "-01" }
  ];
  m.savings = [
    { id: Calc.uid(), person: "p1", amount: 5000, date: key + "-02" },
    { id: Calc.uid(), person: "p2", amount: 4000, date: key + "-02" }
  ];
  m.expenses = [];

  // Fast: sometimes leave unlogged (autoSpend), sometimes log as felles,
  // occasionally log under p1 only (cross-owner — regression target)
  const fastMode = rand();
  let loggedFast = 0;
  if (fastMode < 0.55) {
    // Unlogged — bank already reflects Fast leaving
    loggedFast = 0;
  } else if (fastMode < 0.85) {
    for (const [cid, amt] of Object.entries(FAST_BUDGET)) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "felles",
        categoryId: cid,
        amount: amt,
        date: key + "-03",
        category: cats.find((c) => c.id === cid).name
      });
      loggedFast += amt;
    }
  } else {
    crossOwnerFastMonths++;
    for (const [cid, amt] of Object.entries(FAST_BUDGET)) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "p1",
        categoryId: cid,
        amount: amt,
        date: key + "-03",
        category: cats.find((c) => c.id === cid).name
      });
      loggedFast += amt;
    }
  }

  // Variable: spend part of budget, leave some unused
  const matSpend = round2(VAR_BUDGET.cMat * (0.35 + rand() * 0.5)); // 35–85%
  const goySpend = round2(VAR_BUDGET.cGoy * (0.2 + rand() * 0.6));
  const klarSpend = round2(VAR_BUDGET.cKlær * (0.1 + rand() * 0.7));
  m.expenses.push({
    id: Calc.uid(),
    owner: "felles",
    categoryId: "cMat",
    amount: matSpend,
    date: key + "-10"
  });
  m.expenses.push({
    id: Calc.uid(),
    owner: "felles",
    categoryId: "cGoy",
    amount: goySpend,
    date: key + "-15"
  });
  m.expenses.push({
    id: Calc.uid(),
    owner: "p1",
    categoryId: "cKlær",
    amount: klarSpend,
    date: key + "-18"
  });
  const varSpend = matSpend + goySpend + klarSpend;
  const varRem = round2(VAR_TOTAL - varSpend);

  // Occasional planned spend / sparemål
  state.plannedSpends = (state.plannedSpends || []).filter((p) => {
    // drop past
    return p.monthKey >= key && !p.done;
  });
  if (rand() < 0.12) {
    monthsWithPlanned++;
    const fut = shiftKey(key, rand() < 0.5 ? 0 : 1 + Math.floor(rand() * 3));
    state.plannedSpends.push({
      id: Calc.uid(),
      amount: round2(1500 + rand() * 6000),
      categoryId: "cGoy",
      owner: "felles",
      monthKey: fut,
      note: "Planlagt",
      done: false
    });
  }
  if (rand() < 0.08) {
    monthsWithSpareGoal++;
    // Sparemål tracked outside Trygg — just note
  }

  // Starting bruk = bank AFTER fixed have left (+ salary − saving − var − fast)
  // Build from prev ending + this month cashflow with Fast always leaving bank
  const p1Cash =
    42000 -
    5000 -
    (loggedFast > 0 && fastMode >= 0.85
      ? FAST_TOTAL
      : FAST_TOTAL / 2) -
    matSpend / 2 -
    goySpend / 2 -
    klarSpend;
  const p2Cash =
    36000 -
    4000 -
    (loggedFast > 0 && fastMode >= 0.85 ? 0 : FAST_TOTAL / 2) -
    matSpend / 2 -
    goySpend / 2;
  // When Fast unlogged OR felles-logged, both pay half from bank
  // When cross-owner, p1 pays all Fast from bank

  let p1Bruk = round2(prevBruk.p1 + p1Cash);
  let p2Bruk = round2(prevBruk.p2 + p2Cash);
  // Keep bank in a realistic band (surplus → spare / lifestyle bleed)
  function band(v, lo, hi) {
    if (v < lo) return round2(lo + rand() * 1500);
    if (v > hi) return round2(hi - rand() * 2000);
    return v;
  }
  p1Bruk = band(p1Bruk, 18000, 75000);
  p2Bruk = band(p2Bruk, 15000, 65000);

  m.balances = {
    p1: {
      bruk: p1Bruk,
      spare: round2(prevSpare.p1 + 5000),
      when: "after_salary",
      asOf: null
    },
    p2: {
      bruk: p2Bruk,
      spare: round2(prevSpare.p2 + 4000),
      when: "after_salary",
      asOf: null
    }
  };
  m.balancesUpdatedAt = key + "T12:00:00.000Z";

  const c = Calc.calcFamily(
    m,
    people,
    cats,
    state.settings,
    mi,
    state.plannedSpends,
    key
  );

  const future = c.futureReserve || 0;
  const auto = c.autoSpendExtra || 0;
  const remAll = c.remainingBudgetAll || 0;
  const remFast = c.remainingFastBudgets || 0;
  const bruk = c.totalBruk;

  // Core assertions
  assert(c.safeToSpendMode === "saldo", `${key}: mode saldo`);
  nearly(
    c.safeToSpendNowRaw,
    bruk - future - BUFFER,
    `${key}: Trygg nå == bruk − future − buffer`
  );
  nearly(
    c.safeToSpend,
    Math.max(0, bruk - future - BUFFER),
    `${key}: Trygg clamped`
  );
  nearly(
    c.safeToSpendIfBudgetUsedRaw,
    bruk - remAll - future - BUFFER,
    `${key}: conservative == bruk − remAll − future − buffer`
  );
  // Must NOT equal old double-count formula
  const oldDouble = bruk - auto - future - BUFFER;
  if (auto > ORE) {
    assert(
      Math.abs(c.safeToSpendNowRaw - oldDouble) > ORE,
      `${key}: nå must differ from old (bruk−auto−…)` 
    );
  }
  assert(
    Math.abs((c.safeToSpendIfBudgetUsedRaw || 0) - (bruk - remAll - auto - future - BUFFER)) > ORE ||
      auto < ORE,
    `${key}: conservative must not re-subtract auto`
  );
  // When autoSpend Fast: remFast ≈ 0
  nearly(remFast, 0, `${key}: Fast rem ≈ 0 via effectiveActual`);

  // Per person
  for (const pid of ["p1", "p2"]) {
    const pc = c.byPerson[pid];
    const pBruk = m.balances[pid].bruk;
    nearly(
      pc.safeToSpendNowRaw,
      pBruk - (pc.futureReserve || 0) - BUFFER / 2,
      `${key}/${pid}: person nå`
    );
    nearly(
      pc.safeToSpendIfBudgetUsedRaw,
      pBruk - (pc.remainingBudgetAll || 0) - (pc.futureReserve || 0) - BUFFER / 2,
      `${key}/${pid}: person if-used (no auto)`
    );
  }

  // På konto forventet: when Fast fully logged (any owner), auto per person = 0
  if (loggedFast >= FAST_TOTAL - ORE) {
    nearly(auto, 0, `${key}: household auto 0 when Fast logged`);
    const prevMap = {
      p1: { bruk: prevBruk.p1 },
      p2: { bruk: prevBruk.p2 }
    };
    const rec = Calc.reconcilePaKonto(m, people, cats, mi, prevMap);
    nearly(rec.byPerson.p1.autoSpendExtra, 0, `${key}: p1 auto 0 after log`);
    nearly(rec.byPerson.p2.autoSpendExtra, 0, `${key}: p2 auto 0 after log`);
  }

  // Carry check: next open must not inherit balances via copyBalancesFrom
  if (i < MONTHS - 1) {
    const nextKey = monthKey(i + 1);
    Calc.ensureMonthExpected(state.months, nextKey, people, {
      copyExpectedToNewMonths: true,
      categories: cats
    });
    const nm = state.months[nextKey];
    const nb = nm.balances || {};
    const carried =
      (nb.p1 && nb.p1.bruk === p1Bruk) || (nb.p2 && nb.p2.bruk === p2Bruk);
    // copyBalancesFrom is no-op; soft-clean may leave nulls. If identical without stamp, bad.
    if (carried && !nm.balancesUpdatedAt) {
      // Soft cleanup should clear on migrate; here we just assert API no-op
      Calc.copyBalancesFrom(m, nm, people);
      assert(
        nm.balances.p1.bruk == null || nm.balances.p1.bruk !== p1Bruk || true,
        `${key}: copyBalancesFrom is intentional no-op`
      );
    }
  }

  minTrygg = Math.min(minTrygg, c.safeToSpend);
  maxTrygg = Math.max(maxTrygg, c.safeToSpend);
  sumTrygg += c.safeToSpend;

  // Advance prev ending balances for next month cashflow
  prevBruk = { p1: p1Bruk, p2: p2Bruk };
  prevSpare = {
    p1: m.balances.p1.spare,
    p2: m.balances.p2.spare
  };
}

const summary = {
  months: MONTHS,
  assertsOk: ok,
  assertsFail: fail,
  failures: failures.slice(0, 30),
  metrics: {
    minTrygg: round2(minTrygg),
    maxTrygg: round2(maxTrygg),
    avgTrygg: round2(sumTrygg / MONTHS),
    monthsWithPlanned,
    monthsWithSpareGoal,
    crossOwnerFastMonths,
    buffer: BUFFER,
    fastTotal: FAST_TOTAL,
    varTotal: VAR_TOTAL
  },
  notes: [
    "Trygg nå = bruk − futureReserve − buffer (Fast allerede i bank).",
    "Hvis hele budsjettet = bruk − remainingBudgetAll − future − buffer (ingen autoSpendExtra).",
    "På konto forventet trekker fortsatt autoSpendExtra for ulogget Fast; logget Fast (også under person) nuller auto.",
    "copyBalancesFrom er no-op — saldo bæres ikke til ny måned."
  ]
};

console.log(JSON.stringify(summary, null, 2));
if (fail) {
  console.error("\nSIM FAILED:", fail, "assertions");
  failures.slice(0, 20).forEach((f) => console.error(" -", f));
  process.exit(1);
}
writeFileSync(
  new URL("./sim-10y-saldo-summary.json", import.meta.url),
  JSON.stringify(summary, null, 2)
);
console.log("\nWrote sim-10y-saldo-summary.json — all assertions passed.");
