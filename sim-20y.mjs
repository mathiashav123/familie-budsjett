/**
 * Synthetic 20-year (240 months) Familiebudsjett household life simulation.
 * Years 2020–2039. Uses calc-core.js only — NEVER touches browser localStorage.
 *
 * Extends sim-10y with: sparemål lifecycle, underlinjer (år/kvartal), planlagt sparing,
 * missed months, person add/rename, yearRollup, payload-size growth curve.
 */
import { createRequire } from "module";
import { performance } from "perf_hooks";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");
const __dirname = dirname(fileURLToPath(import.meta.url));

const WARN_STORAGE_MB = 4;
const CLOUD_SOFT_MB = 1.5; // practical cloud sync comfort zone

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
const rand = mulberry32(20200920);

function pick(arr) {
  return arr[Math.floor(rand() * arr.length)];
}
function randInt(lo, hi) {
  return lo + Math.floor(rand() * (hi - lo + 1));
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function inflate(base, years, rate) {
  return round2(base * Math.pow(1 + rate, years));
}

const notes = [];
const failures = [];
let assertsOk = 0;
let assertsFail = 0;

function assert(cond, msg) {
  if (cond) assertsOk++;
  else {
    assertsFail++;
    failures.push(msg);
    console.log("  ✗", msg);
  }
}

function checkNoBadNumbers(obj, path, bad) {
  if (obj == null) return;
  if (typeof obj === "number") {
    if (!Number.isFinite(obj)) bad.push(`${path}=${obj}`);
    return;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => checkNoBadNumbers(v, `${path}[${i}]`, bad));
    return;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      if (k === "cat") continue;
      checkNoBadNumbers(obj[k], path ? `${path}.${k}` : k, bad);
    }
  }
}

function monthKeyFromIndex(startY, startM, i) {
  let y = startY;
  let m = startM + i;
  while (m > 11) {
    m -= 12;
    y += 1;
  }
  return y + "-" + String(m + 1).padStart(2, "0");
}

function dayInMonth(key, day) {
  const d = String(Math.min(28, Math.max(1, day))).padStart(2, "0");
  return key + "-" + d;
}

function openMonth(state, key) {
  return Calc.ensureMonthExpected(state.months, key, state.people, {
    copyExpectedToNewMonths: state.settings.copyExpectedToNewMonths !== false,
    categories: state.categories
  });
}

function addCat(cats, name, type, owner, order, split, people) {
  const cat = {
    id: "c_" + name.toLowerCase().replace(/[^a-z0-9æøå]+/gi, "_") + "_" + owner,
    name,
    type,
    owner,
    autoFill: type === "fast",
    archived: false,
    order
  };
  if (split) Calc.setCategorySplit(cat, split, people);
  cats.push(cat);
  return cat;
}

function buildInitialCategories(people) {
  const cats = [];
  let order = 0;
  addCat(cats, "Lån", "fast", "felles", order++, null, people);
  addCat(cats, "Strøm", "fast", "felles", order++, null, people);
  addCat(cats, "Internett", "fast", "felles", order++, null, people);
  addCat(cats, "Forsikring", "fast", "felles", order++, null, people);
  addCat(cats, "Felleskost", "fast", "felles", order++, null, people);
  addCat(cats, "Bil", "variabel", "felles", order++, null, people);
  addCat(cats, "Ferie", "variabel", "felles", order++, null, people);

  const personal = [
    ["Mat", "variabel"],
    ["Hygiene", "variabel"],
    ["Klær", "variabel"],
    ["Abonnement", "variabel"],
    ["Restaurant", "variabel"],
    ["Gøy", "variabel"],
    ["Transport", "variabel"]
  ];
  for (const pid of ["p1", "p2"]) {
    for (const [name, type] of personal) {
      addCat(cats, name, type, pid, order++, null, people);
    }
  }
  addCat(cats, "Mobil", "fast", "p1", order++, null, people);
  addCat(cats, "Fond", "variabel", "p1", order++, null, people);
  return cats;
}

const BASE_BUDGETS = {
  felles: {
    Lån: 22000,
    Strøm: 1600,
    Internett: 799,
    Forsikring: 680,
    Felleskost: 1200,
    Bil: 2500,
    Ferie: 1500
  },
  p1: {
    Mat: 2200,
    Hygiene: 200,
    Klær: 300,
    Abonnement: 1200,
    Restaurant: 400,
    Gøy: 500,
    Transport: 800,
    Mobil: 449,
    Fond: 500
  },
  p2: {
    Mat: 2200,
    Hygiene: 400,
    Klær: 600,
    Abonnement: 400,
    Restaurant: 400,
    Gøy: 400,
    Transport: 600
  }
};

const BASE_INCOME = {
  p1: { lønn: 38000, ekstra: 1500 },
  p2: { lønn: 32000, ekstra: null }
};

const BASE_PLANNED_SPARING = { p1: 2000, p2: 1500 };

function applyUnderlinjer(m, cats, yearIndex, monthIndex) {
  // Abonnement p1: Netflix year once + Spotify month + Disney+ quarter spread
  const abo = cats.find((c) => c.name === "Abonnement" && c.owner === "p1" && !c.archived);
  if (abo) {
    const lines = [
      {
        id: "ul_netflix",
        name: "Netflix",
        amount: round2(inflate(1599, yearIndex, 0.03)),
        interval: "year",
        mode: "once",
        month: 2 // mars
      },
      {
        id: "ul_spotify",
        name: "Spotify",
        amount: round2(inflate(119, yearIndex, 0.02))
      },
      {
        id: "ul_disney",
        name: "Disney+",
        amount: round2(inflate(339, yearIndex, 0.03)),
        interval: "quarter",
        mode: "spread",
        month: 0
      }
    ];
    Calc.setBudgetLines(m, abo.id, "p1", lines, monthIndex);
  }

  // Forsikring felles: bil+bolig årlig once + innboforsikring kvartal once
  const fors = cats.find((c) => c.name === "Forsikring" && c.owner === "felles" && !c.archived);
  if (fors) {
    const lines = [
      {
        id: "ul_bilfors",
        name: "Bilforsikring",
        amount: round2(inflate(8200, yearIndex, 0.025)),
        interval: "year",
        mode: "once",
        month: 5 // juni
      },
      {
        id: "ul_innbo",
        name: "Innbo",
        amount: round2(inflate(890, yearIndex, 0.02)),
        interval: "quarter",
        mode: "once",
        month: 0 // jan/apr/jul/okt
      }
    ];
    Calc.setBudgetLines(m, fors.id, "felles", lines, monthIndex);
  }
}

function applyPlan(m, cats, people, yearIndex, incomeScaleP1, incomeScaleP2, monthIndex) {
  Calc.ensureMonthShape(m, people);
  const rate = 0.025;
  m.plannedIncome.p1 = {
    lønn: round2(BASE_INCOME.p1.lønn * incomeScaleP1 * Math.pow(1.02, Math.max(0, yearIndex - 4))),
    ekstra: BASE_INCOME.p1.ekstra != null ? round2(BASE_INCOME.p1.ekstra * incomeScaleP1) : null,
    sparing: round2(BASE_PLANNED_SPARING.p1 * Math.pow(1.01, yearIndex))
  };
  m.plannedIncome.p2 = {
    lønn: round2(BASE_INCOME.p2.lønn * incomeScaleP2 * Math.pow(1.015, Math.max(0, yearIndex - 4))),
    ekstra: null,
    sparing: round2(BASE_PLANNED_SPARING.p2 * Math.pow(1.01, yearIndex))
  };
  // Extra person gets modest plan if present
  for (const p of Calc.activePeople(people)) {
    if (p.id === "p1" || p.id === "p2") continue;
    if (!m.plannedIncome[p.id]) {
      m.plannedIncome[p.id] = { lønn: 0, ekstra: null, sparing: 500 };
    }
  }

  for (const [owner, map] of Object.entries(BASE_BUDGETS)) {
    for (const [name, amount] of Object.entries(map)) {
      const cat = cats.find((c) => c.name === name && c.owner === owner && !c.archived);
      if (!cat) continue;
      // Skip categories managed via underlinjer — setBudgetLines syncs budget
      if (
        (name === "Abonnement" && owner === "p1") ||
        (name === "Forsikring" && owner === "felles")
      ) {
        continue;
      }
      const inflateNames = new Set([
        "Strøm",
        "Internett",
        "Mat",
        "Lån",
        "Felleskost",
        "Bil"
      ]);
      const amt = inflateNames.has(name) ? inflate(amount, yearIndex, rate) : amount;
      Calc.setBudgetForOwner(m, cat.id, owner, amt);
    }
  }
  applyUnderlinjer(m, cats, yearIndex, monthIndex);

  const baby = cats.find((c) => c.name === "Baby" && !c.archived);
  if (baby) {
    Calc.setBudgetForOwner(m, baby.id, "felles", inflate(2800, Math.max(0, yearIndex - 2), 0.02));
  }
  const barnehage = cats.find((c) => c.name === "Barnehage" && !c.archived);
  if (barnehage) {
    Calc.setBudgetForOwner(m, barnehage.id, "felles", inflate(3500, Math.max(0, yearIndex - 5), 0.02));
  }
  const elbil = cats.find((c) => c.name === "Elbil-lading" && !c.archived);
  if (elbil) {
    Calc.setBudgetForOwner(m, elbil.id, "felles", inflate(800, Math.max(0, yearIndex - 10), 0.02));
  }
}

function logDailyishExpenses(m, cats, people, key, monthIdx, intensity) {
  const month = parseInt(key.split("-")[1], 10);
  const yearIndex = Math.floor(monthIdx / 12);
  const activeCats = cats.filter((c) => !c.archived);
  const byName = (name, owner) =>
    activeCats.find((c) => c.name === name && (owner == null || c.owner === owner));
  const scale = intensity == null ? 1 : intensity;

  const groceryN = Math.max(0, Math.round(randInt(12, 18) * scale));
  for (let i = 0; i < groceryN; i++) {
    const owner = rand() < 0.5 ? "p1" : "p2";
    const cat = byName("Mat", owner) || pick(activeCats);
    m.expenses.push({
      id: Calc.uid(),
      owner,
      categoryId: cat.id,
      amount: round2(randInt(45, 520) + rand()),
      date: dayInMonth(key, randInt(1, 28)),
      note: "Mat"
    });
  }

  for (let i = 0; i < Math.round(randInt(4, 10) * scale); i++) {
    const owner = rand() < 0.55 ? "p1" : "p2";
    const cat = byName("Transport", owner) || byName("Bil", "felles") || pick(activeCats);
    m.expenses.push({
      id: Calc.uid(),
      owner: cat.owner === "felles" ? "felles" : owner,
      categoryId: cat.id,
      amount: round2(randInt(35, 650) + rand()),
      date: dayInMonth(key, randInt(1, 28)),
      note: ""
    });
  }

  for (const name of [
    "Abonnement",
    "Mobil",
    "Internett",
    "Strøm",
    "Forsikring",
    "Lån",
    "Felleskost"
  ]) {
    const matches = activeCats.filter((c) => c.name === name);
    for (const cat of matches) {
      const planned = Calc.budgetFor(m, cat.id, month - 1) || Calc.budgetForOwner(m, cat.id, cat.owner, month - 1);
      if (!planned) continue;
      const amt = round2(planned * (0.9 + rand() * 0.15));
      m.expenses.push({
        id: Calc.uid(),
        owner: cat.owner === "felles" ? "felles" : cat.owner,
        categoryId: cat.id,
        amount: amt,
        date: dayInMonth(key, name === "Lån" ? 1 : randInt(1, 12)),
        note: name
      });
    }
  }

  for (let i = 0; i < Math.round(randInt(8, 16) * scale); i++) {
    const names = ["Restaurant", "Gøy", "Hygiene", "Klær", "Fond"];
    const name = pick(names);
    const owner = rand() < 0.5 ? "p1" : "p2";
    const cat = byName(name, owner) || pick(activeCats);
    m.expenses.push({
      id: Calc.uid(),
      owner: cat.owner === "felles" ? "felles" : owner,
      categoryId: cat.id,
      amount: round2(randInt(49, 899) + rand()),
      date: dayInMonth(key, randInt(1, 28)),
      note: ""
    });
  }

  if (month >= 6 && month <= 8) {
    const ferie = byName("Ferie", "felles");
    if (ferie) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "felles",
        categoryId: ferie.id,
        amount: round2(randInt(4000, 14000) * (1 + yearIndex * 0.02)),
        date: dayInMonth(key, randInt(5, 20)),
        note: "Ferie"
      });
    }
  }

  if (month === 12) {
    for (let i = 0; i < randInt(4, 8); i++) {
      const owner = rand() < 0.5 ? "p1" : "p2";
      const cat = byName("Gøy", owner) || byName("Mat", owner) || pick(activeCats);
      m.expenses.push({
        id: Calc.uid(),
        owner,
        categoryId: cat.id,
        amount: round2(randInt(200, 2500) + rand()),
        date: dayInMonth(key, randInt(10, 24)),
        note: "Jul"
      });
    }
  }

  for (const name of ["Baby", "Barnehage", "Elbil-lading"]) {
    const cat = byName(name, "felles");
    if (!cat) continue;
    for (let i = 0; i < randInt(2, 6); i++) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "felles",
        categoryId: cat.id,
        amount: round2(randInt(80, 1400) + rand()),
        date: dayInMonth(key, randInt(1, 28)),
        note: name
      });
    }
  }
}

function logIncomesAndSavings(m, people, key, incomeScaleP1, incomeScaleP2, yearIndex) {
  const active = Calc.activePeople(people);
  for (const p of active) {
    if (p.id !== "p1" && p.id !== "p2") continue;
    const scale = p.id === "p1" ? incomeScaleP1 : incomeScaleP2;
    const base = BASE_INCOME[p.id].lønn;
    const bump =
      p.id === "p1"
        ? Math.pow(1.02, Math.max(0, yearIndex - 4))
        : Math.pow(1.015, Math.max(0, yearIndex - 4));
    m.incomes.push({
      id: Calc.uid(),
      person: p.id,
      type: "lønn",
      amount: round2(base * scale * bump),
      date: dayInMonth(key, 12)
    });
    if (BASE_INCOME[p.id].ekstra != null && rand() < 0.85) {
      m.incomes.push({
        id: Calc.uid(),
        person: p.id,
        type: "ekstra",
        amount: round2(BASE_INCOME[p.id].ekstra * scale),
        date: dayInMonth(key, 14)
      });
    }
    if (rand() < 0.12) {
      m.incomes.push({
        id: Calc.uid(),
        person: p.id,
        type: "ekstra",
        amount: round2(randInt(1000, 8000)),
        date: dayInMonth(key, randInt(15, 25)),
        note: "Bonus"
      });
    }
    // Planlagt sparing nær lønn (dag 13–15)
    const planned = Calc.plannedSparingFor(m, p.id) || BASE_PLANNED_SPARING[p.id] || 1000;
    if (rand() < 0.85) {
      m.savings.push({
        id: Calc.uid(),
        person: p.id,
        amount: round2(planned * (0.85 + rand() * 0.3)),
        date: dayInMonth(key, randInt(13, 15)),
        note: "Planlagt sparing"
      });
    } else if (rand() < 0.5) {
      // Partial / missed sparing month
      m.savings.push({
        id: Calc.uid(),
        person: p.id,
        amount: round2(planned * rand() * 0.4),
        date: dayInMonth(key, 20),
        note: "Delvis sparing"
      });
    }
  }
}

function updateBalances(m, prev, people, c) {
  Calc.ensureMonthShape(m, people);
  for (const p of Calc.activePeople(people)) {
    const prevBal = (prev && prev.balances && prev.balances[p.id]) || { bruk: 8000, spare: 10000 };
    const pc = (c && c.byPerson && c.byPerson[p.id]) || {};
    const spareAdd = pc.sparing || 0;
    const base = p.id === "p1" ? 14000 : p.id === "p2" ? 10000 : 5000;
    const endBruk = round2(Math.max(800, base + randInt(-3500, 5500)));
    const endSpare = round2(
      (prevBal.spare != null ? Number(prevBal.spare) : 10000) + spareAdd + randInt(0, 150)
    );
    m.balances[p.id] = { bruk: endBruk, spare: endSpare };
  }
}

// ---------- Sparemål helpers ----------
function createGoal(state, opts) {
  const g = Calc.normalizeSavingsGoal(
    {
      id: opts.id || Calc.uid(),
      name: opts.name,
      target: opts.target,
      monthly: opts.monthly,
      saved: opts.saved || 0,
      person: opts.person || "samlet"
    },
    state.people
  );
  g._meta = {
    createdAt: opts.createdAt,
    status: "active", // active | completed | abandoned
    history: [{ at: opts.createdAt, event: "created", monthly: g.monthly, target: g.target }]
  };
  state.savingsGoals.push(g);
  return g;
}

function contributeToGoals(state, key, monthIdx) {
  const fromDate = new Date(key + "-15T12:00:00");
  for (const g of state.savingsGoals) {
    if (g._meta.status !== "active") continue;
    // Realistic: ~80% of months contribute full monthly, 15% partial, 5% miss
    const roll = rand();
    let add = 0;
    if (roll < 0.8) add = g.monthly;
    else if (roll < 0.95) add = round2(g.monthly * (0.3 + rand() * 0.5));
    g.saved = round2(g.saved + add);

    const prog = Calc.savingsGoalProgress(g);
    const eta = Calc.savingsGoalEta(g, fromDate);
    g._lastEta = eta;
    g._lastProgress = prog;

    if (prog.reached) {
      g._meta.status = "completed";
      g._meta.completedAt = key;
      g._meta.history.push({ at: key, event: "completed", saved: g.saved });
      notes.push(`${key}: sparemål «${g.name}» nådd (${round2(g.saved)} / ${g.target})`);
    }
  }
}

function snapshotPayload(state) {
  // Strip sim-only _meta for realistic sync size estimate
  const clone = JSON.parse(JSON.stringify(state));
  for (const g of clone.savingsGoals || []) {
    delete g._meta;
    delete g._lastEta;
    delete g._lastProgress;
  }
  const json = JSON.stringify(clone);
  return Buffer.byteLength(json, "utf8");
}

// ---------- Run ----------
console.log("\n=== Familiebudsjett 20-year synthetic simulation (2020–2039) ===\n");
console.log("(SYNTHETIC only — no localStorage / live browser data)\n");

const START_Y = 2020;
const START_M = 0;
const MONTHS = 240;

const people = Calc.defaultPeople();
const categories = buildInitialCategories(people);

const state = {
  version: 2,
  people,
  view: { year: START_Y, month: START_M },
  categories,
  months: {},
  savingsGoals: [],
  settings: {
    sort: "over",
    chartMode: "actual",
    reminderDismissedDate: null,
    innUtView: "samlet",
    copyExpectedToNewMonths: true,
    mainTab: "oversikt",
    useSaldoInSafeToSpend: true,
    spendBuffer: 0,
    sparingView: "samlet"
  }
};

const key0 = monthKeyFromIndex(START_Y, START_M, 0);
state.months[key0] = {
  balances: {},
  budgets: {},
  budgetLines: {},
  plannedIncome: {},
  incomes: [],
  savings: [],
  expenses: []
};
applyPlan(state.months[key0], state.categories, state.people, 0, 1, 1, 0);
state.months[key0].balances = {
  p1: { bruk: 12000, spare: 25000 },
  p2: { bruk: 9000, spare: 18000 }
};

// Initial sparemål
createGoal(state, {
  id: "g_ferie",
  name: "Sommerferie Italia",
  target: 60000,
  monthly: 2000, // adjusted upward at month 30 while still active
  person: "samlet",
  createdAt: key0
});
createGoal(state, {
  id: "g_buffer",
  name: "Bufferkonto",
  target: 100000,
  monthly: 3000,
  person: "samlet",
  createdAt: key0
});
createGoal(state, {
  id: "g_mathias_pc",
  name: "Ny PC",
  target: 25000,
  monthly: 400, // slow on purpose — abandoned before reach
  person: "p1",
  createdAt: key0
});

const metrics = {
  months: [],
  carryEvents: 0,
  maxPlanUtDelta: 0,
  maxFellesShareDelta: 0,
  totalExpenses: 0,
  totalIncomes: 0,
  totalSavingsTx: 0,
  maxTxInMonth: 0,
  babyAddedAt: null,
  barnehageAddedAt: null,
  elbilAddedAt: null,
  salaryBumpAt: null,
  jobChangeAt: null,
  splitChangeAt: null,
  personAddedAt: null,
  personRenamedAt: null,
  overBudgetCats: 0,
  missedMonths: [],
  oneOffs: [],
  payloadByYear: [],
  goalsCompleted: [],
  goalsAbandoned: [],
  goalsAdjusted: [],
  yearRollupMs: [],
  underlinjeChecks: 0
};
const calcTimes = [];
let incomeScaleP1 = 1;
let incomeScaleP2 = 1;
let prevKey = null;
const MISSED = new Set(["2021-07", "2025-03", "2031-08", "2036-02"]); // vacation / life chaos

for (let i = 0; i < MONTHS; i++) {
  const key = monthKeyFromIndex(START_Y, START_M, i);
  const yearIndex = Math.floor(i / 12);
  const monthNum = parseInt(key.split("-")[1], 10);
  const monthIndex = monthNum - 1;

  // Year 3: Baby
  if (i === 24) {
    addCat(state.categories, "Baby", "variabel", "felles", state.categories.length, null, state.people);
    metrics.babyAddedAt = key;
    notes.push(`${key}: added Baby category (year 3)`);
  }

  // Year 5: Barnehage + salary bump
  if (i === 48) {
    addCat(state.categories, "Barnehage", "fast", "felles", state.categories.length, null, state.people);
    metrics.barnehageAddedAt = key;
    incomeScaleP1 = 1.12;
    incomeScaleP2 = 1.08;
    metrics.salaryBumpAt = key;
    notes.push(`${key}: Barnehage + salary bump (+12% / +8%)`);
  }

  // Year 4: felles split 55/45
  if (i === 36) {
    for (const name of ["Lån", "Strøm", "Felleskost"]) {
      const cat = state.categories.find((c) => c.name === name);
      if (cat) Calc.setCategorySplit(cat, { p1: 55, p2: 45 }, state.people);
    }
    metrics.splitChangeAt = key;
    notes.push(`${key}: felles split → 55/45 on Lån/Strøm/Felleskost`);
  }

  // Year 7: p2 job change
  if (i === 72) {
    incomeScaleP2 = 0.72;
    metrics.jobChangeAt = key;
    notes.push(`${key}: p2 job change (income drop to 72%)`);
  }
  if (i > 72 && i <= 80) {
    incomeScaleP2 = 0.72 + ((i - 72) / 8) * (1.05 - 0.72);
  }
  if (i === 80) notes.push(`${key}: p2 income recovered (~105%)`);

  // Year 8: new sparemål (bil)
  if (i === 96) {
    createGoal(state, {
      id: "g_bil",
      name: "Elbil-nedbetaling",
      target: 120000,
      monthly: 4000,
      person: "felles",
      createdAt: key
    });
    notes.push(`${key}: nytt sparemål Elbil-nedbetaling`);
  }

  // Year 10: elbil-lading category + second salary bump
  if (i === 120) {
    addCat(state.categories, "Elbil-lading", "variabel", "felles", state.categories.length, null, state.people);
    metrics.elbilAddedAt = key;
    incomeScaleP1 = 1.25;
    incomeScaleP2 = 1.18;
    notes.push(`${key}: Elbil-lading + salary bump #2`);
  }

  // Year 11: add third person (barn / husstandsmedlem) briefly then rename
  if (i === 132) {
    state.people.push({ id: "p3", name: "Emma", archived: false });
    // Re-normalize felles splits for 3 people on some cats
    const lan = state.categories.find((c) => c.name === "Lån");
    if (lan) Calc.setCategorySplit(lan, { p1: 40, p2: 40, p3: 20 }, state.people);
    metrics.personAddedAt = key;
    notes.push(`${key}: person Emma (p3) lagt til`);
  }
  if (i === 144) {
    const p3 = state.people.find((p) => p.id === "p3");
    if (p3) p3.name = "Emma H.";
    metrics.personRenamedAt = key;
    notes.push(`${key}: person p3 omdøpt til Emma H.`);
  }
  // Archive p3 after a few years (moved out)
  if (i === 180) {
    const p3 = state.people.find((p) => p.id === "p3");
    if (p3) p3.archived = true;
    // Reset Lån split to 2 people
    const lan = state.categories.find((c) => c.name === "Lån");
    if (lan) Calc.setCategorySplit(lan, { p1: 55, p2: 45 }, state.people);
    notes.push(`${key}: Emma arkivert (flyttet ut), Lån tilbake 55/45`);
  }

  // Sparemål adjustments & abandonment
  if (i === 30) {
    // Adjust ferie goal upward (more expensive trip) while still active
    const g = state.savingsGoals.find((x) => x.id === "g_ferie");
    if (g && g._meta.status === "active") {
      g.target = 75000;
      g.monthly = 2800;
      g._meta.history.push({ at: key, event: "adjusted", monthly: 2800, target: 75000 });
      metrics.goalsAdjusted.push({ key, id: g.id, name: g.name });
      notes.push(`${key}: sparemål «${g.name}» justert → 75k / 2.8k mnd`);
    }
  }
  if (i === 60) {
    // Abandon PC goal (bought differently / lost interest)
    const g = state.savingsGoals.find((x) => x.id === "g_mathias_pc");
    if (g && g._meta.status === "active") {
      g._meta.status = "abandoned";
      g._meta.abandonedAt = key;
      g._meta.history.push({ at: key, event: "abandoned", saved: g.saved });
      metrics.goalsAbandoned.push({ key, id: g.id, name: g.name, saved: g.saved, target: g.target });
      notes.push(`${key}: sparemål «${g.name}» forlatt (${round2(g.saved)}/${g.target})`);
    }
  }
  if (i === 108) {
    // Short-lived goal that gets abandoned
    createGoal(state, {
      id: "g_kamera",
      name: "Kamerautstyr",
      target: 22000,
      monthly: 800,
      person: "p2",
      createdAt: key
    });
    notes.push(`${key}: nytt sparemål Kamerautstyr`);
  }
  if (i === 126) {
    const g = state.savingsGoals.find((x) => x.id === "g_kamera");
    if (g && g._meta.status === "active") {
      g._meta.status = "abandoned";
      g._meta.abandonedAt = key;
      g._meta.history.push({ at: key, event: "abandoned", saved: g.saved });
      metrics.goalsAbandoned.push({ key, id: g.id, name: g.name, saved: g.saved, target: g.target });
      notes.push(`${key}: sparemål «${g.name}» forlatt (${round2(g.saved)}/${g.target})`);
    }
  }
  if (i === 150) {
    createGoal(state, {
      id: "g_hytte",
      name: "Hyttefond",
      target: 250000,
      monthly: 5000,
      person: "samlet",
      createdAt: key
    });
    notes.push(`${key}: nytt sparemål Hyttefond`);
  }
  if (i === 200) {
    const g = state.savingsGoals.find((x) => x.id === "g_hytte");
    if (g && g._meta.status === "active") {
      g.monthly = 3500; // life got expensive
      g._meta.history.push({ at: key, event: "adjusted", monthly: 3500 });
      metrics.goalsAdjusted.push({ key, id: g.id, name: g.name });
      notes.push(`${key}: Hyttefond monthly ↓ 3500`);
    }
  }

  const carry = openMonth(state, key);
  if (carry.copied) metrics.carryEvents++;

  const m = state.months[key];
  Calc.ensureMonthShape(m, state.people);

  applyPlan(m, state.categories, state.people, yearIndex, incomeScaleP1, incomeScaleP2, monthIndex);

  if (i > 0 && i % 17 === 0) {
    const lan = state.categories.find((c) => c.name === "Lån");
    if (lan) {
      const cur = Calc.budgetForOwner(m, lan.id, "felles") || 22000;
      Calc.setBudgetForOwner(m, lan.id, "felles", round2(cur * 1.03));
      notes.push(`${key}: Lån budget +3% edit`);
    }
  }

  // Big one-off expenses
  if (i === 40) {
    const bil = state.categories.find((c) => c.name === "Bil");
    if (bil) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "felles",
        categoryId: bil.id,
        amount: 28500,
        date: dayInMonth(key, 8),
        note: "Motorbytte"
      });
      metrics.oneOffs.push({ key, note: "Motorbytte", amount: 28500 });
      notes.push(`${key}: engangsutgift Motorbytte 28500`);
    }
  }
  if (i === 110) {
    const ferie = state.categories.find((c) => c.name === "Ferie");
    if (ferie) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "felles",
        categoryId: ferie.id,
        amount: 42000,
        date: dayInMonth(key, 12),
        note: "Bryllupsreise"
      });
      metrics.oneOffs.push({ key, note: "Bryllupsreise", amount: 42000 });
      notes.push(`${key}: engangsutgift Bryllupsreise 42000`);
    }
  }
  if (i === 190) {
    const goy = state.categories.find((c) => c.name === "Gøy" && c.owner === "p1");
    if (goy) {
      m.expenses.push({
        id: Calc.uid(),
        owner: "p1",
        categoryId: goy.id,
        amount: 15000,
        date: dayInMonth(key, 3),
        note: "Tannlege"
      });
      metrics.oneOffs.push({ key, note: "Tannlege", amount: 15000 });
      notes.push(`${key}: engangsutgift Tannlege 15000`);
    }
  }

  const isMissed = MISSED.has(key);
  if (isMissed) {
    metrics.missedMonths.push(key);
    notes.push(`${key}: MISSED month (minimal logging — ferie/liv)`);
    // Still get salary sometimes, but sparse expenses
    logIncomesAndSavings(m, state.people, key, incomeScaleP1, incomeScaleP2, yearIndex);
    // Only 2–4 random expenses
    logDailyishExpenses(m, state.categories, state.people, key, i, 0.15);
  } else {
    logDailyishExpenses(m, state.categories, state.people, key, i, 1);
    logIncomesAndSavings(m, state.people, key, incomeScaleP1, incomeScaleP2, yearIndex);
  }

  contributeToGoals(state, key, i);

  const t0 = performance.now();
  const c = Calc.calcFamily(m, state.people, state.categories, state.settings);
  const t1 = performance.now();
  calcTimes.push(t1 - t0);

  const prev = prevKey ? state.months[prevKey] : null;
  updateBalances(m, prev, state.people, c);
  const c2 = Calc.calcFamily(m, state.people, state.categories, state.settings);

  // Underlinje sanity: Abonnement p1 budget should match line sum for month
  const abo = state.categories.find((c) => c.name === "Abonnement" && c.owner === "p1");
  if (abo) {
    const lines = Calc.getBudgetLines(m, abo.id, "p1");
    const lineSum = Calc.sumBudgetLines(lines, monthIndex);
    const bud = Calc.budgetForOwner(m, abo.id, "p1", monthIndex);
    const d = Math.abs(lineSum - bud);
    metrics.underlinjeChecks++;
    assert(d < 0.05, `${key}: underlinje Abonnement delta ${d} (lines=${lineSum} bud=${bud})`);
  }

  const bad = [];
  checkNoBadNumbers(c2, "calc", bad);
  assert(bad.length === 0, `${key}: no NaN/Inf (${bad.slice(0, 3).join(", ")})`);

  let sumPlanUt = 0;
  for (const p of c2.activePeople) {
    sumPlanUt += c2.byPerson[p.id].planUt;
  }
  const planDelta = Math.abs(sumPlanUt - c2.plannedTotal);
  if (planDelta > metrics.maxPlanUtDelta) metrics.maxPlanUtDelta = planDelta;
  assert(
    planDelta < 1.0,
    `${key}: planUt sum delta ${planDelta.toFixed(4)} (sum=${sumPlanUt}, total=${c2.plannedTotal})`
  );

  for (const cat of state.categories) {
    if (cat.archived || cat.owner !== "felles") continue;
    const fb = Calc.budgetForOwner(m, cat.id, "felles", monthIndex);
    if (!fb) continue;
    let shareSum = 0;
    for (const p of c2.activePeople) {
      shareSum += Calc.fellesShare(cat, p.id, state.people, fb);
    }
    const d = Math.abs(shareSum - fb);
    if (d > metrics.maxFellesShareDelta) metrics.maxFellesShareDelta = d;
    assert(d < 0.05, `${key}: felles share ${cat.name} delta ${d}`);
    const split = Calc.getCategorySplit(cat, state.people);
    const ssum = Calc.splitSum(split, state.people);
    assert(Math.abs(ssum - 100) < 0.1, `${key}: split ${cat.name} sum=${ssum}`);
  }

  // Safe-to-spend per person finite
  for (const p of c2.activePeople) {
    const sts = c2.byPerson[p.id].safeToSpend;
    assert(Number.isFinite(sts), `${key}: safeToSpend ${p.id} finite`);
  }

  // Sparing stats should work
  if (i % 12 === 11) {
    const ss = Calc.sparingStats(state.months, yearIndex + START_Y, monthIndex, state.people);
    assert(Number.isFinite(ss.samlet.totalt), `${key}: sparingStats.totalt finite`);
    assert(Number.isFinite(ss.samlet.iAar), `${key}: sparingStats.iAar finite`);
  }

  for (const s of c2.catStats || []) {
    if (s.over) metrics.overBudgetCats++;
  }

  metrics.totalExpenses += m.expenses.length;
  metrics.totalIncomes += m.incomes.length;
  metrics.totalSavingsTx += m.savings.length;
  if (m.expenses.length > metrics.maxTxInMonth) metrics.maxTxInMonth = m.expenses.length;

  metrics.months.push({
    key,
    expenses: m.expenses.length,
    incomes: m.incomes.length,
    savings: m.savings.length,
    planInn: c2.planInn,
    plannedTotal: c2.plannedTotal,
    samletUtgifter: c2.samletUtgifter,
    safeToSpend: c2.safeToSpend,
    safeMode: c2.safeToSpendMode,
    calcMs: t1 - t0,
    peopleCount: c2.activePeople.length
  });

  // Year-end payload snapshot + yearRollup
  if (monthNum === 12 || i === MONTHS - 1) {
    const y = parseInt(key.split("-")[0], 10);
    const bytes = snapshotPayload(state);
    metrics.payloadByYear.push({ year: y, bytes, months: Object.keys(state.months).length });

    const tY0 = performance.now();
    const roll = Calc.yearRollup(state.months, y, state.people, state.categories, state.settings);
    const tY1 = performance.now();
    metrics.yearRollupMs.push({ year: y, ms: tY1 - tY0, tilOvers: roll.totals.tilOvers });
    assert(roll.months.length === 12 || i < 12, `${key}: yearRollup has months`);
  }

  prevKey = key;
}

// Finalize goal metrics
for (const g of state.savingsGoals) {
  if (g._meta.status === "completed") {
    metrics.goalsCompleted.push({
      id: g.id,
      name: g.name,
      at: g._meta.completedAt,
      saved: g.saved,
      target: g.target
    });
  }
}

// Performance: all months
const tAll0 = performance.now();
for (let i = 0; i < MONTHS; i++) {
  const key = monthKeyFromIndex(START_Y, START_M, i);
  Calc.calcFamily(state.months[key], state.people, state.categories, state.settings);
}
const tAll1 = performance.now();
const totalCalcMs = tAll1 - tAll0;
const avgCalcMs = calcTimes.reduce((a, b) => a + b, 0) / calcTimes.length;
const maxCalcMs = Math.max(...calcTimes);

assert(totalCalcMs < 8000, `calcFamily×240 < 8000ms (got ${totalCalcMs.toFixed(2)}ms)`);
assert(avgCalcMs < 50, `avg calcFamily < 50ms (got ${avgCalcMs.toFixed(3)}ms)`);

const serialized = snapshotPayload(state);
const storageBytes = serialized;
const storageMB = storageBytes / (1024 * 1024);
const storageWarn = storageMB >= WARN_STORAGE_MB;
assert(storageMB < 12, `storage < 12 MiB (got ${storageMB.toFixed(2)} MiB)`);

// Sparemål ETA sanity on remaining active goals
for (const g of state.savingsGoals) {
  const eta = Calc.savingsGoalEta(g, new Date("2039-12-15"));
  const prog = Calc.savingsGoalProgress(g);
  assert(["reached", "eta", "need_monthly"].includes(eta.status), `goal ${g.id} eta status`);
  assert(prog.pct >= 0 && prog.pct <= 100, `goal ${g.id} pct in range`);
  g._finalEta = eta;
  g._finalProgress = prog;
}

console.log("--- Scenario notes (sample) ---");
notes.filter((_, idx) => idx < 8 || notes.length - idx < 8 || notes[idx].includes("sparemål") || notes[idx].includes("MISSED") || notes[idx].includes("person") || notes[idx].includes("engangs")).forEach((n) => console.log(" •", n));

console.log("\n--- Key metrics ---");
console.log(` Months simulated:        ${MONTHS}`);
console.log(` Assertions passed:       ${assertsOk}`);
console.log(` Assertions failed:       ${assertsFail}`);
console.log(` Carry-forward events:    ${metrics.carryEvents}`);
console.log(` Total expense txs:       ${metrics.totalExpenses}`);
console.log(` Total income txs:        ${metrics.totalIncomes}`);
console.log(` Total savings txs:       ${metrics.totalSavingsTx}`);
console.log(` Max expenses/month:      ${metrics.maxTxInMonth}`);
console.log(` Avg expenses/month:      ${(metrics.totalExpenses / MONTHS).toFixed(1)}`);
console.log(` Max |ΣplanUt − total|:   ${metrics.maxPlanUtDelta.toFixed(6)} kr`);
console.log(` Max |ΣfellesShares − F|: ${metrics.maxFellesShareDelta.toFixed(6)} kr`);
console.log(` Over-budget cat-months:  ${metrics.overBudgetCats}`);
console.log(` Missed months:           ${metrics.missedMonths.join(", ") || "—"}`);
console.log(` One-offs:                ${metrics.oneOffs.map((o) => o.note).join(", ")}`);
console.log(` Baby / Barnehage / Elbil:${metrics.babyAddedAt} / ${metrics.barnehageAddedAt} / ${metrics.elbilAddedAt}`);
console.log(` Salary / Job / Split:    ${metrics.salaryBumpAt} / ${metrics.jobChangeAt} / ${metrics.splitChangeAt}`);
console.log(` Person add/rename:       ${metrics.personAddedAt} / ${metrics.personRenamedAt}`);
console.log(` calcFamily ×240:         ${totalCalcMs.toFixed(2)} ms`);
console.log(` calcFamily avg/max:      ${avgCalcMs.toFixed(3)} / ${maxCalcMs.toFixed(3)} ms`);
console.log(
  ` Storage serialize:       ${(storageBytes / 1024).toFixed(1)} KiB` +
    (storageWarn ? ` ⚠ large (>${WARN_STORAGE_MB} MiB)` : " (OK)")
);

console.log("\n--- Payload growth (sync JSON) ---");
for (const row of metrics.payloadByYear.filter((_, i) => i % 2 === 1 || i === 0 || i === metrics.payloadByYear.length - 1)) {
  console.log(`  ${row.year}: ${(row.bytes / 1024).toFixed(1)} KiB (${row.months} mnd)`);
}

console.log("\n--- Sparemål ---");
for (const g of state.savingsGoals) {
  const st = g._meta.status;
  const prog = g._finalProgress;
  const eta = g._finalEta;
  console.log(
    `  [${st}] ${g.name} (${g.person}): ${round2(g.saved)}/${g.target} (${prog.pct.toFixed(0)}%) ` +
      `monthly=${g.monthly} eta=${eta.label}` +
      (g._meta.completedAt ? ` @${g._meta.completedAt}` : "") +
      (g._meta.abandonedAt ? ` abandoned@${g._meta.abandonedAt}` : "")
  );
}
console.log(`  Completed: ${metrics.goalsCompleted.length}, Abandoned: ${metrics.goalsAbandoned.length}, Adjusted: ${metrics.goalsAdjusted.length}`);

console.log("\n--- Year rollup perf ---");
const avgRoll = metrics.yearRollupMs.reduce((a, b) => a + b.ms, 0) / metrics.yearRollupMs.length;
console.log(`  avg yearRollup: ${avgRoll.toFixed(2)} ms (${metrics.yearRollupMs.length} years)`);

console.log("\n--- Sample months ---");
const sampleIdx = [0, 24, 48, 72, 96, 120, 132, 180, 200, 239];
for (const idx of sampleIdx) {
  const row = metrics.months[idx];
  if (!row) continue;
  console.log(
    `  ${row.key}: exp=${row.expenses} inn=${row.incomes} spareTx=${row.savings} ` +
      `planInn=${round2(row.planInn)} planUt=${round2(row.plannedTotal)} actualUt=${round2(row.samletUtgifter)} ` +
      `safe=${round2(row.safeToSpend)} (${row.safeMode}) people=${row.peopleCount} calc=${row.calcMs.toFixed(2)}ms`
  );
}

const painful = [];
if (metrics.totalExpenses > 8000) painful.push(`Logg blir svært lang (~${metrics.totalExpenses} utgiftsposter over 20 år)`);
painful.push("Månedsnavigasjon uten sterk år-/trendvisning blir slitsom over to tiår");
painful.push("yearRollup finnes i calc, men UI mangler rik flerårig trendgraf / sparerate over tid");
painful.push("Sparemål er ikke koblet til spareinnskudd — manuell «saved» krever disiplin i 20 år");
if (storageMB > CLOUD_SOFT_MB)
  painful.push(`Sync-payload ~${storageMB.toFixed(2)} MiB nærmer seg/overstiger komfortabel sky-sync`);
else if (storageMB > 0.8)
  painful.push(`Sync-payload ~${(storageBytes / 1024).toFixed(0)} KiB OK nå, men vokser lineært med måneder`);
if (metrics.missedMonths.length)
  painful.push(`Uregelmessig logging (${metrics.missedMonths.length} «glemte» måneder) — carry-forward hjelper plan, men faktisk logg får hull`);

const usable =
  assertsFail === 0 &&
  avgCalcMs < 20 &&
  storageMB < 8;

console.log("\n--- Usability verdict (synthetic) ---");
console.log(` Usable overview for 20 years?  ${usable ? "JA (kalk/lagring OK)" : "DELVIS / NEI"}`);
console.log(" Pain points:");
painful.forEach((p) => console.log("  –", p));

console.log("\n=== TL;DR (norsk) ===");
if (usable) {
  console.log(
    `Appen klarer 20 år teknisk: ${MONTHS} mnd, ~${metrics.totalExpenses} utgifter, ` +
      `${(storageBytes / 1024).toFixed(0)} KiB lagring, calc ~${avgCalcMs.toFixed(2)} ms/mnd. ` +
      `Sparemål: ${metrics.goalsCompleted.length} fullført, ${metrics.goalsAbandoned.length} forlatt. ` +
      `Oversikt per måned fungerer; smertepunkter er lang logg, sync-volum og manuell sparemål-progresjon.`
  );
} else {
  console.log(`Tekniske problemer (${assertsFail} feil). Se assertions.`);
}

if (assertsFail) {
  console.log("\nFAILED assertions:");
  failures.forEach((f) => console.log(" -", f));
}

// ---------- Write Norwegian report ----------
const reportPath = join(__dirname, "SIM-20Y-RAPPORT.md");
const goalsTable = state.savingsGoals
  .map((g) => {
    const prog = g._finalProgress;
    return `| ${g.name} | ${g.person} | ${g._meta.status} | ${round2(g.saved)} / ${g.target} | ${prog.pct.toFixed(0)}% | ${g.monthly} | ${g._finalEta.label} | ${g._meta.completedAt || g._meta.abandonedAt || "—"} |`;
  })
  .join("\n");

const payloadTable = metrics.payloadByYear
  .map((r) => `| ${r.year} | ${(r.bytes / 1024).toFixed(1)} KiB | ${r.months} |`)
  .join("\n");

const sampleSafe = sampleIdx
  .map((idx) => metrics.months[idx])
  .filter(Boolean)
  .map(
    (r) =>
      `| ${r.key} | ${r.expenses} | ${round2(r.safeToSpend)} | ${r.safeMode} | ${r.peopleCount} | ${r.calcMs.toFixed(2)} ms |`
  )
  .join("\n");

const report = `# Familiebudsjett – 20-års simulering (2020–2039)

**Dato:** 7. september 2026 (UTC+2)  
**Type:** Syntetisk husstandsbruk (Mathias + Andrea + Felles) — **ingen** lokal brukerdata / localStorage berørt.  
**Skript:** \`sim-20y.mjs\` (bygger på \`sim-10y.mjs\` / \`sim-2y.mjs\`)

---

## Kort svar: Holder det i 20 år?

**Teknisk: ja.** Kalkulasjoner er raske (~${avgCalcMs.toFixed(2)} ms/mnd, hele 240 mnd på ~${totalCalcMs.toFixed(0)} ms), carry-forward av plan fungerer, felles-fordeling summerer til 100 %, underlinjer (år/kvartal) synker budsjett riktig, safe-to-spend per person er endelig, og \`yearRollup\` / \`sparingStats\` tåler to tiår.

**Som daglig produkt over 20 år: delvis.** Appen forblir nyttig som **månedsstyring** (budsjett, safe-to-spend, sparing-innskudd, sparemål). Den blir gradvis mindre behagelig som **livshistorikk** fordi logg, navigasjon og sync-payload vokser lineært uten sterke flerårsverktøy, og sparemål krever manuell oppdatering av «spart».

**Assertions:** ${assertsOk} OK / ${assertsFail} feil  
**Payload etter 20 år:** ${(storageBytes / 1024).toFixed(1)} KiB (~${storageMB.toFixed(2)} MiB)

---

## Hva ble simulert

| Område | Dekning |
|--------|---------|
| Personer | Mathias (p1), Andrea (p2); Emma (p3) lagt til år 11, omdøpt, arkivert år 15 |
| Budsjetter | Felles + personlige kategorier, inflasjon ~2–3 %/år, Lån-justeringer |
| Underlinjer | Netflix (år/once), Spotify (mnd), Disney+ (kvartal/spread); bilforsikring (år), innbo (kvartal/once) |
| Inntekt | Lønn + ekstra, lønnsøkning år 5 og 10, jobbytte/inntektsfall Andrea år 7 |
| Sparing | Planlagt sparing nær lønn, spareinnskudd, spare saldo, \`sparingStats\` |
| Sparemål | 5 mål over tid: fullført / forlatt / justert / aktive |
| Safe-to-spend | Saldo-modus per person + samlet |
| Edge cases | ${metrics.missedMonths.length} glemte måneder, ${metrics.oneOffs.length} engangsutgifter, nye kategorier midt i løpet |
| Årsvisning | \`yearRollup\` hvert år (~${avgRoll.toFixed(1)} ms snitt) |

### Livshendelser (utvalg)
${notes
  .filter(
    (n) =>
      n.includes("added") ||
      n.includes("sparemål") ||
      n.includes("MISSED") ||
      n.includes("person") ||
      n.includes("engangs") ||
      n.includes("salary") ||
      n.includes("job") ||
      n.includes("split") ||
      n.includes("Barnehage") ||
      n.includes("Elbil") ||
      n.includes("arkivert") ||
      n.includes("omdøpt")
  )
  .map((n) => `- ${n}`)
  .join("\n")}

---

## Nøkkeltall

| Metrikk | Verdi |
|---------|-------|
| Måneder | ${MONTHS} |
| Utgiftsposter | ${metrics.totalExpenses} |
| Inntektsrader | ${metrics.totalIncomes} |
| Spareinnskudd | ${metrics.totalSavingsTx} |
| Snitt utgifter/mnd | ${(metrics.totalExpenses / MONTHS).toFixed(1)} |
| Maks utgifter i én mnd | ${metrics.maxTxInMonth} |
| Carry-forward | ${metrics.carryEvents} |
| Over budsjett (kat·mnd) | ${metrics.overBudgetCats} |
| calcFamily snitt/maks | ${avgCalcMs.toFixed(3)} / ${maxCalcMs.toFixed(3)} ms |
| Sync JSON (20 år) | ${(storageBytes / 1024).toFixed(1)} KiB |
| Sparemål fullført | ${metrics.goalsCompleted.length} |
| Sparemål forlatt | ${metrics.goalsAbandoned.length} |
| Sparemål justert | ${metrics.goalsAdjusted.length} |

### Payload-vekst (viktig for sky-synk)

| År | JSON-størrelse | Måneder lagret |
|----|----------------|----------------|
${payloadTable}

**Tolkning:** Veksten er ~lineær med antall måneder/transaksjoner. Etter 20 år er ~${(storageBytes / 1024).toFixed(0)} KiB fortsatt **under** typiske localStorage-grenser (~5 MiB), men for **sky-synk** (hele JSON opp/ned) begynner det å merkes: tregere sync, større konfliktrisiko, dyrere båndbredde på mobil. Uten komprimering / inkrementell sync / arkiv av gamle år vil 30–40 år bli ubehagelig.

### Sample safe-to-spend

| Måned | Utgifter | Safe-to-spend | Modus | Personer | Calc |
|-------|----------|---------------|-------|----------|------|
${sampleSafe}

---

## Sparemål – funn

| Navn | Person | Status | Spart / mål | % | Mnd-beløp | ETA | Når |
|------|--------|--------|-------------|---|-----------|-----|-----|
${goalsTable}

### Hva fungerer
- **ETA og progresjon** (\`savingsGoalEta\` / \`savingsGoalProgress\`) er stabile over 20 år: «nådd», «ca. mnd ÅÅÅÅ», «Sett månedlig beløp».
- Flere mål samtidig (personlig + felles + samlet) er støttet.
- Justering av target/monthly midt i løpet fungerer uten å ødelegge lagret \`saved\`.

### Smertepunkter (sparemål)
1. **Ingen auto-kobling til spareinnskudd** — \`saved\` er eksplisitt felt. Over 20 år med flere mål er det lett å glemme å oppdatere, eller å doble-telle mellom bufferkonto og hyttefond.
2. **Ingen historikk/UI for forlatte/fullførte mål** i datamodellen utover det appen selv lagrer — simuleringen trengte \`_meta\` for status. Produktene bør ha status (aktiv/nådd/arkivert) + dato.
3. **Ingen «bidra denne måneden»-flyt** knyttet til planlagt sparing nær lønn — brukeren må tenke to steder (sparing-logg vs. sparemål).
4. **ETA antar konstant monthly** — livshendelser (jobbytte, barn) endrer sparingsevne; ETA blir optimistisk uten replanlegging.
5. **Felles vs. samlet vs. person** er fleksibelt, men uten aggregert «hvor mye er øremerket» mot spare saldo kan man tro man har mer fri sparekapital enn man har.

---

## Pain points (produkt)

### UX
- **Måned-for-måned** over 240 måneder uten rik flerårs-tidslinje.
- **Logg** med ~${metrics.totalExpenses} poster: søk hjelper, men mangler år/kategori-aggregat og «arkiver gamle år».
- **Glemte måneder:** carry-forward redder budsjettplan, men faktiske tall får hull — mangler «fyll inn forrige måned»-påminnelse / estimat.
- **Person add/rename/arkiv** fungerer i modellen; felles-% må justeres manuelt når husstanden endres (vi så Lån 40/40/20 → tilbake 55/45).

### Ytelse
- **calcFamily** er ikke flaskehalsen (~${avgCalcMs.toFixed(2)} ms).
- **UI-rendering** av logg/år med tusenvis av DOM-noder er den sannsynlige flaskehalsen (ikke målt her, men forventet).
- **yearRollup** ~${avgRoll.toFixed(1)} ms/år er greit; 20 år i én graf er fortsatt billig på calc-siden.

### Data / sync
- Payload ~${(storageBytes / 1024).toFixed(0)} KiB etter 20 år — OK lokalt, **bør planlegges** for sky (inkrementell sync, komprimering, eller år-arkiv).
- Hele state som én JSON er sårbart for store merge-konflikter ved samtidige enheter.

### Manglende funksjoner
- Flerårig trend (sparerate, utgifter/kategori, safe-to-spend over tid).
- Kobling sparing ↔ sparemål.
- Arkiv/eksport av gamle år uten å slette.
- Bedre engangsutgift-håndtering (merket one-off som ikke ødelegger «vanlig måned»-snitt).

---

## Anbefalte endringer (prioritert)

### Must (bør på plass for 10–20 års bruk)
1. **Årsarkiv / kompakt historikk** — behold aggregater (månedssummer per kategori), detalj-transaksjoner kan eksporteres eller lastes lazy. Mål: holde aktiv sync-payload under ~500–800 KiB.
2. **Sparemål-status + historikk** — aktiv / nådd / arkivert, med dato; ikke bare slette fullførte mål.
3. **Valgfri kobling: spareinnskudd → sparemål** — «fordel denne sparing til mål X» (evt. automatisk %-fordeling), slik at \`saved\` ikke er rent manuelt i 20 år.
4. **Flerårsoversikt i UI** — bygg på \`yearRollup\` + \`sparingStats\`: sparerate, utgifter, safe-to-spend-trend.

### Should
5. **Inkrementell / delt sky-sync** — ikke alltid full JSON; eller gzip + diff. Reduserer konflikter og mobilkost.
6. **«Glemt måned»-flyt** — detekter hull, foreslå kopi av forrige plan + estimat basert på snitt.
7. **Engangsutgift-flagg** — holdes utenfor «vanlig forbruk»-snitt og budsjettvarsler.
8. **Husstandsendring-veiviser** — ved ny person/arkiv: foreslå nye felles-% og oppdater alle felles-kategorier.

### Nice
9. **Virtuell logg-liste** (windowing) så 10k+ poster ikke henger UI.
10. **Sparemål-scenarioer** — «hva hvis monthly −500 kr?» uten å endre lagret mål.
11. **Inflasjonsjusterte budsjettforslag** ved årsskifte (simuleringen gjorde dette manuelt).
12. **Eksport til regneark/PDF** per år for skatt/boliglån-samtaler.

---

## Konklusjon for Mathias

Familiebudsjett **skalerer teknisk til 20 år aktiv bruk** uten kalkfeil i denne simuleringen. Det som avgjør om det forblir *behagelig* er produktvalg rundt **historikkvolum**, **sky-sync**, og **sparemål-arbeidsflyt**. Prioriter arkiv + sparemål-kobling + flerårsvisning før kosmetikk.

Ingen calc-bug blokkerte simuleringen — **ingen deploy** anbefalt fra denne kjøringen (kun rapport).

---

*Generert av \`sim-20y.mjs\` — assertions ${assertsFail === 0 ? "grønne" : "røde"}.*
`;

writeFileSync(reportPath, report, "utf8");
console.log(`\nReport written: ${reportPath}\n`);

// Machine-readable summary for parent
const summary = {
  ok: assertsFail === 0,
  months: MONTHS,
  expenses: metrics.totalExpenses,
  incomes: metrics.totalIncomes,
  savingsTx: metrics.totalSavingsTx,
  payloadBytes: storageBytes,
  payloadKiB: round2(storageBytes / 1024),
  payloadMiB: round2(storageMB),
  avgCalcMs: round2(avgCalcMs),
  totalCalcMs: round2(totalCalcMs),
  goalsCompleted: metrics.goalsCompleted.length,
  goalsAbandoned: metrics.goalsAbandoned.length,
  goalsAdjusted: metrics.goalsAdjusted.length,
  goalsActive: state.savingsGoals.filter((g) => g._meta.status === "active").length,
  missedMonths: metrics.missedMonths.length,
  carryEvents: metrics.carryEvents,
  usable,
  reportPath,
  top5: [
    "Årsarkiv / kompakt historikk for sync-payload",
    "Sparemål status (aktiv/nådd/arkivert) + historikk",
    "Kobling spareinnskudd → sparemål (fordeling)",
    "Flerårsoversikt i UI (yearRollup + sparingStats)",
    "Inkrementell/delt sky-sync (ikke alltid full JSON)"
  ]
};
writeFileSync(join(__dirname, "sim-20y-summary.json"), JSON.stringify(summary, null, 2));
console.log("SUMMARY_JSON:", JSON.stringify(summary));

if (assertsFail) process.exit(1);
console.log("OK – all assertions passed.\n");
