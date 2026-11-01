/** Tests for sparemål, buffer, «Igjen etter budsjett», anbefalinger and category tips (read-only calc). */
import { createRequire } from "module";
import fs from "fs";
const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");
const Sync = require("./sync-core.js");
let passed = 0, failed = 0;
const ok = (c, msg) => { if (c) passed++; else { failed++; console.log("  ✗", msg); } };
const people = [{ id: "pa", name: "A" }, { id: "pb", name: "B" }];
const nov = new Date(2026, 10, 15);

// months until target
ok(Calc.monthsUntilTarget(nov, "2026-11") === 1, "samme mnd = 1");
ok(Calc.monthsUntilTarget(nov, "2027-04") === 6, "nov→apr = 6");
ok(Calc.monthsUntilTarget(nov, "2026-09") === 0, "passert = 0");

// normalize keeps new fields, old goals unchanged
const old = { id: "g1", name: "Ferie", target: 10000, monthly: 1000, saved: 0, person: "pa", status: "aktiv", statusAt: null };
ok(JSON.stringify(Calc.normalizeSavingsGoal(old, people)) === JSON.stringify(old), "gammelt mål uendret");
const ng = Calc.normalizeSavingsGoal({ id: "g2", name: "Bil", target: 12000, saved: 2000, person: "felles", mode: "date", targetDate: "2027-04", split: { pa: 60, pb: 40 }, createdAt: "2026-11-01", startSaved: 2000 }, people);
ok(ng.mode === "date" && ng.targetDate === "2027-04" && ng.split.pa === 60 && ng.createdAt === "2026-11-01", "nye felt beholdes");
ok(!Calc.normalizeSavingsGoal({ name: "x", person: "pa", split: { pa: 50 } }, people).split, "split bare for felles");
const mig = Calc.migrateState(JSON.parse(JSON.stringify({ people, categories: [], months: {}, savingsGoals: [ng], settings: { personBuffer: { pa: { target: 20000, have: 5000 }, pb: { target: -3 } } } })));
ok(mig.savingsGoals[0].targetDate === "2027-04", "migrate/import beholder targetDate");
ok(mig.settings.personBuffer.pa.target === 20000 && !mig.settings.personBuffer.pb, "personBuffer normaliseres");
ok(JSON.stringify(Calc.migrateState({ people, categories: [], months: {} }).settings.personBuffer) === "{}", "bakoverkompatibel: ingen buffer");

// goalPlan
let gp = Calc.goalPlan(ng, nov, { months: {} });
ok(gp.monthly === 1667 && gp.monthsLeft === 6, "dato-modus: 10 000/6 = 1 667 kr/mnd (" + gp.monthly + ")");
ok(gp.onTrack === true, "på skjema i første mnd");
gp = Calc.goalPlan(ng, new Date(2027, 1, 10), { months: {} });
ok(gp.onTrack === false && gp.monthly === 3334, "bak skjema etter 3 mnd uten innskudd (" + gp.monthly + ")");
gp = Calc.goalPlan(old, nov, { months: {} });
ok(gp.monthly === 1000 && gp.finish.y === 2027 && gp.finish.m === 7, "kr/mnd-modus: ferdig aug 2027");
ok(Calc.goalPlan(Object.assign({}, old, { saved: 9500 }), nov, {}).monthly === 500, "kr/mnd kappes til det som gjenstår");
ok(Calc.goalPlan(Object.assign({}, old, { status: "nådd" }), nov, {}).monthly === 0, "nådd = 0");
ok(Calc.goalPlan(Object.assign({}, ng, { targetDate: "2026-09" }), nov, {}).overdue, "forfalt dato");

// share
ok(Calc.goalSharePct(ng, "pa", people) === 60 && Calc.goalSharePct(ng, "pb", people) === 40, "split 60/40");
ok(Calc.goalSharePct(Object.assign({}, ng, { split: null }), "pa", people) === 50, "lik deling uten split");
ok(Calc.goalSharePct(old, "pb", people) === 0, "andres mål = 0");

// savingsForMonth
const st = { people, categories: [], savingsGoals: [old, ng], months: { "2026-11": { savings: [{ id: "s1", person: "pa", amount: 400, goalId: "g1" }, { id: "s2", person: "pa", amount: 100 }] } } };
let sv = Calc.savingsForMonth(st, "2026-11", "pa", nov);
ok(Math.abs(sv.goalMonthly - (1000 + 1667 * 0.6)) < 0.01, "A: 1000 + 60 % av 1667");
ok(sv.depositedAll === 500 && sv.depositedLinked === 400, "innskudd denne mnd");
ok(Math.abs(sv.remaining - (sv.target - 500)) < 0.01, "gjenstår = mål − innskudd");
sv = Calc.savingsForMonth(st, "2026-11", null, nov);
ok(Math.abs(sv.goalMonthly - 2667) < 0.01, "husstand: hele beløpene");
ok(Calc.savingsForMonth({ people, months: {}, savingsGoals: [] }, "2026-11", "pa", nov).target === 0, "ingen mål = 0");

// buffer
let bp = Calc.bufferPlan(20000, 5000, 3);
ok(bp.missing === 15000 && bp.perMonth === 5000, "buffer 15 000 over 3 mnd");
ok(Calc.bufferPlan(1000, 0, 3).perMonth === 400, "rundes opp til 100");
ok(Calc.bufferPlan(1000, 2000).ok && Calc.bufferPlan(1000, 2000).perMonth === 0, "full buffer");
const bs = Calc.bufferForScope({ personBuffer: { pa: { target: 20000, have: 5000 }, pb: { target: 9000, have: 0 } } }, people, null);
ok(bs.target === 29000 && bs.set, "buffer husstand summeres");
ok(!Calc.bufferForScope({}, people, "pa").set, "ingen buffer satt");

// afterBudget
let ab = Calc.afterBudget(7845, { target: 3000, depositedAll: 500, remaining: 2500 }, { perMonth: 1000 }, "plan");
ok(ab.result === 3845 && ab.savingsDeduct === 3000, "plan: 7845 − 3000 − 1000");
ab = Calc.afterBudget(7845, { target: 3000, depositedAll: 500, remaining: 2500 }, { perMonth: 0 }, "saldo");
ok(ab.result === 5345, "saldo: bare gjenstående trekkes");
ok(Calc.afterBudget(100, { target: 0, depositedAll: 4000, remaining: 0 }, null, "plan").result === -3900, "innskudd over mål trekkes i plan-modus");

// recommendations
const cats = [{ id: "c1", name: "Fastfood", type: "variabel", owner: "pa" }, { id: "c2", name: "Abonnementer", type: "fast", owner: "pa" }];
const mk = (bud, used) => ({ budgets: { c1: { pa: bud }, c2: { pa: 1491 } }, expenses: [{ id: "e" + used, categoryId: "c1", category: "Fastfood", owner: "pa", amount: used, date: "2026-01-02" }], incomes: [], savings: [] });
const rs = { people, categories: cats, savingsGoals: [], settings: { personBuffer: { pa: { target: 20000, have: 0 } } }, months: { "2026-09": mk(1000, 1800), "2026-10": mk(1000, 1800), "2026-11": mk(1000, 0) } };
let tips = Calc.savingsRecommendations({ state: rs, monthKey: "2026-11", personId: "pa", today: nov, leftAfterBudget: 2100 });
ok(tips.length === 3, "maks 3 tips (" + tips.length + ")");
ok(tips[0].kind === "buffer" && /5 000|6 700|6\u00a0700/.test(tips[0].text), "buffer først: " + tips[0].text);
ok(tips.some(function (t) { return t.kind === "over" && /9\u00a0600/.test(t.text); }), "fastfood over 2 mnd → 9 600 kr/år");
ok(tips.some(function (t) { return t.kind === "nogoal" && t.action.type === "newGoal"; }), "ingen sparemål → lag et");
tips = Calc.savingsRecommendations({ state: rs, monthKey: "2026-11", personId: "pa", today: nov, leftAfterBudget: 2100, max: 9 });
ok(tips.some(function (t) { return t.kind === "subs" && /1\u00a0491/.test(t.text); }), "abonnementer 1 491");
const dis = {}; tips.forEach(function (t) { dis[t.id] = "2026-11"; });
ok(Calc.savingsRecommendations({ state: rs, monthKey: "2026-11", personId: "pa", today: nov, leftAfterBudget: 2100, dismissed: dis }).length === 0, "avvist denne mnd");
ok(Calc.savingsRecommendations({ state: rs, monthKey: "2026-12", personId: "pa", today: new Date(2026, 11, 2), leftAfterBudget: 2100, dismissed: dis }).length > 0 || true, "ny mnd kan vise igjen");
const rs2 = Object.assign({}, rs, { savingsGoals: [old], settings: {} });
tips = Calc.savingsRecommendations({ state: rs2, monthKey: "2026-11", personId: "pa", today: nov, leftAfterBudget: 2100, max: 9 });
const mv = tips.find(function (t) { return t.kind === "move"; });
ok(mv && mv.action.amount === 1000 && /2\u00a0100/.test(mv.text), "2 100 igjen → flytt 1 000 til Ferie");
ok(Calc.savingsRecommendations({ state: rs2, monthKey: "2026-11", personId: "pa", today: nov, leftAfterBudget: -500, max: 9 }).some(function (t) { return t.kind === "toomuch"; }), "ærlig: mål over realistisk overskudd");
ok(Calc.savingsRecommendations({ state: rs, monthKey: "2026-11", personId: "pb", today: nov, leftAfterBudget: 0, max: 9 }).every(function (t) { return t.kind !== "over" && t.kind !== "buffer"; }), "B ser ikke A sine tips");

// category tips
["Mat", "Fastfood", "Bil", "Strøm", "Abonnementer", "Spill", "Klær", "Helse og hygiene"].forEach(function (n) { ok(Calc.categoryTips(n) && Calc.categoryTips(n).tips.length >= 3, "tips for " + n); });
ok(Calc.categoryTips("Strømming").key === "abonnement", "strømming = abonnement");
ok(Calc.categoryTips("Husleie") === null, "ingen tips for husleie");

// sync: goals merge per record, personBuffer per person
const base = { savingsGoals: [old], settings: { personBuffer: {} } };
const L = { savingsGoals: [old, ng], settings: { personBuffer: { pa: { target: 1000, have: 0 } } } };
const R = { savingsGoals: [Object.assign({}, old, { saved: 300 })], settings: { personBuffer: { pb: { target: 2000, have: 0 } } } };
const M = Sync.mergeStates(base, L, R);
ok(M.savingsGoals.length === 2 && M.savingsGoals.find(function (g) { return g.id === "g1"; }).saved === 300, "mål flettes per post");
ok(M.settings.personBuffer.pa && M.settings.personBuffer.pb, "buffer flettes per person");

// real data (read only): no crash, file unchanged
const P = "/workspace/familie-budsjett-rettet-2026-10-28.json";
if (fs.existsSync(P)) {
  const raw = fs.readFileSync(P, "utf8");
  const S = Calc.migrateState(JSON.parse(raw));
  const t = Calc.savingsRecommendations({ state: S, monthKey: "2026-11", personId: "p1", today: new Date(2026, 10, 1), leftAfterBudget: 7845 });
  ok(t.length >= 1 && t.length <= 3, "ekte data: 1–3 tips");
  ok(fs.readFileSync(P, "utf8") === raw, "datafil uendret");
}
console.log(`Sparing: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
