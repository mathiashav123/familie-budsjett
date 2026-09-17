#!/usr/bin/env node
/**
 * QA: verify live export expected Sep/Oct/Nov numbers for Mathias.
 * Usage: node scripts/qa-live-fallback.mjs [--write]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const Calc = require(path.join(root, "calc-core.js"));

const exportPath =
  process.env.FAMILY_BUDGET_EXPORT ||
  path.resolve(root, "../familie-budsjett-export-live.json");
const write = process.argv.includes("--write");

const live = JSON.parse(fs.readFileSync(exportPath, "utf8"));
const months = JSON.parse(JSON.stringify(live.months));
const people = live.people;
const cats = live.categories;
const planned = live.plannedSpends || [];
const settings = Object.assign({}, live.settings, { months });

function calc(key) {
  const mi = Number(key.split("-")[1]) - 1;
  return Calc.calcFamily(
    months[key],
    people,
    cats,
    settings,
    mi,
    planned,
    key
  );
}

const expected = {
  "2026-09": { trygg: 71223, bank: 231223, mode: "saldo" },
  "2026-10": { trygg: 85905.2, mode: "saldo" },
  "2026-11": { trygg: 105229.4, mode: "saldo" }
};

const report = {};
for (const key of Object.keys(expected)) {
  const c = calc(key);
  report[key] = {
    totalBruk: c.totalBruk,
    safeToSpend: c.safeToSpend,
    safeToSpendMode: c.safeToSpendMode,
    futureReserve: c.futureReserve,
    brukFromDisplayFallback: !!c.brukFromDisplayFallback,
    ok:
      c.safeToSpend === expected[key].trygg &&
      c.safeToSpendMode === "saldo"
  };
}

const proj = Calc.projectPotFollowBudget({
  months,
  fromKey: "2026-09",
  people,
  categories: cats,
  plannedSpends: planned,
  startPot: 231223,
  horizon: 12
});

console.log(
  JSON.stringify(
    {
      exportPath,
      expected,
      report,
      projection: {
        oct: proj.months[0],
        potAtHorizon: proj.potAtHorizon,
        formula: proj.formula
      }
    },
    null,
    2
  )
);

const allOk = Object.values(report).every((r) => r.ok);
if (!allOk) {
  console.error("QA FAILED — Sep/Oct/Nov Trygg not expected rolling saldo");
  process.exit(1);
}

if (write) {
  for (const key of ["2026-10", "2026-11"]) {
    Calc.ensureSuggestedBalances(months, key, people, {
      plannedSpends: planned,
      categories: cats
    });
  }
  const out = Object.assign({}, live, { months });
  const outPath = path.resolve(root, "familie-budsjett-export-live-qa.json");
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log("Wrote", outPath);
}

console.log("QA OK — Sep=71223, Oct/Nov rolling (not frozen 71k)");
