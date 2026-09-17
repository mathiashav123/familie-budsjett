/**
 * Familiebudsjett – pure calc + migration (Node + browser)
 * Expected budgets are per owner (personId / felles). Felles expenses (+ felles budgets)
 * are split by per-category percentages (default equal) for per-person planUt / actuals.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FamilieBudsjettCalc = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var LEGACY_A = "a";
  var LEGACY_B = "b";
  var ID_A = "p1";
  var ID_B = "p2";

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function defaultPeople() {
    return [
      { id: ID_A, name: "Mathias", archived: false },
      { id: ID_B, name: "Andrea", archived: false }
    ];
  }

  function activePeople(people) {
    if (!Array.isArray(people)) return [];
    return people.filter(function (p) {
      return p && p.id && !p.archived;
    });
  }

  function personById(people, id) {
    if (!Array.isArray(people)) return null;
    return people.find(function (p) {
      return p.id === id;
    }) || null;
  }

  function nameOf(people, who) {
    if (who === "felles" || !who) return "Felles";
    var p = personById(people, who);
    return p ? p.name : "Ukjent";
  }

  function mapLegacyOwner(who) {
    if (who === LEGACY_A) return ID_A;
    if (who === LEGACY_B) return ID_B;
    return who;
  }

  /** Equal percent map across active people (sums to 100; last gets remainder). */
  function equalSplit(people) {
    var active = activePeople(people);
    var n = active.length;
    var out = {};
    if (n === 0) return out;
    var base = Math.floor(10000 / n) / 100; // 2 decimals
    var sum = 0;
    active.forEach(function (p, i) {
      if (i === n - 1) {
        out[p.id] = Math.round((100 - sum) * 100) / 100;
      } else {
        out[p.id] = base;
        sum += base;
      }
    });
    return out;
  }

  function cloneSplit(split) {
    if (!split || typeof split !== "object") return null;
    var out = {};
    Object.keys(split).forEach(function (k) {
      var n = Number(split[k]);
      if (!Number.isNaN(n)) out[k] = n;
    });
    return Object.keys(out).length ? out : null;
  }

  function splitSum(split, people) {
    var active = activePeople(people);
    var sum = 0;
    active.forEach(function (p) {
      var v = split && split[p.id];
      if (v != null && v !== "") sum += Number(v) || 0;
    });
    return Math.round(sum * 100) / 100;
  }

  /** True when split is missing or matches equal among active people. */
  function isEqualSplit(split, people) {
    if (!split || typeof split !== "object") return true;
    var eq = equalSplit(people);
    var active = activePeople(people);
    if (!active.length) return true;
    for (var i = 0; i < active.length; i++) {
      var id = active[i].id;
      var a = Number(split[id]);
      var b = Number(eq[id]);
      if (split[id] == null || split[id] === "" || Number.isNaN(a)) return false;
      if (Math.abs(a - b) > 0.051) return false;
    }
    return true;
  }

  /**
   * Resolve split for a category among active people.
   * No cat.split (or equal values) → equal. Custom → keep; missing people get 0.
   */
  function getCategorySplit(cat, people) {
    var active = activePeople(people);
    if (!active.length) return {};
    var raw = cat && cat.split;
    if (!raw || typeof raw !== "object" || isEqualSplit(raw, people)) {
      return equalSplit(people);
    }
    var out = {};
    active.forEach(function (p) {
      var v = raw[p.id];
      out[p.id] = v == null || v === "" ? 0 : Number(v) || 0;
    });
    return out;
  }

  function fellesSharePercent(cat, personId, people) {
    var split = getCategorySplit(cat, people);
    var v = split[personId];
    return v == null ? 0 : Number(v) || 0;
  }

  /** person's kr share of a felles budgetOrActual amount */
  function fellesShare(cat, personId, people, budgetOrActual) {
    var amt = Number(budgetOrActual) || 0;
    if (!amt) return 0;
    return (amt * fellesSharePercent(cat, personId, people)) / 100;
  }


  /**
   * Rescale active-people split percentages to sum 100.
   * If all zero / empty → equal split. Last person gets remainder øre.
   */
  function normalizeSplitTo100(split, people) {
    var active = activePeople(people);
    var out = {};
    if (!active.length) return out;
    var sum = 0;
    active.forEach(function (p) {
      var v =
        split && split[p.id] != null && split[p.id] !== ""
          ? Number(split[p.id])
          : 0;
      if (!Number.isFinite(v) || v < 0) v = 0;
      out[p.id] = v;
      sum += v;
    });
    if (sum <= 0) return equalSplit(people);
    var running = 0;
    active.forEach(function (p, i) {
      if (i === active.length - 1) {
        out[p.id] = Math.round((100 - running) * 100) / 100;
      } else {
        var n = Math.round((out[p.id] / sum) * 10000) / 100;
        out[p.id] = n;
        running += n;
      }
    });
    return out;
  }

  /**
   * Persist split only when custom (≠ equal). Equal / empty clears cat.split
   * so future people-count changes keep rebalancing.
   */
  function setCategorySplit(cat, split, people) {
    if (!cat) return;
    var cleaned = cloneSplit(split);
    if (!cleaned || isEqualSplit(cleaned, people)) {
      delete cat.split;
      return;
    }
    var active = activePeople(people);
    var next = {};
    active.forEach(function (p) {
      next[p.id] =
        cleaned[p.id] == null || cleaned[p.id] === ""
          ? 0
          : Number(cleaned[p.id]) || 0;
    });
    cat.split = next;
  }

  /**
   * Custom splits only (equal is stored as absent). Pad new people with 0 %;
   * drop archived keys. Clear if values now match equal.
   */
  function ensureCategorySplits(categories, people) {
    var active = activePeople(people);
    (categories || []).forEach(function (cat) {
      if (!cat || !cat.split || typeof cat.split !== "object") return;
      if (isEqualSplit(cat.split, people)) {
        delete cat.split;
        return;
      }
      var next = {};
      active.forEach(function (p) {
        var v = cat.split[p.id];
        next[p.id] = v == null || v === "" ? 0 : Number(v) || 0;
      });
      if (isEqualSplit(next, people)) {
        delete cat.split;
      } else {
        cat.split = next;
      }
    });
  }

  /** Additive plannedIncome fields per person (income + standing monthly saving plan). */
  var PLANNED_INCOME_FIELDS = ["lønn", "ekstra", "sparing"];

  function emptyPlannedIncomeBlock() {
    return { lønn: null, ekstra: null, sparing: null };
  }

  function ensurePlannedIncomeShape(m, people) {
    if (!m.plannedIncome || typeof m.plannedIncome !== "object") {
      m.plannedIncome = {};
    }
    // Migrate legacy a/b keys if present
    if (m.plannedIncome[LEGACY_A] && !m.plannedIncome[ID_A]) {
      m.plannedIncome[ID_A] = m.plannedIncome[LEGACY_A];
      delete m.plannedIncome[LEGACY_A];
    }
    if (m.plannedIncome[LEGACY_B] && !m.plannedIncome[ID_B]) {
      m.plannedIncome[ID_B] = m.plannedIncome[LEGACY_B];
      delete m.plannedIncome[LEGACY_B];
    }
    (people || []).forEach(function (p) {
      if (!m.plannedIncome[p.id] || typeof m.plannedIncome[p.id] !== "object") {
        m.plannedIncome[p.id] = emptyPlannedIncomeBlock();
      }
      PLANNED_INCOME_FIELDS.forEach(function (f) {
        if (!(f in m.plannedIncome[p.id])) m.plannedIncome[p.id][f] = null;
      });
    });
  }

  var BALANCE_WHEN_BEFORE = "before_salary";
  var BALANCE_WHEN_AFTER = "after_salary";
  var BALANCE_WHEN_DATED = "dated";

  /** Normalize balance timing mode (additive default: after_salary). */
  function normalizeBalanceWhen(w) {
    if (w === BALANCE_WHEN_BEFORE || w === BALANCE_WHEN_DATED) return w;
    return BALANCE_WHEN_AFTER;
  }

  /** YYYY-MM-DD or null. */
  function normalizeBalanceAsOf(v) {
    if (v == null || v === "") return null;
    var s = String(v).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    return s;
  }

  function emptyBalance() {
    return {
      bruk: null,
      spare: null,
      when: BALANCE_WHEN_AFTER,
      asOf: null,
      suggested: false,
      suggestedAfterPlans: false
    };
  }

  function ensureBalancesShape(m, people) {
    if (!m.balances || typeof m.balances !== "object") m.balances = {};
    (people || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!m.balances[p.id] || typeof m.balances[p.id] !== "object") {
        m.balances[p.id] = emptyBalance();
      } else {
        if (!("bruk" in m.balances[p.id])) m.balances[p.id].bruk = null;
        if (!("spare" in m.balances[p.id])) m.balances[p.id].spare = null;
        m.balances[p.id].when = normalizeBalanceWhen(m.balances[p.id].when);
        m.balances[p.id].asOf = normalizeBalanceAsOf(m.balances[p.id].asOf);
        if (m.balances[p.id].suggested) m.balances[p.id].suggested = true;
        else m.balances[p.id].suggested = false;
        if (m.balances[p.id].suggestedAfterPlans) {
          m.balances[p.id].suggestedAfterPlans = true;
        } else {
          m.balances[p.id].suggestedAfterPlans = false;
        }
      }
    });
  }

  function monthHasBalances(m) {
    if (!m || !m.balances || typeof m.balances !== "object") return false;
    var keys = Object.keys(m.balances);
    for (var i = 0; i < keys.length; i++) {
      var b = m.balances[keys[i]];
      if (!b) continue;
      if (
        (b.bruk != null && b.bruk !== "") ||
        (b.spare != null && b.spare !== "")
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Intentionally a no-op: point-in-time «På konto nå» must never auto-follow
   * into a new month. Budgets / planned income still carry via copyExpectedFrom.
   * Kept exported for API stability / callers.
   */
  function copyBalancesFrom(sourceMonth, targetMonth, people) {
    return targetMonth;
  }

  function balanceFieldEqual(a, b) {
    if (a == null || a === "" || b == null || b === "") return false;
    var na = Number(a);
    var nb = Number(b);
    if (!Number.isFinite(na) || !Number.isFinite(nb)) return false;
    return na === nb;
  }

  /**
   * Soft cleanup of accidental carry-forward: months that got bruk/spare copied
   * from the previous month without an explicit confirm (no balancesUpdatedAt).
   * Never touches months that have balancesUpdatedAt.
   * Returns number of person-fields cleared.
   */
  function clearAccidentalBalanceCarry(months) {
    if (!months || typeof months !== "object") return 0;
    var keys = Object.keys(months).filter(function (k) {
      return /^\d{4}-\d{2}$/.test(k);
    }).sort();
    var cleared = 0;
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var m = months[key];
      if (!m || !m.balances || typeof m.balances !== "object") continue;
      if (m.balancesUpdatedAt) continue;
      var prevKey = shiftMonthKey(key, -1);
      var prev = prevKey && months[prevKey];
      if (!prev || !prev.balances || typeof prev.balances !== "object") continue;
      Object.keys(m.balances).forEach(function (pid) {
        var cur = m.balances[pid];
        var pbal = prev.balances[pid];
        if (!cur || typeof cur !== "object" || !pbal) return;
        // Keep suggested / virtual carry pot seeds; not accidental raw copies
        if (cur.suggested || cur.suggestedAfterPlans || cur.fromCarryPot || m.balancesSuggested || m.carryPot) return;
        if (balanceFieldEqual(cur.bruk, pbal.bruk)) {
          cur.bruk = null;
          cleared++;
        }
        if (balanceFieldEqual(cur.spare, pbal.spare)) {
          cur.spare = null;
          cleared++;
        }
      });
    }
    return cleared;
  }


  /** True if any person balance is a suggested (unconfirmed) seed. */
  function monthHasSuggestedBalances(m) {
    if (!m || !m.balances || typeof m.balances !== "object") return false;
    if (m.balancesSuggested) return true;
    var keys = Object.keys(m.balances);
    for (var i = 0; i < keys.length; i++) {
      var b = m.balances[keys[i]];
      if (b && (b.suggested || b.suggestedAfterPlans)) return true;
    }
    return false;
  }

  /** True if saldo was plan-seeded (suggested or suggestedAfterPlans) for bake-in. */
  function monthHasPlanSeededBalances(m) {
    return monthHasSuggestedBalances(m);
  }

  /**
   * True when current bruk already embeds open same-month plannedSpends —
   * flagged seed, or live data matching seed after partial migrate (no flags).
   * prev must be confirmed (balancesUpdatedAt). Household totals compared.
   */
  function brukReflectsSameMonthPlans(m, prev, monthKey, plannedSpends, people) {
    if (monthHasPlanSeededBalances(m)) return true;
    if (!m || !prev || !monthKey) return false;
    if (!prev.balancesUpdatedAt) return false;
    var openSame = plannedSpendsForMonth(plannedSpends || [], monthKey).filter(
      function (p) {
        return p && !p.done && p.amount > 0;
      }
    );
    if (!openSame.length) return false;
    ensureBalancesShape(m, people);
    ensureBalancesShape(prev, people);
    var active = activePeople(people);
    var currentTotal = 0;
    var suggestedTotal = 0;
    var anyCurrent = false;
    var anyPrev = false;
    var i;
    for (i = 0; i < active.length; i++) {
      var p = active[i];
      var cur = parseBalanceAmount((m.balances[p.id] || {}).bruk);
      var prevBruk = parseBalanceAmount((prev.balances[p.id] || {}).bruk);
      if (cur != null) {
        currentTotal += cur;
        anyCurrent = true;
      }
      if (prevBruk != null) {
        anyPrev = true;
        var deduct = openPlannedSpendDeductionForPerson(
          plannedSpends || [],
          monthKey,
          p.id,
          people
        );
        var sug = computeSuggestedBrukFromPrev(prevBruk, deduct);
        if (sug != null) suggestedTotal += sug;
      }
    }
    if (!anyCurrent || !anyPrev) return false;
    // Within 1 kr of seed, or stronger: bruk already ≤ seed (plans baked in)
    if (Math.abs(currentTotal - suggestedTotal) <= 1) return true;
    if (currentTotal <= suggestedTotal + 1) return true;
    return false;
  }

  /**
   * Persist: if bruk matches seed without flags, mark same-month plans reflected.
   * Returns true if any plans were marked.
   */
  function healBrukReflectedSameMonthPlans(months, key, people, plannedSpends) {
    if (!months || !key) return false;
    var m = months[key];
    if (!m) return false;
    if (monthHasPlanSeededBalances(m)) return false;
    var prevKey = findNearestPreviousWithConfirmedBalances(months, key);
    var prev = prevKey && months[prevKey];
    if (!brukReflectsSameMonthPlans(m, prev, key, plannedSpends || [], people)) {
      return false;
    }
    return markPlannedSpendsReflectedInBalance(plannedSpends || [], key) > 0;
  }

  /**
   * Open plannedSpends with monthKey === target attributed to one person:
   * own amount full; felles split equally across active people.
   * opts.skipReflected: ignore items already reflectedInBalance (carry-end).
   */
  function openPlannedSpendDeductionForPerson(plannedSpends, monthKey, personId, people, opts) {
    var mk = String(monthKey || "");
    if (!mk || !personId) return 0;
    opts = opts || {};
    var active = activePeople(people);
    var n = Math.max(1, active.length);
    var sum = 0;
    plannedSpendsForMonth(plannedSpends, mk).forEach(function (item) {
      if (!item || item.done || !(item.amount > 0)) return;
      if (opts.skipReflected && item.reflectedInBalance) return;
      if (item.owner === personId) sum += Number(item.amount) || 0;
      else if (item.owner === "felles") sum += (Number(item.amount) || 0) / n;
    });
    return sum;
  }

  /**
   * Sum open planned deductions for monthKeys after fromExclusive through
   * toInclusive (inclusive). Used when jumping e.g. Sep→Nov so Oct bil
   * is subtracted once even if Oct was never seeded.
   */
  function openPlannedSpendDeductionForPersonRange(
    plannedSpends,
    fromExclusiveKey,
    toInclusiveKey,
    personId,
    people,
    opts
  ) {
    var from = String(fromExclusiveKey || "");
    var to = String(toInclusiveKey || "");
    if (!from || !to || !personId) return 0;
    if (to <= from) return 0;
    var sum = 0;
    var mk = shiftMonthKey(from, 1);
    var guard = 0;
    while (mk && mk <= to && guard < 48) {
      sum += openPlannedSpendDeductionForPerson(
        plannedSpends,
        mk,
        personId,
        people,
        opts
      );
      mk = shiftMonthKey(mk, 1);
      guard++;
    }
    return sum;
  }

  /**
   * prev confirmed bruk − open same-month planned (person share).
   * Does not invent salary. Returns null if prevBruk missing.
   */
  function computeSuggestedBrukFromPrev(prevBruk, plannedDeduction) {
    if (prevBruk == null || prevBruk === "") return null;
    var b = Number(prevBruk);
    if (!Number.isFinite(b)) return null;
    var d =
      plannedDeduction == null || plannedDeduction === ""
        ? 0
        : Number(plannedDeduction);
    if (!Number.isFinite(d)) d = 0;
    return b - d;
  }

  /**
   * Seed suggested starting bruk for a new month that has no confirmed saldo.
   * Formula: nearest prev with carry source (bank or virtual pot):
   *   suggestedBruk = prevEndBruk − openPlannedSpends(after prev … through newMonth)
   * Jumping Sep→Nov subtracts Oct bil once even if Oct was never opened.
   * Runs even when open planned = 0 (rolling carry of leftover / deficit).
   * Marks suggested:true + when=after_salary. Does not write balancesUpdatedAt
   * (user must Bekreft). Never re-seeds over confirmed or existing non-suggested bruk.
   */

  /**
   * Virtual carry pot: tracks leftover trygg across months without requiring
   * På konto confirm. På konto is a correction tool that resets the pot.
   *
   * Without bank confirm (virtual roll):
   *   end = startSuggestedBruk − variable_logged − same-month_planned(if not reflected)
   *        + logged_income (only if any)
   * Do NOT add full planned lønn/ekstra — that invents huge growth without bank.
   *
   * Confirmed bank (balancesUpdatedAt) is truth → ending pot = bruk (no invent).
   */

  function monthHasCarrySource(m) {
    if (!m) return false;
    if (m.balancesUpdatedAt && monthHasBalances(m)) return true;
    if (monthHasSuggestedBalances(m)) return true;
    if (m.carryPot && typeof m.carryPot === "object") {
      var keys = Object.keys(m.carryPot);
      for (var i = 0; i < keys.length; i++) {
        var v = Number(m.carryPot[keys[i]]);
        if (Number.isFinite(v)) return true;
      }
    }
    return false;
  }

  /** Nearest earlier month with confirmed bank OR virtual/suggested carry pot. */
  function findNearestPreviousWithCarrySource(months, monthKey, maxLookback) {
    var look = maxLookback == null ? 36 : maxLookback;
    var key = monthKey;
    for (var i = 0; i < look; i++) {
      key = shiftMonthKey(key, -1);
      if (!key) return null;
      var m = months && months[key];
      if (m && monthHasCarrySource(m)) return key;
    }
    return null;
  }

  /**
   * Ending carry pot for one person after a month's envelope effects.
   * opts: { categories, monthIndex, plannedSpends, monthKey }
   */
  function computeCarryEndBrukForPerson(m, personId, people, opts) {
    opts = opts || {};
    if (!m || !personId) return null;
    ensureBalancesShape(m, people);
    var bal = (m.balances && m.balances[personId]) || {};
    var start = parseBalanceAmount(bal.bruk);
    if (start == null && m.carryPot && m.carryPot[personId] != null) {
      var cp = Number(m.carryPot[personId]);
      if (Number.isFinite(cp)) start = cp;
    }
    if (start == null) return null;

    // Confirmed bank snapshot is truth — do not invent post-confirm cashflow
    if (m.balancesUpdatedAt) return start;

    var categories = opts.categories || [];
    var parts = personCashflowParts(m, personId, people, categories, {});
    var loggedInn = (parts.lønn || 0) + (parts.ekstra || 0);
    var loggedSparing = parts.sparing || 0;
    var variableSpending = parts.utgifter || 0; // logged expenses (var + any logged fast)

    // Same-month planned once if not already in start (seeded/reflected)
    var plannedDeduct = 0;
    if (opts.monthKey) {
      plannedDeduct = openPlannedSpendDeductionForPerson(
        opts.plannedSpends || [],
        opts.monthKey,
        personId,
        people,
        { skipReflected: true }
      );
      // Seed already baked plans into start → do not subtract again
      if (
        bal.suggestedAfterPlans ||
        bal.suggested ||
        m.balancesSuggested ||
        monthHasPlanSeededBalances(m)
      ) {
        plannedDeduct = 0;
      }
    }

    // Virtual roll: leftover trygg — no automatic planInn / Fast auto stacking
    // end = start − variable − (same-month planned if needed) + logged income only
    var end = start - variableSpending - plannedDeduct;
    if (loggedInn > 0) end += loggedInn;
    if (loggedSparing > 0) end -= loggedSparing;
    return end;
  }

  /** Household / per-person ending pots for a month (additive carryPot field). */
  function computeMonthCarryPot(m, people, opts) {
    opts = opts || {};
    var active = activePeople(people);
    var out = {};
    var any = false;
    active.forEach(function (p) {
      var end = computeCarryEndBrukForPerson(m, p.id, people, opts);
      if (end == null) return;
      out[p.id] = Math.round(end * 100) / 100;
      any = true;
    });
    return any ? out : null;
  }

  /**
   * Persist ending carryPot on month (additive). Safe to call often.
   */
  function refreshMonthCarryPot(months, key, people, opts) {
    if (!months || !key || !months[key]) return null;
    var pot = computeMonthCarryPot(months[key], people, opts);
    if (pot) {
      months[key].carryPot = pot;
      months[key].carryPotSource = months[key].balancesUpdatedAt
        ? "bank"
        : "virtual";
    }
    return pot;
  }

  /**
   * Rolling suggested bruk for one person: pot = confirmed/prev + Σ(lønn − Fast − var − planlagt).
   * Prefer nearest confirmed På konto as anchor (never freeze at bank−bil only).
   * Returns { amount, anchorKey, startPot } or null.
   */
  function computeRollingSuggestedForPerson(
    months,
    key,
    personId,
    people,
    categories,
    plannedSpends
  ) {
    if (!months || !key || !personId) return null;
    var cats = categories || [];
    var planned = plannedSpends || [];
    // If the immediately previous month is a suggested/virtual month WITH logged
    // activity, chain from its carry-end (so overspend lowers next pot). Otherwise
    // re-anchor at nearest confirmed På konto and follow-budget roll (fixes 71k freeze).
    var prevImmediate = shiftMonthKey(key, -1);
    var prevM = prevImmediate && months[prevImmediate];
    var prevHasLogs =
      prevM &&
      ((Array.isArray(prevM.expenses) && prevM.expenses.length > 0) ||
        (Array.isArray(prevM.incomes) && prevM.incomes.length > 0) ||
        (Array.isArray(prevM.savings) && prevM.savings.length > 0));
    var anchorKey = null;
    var startPot = null;
    if (
      prevM &&
      !prevM.balancesUpdatedAt &&
      monthHasSuggestedBalances(prevM) &&
      prevHasLogs
    ) {
      ensureBalancesShape(prevM, people);
      refreshMonthCarryPot(months, prevImmediate, people, {
        categories: cats,
        monthIndex: monthIndexFromKey(prevImmediate),
        monthKey: prevImmediate,
        plannedSpends: planned
      });
      if (
        prevM.carryPot &&
        prevM.carryPot[personId] != null &&
        Number.isFinite(Number(prevM.carryPot[personId]))
      ) {
        startPot = Number(prevM.carryPot[personId]);
      } else {
        startPot = computeCarryEndBrukForPerson(prevM, personId, people, {
          categories: cats,
          monthIndex: monthIndexFromKey(prevImmediate),
          monthKey: prevImmediate,
          plannedSpends: planned
        });
      }
      anchorKey = prevImmediate;
      if (startPot != null && Number.isFinite(startPot)) {
        // One month of follow-budget from that carry-end into `key`
        var proj1 = projectPotFollowBudget({
          months: months,
          fromKey: anchorKey,
          people: people,
          categories: cats,
          plannedSpends: planned,
          startPot: startPot,
          horizon: 1,
          personId: personId
        });
        var pot1 = proj1 && proj1.potByKey ? proj1.potByKey[key] : null;
        if (Number.isFinite(pot1)) {
          return {
            amount: Math.round(pot1 * 100) / 100,
            anchorKey: anchorKey,
            startPot: startPot
          };
        }
      }
    }
    anchorKey = findNearestPreviousWithConfirmedBalances(months, key);
    startPot = null;
    if (anchorKey && months[anchorKey]) {
      ensureBalancesShape(months[anchorKey], people);
      startPot = parseBalanceAmount(
        (months[anchorKey].balances[personId] || {}).bruk
      );
    }
    if (startPot == null) {
      // No confirmed bank — fall back to nearest carry/suggested source
      anchorKey = findNearestPreviousWithCarrySource(months, key);
      if (!anchorKey || !months[anchorKey]) return null;
      var prev = months[anchorKey];
      ensureBalancesShape(prev, people);
      if (prev.balancesUpdatedAt) {
        startPot = parseBalanceAmount((prev.balances[personId] || {}).bruk);
      } else if (
        prev.carryPot &&
        prev.carryPot[personId] != null &&
        Number.isFinite(Number(prev.carryPot[personId]))
      ) {
        startPot = Number(prev.carryPot[personId]);
      } else {
        startPot = parseBalanceAmount((prev.balances[personId] || {}).bruk);
      }
    }
    if (startPot == null || !Number.isFinite(startPot)) return null;
    var dist = monthsBetweenKeys(anchorKey, key);
    if (dist == null || dist <= 0) return null;
    // Do NOT call ensureMonthExpected here (it seeds → recurse). projectPotFollowBudget
    // reuses last known expected budgets virtually for missing months.
    var proj = projectPotFollowBudget({
      months: months,
      fromKey: anchorKey,
      people: people,
      categories: cats,
      plannedSpends: planned,
      startPot: startPot,
      horizon: dist,
      personId: personId
    });
    if (!proj || !proj.potByKey) return null;
    var pot = proj.potByKey[key];
    if (!Number.isFinite(pot)) return null;
    return {
      amount: Math.round(pot * 100) / 100,
      anchorKey: anchorKey,
      startPot: startPot
    };
  }

  /**
   * Seed suggested starting bruk for a new month that has no confirmed saldo.
   * Formula (Mathias-regelen): nearest confirmed På konto, then
   *   pot += planInn − Fast − variabelt − planlagte utlegg
   * each month through the viewed month. Never freeze at bank−bil (~71223).
   * Marks suggested:true. Does not write balancesUpdatedAt (På konto is correction).
   * Refreshes stale suggested seeds on revisit so localStorage 71223 heals.
   */
  function ensureSuggestedBalances(months, key, people, plannedSpends, maybeOpts) {
    // Compat: 4th arg may be opts { plannedSpends, categories }
    var categoriesOpt = [];
    if (plannedSpends && !Array.isArray(plannedSpends) && typeof plannedSpends === "object") {
      categoriesOpt = plannedSpends.categories || [];
      plannedSpends = plannedSpends.plannedSpends || [];
    }
    if (maybeOpts && typeof maybeOpts === "object") {
      if (Array.isArray(maybeOpts.categories)) categoriesOpt = maybeOpts.categories;
      if (Array.isArray(maybeOpts.plannedSpends) && (!plannedSpends || !plannedSpends.length)) {
        plannedSpends = maybeOpts.plannedSpends;
      }
    }
    plannedSpends = Array.isArray(plannedSpends) ? plannedSpends : [];
    if (!months || !key) return { seeded: false, reason: "no-month" };
    if (!months[key]) {
      months[key] = {
        balances: {},
        budgets: {},
        budgetLines: {},
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: [] // always a fresh array — never share refs across months
      };
    }
    var m = months[key];
    if (m.balancesUpdatedAt) {
      // Confirmed but flags/reflected may be missing after partial migrate
      if (healBrukReflectedSameMonthPlans(months, key, people, plannedSpends)) {
        return { seeded: false, reason: "healed-reflected" };
      }
      return { seeded: false, reason: "confirmed" };
    }
    ensureBalancesShape(m, people);
    var active = activePeople(people);
    var i;
    // User-typed draft (non-suggested, no confirm) — do not overwrite
    for (i = 0; i < active.length; i++) {
      var bal0 = m.balances[active[i].id];
      if (
        bal0 &&
        bal0.bruk != null &&
        bal0.bruk !== "" &&
        Number.isFinite(Number(bal0.bruk)) &&
        !bal0.suggested &&
        !m.balancesSuggested
      ) {
        // Legacy unflagged bank−bil freeze (~71223): still allow rolling heal
        var legacyFreeze = false;
        var prevConf = findNearestPreviousWithConfirmedBalances(months, key);
        if (prevConf && months[prevConf]) {
          var prevB = parseBalanceAmount(
            (months[prevConf].balances[active[i].id] || {}).bruk
          );
          var ded = openPlannedSpendDeductionForPersonRange(
            plannedSpends,
            prevConf,
            key,
            active[i].id,
            people
          );
          var legacy = computeSuggestedBrukFromPrev(prevB, ded);
          if (
            legacy != null &&
            Math.abs(Number(bal0.bruk) - legacy) < 0.02
          ) {
            legacyFreeze = true;
          }
        }
        if (!legacyFreeze) {
          return { seeded: false, reason: "has-bruk" };
        }
      }
    }

    var cats = categoriesOpt || [];
    var seededAny = false;
    var changed = false;
    var potMap = {};
    var anchorUsed = null;
    var hadSuggested = monthHasSuggestedBalances(m);
    active.forEach(function (p) {
      var rolled = computeRollingSuggestedForPerson(
        months,
        key,
        p.id,
        people,
        cats,
        plannedSpends
      );
      if (!rolled || rolled.amount == null) return;
      var suggestedAmt = rolled.amount;
      anchorUsed = rolled.anchorKey;
      if (!m.balances[p.id] || typeof m.balances[p.id] !== "object") {
        m.balances[p.id] = emptyBalance();
      }
      var prevAmt = parseBalanceAmount(m.balances[p.id].bruk);
      if (prevAmt == null || Math.abs(prevAmt - suggestedAmt) > 0.005) {
        changed = true;
      }
      m.balances[p.id].bruk = suggestedAmt;
      m.balances[p.id].spare = null;
      m.balances[p.id].when = BALANCE_WHEN_AFTER;
      m.balances[p.id].asOf = null;
      m.balances[p.id].suggested = true;
      m.balances[p.id].suggestedAfterPlans = true;
      m.balances[p.id].fromCarryPot = true;
      potMap[p.id] = suggestedAmt;
      seededAny = true;
    });
    if (seededAny) {
      m.balancesSuggested = true;
      m.carryPot = potMap;
      m.carryPotSource = "follow-budget";
      // Same-month planned already in rolling seed → mark reflected (no double-count)
      markPlannedSpendsReflectedInBalance(plannedSpends || [], key);
      return {
        seeded: changed || !hadSuggested,
        reason: changed ? "rolling-ok" : "rolling-unchanged",
        fromCarry: true,
        anchorKey: anchorUsed
      };
    }
    // No rolling anchor — still try reflected heal for partial migrate
    if (healBrukReflectedSameMonthPlans(months, key, people, plannedSpends)) {
      return { seeded: false, reason: "healed-reflected" };
    }
    return { seeded: false, reason: "no-prev-bruk" };
  }


  /**
   * Calc-time display bruk when month M has no persisted bruk/seed.
   * Same follow-budget formula as ensureSuggestedBalances (lønn − utgifter roll).
   * Does NOT mutate months — pure fallback so Trygg never shows 0/blank
   * just because localStorage/cloud seed persist failed.
   * Returns { byPerson, total, prevKey, fromFallback:true } or null.
   */
  function resolveDisplayBrukFallback(months, key, people, plannedSpends, categories) {
    if (!months || !key) return null;
    var m = months[key];
    if (!m) return null;
    // Confirmed or already-seeded → no calc-time invent
    if (m.balancesUpdatedAt) return null;
    if (monthHasSuggestedBalances(m)) return null;
    var active = activePeople(people);
    var i;
    for (i = 0; i < active.length; i++) {
      var bal0 = m.balances && m.balances[active[i].id];
      if (
        bal0 &&
        bal0.bruk != null &&
        bal0.bruk !== "" &&
        Number.isFinite(Number(bal0.bruk)) &&
        !bal0.suggested
      ) {
        return null; // real non-suggested bruk present
      }
    }
    var cats = categories || [];
    var byPerson = {};
    var total = 0;
    var any = false;
    var prevKey = null;
    active.forEach(function (p) {
      var rolled = computeRollingSuggestedForPerson(
        months,
        key,
        p.id,
        people,
        cats,
        plannedSpends || []
      );
      if (!rolled || rolled.amount == null) return;
      byPerson[p.id] = rolled.amount;
      total += rolled.amount;
      prevKey = rolled.anchorKey;
      any = true;
    });
    if (!any) return null;
    return {
      byPerson: byPerson,
      total: Math.round(total * 100) / 100,
      prevKey: prevKey,
      fromFallback: true
    };
  }

  /**
   * Variable (non-fast) planned budget total for a month.
   */
  function plannedVariableBudgetTotal(m, categories, monthIndex) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived) return;
      if (cat.type === "fast") return;
      sum += budgetFor(m, cat.id, monthIndex) || 0;
    });
    return sum;
  }

  /**
   * Fixed (fast) planned budget total for a month.
   */
  function plannedFixedBudgetTotal(m, categories, monthIndex) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived) return;
      if (cat.type !== "fast") return;
      sum += budgetFor(m, cat.id, monthIndex) || 0;
    });
    return sum;
  }

  /**
   * Planned income total (lønn+ekstra) for active people in a month.
   */
  function plannedIncomeTotal(m, people) {
    var active = activePeople(people);
    var sum = 0;
    active.forEach(function (p) {
      sum +=
        plannedIncomeFor(m, p.id, "lønn") +
        plannedIncomeFor(m, p.id, "ekstra");
    });
    return sum;
  }

  /**
   * Open plannedSpends total for a single monthKey (all owners, full amounts).
   */
  function openPlannedSpendTotalForMonth(plannedSpends, monthKey, opts) {
    opts = opts || {};
    var mk = String(monthKey || "");
    var sum = 0;
    (plannedSpends || []).forEach(function (p) {
      if (!p || p.done || !(p.amount > 0)) return;
      if (String(p.monthKey || "") !== mk) return;
      // Projection from raw pot must still count items marked reflectedInBalance
      // (seed bake-in); only skip when opts.skipReflected is explicitly true.
      if (opts.skipReflected && p.reflectedInBalance) return;
      sum += Number(p.amount) || 0;
    });
    return sum;
  }


  /**
   * Oversikt Trygg: when to replace seed/fallback with follow-budget projected pot.
   * Any empty future month (ahead > 0) without confirmed På konto — so sticky
   * suggested seeds (~71223) never win over rolling pot = prev + (lønn − utgifter).
   * Never overrides confirmed På konto or months with logged expenses.
   */
  function shouldUseProjectedPotForOversikt(opts) {
    opts = opts || {};
    var ahead = opts.ahead;
    var viewEmpty = !!opts.viewEmpty;
    var confirmed = !!opts.balancesUpdatedAt;
    return (
      viewEmpty &&
      !confirmed &&
      ahead != null &&
      ahead > 0
    );
  }

  /**
   * Project pot forward if user follows budget.
   * Formula (documented in UI):
   *   pot_{m+1} = pot_m + planInn − planUtFixed − planUtVariable − plannedSpendsThatMonth
   * Lønn minus planlagte utgifter (Fast + variabelt + planlagte utlegg) → neste Trygg.
   * startPot should be current effective bruk/pot (seed or bank), not Trygg-after-future-reserve.
   * Confirmed bank months on Oversikt keep bank-based Trygg (caller must not override
   * those with this projection — Fast already sits in the bank saldo).
   *
   * Scope (opts.personId):
   *   - person p1/p2: planInn = that person's plannedIncome only; planUtFixed/Variable =
   *     that person's budgets + felles %-share (same as personal Trygg); plannedSpends =
   *     openPlannedSpendDeductionForPerson (own full + felles equal split).
   *   - household / unset: full household totals (both incomes, all budgets).
   * Never mix household cashflow onto a personal pot.
   *
   * Missing future months reuse the last known expected budgets/income (virtual
   * carry — does not mutate months). Horizon up to 240 months (20 years).
   *
   * Returns {
   *   startPot, personId, months:[{monthKey, pot, planInn, planUtFixed, planUtVariable, plannedSpends, delta}],
   *   potAtHorizon, potByKey, byYear:[{year, monthKey, pot}],
   *   milestones:{m12,m60,m144}, formula
   * }.
   */
  function projectPotFollowBudget(opts) {
    opts = opts || {};
    var months = opts.months || {};
    var fromKey = opts.fromKey;
    var people = opts.people || [];
    var categories = opts.categories || [];
    var plannedSpends = opts.plannedSpends || [];
    var startPot = Number(opts.startPot);
    var personId = opts.personId || null;
    if (
      personId === "samlet" ||
      personId === "felles" ||
      personId === "household" ||
      !personId
    ) {
      personId = null;
    } else if (!personById(people, personId)) {
      personId = null;
    }
    var horizon =
      opts.horizon == null
        ? 12
        : Math.max(1, Math.min(240, Number(opts.horizon) || 12));
    if (!fromKey || !Number.isFinite(startPot)) {
      return {
        startPot: startPot,
        personId: personId,
        months: [],
        potAtHorizon: null,
        potByKey: {},
        byYear: [],
        milestones: {},
        formula:
          "pot = pot + planInn − planUtFixed − planUtVariable − planlagteUtlegg"
      };
    }
    ensureCategorySplits(categories, people);
    var pot = startPot;
    var rows = [];
    var potByKey = {};
    var key = fromKey;
    // Template for months without expected: prefer fromKey, else nearest prev.
    var template = null;
    if (months[fromKey] && monthHasExpected(months[fromKey])) {
      template = months[fromKey];
    } else {
      var prevExp = findNearestPreviousWithExpected(months, fromKey, 60);
      if (prevExp && months[prevExp]) template = months[prevExp];
    }
    for (var i = 0; i < horizon; i++) {
      key = shiftMonthKey(key, 1);
      if (!key) break;
      var m = months[key];
      var miEarly = monthIndexFromKey(key);
      if (m && monthHasExpected(m)) {
        // Heal incomplete carry (missing Sep plan cats) from prior template
        // before adopting — else a thin Dec poisons 10y Fremover.
        if (template) {
          var wasStaleProj = isStaleIncompleteExpected(m, template);
          fillMissingExpectedFrom(template, m, people, miEarly);
          if (wasStaleProj) realignPlannedIncomeFrom(template, m, people);
        }
        template = m;
      } else if (template) {
        // Virtual month: reuse expected budgets/income by VALUE, never share expenses array
        m = {
          balances: {},
          budgets: template.budgets || {},
          budgetLines: template.budgetLines || {},
          plannedIncome: template.plannedIncome || {},
          incomes: [],
          savings: [],
          expenses: []
        };
      } else if (!m) {
        m = {
          balances: {},
          budgets: {},
          budgetLines: {},
          plannedIncome: {},
          incomes: [],
          savings: [],
          expenses: []
        };
      }
      var mi = monthIndexFromKey(key);
      var planInn;
      var planUtFixed;
      var planUtVar;
      var planned;
      if (personId) {
        planInn = plannedIncomeForPerson(m, personId);
        planUtFixed = plannedFixedBudgetForPerson(
          m,
          personId,
          categories,
          people,
          mi
        );
        planUtVar = plannedVariableBudgetForPerson(
          m,
          personId,
          categories,
          people,
          mi
        );
        planned = openPlannedSpendDeductionForPerson(
          plannedSpends,
          key,
          personId,
          people
        );
      } else {
        planInn = plannedIncomeTotal(m, people);
        planUtFixed = plannedFixedBudgetTotal(m, categories, mi);
        planUtVar = plannedVariableBudgetTotal(m, categories, mi);
        planned = openPlannedSpendTotalForMonth(plannedSpends, key);
      }
      pot = pot + planInn - planUtFixed - planUtVar - planned;
      pot = Math.round(pot * 100) / 100;
      var delta = planInn - planUtFixed - planUtVar - planned;
      delta = Math.round(delta * 100) / 100;
      rows.push({
        monthKey: key,
        pot: pot,
        delta: delta,
        planInn: planInn,
        planUtFixed: planUtFixed,
        planUtVariable: planUtVar,
        plannedSpends: planned
      });
      potByKey[key] = pot;
    }
    // Year-end snapshots (December of each calendar year touched)
    var byYear = [];
    var seenYear = {};
    rows.forEach(function (row) {
      var y = String(row.monthKey || "").slice(0, 4);
      var mo = String(row.monthKey || "").slice(5, 7);
      if (!y || mo !== "12") return;
      if (seenYear[y]) return;
      seenYear[y] = true;
      byYear.push({ year: parseInt(y, 10), monthKey: row.monthKey, pot: row.pot });
    });
    // Also anniversary milestones at +12/+60/+144 months when present
    function atOffset(n) {
      return rows.length >= n ? rows[n - 1] : null;
    }
    var m12 = atOffset(12);
    var m60 = atOffset(60);
    var m144 = atOffset(144);
    return {
      startPot: startPot,
      personId: personId,
      months: rows,
      potAtHorizon: rows.length ? rows[rows.length - 1].pot : startPot,
      potByKey: potByKey,
      byYear: byYear,
      milestones: {
        m12: m12,
        m60: m60,
        m144: m144
      },
      formula:
        "pot = pot + planInn − planUtFixed − planUtVariable − planlagteUtlegg"
    };
  }

  /** Clear suggested flags after user confirms/edits saldo.
   * Returns true if that person (or month) had a plan-seeded balance — caller
   * should mark same-month plannedSpends reflectedInBalance so Trygg does not
   * reserve them again after Bekreft.
   */
  function clearSuggestedBalanceFlag(m, personId) {
    if (!m || !m.balances) return false;
    var wasSeeded = false;
    if (personId && m.balances[personId]) {
      var bal = m.balances[personId];
      if (bal.suggested || bal.suggestedAfterPlans || m.balancesSuggested) {
        wasSeeded = true;
      }
      bal.suggested = false;
      bal.suggestedAfterPlans = false;
    }
    var any = false;
    Object.keys(m.balances).forEach(function (pid) {
      if (
        m.balances[pid] &&
        (m.balances[pid].suggested || m.balances[pid].suggestedAfterPlans)
      ) {
        any = true;
      }
    });
    if (!any) {
      delete m.balancesSuggested;
    }
    return wasSeeded;
  }

  /**
   * Mark open plannedSpends for monthKey as already reflected in På konto nå
   * (seeded/confirmed). They must not enter futureReserve again.
   */
  function markPlannedSpendsReflectedInBalance(plannedSpends, monthKey) {
    var mk = String(monthKey || "");
    if (!mk || !Array.isArray(plannedSpends)) return 0;
    var n = 0;
    plannedSpends.forEach(function (p) {
      if (!p || p.done || !(p.amount > 0)) return;
      if (String(p.monthKey || "") !== mk) return;
      if (p.reflectedInBalance) return;
      p.reflectedInBalance = true;
      n++;
    });
    return n;
  }

  function findNearestPreviousWithBalances(months, monthKey, maxLookback) {
    var look = maxLookback == null ? 36 : maxLookback;
    var key = monthKey;
    for (var i = 0; i < look; i++) {
      key = shiftMonthKey(key, -1);
      if (!key) return null;
      var m = months && months[key];
      if (m && monthHasBalances(m)) return key;
    }
    return null;
  }

  /** Nearest earlier month with user-confirmed På konto (balancesUpdatedAt). */
  function findNearestPreviousWithConfirmedBalances(months, monthKey, maxLookback) {
    var look = maxLookback == null ? 36 : maxLookback;
    var key = monthKey;
    for (var i = 0; i < look; i++) {
      key = shiftMonthKey(key, -1);
      if (!key) return null;
      var m = months && months[key];
      if (m && m.balancesUpdatedAt && monthHasBalances(m)) return key;
    }
    return null;
  }

  function ensureMonthShape(m, people) {
    if (!m.budgets || typeof m.budgets !== "object") m.budgets = {};
    if (!m.budgetLines || typeof m.budgetLines !== "object") m.budgetLines = {};
    if (!Array.isArray(m.incomes)) m.incomes = [];
    if (!Array.isArray(m.savings)) m.savings = [];
    if (!Array.isArray(m.expenses)) m.expenses = [];
    ensurePlannedIncomeShape(m, people);
    ensureBalancesShape(m, people);
  }

  function migrateState(parsed) {
    var now = new Date();
    var basePeople = defaultPeople();
    if (!parsed || typeof parsed !== "object") {
      return {
        version: 2,
        people: basePeople,
        view: { year: now.getFullYear(), month: now.getMonth() },
        categories: [],
        months: {},
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
        },
        savingsGoals: [],
        archives: [],
        plannedSpends: []
      };
    }

    var people;
    if (Array.isArray(parsed.people) && parsed.people.length) {
      people = parsed.people.map(function (p, i) {
        return {
          id: p.id || ("p" + (i + 1)),
          name: (p.name && String(p.name).trim()) || ("Person " + (i + 1)),
          archived: !!p.archived
        };
      });
    } else {
      var na =
        (parsed.names && parsed.names.a) ||
        (parsed.names && parsed.names[LEGACY_A]) ||
        "Mathias";
      var nb =
        (parsed.names && parsed.names.b) ||
        (parsed.names && parsed.names[LEGACY_B]) ||
        "Andrea";
      people = [
        { id: ID_A, name: String(na), archived: false },
        { id: ID_B, name: String(nb), archived: false }
      ];
    }

    var cats = Array.isArray(parsed.categories)
      ? parsed.categories.map(function (c) {
          var owner = mapLegacyOwner(c.owner);
          if (owner !== "felles" && !personById(people, owner)) {
            owner = "felles";
          }
          var migrated = {
            id: c.id || uid(),
            name: c.name || "Kategori",
            type: c.type === "fast" ? "fast" : "variabel",
            owner: owner === "felles" ? "felles" : owner,
            autoFill: c.autoFill != null ? !!c.autoFill : c.type === "fast",
            // autoSpend: Fast counts as spent by default; false = «Ikke auto-tell denne»
            autoSpend: c.autoSpend != null ? !!c.autoSpend : undefined,
            archived: !!c.archived,
            order: c.order != null && isFinite(Number(c.order)) ? Number(c.order) : undefined
          };
          var sp = cloneSplit(c.split);
          if (sp) migrated.split = sp;
          return migrated;
        })
      : [];

    var months = {};
    var migratedFromSaldo = false;
    var rawMonths =
      parsed.months && typeof parsed.months === "object" ? parsed.months : {};
    Object.keys(rawMonths).forEach(function (key) {
      var src = rawMonths[key] || {};
      var m = {
        balances: {},
        budgets:
          src.budgets && typeof src.budgets === "object"
            ? Object.assign({}, src.budgets)
            : {},
        budgetLines: cloneBudgetLinesTree(src.budgetLines),
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: []
      };

      // Per-person balances; migrate legacy family saldoBefore → first person bruk
      if (src.balances && typeof src.balances === "object") {
        Object.keys(src.balances).forEach(function (pid) {
          var nb = mapLegacyOwner(pid);
          var b = src.balances[pid] || {};
          m.balances[nb] = {
            bruk: b.bruk != null && b.bruk !== "" ? b.bruk : null,
            spare: b.spare != null && b.spare !== "" ? b.spare : null,
            when: normalizeBalanceWhen(b.when),
            asOf: normalizeBalanceAsOf(b.asOf)
          };
        });
      } else if (src.saldoBefore != null && src.saldoBefore !== "") {
        var firstId = (people[0] && people[0].id) || ID_A;
        people.forEach(function (p) {
          m.balances[p.id] = {
            bruk: p.id === firstId ? Number(src.saldoBefore) : 0,
            spare: null,
            when: BALANCE_WHEN_AFTER,
            asOf: null
          };
        });
        migratedFromSaldo = true;
      }

      var pi = src.plannedIncome || {};
      // Copy after legacy remap
      Object.keys(pi).forEach(function (k) {
        var nk = mapLegacyOwner(k);
        m.plannedIncome[nk] = {
          lønn:
            pi[k] && pi[k].lønn != null ? pi[k].lønn : null,
          ekstra:
            pi[k] && pi[k].ekstra != null ? pi[k].ekstra : null,
          sparing:
            pi[k] && pi[k].sparing != null ? pi[k].sparing : null
        };
      });

      (src.incomes || []).forEach(function (i) {
        m.incomes.push({
          id: i.id || uid(),
          person: mapLegacyOwner(i.person),
          type: i.type === "ekstra" ? "ekstra" : "lønn",
          amount: i.amount,
          note: i.note || "",
          date: i.date || ""
        });
      });
      (src.savings || []).forEach(function (s) {
        m.savings.push({
          id: s.id || uid(),
          person: mapLegacyOwner(s.person),
          amount: s.amount,
          note: s.note || "",
          date: s.date || "",
          goalId: s.goalId ? String(s.goalId) : null
        });
      });
      (src.expenses || []).forEach(function (e) {
        m.expenses.push({
          id: e.id || uid(),
          owner: mapLegacyOwner(e.owner || "felles"),
          categoryId: e.categoryId || null,
          category: e.category || "",
          amount: e.amount,
          note: e.note || "",
          date: e.date || ""
        });
      });

      ensureMonthShape(m, people);
      if (src.balancesUpdatedAt) {
        m.balancesUpdatedAt = src.balancesUpdatedAt;
      }
      months[key] = m;
    });

    ensureCategorySplits(cats, people);

    // Soft-clean accidental balance carries (no balancesUpdatedAt + identical to prev).
    clearAccidentalBalanceCarry(months);

    // Additive heal: future months missing newer Sep plan cats (Div/Helse/Bil)
    // or stale plannedIncome pick up from nearest previous expected. No expenses copied.
    healAllMonthsExpected(months, people, {});

    // One-shot baseline refresh: overwrite forward months from template key
    // (e.g. after raising Sep Mat 2500→4000 so Oct+ become 4000 too).
    var rebaseFrom =
      parsed.settings && parsed.settings.rebasePlanFromKey
        ? String(parsed.settings.rebasePlanFromKey)
        : "";
    if (rebaseFrom && months[rebaseFrom]) {
      rebaseForwardMonthsFrom(months, rebaseFrom, people, {
        seedEmpty: true
      });
    }

    return {
      version: 2,
      people: people,
      view: {
        year: (parsed.view && parsed.view.year) || now.getFullYear(),
        month:
          typeof (parsed.view && parsed.view.month) === "number"
            ? parsed.view.month
            : now.getMonth()
      },
      categories: cats,
      months: months,
      settings: {
        sort: (parsed.settings && parsed.settings.sort) || "over",
        chartMode: (parsed.settings && parsed.settings.chartMode) || "actual",
        reminderDismissedDate:
          (parsed.settings && parsed.settings.reminderDismissedDate) || null,
        innUtView:
          (parsed.settings && parsed.settings.innUtView) || "samlet",
        copyExpectedToNewMonths:
          parsed.settings && parsed.settings.copyExpectedToNewMonths === false
            ? false
            : true,
        mainTab:
          (parsed.settings && parsed.settings.mainTab) || "oversikt",
        useSaldoInSafeToSpend:
          parsed.settings && parsed.settings.useSaldoInSafeToSpend === false
            ? false
            : true,
        spendBuffer: (function () {
          var b = parsed.settings && parsed.settings.spendBuffer;
          if (b == null || b === "") return 0;
          var n = Number(b);
          return Number.isFinite(n) && n >= 0 ? n : 0;
        })(),
        sparingView:
          (parsed.settings && parsed.settings.sparingView) || "samlet",
        pendingBalancesMigrationToast:
          migratedFromSaldo ||
          !!(
            parsed.settings && parsed.settings.pendingBalancesMigrationToast
          )
      },
      savingsGoals: normalizeSavingsGoals(parsed.savingsGoals, people),
      archives: normalizeArchives(parsed.archives),
      plannedSpends: normalizePlannedSpends(parsed.plannedSpends, people)
    };
  }

  function plannedIncomeFor(m, personId, type) {
    var block = m.plannedIncome && m.plannedIncome[personId];
    var v = block && block[type];
    return v == null || v === "" ? 0 : Number(v) || 0;
  }

  /** Standing planned monthly saving (Plan → Sparing). Not income. */
  function plannedSparingFor(m, personId) {
    return plannedIncomeFor(m, personId, "sparing");
  }

  function plannedSparingTotal(m, people) {
    var sum = 0;
    activePeople(people).forEach(function (p) {
      sum += plannedSparingFor(m, p.id);
    });
    return sum;
  }

  /**
   * Budgets are per owner: budgets[catId] = { p1: n, p2: n, felles: n }
   * Legacy scalar budgets[catId] = n is treated as felles.
   */
  function isBudgetValueSet(v) {
    return v != null && v !== "";
  }

  function budgetEntryHasValue(entry) {
    if (!isBudgetValueSet(entry)) return false;
    if (typeof entry !== "object") return true;
    var keys = Object.keys(entry);
    for (var i = 0; i < keys.length; i++) {
      if (isBudgetValueSet(entry[keys[i]])) return true;
    }
    return false;
  }

  function cloneBudgetEntry(entry) {
    if (!isBudgetValueSet(entry)) return null;
    if (typeof entry !== "object") {
      var n = Number(entry);
      return { felles: Number.isNaN(n) ? null : n };
    }
    var out = {};
    Object.keys(entry).forEach(function (k) {
      if (isBudgetValueSet(entry[k])) out[k] = entry[k];
    });
    return Object.keys(out).length ? out : null;
  }

  function ensureBudgetObject(m, catId) {
    if (!m.budgets || typeof m.budgets !== "object") m.budgets = {};
    var cur = m.budgets[catId];
    if (cur == null || cur === "") {
      m.budgets[catId] = {};
      return m.budgets[catId];
    }
    if (typeof cur !== "object") {
      var n = Number(cur);
      m.budgets[catId] = {
        felles: Number.isNaN(n) ? null : n
      };
      return m.budgets[catId];
    }
    return cur;
  }

  function monthIndexFromKey(key) {
    if (!key || typeof key !== "string") return null;
    var parts = key.split("-");
    if (parts.length < 2) return null;
    var mo = Number(parts[1]);
    if (!Number.isFinite(mo) || mo < 1 || mo > 12) return null;
    return mo - 1;
  }

  function normalizeBudgetLine(line) {
    if (!line || typeof line !== "object") return null;
    var amt = line.amount;
    var n =
      amt == null || amt === ""
        ? 0
        : Number(amt);
    if (Number.isNaN(n)) n = 0;
    var interval = line.interval;
    if (interval !== "year" && interval !== "quarter" && interval !== "month") {
      interval = "month";
    }
    var mode = line.mode;
    if (mode !== "once" && mode !== "spread") {
      mode = "spread";
    }
    var month = line.month;
    if (month == null || month === "") {
      month = 0;
    } else {
      month = Number(month);
      if (!Number.isFinite(month)) month = 0;
      month = Math.max(0, Math.min(11, Math.floor(month)));
    }
    var out = {
      id: line.id || uid(),
      name: line.name != null ? String(line.name) : "",
      amount: n
    };
    // Additive: only persist non-default interval fields (legacy lines stay {id,name,amount})
    if (interval !== "month") {
      out.interval = interval;
      out.mode = mode;
      out.month = month;
    }
    return out;
  }

  /**
   * Monthly contribution of one underlinje for a viewed calendar month (0–11).
   * month = legacy full amount every month.
   * year + spread → amount/12; year + once → full amount only in line.month.
   * quarter + spread → amount/3; quarter + once → full amount in months with same quarter slot.
   */
  function lineMonthlyContribution(line, monthIndex) {
    if (!line) return 0;
    var amt = Number(line.amount) || 0;
    var interval = line.interval || "month";
    if (interval === "month") return amt;
    var mode = line.mode || "spread";
    var payMonth = line.month;
    if (payMonth == null || payMonth === "") payMonth = 0;
    else {
      payMonth = Number(payMonth);
      if (!Number.isFinite(payMonth)) payMonth = 0;
      payMonth = Math.max(0, Math.min(11, Math.floor(payMonth)));
    }
    var mi = monthIndex;
    if (mi == null || mi === "") {
      // Without a viewed month: spread still smooths; once cannot land → 0
      if (mode === "once") return 0;
      return interval === "year" ? amt / 12 : amt / 3;
    }
    mi = Number(mi);
    if (!Number.isFinite(mi)) mi = 0;
    mi = Math.max(0, Math.min(11, Math.floor(mi)));
    if (interval === "year") {
      if (mode === "once") return mi === payMonth ? amt : 0;
      return amt / 12;
    }
    if (interval === "quarter") {
      if (mode === "once") return mi % 3 === payMonth % 3 ? amt : 0;
      return amt / 3;
    }
    return amt;
  }

  function cloneBudgetLinesTree(src) {
    if (!src || typeof src !== "object") return {};
    var out = {};
    Object.keys(src).forEach(function (catId) {
      var byOwner = src[catId];
      if (!byOwner || typeof byOwner !== "object") return;
      var owners = {};
      Object.keys(byOwner).forEach(function (ownerId) {
        var arr = byOwner[ownerId];
        if (!Array.isArray(arr) || !arr.length) return;
        var lines = arr
          .map(normalizeBudgetLine)
          .filter(Boolean);
        if (lines.length) owners[ownerId] = lines;
      });
      if (Object.keys(owners).length) out[catId] = owners;
    });
    return out;
  }

  function getBudgetLines(m, catId, ownerId) {
    var bl = m && m.budgetLines;
    if (!bl || typeof bl !== "object") return [];
    var byCat = bl[catId];
    if (!byCat || typeof byCat !== "object") return [];
    var arr = byCat[ownerId];
    if (!Array.isArray(arr)) return [];
    return arr.map(normalizeBudgetLine).filter(Boolean);
  }

  function hasBudgetLines(m, catId, ownerId) {
    return getBudgetLines(m, catId, ownerId).length > 0;
  }

  function sumBudgetLines(lines, monthIndex) {
    var sum = 0;
    (lines || []).forEach(function (l) {
      if (!l) return;
      sum += lineMonthlyContribution(l, monthIndex);
    });
    return sum;
  }

  /** Raw stored amounts (ignores interval) – for display of yearly/quarter prices. */
  function sumBudgetLinesRaw(lines) {
    var sum = 0;
    (lines || []).forEach(function (l) {
      if (!l) return;
      sum += Number(l.amount) || 0;
    });
    return sum;
  }

  /**
   * Replace underlinjer for cat+owner. Empty/null clears lines (budget number kept).
   * When lines exist, syncs budgets[catId][owner] = sum(lines).
   */
  function setBudgetLines(m, catId, ownerId, lines, monthIndex) {
    if (!m.budgetLines || typeof m.budgetLines !== "object") m.budgetLines = {};
    if (!m.budgetLines[catId] || typeof m.budgetLines[catId] !== "object") {
      m.budgetLines[catId] = {};
    }
    var normalized = (lines || []).map(normalizeBudgetLine).filter(Boolean);
    if (!normalized.length) {
      delete m.budgetLines[catId][ownerId];
      if (!Object.keys(m.budgetLines[catId]).length) {
        delete m.budgetLines[catId];
      }
      return;
    }
    m.budgetLines[catId][ownerId] = normalized;
    setBudgetForOwnerRaw(
      m,
      catId,
      ownerId,
      sumBudgetLines(normalized, monthIndex)
    );
  }

  function syncBudgetFromLines(m, catId, ownerId, monthIndex) {
    var lines = getBudgetLines(m, catId, ownerId);
    if (!lines.length) return;
    setBudgetForOwnerRaw(
      m,
      catId,
      ownerId,
      sumBudgetLines(lines, monthIndex)
    );
  }

  function copyBudgetLinesFrom(sourceMonth, targetMonth, monthIndex) {
    if (!sourceMonth || !targetMonth) return;
    var cloned = cloneBudgetLinesTree(sourceMonth.budgetLines);
    targetMonth.budgetLines = cloned;
    // Keep budgets in sync with lines where present (monthly contribution for target month)
    Object.keys(cloned).forEach(function (catId) {
      Object.keys(cloned[catId]).forEach(function (ownerId) {
        syncBudgetFromLines(targetMonth, catId, ownerId, monthIndex);
      });
    });
  }

  function budgetOwnersForCat(m, catId) {
    var owners = {};
    var entry = m && m.budgets && m.budgets[catId];
    if (isBudgetValueSet(entry)) {
      if (typeof entry !== "object") {
        owners.felles = true;
      } else {
        Object.keys(entry).forEach(function (k) {
          owners[k] = true;
        });
      }
    }
    var bl = m && m.budgetLines && m.budgetLines[catId];
    if (bl && typeof bl === "object") {
      Object.keys(bl).forEach(function (k) {
        owners[k] = true;
      });
    }
    return Object.keys(owners);
  }

  function budgetForOwnerRaw(m, catId, ownerId) {
    var entry = m.budgets && m.budgets[catId];
    if (!isBudgetValueSet(entry)) return 0;
    if (typeof entry !== "object") {
      return ownerId === "felles" ? Number(entry) || 0 : 0;
    }
    var v = entry[ownerId];
    return v == null || v === "" ? 0 : Number(v) || 0;
  }

  function budgetForOwner(m, catId, ownerId, monthIndex) {
    var lines = getBudgetLines(m, catId, ownerId);
    if (lines.length) return sumBudgetLines(lines, monthIndex);
    return budgetForOwnerRaw(m, catId, ownerId);
  }

  /** Household total for one category (all owners summed). */
  function budgetFor(m, catId, monthIndex) {
    var owners = budgetOwnersForCat(m, catId);
    if (!owners.length) {
      var entry = m.budgets && m.budgets[catId];
      if (!isBudgetValueSet(entry)) return 0;
      if (typeof entry !== "object") return Number(entry) || 0;
      return 0;
    }
    var sum = 0;
    owners.forEach(function (oid) {
      sum += budgetForOwner(m, catId, oid, monthIndex);
    });
    return sum;
  }

  function setBudgetForOwnerRaw(m, catId, ownerId, value) {
    var obj = ensureBudgetObject(m, catId);
    if (value == null || value === "") {
      delete obj[ownerId];
    } else {
      obj[ownerId] = value;
    }
    if (!budgetEntryHasValue(obj)) {
      delete m.budgets[catId];
    }
  }

  function setBudgetForOwner(m, catId, ownerId, value) {
    // Manual total edit: if lines exist, clear them so total becomes source of truth
    if (hasBudgetLines(m, catId, ownerId)) {
      setBudgetLines(m, catId, ownerId, []);
    }
    setBudgetForOwnerRaw(m, catId, ownerId, value);
  }

  function actualForCategory(m, catId, catName) {
    return (m.expenses || [])
      .filter(function (e) {
        return (
          e.categoryId === catId ||
          (!e.categoryId && catName && e.category === catName)
        );
      })
      .reduce(function (s, e) {
        return s + (e.amount || 0);
      }, 0);
  }

  function actualForCategoryOwner(m, catId, catName, ownerId) {
    return (m.expenses || [])
      .filter(function (e) {
        var matchCat =
          e.categoryId === catId ||
          (!e.categoryId && catName && e.category === catName);
        if (!matchCat) return false;
        if (ownerId === "felles") return e.owner === "felles" || !e.owner;
        return e.owner === ownerId;
      })
      .reduce(function (s, e) {
        return s + (e.amount || 0);
      }, 0);
  }

  function sumAmounts(arr, pred) {
    return (arr || [])
      .filter(pred || function () {
        return true;
      })
      .reduce(function (s, x) {
        return s + (x.amount || 0);
      }, 0);
  }

  function catById(categories, id) {
    if (!id || !categories) return null;
    for (var i = 0; i < categories.length; i++) {
      if (categories[i] && categories[i].id === id) return categories[i];
    }
    return null;
  }

  /**
   * Sum of this person's %-share of all felles expenses (per category split).
   * Expenses without categoryId use equal split across people (legacy).
   */
  function fellesExpenseShareForPerson(m, personId, people, categories) {
    var active = activePeople(people);
    var n = Math.max(1, active.length);
    var sum = 0;
    (m.expenses || []).forEach(function (e) {
      if (!e || e.owner !== "felles") return;
      var amt = Number(e.amount) || 0;
      if (!amt) return;
      var cat = e.categoryId ? catById(categories, e.categoryId) : null;
      if (!cat && e.category) {
        for (var i = 0; i < (categories || []).length; i++) {
          if (
            categories[i] &&
            categories[i].name === e.category &&
            !categories[i].archived
          ) {
            cat = categories[i];
            break;
          }
        }
      }
      if (cat) {
        sum += fellesShare(cat, personId, people, amt);
      } else {
        sum += amt / n;
      }
    });
    return sum;
  }

  /**
   * Per-person actuals. Felles expenses use category split percents.
   * tilOvers = lønn + ekstra - sparing - utgifter (same semantics as before).
   */
  function calcPerson(m, personId, people, categories) {
    var lønn = sumAmounts(m.incomes, function (i) {
      return i.person === personId && i.type === "lønn";
    });
    var ekstra = sumAmounts(m.incomes, function (i) {
      return i.person === personId && i.type === "ekstra";
    });
    var sparing = sumAmounts(m.savings, function (s) {
      return s.person === personId;
    });
    var ownExp = sumAmounts(m.expenses, function (e) {
      return e.owner === personId;
    });
    var fellesPart = fellesExpenseShareForPerson(m, personId, people, categories);
    var utgifter = ownExp + fellesPart;
    var tilOvers = lønn + ekstra - sparing - utgifter;
    return {
      lønn: lønn,
      ekstra: ekstra,
      sparing: sparing,
      utgifter: utgifter,
      ownExp: ownExp,
      fellesShare: fellesPart,
      tilOvers: tilOvers,
      planInn:
        plannedIncomeFor(m, personId, "lønn") +
        plannedIncomeFor(m, personId, "ekstra"),
      actualInn: lønn + ekstra
    };
  }

  /**
   * Planned ut for one person = that person's category budgets
   * + %-share of Felles-section budgets (budgets[cat].felles).
   * Does NOT use category.owner for expected amounts (budget keys are the source).
   */
  function plannedUtForPerson(m, personId, categories, people, monthIndex) {
    var own = 0;
    var felles = 0;
    (categories || []).forEach(function (cat) {
      if (cat.archived) return;
      own += budgetForOwner(m, cat.id, personId, monthIndex);
      var fb = budgetForOwner(m, cat.id, "felles", monthIndex);
      felles += fellesShare(cat, personId, people, fb);
    });
    return own + felles;
  }

  /**
   * Person share of Fast / variabelt planned budgets (own owner key + felles %-share).
   * Same attribution as plannedUtForPerson / personal Trygg.
   */
  function plannedBudgetForPersonByType(
    m,
    personId,
    categories,
    people,
    monthIndex,
    typeFilter
  ) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived) return;
      if (typeFilter === "fast" && cat.type !== "fast") return;
      if (typeFilter === "variable" && cat.type === "fast") return;
      sum += budgetForOwner(m, cat.id, personId, monthIndex) || 0;
      var fb = budgetForOwner(m, cat.id, "felles", monthIndex) || 0;
      if (fb) sum += fellesShare(cat, personId, people, fb);
    });
    return sum;
  }

  function plannedFixedBudgetForPerson(m, personId, categories, people, monthIndex) {
    return plannedBudgetForPersonByType(
      m,
      personId,
      categories,
      people,
      monthIndex,
      "fast"
    );
  }

  function plannedVariableBudgetForPerson(
    m,
    personId,
    categories,
    people,
    monthIndex
  ) {
    return plannedBudgetForPersonByType(
      m,
      personId,
      categories,
      people,
      monthIndex,
      "variable"
    );
  }

  /** Planned lønn+ekstra for one person (no sparing). */
  function plannedIncomeForPerson(m, personId) {
    return (
      plannedIncomeFor(m, personId, "lønn") +
      plannedIncomeFor(m, personId, "ekstra")
    );
  }

  function plannedUtFelles(m, categories, monthIndex) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (cat.archived) return;
      sum += budgetForOwner(m, cat.id, "felles", monthIndex);
    });
    return sum;
  }



  /**
   * Feature 1 – Fast auto-count as spent.
   * Rule: category auto-spends when type==="fast" AND autoSpend !== false.
   * Double-count rule (documented): effectiveActual = max(planned, logged).
   * Yearly/quarterly: uses budgetFor / budgetForOwner (already month-aware via lines).
   */
  function categoryAutoSpends(cat) {
    return !!(cat && !cat.archived && cat.type === "fast" && cat.autoSpend !== false);
  }

  function effectiveActualForCategory(m, cat, monthIndex) {
    var logged = actualForCategory(m, cat.id, cat.name);
    if (!categoryAutoSpends(cat)) return logged;
    var planned = budgetFor(m, cat.id, monthIndex);
    return Math.max(planned || 0, logged || 0);
  }

  function effectiveActualForCategoryOwner(m, cat, ownerId, monthIndex) {
    var logged = actualForCategoryOwner(m, cat.id, cat.name, ownerId);
    if (!categoryAutoSpends(cat)) return logged;
    var planned = budgetForOwner(m, cat.id, ownerId, monthIndex);
    return Math.max(planned || 0, logged || 0);
  }

  function autoSpendExtraForCategory(m, cat, monthIndex) {
    if (!categoryAutoSpends(cat)) return 0;
    var planned = budgetFor(m, cat.id, monthIndex);
    var logged = actualForCategory(m, cat.id, cat.name);
    return Math.max(0, (planned || 0) - (logged || 0));
  }

  function autoSpendExtraTotal(m, categories, monthIndex) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived) return;
      sum += autoSpendExtraForCategory(m, cat, monthIndex);
    });
    return sum;
  }

  /**
   * Per-person Fast auto leftover. Uses category-level autoSpendExtra (total
   * planned − total logged across ALL owners) so logging Fast under a person
   * against a felles-budget still clears autoExtra (no double-count in
   * På konto forventet / plan-mode). Attribute by budget weight:
   * ownPlanned + fellesShare(fellesPlanned).
   */
  function autoSpendExtraForPerson(m, personId, people, categories, monthIndex) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived || !categoryAutoSpends(cat)) return;
      var catExtra = autoSpendExtraForCategory(m, cat, monthIndex);
      if (!(catExtra > 0)) return;
      var totalPlanned = budgetFor(m, cat.id, monthIndex) || 0;
      if (!(totalPlanned > 0)) return;
      var ownPlanned = budgetForOwner(m, cat.id, personId, monthIndex) || 0;
      var fellesPlanned = budgetForOwner(m, cat.id, "felles", monthIndex) || 0;
      var weight =
        ownPlanned + fellesShare(cat, personId, people, fellesPlanned);
      sum += catExtra * (weight / totalPlanned);
    });
    return sum;
  }

  /**
   * Feature 2 – Fremtidig / planlagt utlegg (state.plannedSpends[]).
   * monthKey "YYYY-MM". When viewing month M:
   *   - Hold-back (futureReserve): open items with monthKey > M (strictly later)
   *   - Same-month (monthKey === M): reserve only if NOT plan-seeded into bruk
   *     and NOT reflectedInBalance; manual full bank before paying still reserves
   *     until done / logged / reflected.
   * Double-count: logged expense in viewed month matching owner + categoryId
   * (greedy 1:1) → reserve 0. No category → full amount until done=true.
   */
  function normalizePlannedSpend(p, people) {
    p = p || {};
    var owner = mapLegacyOwner(p.owner || "felles");
    if (owner !== "felles" && !personById(people, owner)) owner = "felles";
    var amount = Number(p.amount);
    var mk = p.monthKey ? String(p.monthKey) : "";
    if (!/^\d{4}-\d{2}$/.test(mk)) mk = "";
    return {
      id: p.id || uid(),
      amount: Number.isFinite(amount) && amount > 0 ? amount : 0,
      categoryId: p.categoryId || null,
      owner: owner,
      monthKey: mk,
      note: p.note ? String(p.note).slice(0, 120) : "",
      done: !!p.done,
      doneExpenseId: p.doneExpenseId || null,
      reflectedInBalance: !!p.reflectedInBalance
    };
  }

  function normalizePlannedSpends(list, people) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (p) {
        return normalizePlannedSpend(p, people);
      })
      .filter(function (p) {
        return p && p.amount > 0 && p.monthKey;
      });
  }

  function plannedSpendsForMonth(list, monthKey) {
    var mk = String(monthKey || "");
    return (list || []).filter(function (p) {
      return p && p.monthKey === mk;
    });
  }

  /**
   * Items with monthKey >= viewed (list UI). Hold-back window for reserve is
   * monthKey > viewed; same-month handled separately (seed / reflected).
   */
  function plannedSpendsFromMonth(list, monthKey) {
    var mk = String(monthKey || "");
    if (!mk) return [];
    return (list || []).filter(function (p) {
      return p && p.monthKey && String(p.monthKey) >= mk;
    });
  }

  /** Strictly later than viewed month (YYYY-MM string order). */
  function plannedSpendsAfterMonth(list, monthKey) {
    var mk = String(monthKey || "");
    if (!mk) return [];
    return (list || []).filter(function (p) {
      return p && p.monthKey && String(p.monthKey) > mk;
    });
  }

  function shouldReserveSameMonthPlan(item, viewedMk, opts) {
    opts = opts || {};
    if (!item || !viewedMk) return false;
    if (String(item.monthKey || "") !== viewedMk) return false;
    if (item.reflectedInBalance) return false;
    if (opts.excludeSameMonth) return false;
    return true;
  }

  /**
   * Reserved amount for planned spends.
   * - Always: open items with monthKey > viewed (hold-back for future months)
   * - Same-month: only when bruk is NOT plan-seeded (excludeSameMonth) and item
   *   is NOT reflectedInBalance (after Bekreft of suggested seed). Manual full
   *   bank before paying still reserves same-month until done/logged/reflected.
   * Matching expenses only for same-month plans.
   */
  function plannedSpendReserve(plannedSpends, monthKey, expenses, opts) {
    opts = opts || {};
    var viewedMk = String(monthKey || "");
    var items = (plannedSpends || []).filter(function (p) {
      if (!p || p.done || !(p.amount > 0) || !p.monthKey) return false;
      var mk = String(p.monthKey);
      if (viewedMk && mk > viewedMk) return true;
      if (viewedMk && mk === viewedMk) {
        return shouldReserveSameMonthPlan(p, viewedMk, opts);
      }
      // No viewed month → keep legacy >= behaviour via fromMonth callers
      if (!viewedMk) return true;
      return false;
    });
    if (!items.length) return 0;
    var exps = (expenses || []).slice();
    var used = {};
    var reserve = 0;
    items.forEach(function (item) {
      if (item.doneExpenseId) {
        var linked = exps.some(function (e) {
          return e && e.id === item.doneExpenseId;
        });
        if (linked) return; // covered
      }
      // Only match category against viewed-month expenses for same-month plans
      var sameMonth = viewedMk && String(item.monthKey || "") === viewedMk;
      if (sameMonth && item.categoryId) {
        var matchIdx = -1;
        for (var i = 0; i < exps.length; i++) {
          if (used[i]) continue;
          var e = exps[i];
          if (!e) continue;
          var eOwner = e.owner || "felles";
          var eCat = e.categoryId || null;
          if (eOwner === item.owner && eCat === item.categoryId) {
            matchIdx = i;
            break;
          }
        }
        if (matchIdx >= 0) {
          used[matchIdx] = true;
          // Covered by logged purchase — do not reserve (avoid double count)
          return;
        }
      }
      reserve += item.amount;
    });
    return reserve;
  }

  function plannedSpendReserveForPerson(
    plannedSpends,
    monthKey,
    expenses,
    personId,
    people,
    opts
  ) {
    opts = opts || {};
    var viewedMk = String(monthKey || "");
    var items = (plannedSpends || []).filter(function (p) {
      if (!p || p.done || !(p.amount > 0) || !p.monthKey) return false;
      var mk = String(p.monthKey);
      if (viewedMk && mk > viewedMk) return true;
      if (viewedMk && mk === viewedMk) {
        return shouldReserveSameMonthPlan(p, viewedMk, opts);
      }
      if (!viewedMk) return true;
      return false;
    });
    if (!items.length) return 0;
    var exps = (expenses || []).slice();
    var used = {};
    var active = activePeople(people);
    var n = Math.max(1, active.length);
    var sum = 0;
    items.forEach(function (item) {
      var covered = false;
      if (item.doneExpenseId) {
        covered = exps.some(function (e) {
          return e && e.id === item.doneExpenseId;
        });
      }
      var sameMonth = viewedMk && String(item.monthKey || "") === viewedMk;
      if (!covered && sameMonth && item.categoryId) {
        for (var i = 0; i < exps.length; i++) {
          if (used[i]) continue;
          var e = exps[i];
          if (!e) continue;
          if ((e.owner || "felles") === item.owner && (e.categoryId || null) === item.categoryId) {
            used[i] = true;
            covered = true;
            break;
          }
        }
      }
      if (covered) return;
      if (item.owner === personId) {
        sum += item.amount;
      } else if (item.owner === "felles") {
        sum += item.amount / n;
      }
    });
    return sum;
  }

  /**
   * Remaining budget attributed to one person:
   * own max(0, planned−actual) + %-share of felles remaining (same splits as planUt).
   * fastOnly → only categories with type === "fast".
   */
  function remainingBudgetForPerson(m, personId, people, categories, monthIndex, fastOnly) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived) return;
      if (fastOnly && cat.type !== "fast") return;
      var ownPlanned = budgetForOwner(m, cat.id, personId, monthIndex);
      var ownActual = effectiveActualForCategoryOwner(m, cat, personId, monthIndex);
      sum += Math.max(0, (ownPlanned || 0) - (ownActual || 0));
      var fellesPlanned = budgetForOwner(m, cat.id, "felles", monthIndex);
      var fellesActual = effectiveActualForCategoryOwner(m, cat, "felles", monthIndex);
      var remFelles = Math.max(0, (fellesPlanned || 0) - (fellesActual || 0));
      if (remFelles) {
        sum += fellesShare(cat, personId, people, remFelles);
      }
    });
    return sum;
  }

  function calcFamily(m, people, categories, settings, monthIndex, plannedSpends, monthKey) {
    var active = activePeople(people);
    var n = Math.max(1, active.length);
    ensureMonthShape(m, people);
    ensureCategorySplits(categories, people);

    var byPerson = {};
    active.forEach(function (p) {
      var cp = calcPerson(m, p.id, people, categories);
      cp.planUt = plannedUtForPerson(m, p.id, categories, people, monthIndex);
      cp.netPlan = cp.planInn - cp.planUt;
      byPerson[p.id] = cp;
    });

    var samletInntekt = 0;
    var samletSparing = 0;
    active.forEach(function (p) {
      samletInntekt += byPerson[p.id].lønn + byPerson[p.id].ekstra;
      samletSparing += byPerson[p.id].sparing;
    });

    var samletUtgifter = sumAmounts(m.expenses);
    var samletTilOvers = samletInntekt - samletSparing - samletUtgifter;

    // Bruk/spare balances per person (spare is NOT spendable / not in Trygg å bruke)
    var balanceByPerson = {};
    var totalBruk = 0;
    var totalSpare = 0;
    var hasBruk = false;
    active.forEach(function (p) {
      var bal = (m.balances && m.balances[p.id]) || {};
      var bruk =
        bal.bruk == null || bal.bruk === "" ? null : Number(bal.bruk);
      var spare =
        bal.spare == null || bal.spare === "" ? null : Number(bal.spare);
      if (bruk != null && !Number.isNaN(bruk)) {
        hasBruk = true;
        totalBruk += bruk;
      }
      if (spare != null && !Number.isNaN(spare)) {
        totalSpare += spare;
      }
      var brukN = bruk == null || Number.isNaN(bruk) ? 0 : bruk;
      var spareN = spare == null || Number.isNaN(spare) ? 0 : spare;
      balanceByPerson[p.id] = {
        bruk: bruk,
        spare: spare,
        sum: brukN + spareN
      };
    });
    // Calc-time fallback placeholders (applied after opts is bound)
    var displayBrukFallback = null;
    var brukFromDisplayFallback = false;
    // Legacy fallback: single saldoBefore if balances never set
    var saldo = hasBruk
      ? totalBruk
      : m.saldoBefore == null || m.saldoBefore === ""
        ? null
        : Number(m.saldoBefore);
    // Forventet på konto etter = bruk-total + til overs (sparing-konto utenfor)
    var forventet = saldo == null ? null : saldo + samletTilOvers;
    var totalAlt = totalBruk + totalSpare;

    var planInn = 0;
    active.forEach(function (p) {
      planInn +=
        plannedIncomeFor(m, p.id, "lønn") +
        plannedIncomeFor(m, p.id, "ekstra");
    });

    var plannedTotal = 0;
    var actualBudgeted = 0;
    var loggedBudgeted = 0;
    var activeCats = (categories || []).filter(function (c) {
      return !c.archived;
    });
    var catStats = activeCats.map(function (cat) {
      var planned = budgetFor(m, cat.id, monthIndex);
      var logged = actualForCategory(m, cat.id, cat.name);
      var effectiveActual = effectiveActualForCategory(m, cat, monthIndex);
      var autoSpent = autoSpendExtraForCategory(m, cat, monthIndex);
      plannedTotal += planned;
      actualBudgeted += effectiveActual;
      loggedBudgeted += logged;
      var plannedByOwner = { felles: budgetForOwner(m, cat.id, "felles", monthIndex) };
      active.forEach(function (p) {
        plannedByOwner[p.id] = budgetForOwner(m, cat.id, p.id, monthIndex);
      });
      return {
        cat: cat,
        planned: planned,
        plannedByOwner: plannedByOwner,
        actual: effectiveActual,
        loggedActual: logged,
        autoSpent: autoSpent,
        autoSpend: categoryAutoSpends(cat),
        remain: planned - effectiveActual,
        over:
          (effectiveActual > planned && planned > 0) ||
          (planned === 0 && effectiveActual > 0)
      };
    });

    // Månedhelse: empty months must show 0 brukt (do NOT invent Fast auto as spend).
    // Months with logged expenses keep effectiveActual (Fast auto counts as spent).
    var expenseCount = Array.isArray(m.expenses) ? m.expenses.length : 0;
    var healthBudgeted = expenseCount === 0 ? 0 : actualBudgeted;
    loggedBudgeted = Math.round(loggedBudgeted * 100) / 100;
    healthBudgeted = Math.round(healthBudgeted * 100) / 100;

    var netPlan = planInn - plannedTotal;
    // netActual uses logged only; overview may show effectiveUtgifter separately
    var netActual = samletInntekt - samletUtgifter;

    // remaining uses effectiveActual (Fast auto-spend → remain 0 unless overspent)
    var remainingFastBudgets = 0;
    var remainingBudgetAll = 0;
    catStats.forEach(function (s) {
      var rem = Math.max(0, (s.planned || 0) - (s.actual || 0));
      remainingBudgetAll += rem;
      if (s.cat && s.cat.type === "fast") {
        remainingFastBudgets += rem;
      }
    });

    // Auto-spend credit: planned−logged for Fast (max rule already in effectiveActual)
    var autoSpendExtra = autoSpendExtraTotal(m, categories, monthIndex);
    var effectiveUtgifter = samletUtgifter + autoSpendExtra;

    var opts = settings && typeof settings === "object" ? settings : {};
    var useSaldo =
      opts.useSaldoInSafeToSpend !== false; // default ON
    var spendBuffer = 0;
    if (opts.spendBuffer != null && opts.spendBuffer !== "") {
      var bufN = Number(opts.spendBuffer);
      if (Number.isFinite(bufN) && bufN > 0) spendBuffer = bufN;
    }

    // Apply calc-time display bruk fallback once opts.months is available
    if (
      !hasBruk &&
      opts &&
      opts.months &&
      (monthKey || opts.monthKey)
    ) {
      var fbKey = monthKey || opts.monthKey;
      displayBrukFallback = resolveDisplayBrukFallback(
        opts.months,
        fbKey,
        people,
        plannedSpends || opts.plannedSpends || [],
        categories
      );
      if (displayBrukFallback && displayBrukFallback.byPerson) {
        brukFromDisplayFallback = true;
        hasBruk = true;
        totalBruk = 0;
        active.forEach(function (p) {
          var fbAmt = displayBrukFallback.byPerson[p.id];
          if (fbAmt == null || !Number.isFinite(Number(fbAmt))) return;
          var spareKeep = balanceByPerson[p.id]
            ? balanceByPerson[p.id].spare
            : null;
          var spareN2 =
            spareKeep == null || Number.isNaN(Number(spareKeep))
              ? 0
              : Number(spareKeep);
          balanceByPerson[p.id] = {
            bruk: Number(fbAmt),
            spare: spareKeep,
            sum: Number(fbAmt) + spareN2,
            fromDisplayFallback: true
          };
          totalBruk += Number(fbAmt);
        });
        // Recompute aggregates that were derived before fallback
        saldo = totalBruk;
        totalAlt = totalBruk + totalSpare;
        forventet =
          typeof samletTilOvers === "number" ? saldo + samletTilOvers : saldo;
      }
    }

    // Future planned spends reserve (Feature 2)
    var mk = monthKey || opts.monthKey || null;
    var plannedList = plannedSpends || opts.plannedSpends || [];
    // Same-month plans already in seeded bruk (flags / reflected / seed-match) → skip
    var excludeSameMonthPlanned =
      monthHasPlanSeededBalances(m) || brukFromDisplayFallback;
    if (!excludeSameMonthPlanned && mk) {
      var prevForSeed = opts.prevMonth || null;
      if (!prevForSeed && opts.months) {
        var prevKeyForSeed = findNearestPreviousWithConfirmedBalances(
          opts.months,
          mk
        );
        prevForSeed =
          prevKeyForSeed && opts.months[prevKeyForSeed]
            ? opts.months[prevKeyForSeed]
            : null;
      }
      if (
        brukReflectsSameMonthPlans(m, prevForSeed, mk, plannedList, people)
      ) {
        excludeSameMonthPlanned = true;
      }
    }
    var futureReserve = plannedSpendReserve(
      plannedList,
      mk,
      m.expenses,
      { excludeSameMonth: excludeSameMonthPlanned }
    );

    // Plan: planInn − effectiveExpenses − remainingFast − futureReserve
    // (autoSpend Fast remain=0; commitment lives in effectiveUtgifter)
    // Allow negative = need to save (no Math.max 0 clamp on primary Trygg)
    var safeToSpendPlanRaw =
      planInn - effectiveUtgifter - remainingFastBudgets - futureReserve;
    var safeToSpendPlan = safeToSpendPlanRaw;

    // Variable remaining (Fast rem≈0 when auto on; not subtracted from "nå")
    var remainingVariableBudgets = Math.max(
      0,
      remainingBudgetAll - remainingFastBudgets
    );

    // Dual saldo formulas — bank saldo already reflects paid Fast (På konto nå).
    // Do NOT re-subtract autoSpendExtra (would double-count fixed bills).
    // Primary "nå": bruk − futureReserve − buffer
    // Secondary "hvis hele budsjettet brukes": bruk − remAll − future − buffer
    //   (remAll uses effectiveActual so Fast rem≈0; still no autoSpendExtra)
    // Plan mode still uses autoSpendExtra via safeToSpendPlanRaw above.
    var safeToSpendNowRaw = null;
    var safeToSpendNow = null;
    var safeToSpendSaldoRaw = null; // conservative / if-budget-used
    var safeToSpendSaldo = null;
    if (hasBruk) {
      safeToSpendNowRaw = totalBruk - futureReserve - spendBuffer;
      safeToSpendNow = safeToSpendNowRaw;
      safeToSpendSaldoRaw =
        totalBruk - remainingBudgetAll - futureReserve - spendBuffer;
      safeToSpendSaldo = safeToSpendSaldoRaw;
    }

    // When saldo-mode is intended but bruk is missing, do NOT fall back to a
    // scary plan-mode 0 (e.g. October with large plannedSpend + no På konto nå).
    // UI shows «Sett på konto nå» / «—» instead of clamping planInn−reserve to 0.
    var safeToSpendMode = "plan";
    var safeToSpendRaw = safeToSpendPlanRaw;
    var safeToSpend = safeToSpendPlan;
    var needsSaldoForSafeToSpend = false;
    if (useSaldo && hasBruk) {
      safeToSpendMode = "saldo";
      safeToSpendRaw = safeToSpendNowRaw;
      safeToSpend = safeToSpendNow;
    } else if (useSaldo && !hasBruk) {
      // På konto is optional (correction tool). Without pot/bruk, fall back to
      // plan-mode Trygg instead of blocking «Sett på konto» / null.
      safeToSpendMode = "plan";
      safeToSpendRaw = safeToSpendPlanRaw;
      safeToSpend = safeToSpendPlan;
      needsSaldoForSafeToSpend = false;
    }

    // Per-person Trygg å bruke (same mode rules; buffer split equally by people count)
    var bufferShareEach = n > 0 ? spendBuffer / n : 0;
    active.forEach(function (p) {
      var cp = byPerson[p.id];
      var bal = balanceByPerson[p.id] || {};
      var personBruk = bal.bruk;
      var hasPersonBruk =
        personBruk != null && Number.isFinite(Number(personBruk));
      var brukN = hasPersonBruk ? Number(personBruk) : 0;

      var remAllP = remainingBudgetForPerson(
        m,
        p.id,
        people,
        categories,
        monthIndex,
        false
      );
      var remFastP = remainingBudgetForPerson(
        m,
        p.id,
        people,
        categories,
        monthIndex,
        true
      );
      var autoExtraP = autoSpendExtraForPerson(
        m,
        p.id,
        people,
        categories,
        monthIndex
      );
      var futureP = plannedSpendReserveForPerson(
        plannedSpends || opts.plannedSpends || [],
        mk,
        m.expenses,
        p.id,
        people,
        { excludeSameMonth: excludeSameMonthPlanned }
      );

      var planRawP =
        (cp.planInn || 0) - (cp.utgifter || 0) - autoExtraP - remFastP - futureP;
      var planSafeP = planRawP;

      var remVarP = Math.max(0, remAllP - remFastP);
      var nowRawP = null;
      var nowSafeP = null;
      var saldoRawP = null; // conservative / if-budget-used
      var saldoSafeP = null;
      if (hasPersonBruk) {
        // Saldo: never re-subtract autoExtra (Fast already in bank balance)
        nowRawP = brukN - futureP - bufferShareEach;
        nowSafeP = nowRawP;
        saldoRawP = brukN - remAllP - futureP - bufferShareEach;
        saldoSafeP = saldoRawP;
      }

      var modeP = "plan";
      var rawP = planRawP;
      var safeP = planSafeP;
      var needsSaldoP = false;
      if (useSaldo && hasPersonBruk) {
        modeP = "saldo";
        rawP = nowRawP;
        safeP = nowSafeP;
      } else if (useSaldo && !hasPersonBruk) {
        // Optional På konto — plan fallback, not blocking
        modeP = "plan";
        rawP = planRawP;
        safeP = planSafeP;
        needsSaldoP = false;
      }

      cp.remainingBudgetAll = remAllP;
      cp.remainingFastBudgets = remFastP;
      cp.remainingVariableBudgets = remVarP;
      cp.autoSpendExtra = autoExtraP;
      cp.futureReserve = futureP;
      cp.spendBufferShare = bufferShareEach;
      cp.hasBrukBalance = hasPersonBruk;
      cp.needsSaldoForSafeToSpend = needsSaldoP;
      cp.safeToSpendMode = modeP;
      cp.safeToSpendPlanRaw = planRawP;
      cp.safeToSpendPlan = planSafeP;
      cp.safeToSpendNowRaw = nowRawP;
      cp.safeToSpendNow = nowSafeP;
      cp.safeToSpendSaldoRaw = saldoRawP;
      cp.safeToSpendSaldo = saldoSafeP;
      cp.safeToSpendIfBudgetUsedRaw = saldoRawP;
      cp.safeToSpendIfBudgetUsed = saldoSafeP;
      cp.safeToSpendRaw = rawP;
      cp.safeToSpend = safeP;
    });

    // Etter lønn (plan) = nå på bruk + forventet inn − forventet ut
    var etterLonn = hasBruk ? totalBruk + planInn - plannedTotal : null;

    var hasPlannedIncome = active.some(function (p) {
      return ["lønn", "ekstra"].some(function (t) {
        var v = m.plannedIncome[p.id] && m.plannedIncome[p.id][t];
        return v != null && v !== "";
      });
    });

    var hasBudgets = Object.keys(m.budgets || {}).some(function (k) {
      return budgetEntryHasValue(m.budgets[k]);
    });

    return {
      byPerson: byPerson,
      activePeople: active,
      peopleCount: n,
      samletInntekt: samletInntekt,
      samletUtgifter: samletUtgifter,
      samletSparing: samletSparing,
      samletTilOvers: samletTilOvers,
      balanceByPerson: balanceByPerson,
      totalBruk: totalBruk,
      totalSpare: totalSpare,
      totalAlt: totalAlt,
      saldo: saldo,
      forventet: forventet,
      planInn: planInn,
      plannedTotal: plannedTotal,
      planUtFelles: plannedUtFelles(m, categories, monthIndex),
      actualBudgeted: actualBudgeted,
      loggedBudgeted: loggedBudgeted,
      healthBudgeted: healthBudgeted,
      expenseCount: expenseCount,
      netPlan: netPlan,
      netActual: netActual,
      remainingFastBudgets: remainingFastBudgets,
      remainingBudgetAll: remainingBudgetAll,
      remainingVariableBudgets: remainingVariableBudgets,
      autoSpendExtra: autoSpendExtra,
      effectiveUtgifter: effectiveUtgifter,
      futureReserve: futureReserve,
      spendBuffer: spendBuffer,
      hasBrukBalances: hasBruk,
      hasSuggestedBalances: excludeSameMonthPlanned || brukFromDisplayFallback,
      brukFromDisplayFallback: brukFromDisplayFallback,
      displayBrukFallback: displayBrukFallback,
      useSaldoInSafeToSpend: useSaldo,
      needsSaldoForSafeToSpend: needsSaldoForSafeToSpend,
      safeToSpendMode: safeToSpendMode,
      safeToSpendPlanRaw: safeToSpendPlanRaw,
      safeToSpendPlan: safeToSpendPlan,
      safeToSpendNowRaw: safeToSpendNowRaw,
      safeToSpendNow: safeToSpendNow,
      safeToSpendSaldoRaw: safeToSpendSaldoRaw,
      safeToSpendSaldo: safeToSpendSaldo,
      safeToSpendIfBudgetUsedRaw: safeToSpendSaldoRaw,
      safeToSpendIfBudgetUsed: safeToSpendSaldo,
      safeToSpendRaw: safeToSpendRaw,
      safeToSpend: safeToSpend,
      etterLonn: etterLonn,
      catStats: catStats,
      hasPlannedIncome: hasPlannedIncome,
      hasBudgets: hasBudgets,
      hasAnyData:
        (m.incomes && m.incomes.length > 0) ||
        (m.savings && m.savings.length > 0) ||
        (m.expenses && m.expenses.length > 0) ||
        monthHasBalances(m) ||
        m.saldoBefore != null ||
        hasPlannedIncome ||
        hasBudgets
    };
  }

  function personHasData(state, personId) {
    if (!state || !state.months) return false;
    var keys = Object.keys(state.months);
    for (var i = 0; i < keys.length; i++) {
      var m = state.months[keys[i]];
      if (!m) continue;
      if (
        (m.incomes || []).some(function (x) {
          return x.person === personId;
        })
      )
        return true;
      if (
        (m.savings || []).some(function (x) {
          return x.person === personId;
        })
      )
        return true;
      if (
        (m.expenses || []).some(function (x) {
          return x.owner === personId;
        })
      )
        return true;
      var pi = m.plannedIncome && m.plannedIncome[personId];
      if (
        pi &&
        ((pi.lønn != null && pi.lønn !== "") ||
          (pi.ekstra != null && pi.ekstra !== ""))
      )
        return true;
      var bal = m.balances && m.balances[personId];
      if (
        bal &&
        ((bal.bruk != null && bal.bruk !== "") ||
          (bal.spare != null && bal.spare !== ""))
      )
        return true;
    }
    if (
      (state.categories || []).some(function (c) {
        return c.owner === personId && !c.archived;
      })
    )
      return true;
    return false;
  }


  function monthHasExpected(m) {
    if (!m) return false;
    var budgets = m.budgets || {};
    var bk = Object.keys(budgets);
    for (var i = 0; i < bk.length; i++) {
      if (budgetEntryHasValue(budgets[bk[i]])) return true;
    }
    var pi = m.plannedIncome || {};
    var pids = Object.keys(pi);
    for (var j = 0; j < pids.length; j++) {
      var block = pi[pids[j]];
      if (!block) continue;
      if (
        (block.lønn != null && block.lønn !== "") ||
        (block.ekstra != null && block.ekstra !== "")
      ) {
        return true;
      }
    }
    return false;
  }

  function shiftMonthKey(key, deltaMonths) {
    var parts = String(key).split("-");
    var y = parseInt(parts[0], 10);
    var mo = parseInt(parts[1], 10) - 1;
    if (!Number.isFinite(y) || !Number.isFinite(mo)) return null;
    mo += deltaMonths;
    while (mo < 0) {
      mo += 12;
      y -= 1;
    }
    while (mo > 11) {
      mo -= 12;
      y += 1;
    }
    return y + "-" + String(mo + 1).padStart(2, "0");
  }

  /** Signed month distance: toKey - fromKey (e.g. 2026-11 - 2026-09 = 2). */
  function monthsBetweenKeys(fromKey, toKey) {
    if (!fromKey || !toKey) return null;
    var a = String(fromKey).split("-");
    var b = String(toKey).split("-");
    if (a.length < 2 || b.length < 2) return null;
    var ay = parseInt(a[0], 10);
    var am = parseInt(a[1], 10);
    var by = parseInt(b[0], 10);
    var bm = parseInt(b[1], 10);
    if (!Number.isFinite(ay) || !Number.isFinite(am) || !Number.isFinite(by) || !Number.isFinite(bm)) {
      return null;
    }
    return (by - ay) * 12 + (bm - am);
  }

  function findNearestPreviousWithExpected(months, monthKey, maxLookback) {
    var look = maxLookback == null ? 36 : maxLookback;
    var key = monthKey;
    for (var i = 0; i < look; i++) {
      key = shiftMonthKey(key, -1);
      if (!key) return null;
      var m = months && months[key];
      if (m && monthHasExpected(m)) return key;
    }
    return null;
  }

  /**
   * Copy ALL category budgets + planned income from source → target.
   * Used when opening an empty month (carry-forward).
   */
  function copyExpectedFrom(sourceMonth, targetMonth, people, monthIndex) {
    if (!sourceMonth || !targetMonth) return targetMonth;
    targetMonth.budgets = targetMonth.budgets || {};
    var srcBudgets = sourceMonth.budgets || {};
    Object.keys(srcBudgets).forEach(function (id) {
      var cloned = cloneBudgetEntry(srcBudgets[id]);
      if (cloned) {
        targetMonth.budgets[id] = cloned;
      }
    });
    copyBudgetLinesFrom(sourceMonth, targetMonth, monthIndex);
    ensureMonthShape(targetMonth, people);
    ensureMonthShape(sourceMonth, people);
    var pi = sourceMonth.plannedIncome || {};
    Object.keys(pi).forEach(function (pid) {
      if (!targetMonth.plannedIncome[pid]) {
        targetMonth.plannedIncome[pid] = emptyPlannedIncomeBlock();
      }
      PLANNED_INCOME_FIELDS.forEach(function (t) {
        if (pi[pid] && pi[pid][t] != null && pi[pid][t] !== "") {
          targetMonth.plannedIncome[pid][t] = pi[pid][t];
        }
      });
    });
    // Do not copy balances — På konto nå is point-in-time per month.
    return targetMonth;
  }

  /**
   * True when target has no explicit budget slot for catId+ownerId.
   * Note: budgetForOwnerRaw returns 0 for missing — do NOT use it with
   * isBudgetValueSet (0 looks "set").
   */
  function ownerBudgetSlotMissing(m, catId, ownerId) {
    var entry = m && m.budgets && m.budgets[catId];
    if (!isBudgetValueSet(entry)) return true;
    if (typeof entry !== "object") {
      // Legacy scalar covers felles only
      return ownerId !== "felles";
    }
    return !isBudgetValueSet(entry[ownerId]);
  }

  /**
   * Additive: fill missing budgets / budgetLines / null plannedIncome from source.
   * Never overwrites existing budget amounts or non-empty plannedIncome fields.
   * Never touches expenses / incomes / savings / balances.
   * Returns true if anything changed.
   */
  function fillMissingExpectedFrom(sourceMonth, targetMonth, people, monthIndex) {
    if (!sourceMonth || !targetMonth) return false;
    var changed = false;
    targetMonth.budgets = targetMonth.budgets || {};
    var srcBudgets = sourceMonth.budgets || {};
    Object.keys(srcBudgets).forEach(function (catId) {
      var srcEntry = srcBudgets[catId];
      if (!budgetEntryHasValue(srcEntry)) return;
      if (typeof srcEntry !== "object") {
        // legacy scalar → felles
        if (!budgetEntryHasValue(targetMonth.budgets[catId])) {
          var cloned = cloneBudgetEntry(srcEntry);
          if (cloned) {
            targetMonth.budgets[catId] = cloned;
            changed = true;
          }
        }
        return;
      }
      Object.keys(srcEntry).forEach(function (oid) {
        if (!isBudgetValueSet(srcEntry[oid])) return;
        if (ownerBudgetSlotMissing(targetMonth, catId, oid)) {
          setBudgetForOwnerRaw(targetMonth, catId, oid, srcEntry[oid]);
          changed = true;
        }
      });
    });
    // Missing underlinjer only (do not replace existing line sets)
    var srcLines = sourceMonth.budgetLines || {};
    Object.keys(srcLines).forEach(function (catId) {
      var byOwner = srcLines[catId];
      if (!byOwner || typeof byOwner !== "object") return;
      Object.keys(byOwner).forEach(function (oid) {
        if (hasBudgetLines(targetMonth, catId, oid)) return;
        if (!Array.isArray(byOwner[oid]) || !byOwner[oid].length) return;
        if (!targetMonth.budgetLines) targetMonth.budgetLines = {};
        if (!targetMonth.budgetLines[catId]) targetMonth.budgetLines[catId] = {};
        targetMonth.budgetLines[catId][oid] = byOwner[oid]
          .map(normalizeBudgetLine)
          .filter(Boolean);
        syncBudgetFromLines(targetMonth, catId, oid, monthIndex);
        changed = true;
      });
    });
    ensureMonthShape(targetMonth, people);
    ensureMonthShape(sourceMonth, people);
    var pi = sourceMonth.plannedIncome || {};
    Object.keys(pi).forEach(function (pid) {
      if (!targetMonth.plannedIncome[pid]) {
        targetMonth.plannedIncome[pid] = emptyPlannedIncomeBlock();
      }
      PLANNED_INCOME_FIELDS.forEach(function (t) {
        if (
          pi[pid] &&
          pi[pid][t] != null &&
          pi[pid][t] !== "" &&
          (targetMonth.plannedIncome[pid][t] == null ||
            targetMonth.plannedIncome[pid][t] === "")
        ) {
          targetMonth.plannedIncome[pid][t] = pi[pid][t];
          changed = true;
        }
      });
    });
    return changed;
  }

  /**
   * True when target looks like a stale incomplete carry of source:
   * - no expenses logged
   * - every set budget value in target equals source
   * - source has at least one budget or plannedIncome field target lacks / differs
   * Customized amounts (e.g. Mat 999 vs source 5000) → false.
   */
  function isStaleIncompleteExpected(targetMonth, sourceMonth) {
    if (!targetMonth || !sourceMonth) return false;
    if (
      Array.isArray(targetMonth.expenses) &&
      targetMonth.expenses.length > 0
    ) {
      return false;
    }
    if (
      Array.isArray(targetMonth.incomes) &&
      targetMonth.incomes.length > 0
    ) {
      return false;
    }
    if (!monthHasExpected(targetMonth) || !monthHasExpected(sourceMonth)) {
      return false;
    }
    var srcBudgets = sourceMonth.budgets || {};
    var tgtBudgets = targetMonth.budgets || {};
    var anyTarget = false;
    var keys = Object.keys(tgtBudgets);
    for (var i = 0; i < keys.length; i++) {
      var catId = keys[i];
      var te = tgtBudgets[catId];
      if (!budgetEntryHasValue(te)) continue;
      if (typeof te !== "object") {
        anyTarget = true;
        var se = srcBudgets[catId];
        var srcVal =
          typeof se === "object" && se
            ? se.felles
            : se;
        if (Number(te) !== Number(srcVal)) return false;
        continue;
      }
      var oids = Object.keys(te);
      for (var j = 0; j < oids.length; j++) {
        var oid = oids[j];
        if (!isBudgetValueSet(te[oid])) continue;
        anyTarget = true;
        var sv = budgetForOwnerRaw(sourceMonth, catId, oid);
        if (!isBudgetValueSet(sv) || Number(te[oid]) !== Number(sv)) {
          return false;
        }
      }
    }
    if (!anyTarget) return false;
    // Source richer in budgets?
    var sk = Object.keys(srcBudgets);
    for (var si = 0; si < sk.length; si++) {
      var sc = sk[si];
      var sEntry = srcBudgets[sc];
      if (!budgetEntryHasValue(sEntry)) continue;
      if (typeof sEntry !== "object") {
        if (!budgetEntryHasValue(tgtBudgets[sc])) return true;
      } else {
        var so = Object.keys(sEntry);
        for (var sj = 0; sj < so.length; sj++) {
          if (
            isBudgetValueSet(sEntry[so[sj]]) &&
            ownerBudgetSlotMissing(targetMonth, sc, so[sj])
          ) {
            return true;
          }
        }
      }
    }
    // Or planned income differs / incomplete while budgets are subset match
    var spi = sourceMonth.plannedIncome || {};
    var tpi = targetMonth.plannedIncome || {};
    var pids = Object.keys(spi);
    for (var p = 0; p < pids.length; p++) {
      var pid = pids[p];
      if (!spi[pid]) continue;
      if (!tpi[pid]) return true;
      for (var fi = 0; fi < PLANNED_INCOME_FIELDS.length; fi++) {
        var f = PLANNED_INCOME_FIELDS[fi];
        var sPv = spi[pid][f];
        var tPv = tpi[pid][f];
        if (sPv != null && sPv !== "") {
          if (tPv == null || tPv === "" || Number(tPv) !== Number(sPv)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * When target is a stale incomplete copy of source, realign plannedIncome
   * (overwrite) from source. Budgets still only filled additively elsewhere.
   */
  function realignPlannedIncomeFrom(sourceMonth, targetMonth, people) {
    if (!sourceMonth || !targetMonth) return false;
    ensureMonthShape(targetMonth, people);
    ensureMonthShape(sourceMonth, people);
    var changed = false;
    var pi = sourceMonth.plannedIncome || {};
    Object.keys(pi).forEach(function (pid) {
      if (!targetMonth.plannedIncome[pid]) {
        targetMonth.plannedIncome[pid] = emptyPlannedIncomeBlock();
      }
      PLANNED_INCOME_FIELDS.forEach(function (t) {
        if (pi[pid] && pi[pid][t] != null && pi[pid][t] !== "") {
          if (targetMonth.plannedIncome[pid][t] !== pi[pid][t]) {
            targetMonth.plannedIncome[pid][t] = pi[pid][t];
            changed = true;
          }
        }
      });
    });
    return changed;
  }

  /**
   * Heal an already-seeded month from nearest previous expected:
   * additive missing budgets/lines/null PI; if stale incomplete subset,
   * also realign plannedIncome to previous (fixes e.g. Oct lønn 40000 vs Sep).
   * Never copies expenses.
   */
  function healMonthExpectedFromPrevious(months, key, people, opts) {
    opts = opts || {};
    if (!months || !key || !months[key]) {
      return { healed: false, sourceKey: null };
    }
    var m = months[key];
    if (!monthHasExpected(m)) {
      return { healed: false, sourceKey: null };
    }
    var srcKey = findNearestPreviousWithExpected(
      months,
      key,
      opts.maxLookback
    );
    if (!srcKey || !months[srcKey]) {
      return { healed: false, sourceKey: null };
    }
    var src = months[srcKey];
    var mi = monthIndexFromKey(key);
    // Explicit baseline refresh: overwrite budgets + plannedIncome from source
    if (opts.rebaseBudgets) {
      var reb = rebaseExpectedFrom(src, m, people, mi);
      return { healed: reb, sourceKey: reb ? srcKey : null };
    }
    // Snapshot before fill — after additive fill, subset may become complete
    var wasStale = isStaleIncompleteExpected(m, src);
    var changed = fillMissingExpectedFrom(src, m, people, mi);
    if (wasStale) {
      if (realignPlannedIncomeFrom(src, m, people)) changed = true;
    }
    return { healed: changed, sourceKey: changed ? srcKey : null };
  }

  /**
   * Heal all persisted months in chronological order (load/migrate).
   * Empty-expense future months pick up Sep plan categories additively.
   * opts.rebaseBudgets — overwrite existing plan budgets/PI from previous
   *   (use after user refreshes baseline, e.g. raised Sep Mat 2500→4000).
   */
  function healAllMonthsExpected(months, people, opts) {
    opts = opts || {};
    if (!months) return { healedKeys: [] };
    var keys = Object.keys(months).sort();
    var healedKeys = [];
    for (var i = 0; i < keys.length; i++) {
      var r = healMonthExpectedFromPrevious(months, keys[i], people, opts);
      if (r && r.healed) healedKeys.push(keys[i]);
    }
    return { healedKeys: healedKeys };
  }

  /**
   * Overwrite budgets + budgetLines + plannedIncome from source → target.
   * Like copyExpectedFrom, but returns true if anything changed.
   * Never touches expenses / incomes / savings / balances.
   */
  function rebaseExpectedFrom(sourceMonth, targetMonth, people, monthIndex) {
    if (!sourceMonth || !targetMonth) return false;
    var before = JSON.stringify({
      budgets: targetMonth.budgets || {},
      budgetLines: targetMonth.budgetLines || {},
      plannedIncome: targetMonth.plannedIncome || {}
    });
    copyExpectedFrom(sourceMonth, targetMonth, people, monthIndex);
    var after = JSON.stringify({
      budgets: targetMonth.budgets || {},
      budgetLines: targetMonth.budgetLines || {},
      plannedIncome: targetMonth.plannedIncome || {}
    });
    return before !== after;
  }

  /**
   * Rebase all months AFTER templateKey from that month's expected plan
   * (budgets + budgetLines + plannedIncome). Expenses never copied.
   * Skips months with logged expenses/incomes unless opts.includeActiveMonths.
   * Returns { rebasedKeys, templateKey }.
   */
  function rebaseForwardMonthsFrom(months, templateKey, people, opts) {
    opts = opts || {};
    var includeActive = !!opts.includeActiveMonths;
    if (!months || !templateKey || !months[templateKey]) {
      return { rebasedKeys: [], templateKey: templateKey || null };
    }
    var src = months[templateKey];
    if (!monthHasExpected(src)) {
      return { rebasedKeys: [], templateKey: templateKey };
    }
    var keys = Object.keys(months).sort();
    var rebasedKeys = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key <= templateKey) continue;
      var m = months[key];
      if (!m) continue;
      if (
        !includeActive &&
        ((Array.isArray(m.expenses) && m.expenses.length > 0) ||
          (Array.isArray(m.incomes) && m.incomes.length > 0))
      ) {
        continue;
      }
      if (!monthHasExpected(m) && !opts.seedEmpty) continue;
      var mi = monthIndexFromKey(key);
      if (rebaseExpectedFrom(src, m, people, mi)) {
        rebasedKeys.push(key);
      } else if (!monthHasExpected(m) && opts.seedEmpty) {
        copyExpectedFrom(src, m, people, mi);
        rebasedKeys.push(key);
      }
    }
    return { rebasedKeys: rebasedKeys, templateKey: templateKey };
  }

  /**
   * Propagate one budget slot (catId+owner) to all later months.
   * Overwrites existing amounts so forward months mirror the new baseline.
   * Never touches expenses. Returns list of month keys updated.
   */
  function propagateBudgetSlotForward(months, fromKey, catId, ownerId, amount) {
    if (!months || !fromKey || !catId || !ownerId) return [];
    var keys = Object.keys(months).sort();
    var updated = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key <= fromKey) continue;
      var m = months[key];
      if (!m) continue;
      if (!monthHasExpected(m)) continue;
      var prev = budgetForOwnerRaw(m, catId, ownerId);
      setBudgetForOwnerRaw(m, catId, ownerId, amount);
      var next = budgetForOwnerRaw(m, catId, ownerId);
      if (Number(prev) !== Number(next) || !isBudgetValueSet(prev)) {
        updated.push(key);
      }
    }
    return updated;
  }

  /**
   * Propagate one plannedIncome field to later months (overwrite).
   */
  function propagatePlannedIncomeForward(months, fromKey, personId, field, value, people) {
    if (!months || !fromKey || !personId || !field) return [];
    var keys = Object.keys(months).sort();
    var updated = [];
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (key <= fromKey) continue;
      var m = months[key];
      if (!m) continue;
      if (!monthHasExpected(m)) continue;
      ensureMonthShape(m, people);
      if (!m.plannedIncome[personId]) {
        m.plannedIncome[personId] = emptyPlannedIncomeBlock();
      }
      if (m.plannedIncome[personId][field] !== value) {
        m.plannedIncome[personId][field] = value;
        updated.push(key);
      }
    }
    return updated;
  }

  /**
   * On first visit to an empty month: copy expected from nearest previous
   * month that has planned income / budgets. Existing months are not
   * overwritten, but missing plan categories are filled additively from
   * the previous expected month (heal). Expenses are never copied.
   *
   * opts.copyExpectedToNewMonths — default true
   * When false: legacy autoFill-only for categories marked autoFill
   *   (planned income is still copied for continuity with prior behavior).
   * Returns { copied, healed, sourceKey, mode: "all"|"autofill"|"heal"|null }
   */
  function ensureMonthExpected(months, key, people, opts) {
    opts = opts || {};
    var copyAll = opts.copyExpectedToNewMonths !== false;
    var categories = opts.categories || [];
    if (!months || !key) {
      return { copied: false, healed: false, sourceKey: null, mode: null };
    }
    if (!months[key]) {
      months[key] = {
        balances: {},
        budgets: {},
        budgetLines: {},
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: [] // always a fresh array — never share refs across months
      };
    }
    var m = months[key];
    ensureMonthShape(m, people);
    if (monthHasExpected(m)) {
      // Incomplete prior carry (e.g. Sep gained Div/Helse/Bil after Oct seeded):
      // fill missing plan from nearest previous — never touch expenses.
      var healEarly = healMonthExpectedFromPrevious(months, key, people, opts);
      var sugEarly = ensureSuggestedBalances(months, key, people, { plannedSpends: opts.plannedSpends || [], categories: opts.categories || categories || [] });
      return {
        copied: false,
        healed: !!(healEarly && healEarly.healed),
        sourceKey: (healEarly && healEarly.healed && healEarly.sourceKey) || null,
        mode: healEarly && healEarly.healed ? "heal" : null,
        suggestedBalances: !!(sugEarly && sugEarly.seeded)
      };
    }
    var srcKey = findNearestPreviousWithExpected(
      months,
      key,
      opts.maxLookback
    );
    if (!srcKey) {
      var sugNoSrc = ensureSuggestedBalances(months, key, people, { plannedSpends: opts.plannedSpends || [], categories: opts.categories || categories || [] });
      return {
        copied: false,
        healed: false,
        sourceKey: null,
        mode: null,
        suggestedBalances: !!(sugNoSrc && sugNoSrc.seeded)
      };
    }
    var src = months[srcKey];
    if (copyAll) {
      copyExpectedFrom(src, m, people, monthIndexFromKey(key));
      var sugAll = ensureSuggestedBalances(months, key, people, { plannedSpends: opts.plannedSpends || [], categories: opts.categories || categories || [] });
      return {
        copied: true,
        healed: false,
        sourceKey: srcKey,
        mode: "all",
        suggestedBalances: !!(sugAll && sugAll.seeded)
      };
    }
    // Legacy / setting OFF: only autoFill categories + planned income
    var any = false;
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived || !cat.autoFill) return;
      if (
        src.budgets &&
        budgetEntryHasValue(src.budgets[cat.id]) &&
        !budgetEntryHasValue(m.budgets[cat.id])
      ) {
        m.budgets[cat.id] = cloneBudgetEntry(src.budgets[cat.id]);
        any = true;
      }
      // Carry underlinjer for autofill cats when target has none
      if (src.budgetLines && src.budgetLines[cat.id]) {
        var srcOwners = src.budgetLines[cat.id];
        Object.keys(srcOwners).forEach(function (oid) {
          if (!hasBudgetLines(m, cat.id, oid) && Array.isArray(srcOwners[oid]) && srcOwners[oid].length) {
            if (!m.budgetLines) m.budgetLines = {};
            if (!m.budgetLines[cat.id]) m.budgetLines[cat.id] = {};
            m.budgetLines[cat.id][oid] = srcOwners[oid].map(normalizeBudgetLine).filter(Boolean);
            syncBudgetFromLines(m, cat.id, oid, monthIndexFromKey(key));
            any = true;
          }
        });
      }
    });
    ensureMonthShape(m, people);
    ensureMonthShape(src, people);
    var pi = src.plannedIncome || {};
    Object.keys(pi).forEach(function (pid) {
      if (!m.plannedIncome[pid]) {
        m.plannedIncome[pid] = emptyPlannedIncomeBlock();
      }
      PLANNED_INCOME_FIELDS.forEach(function (t) {
        if (
          pi[pid] &&
          pi[pid][t] != null &&
          pi[pid][t] !== "" &&
          (m.plannedIncome[pid][t] == null || m.plannedIncome[pid][t] === "")
        ) {
          m.plannedIncome[pid][t] = pi[pid][t];
          any = true;
        }
      });
    });
    var sugAf = ensureSuggestedBalances(months, key, people, { plannedSpends: opts.plannedSpends || [], categories: opts.categories || categories || [] });
    return {
      copied: any,
      healed: false,
      sourceKey: any ? srcKey : null,
      mode: any ? "autofill" : null,
      suggestedBalances: !!(sugAf && sugAf.seeded)
    };
  }

  function reassignPersonData(state, fromId, toOwner) {
    // toOwner: "felles" or another person id
    Object.keys(state.months || {}).forEach(function (key) {
      var m = state.months[key];
      (m.expenses || []).forEach(function (e) {
        if (e.owner === fromId) e.owner = toOwner;
      });
      (m.incomes || []).forEach(function (i) {
        if (i.person === fromId) i.person = toOwner === "felles" ? fromId : toOwner;
      });
      // Keep incomes on person if archiving — only reassign expenses to felles by default
      if (m.plannedIncome && m.plannedIncome[fromId] && toOwner !== "felles") {
        m.plannedIncome[toOwner] = m.plannedIncome[toOwner] || emptyPlannedIncomeBlock();
      }
    });
    (state.categories || []).forEach(function (c) {
      if (c.owner === fromId) c.owner = toOwner;
    });
    (state.savingsGoals || []).forEach(function (g) {
      if (g.person === fromId) {
        g.person = toOwner === "felles" ? "felles" : toOwner;
      }
    });
  }


  /**
   * Safe amount expression evaluator.
   * Allows only numbers, + - * / parentheses, and Norwegian comma decimals.
   * No arbitrary JS eval.
   * @returns {number|null}
   */
  function evalAmountExpression(input) {
    if (input == null) return null;
    var s = String(input).trim();
    if (!s) return null;
    s = s.replace(/\s+/g, "")
      .replace(/kr/gi, "")
      .replace(/×/g, "*")
      .replace(/·/g, "*")
      .replace(/÷/g, "/")
      .replace(/−/g, "-")
      .replace(/,/g, ".");
    // Reject anything outside whitelist (digits, ops, parens, dot)
    if (!/^[\d.+\-*/()]+$/.test(s)) return null;
    // Reject consecutive dots / empty
    if (s.indexOf("..") >= 0) return null;

    var i = 0;
    function peek() {
      return s.charAt(i) || "";
    }
    function consume() {
      return s.charAt(i++) || "";
    }

    function parseExpr() {
      var v = parseTerm();
      while (peek() === "+" || peek() === "-") {
        var op = consume();
        var r = parseTerm();
        v = op === "+" ? v + r : v - r;
      }
      return v;
    }

    function parseTerm() {
      var v = parseFactor();
      while (peek() === "*" || peek() === "/") {
        var op = consume();
        var r = parseFactor();
        if (op === "*") v = v * r;
        else {
          if (r === 0) throw new Error("div0");
          v = v / r;
        }
      }
      return v;
    }

    function parseFactor() {
      if (peek() === "+") {
        consume();
        return parseFactor();
      }
      if (peek() === "-") {
        consume();
        return -parseFactor();
      }
      if (peek() === "(") {
        consume();
        var v = parseExpr();
        if (peek() !== ")") throw new Error("paren");
        consume();
        return v;
      }
      return parseNumber();
    }

    function parseNumber() {
      var start = i;
      while (peek() >= "0" && peek() <= "9") consume();
      if (peek() === ".") {
        consume();
        while (peek() >= "0" && peek() <= "9") consume();
      }
      if (start === i) throw new Error("num");
      var n = Number(s.slice(start, i));
      if (!Number.isFinite(n)) throw new Error("num");
      return n;
    }

    try {
      var result = parseExpr();
      if (i !== s.length) return null;
      if (!Number.isFinite(result)) return null;
      // Normalize -0
      if (Object.is(result, -0)) result = 0;
      return result;
    } catch (e) {
      return null;
    }
  }



  /**
   * Sparemål (savings goals) — additive on state.savingsGoals[].
   * Progress model: `saved` is manual base ("Spart manuelt").
   * Optional spareinnskudd.goalId links deposits → effectiveSaved = saved + linked.
   * Status: aktiv | nådd | arkivert | forlatt. Auto-set nådd when effective ≥ target.
   * person: person id | "felles" | "samlet" (husstand).
   */
  var GOAL_STATUSES = ["aktiv", "nådd", "arkivert", "forlatt"];

  function normalizeGoalStatus(raw) {
    var s = String(raw || "").toLowerCase();
    if (s === "completed" || s === "reached" || s === "naadd") s = "nådd";
    if (s === "abandoned" || s === "dropped") s = "forlatt";
    if (s === "archived" || s === "archive") s = "arkivert";
    if (s === "active" || s === "aktiv") s = "aktiv";
    if (GOAL_STATUSES.indexOf(s) >= 0) return s;
    return "aktiv";
  }

  function normalizeSavingsGoal(g, people) {
    g = g || {};
    var person = mapLegacyOwner(g.person || "samlet");
    if (person !== "felles" && person !== "samlet" && !personById(people, person)) {
      person = "samlet";
    }
    var target = Number(g.target);
    var monthly = Number(g.monthly);
    var saved = Number(g.saved);
    var status = normalizeGoalStatus(g.status);
    // Legacy goals without status: if saved already ≥ target, treat as nådd
    if (!g.status && Number.isFinite(target) && target > 0 && Number.isFinite(saved) && saved >= target) {
      status = "nådd";
    }
    return {
      id: g.id || uid(),
      name: (g.name && String(g.name).trim()) || "Sparemål",
      target: Number.isFinite(target) && target >= 0 ? target : 0,
      monthly: Number.isFinite(monthly) && monthly >= 0 ? monthly : 0,
      saved: Number.isFinite(saved) && saved >= 0 ? saved : 0,
      person: person,
      status: status,
      statusAt: g.statusAt ? String(g.statusAt) : null
    };
  }

  function normalizeSavingsGoals(list, people) {
    if (!Array.isArray(list)) return [];
    return list.map(function (g) {
      return normalizeSavingsGoal(g, people);
    });
  }

  function clonePlain(obj) {
    try {
      return JSON.parse(JSON.stringify(obj));
    } catch (e) {
      return obj;
    }
  }

  function normalizeArchives(list) {
    if (!Array.isArray(list)) return [];
    return list
      .map(function (a) {
        if (!a || typeof a !== "object") return null;
        var year = Number(a.year);
        if (!Number.isFinite(year)) return null;
        return {
          year: year,
          archivedAt: a.archivedAt ? String(a.archivedAt) : null,
          rollup: a.rollup && typeof a.rollup === "object" ? a.rollup : null,
          sparingYear: Number.isFinite(Number(a.sparingYear)) ? Number(a.sparingYear) : 0,
          months: a.months && typeof a.months === "object" ? a.months : {}
        };
      })
      .filter(Boolean)
      .sort(function (x, y) {
        return x.year - y.year;
      });
  }

  function findArchive(archives, year) {
    var y = Number(year);
    var list = archives || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].year === y) return list[i];
    }
    return null;
  }

  function monthKeysForYear(year) {
    var y = Number(year);
    var keys = [];
    for (var month = 0; month < 12; month++) {
      keys.push(y + "-" + String(month + 1).padStart(2, "0"));
    }
    return keys;
  }

  function yearHasMonthData(months, year) {
    var keys = monthKeysForYear(year);
    var map = months || {};
    for (var i = 0; i < keys.length; i++) {
      var m = map[keys[i]];
      if (!m) continue;
      if ((m.expenses && m.expenses.length) || (m.incomes && m.incomes.length) || (m.savings && m.savings.length)) {
        return true;
      }
      if (m.budgets && Object.keys(m.budgets).length) return true;
      if (m.plannedIncome && Object.keys(m.plannedIncome).length) return true;
    }
    return false;
  }

  function listYearsWithData(months, archives) {
    var set = {};
    Object.keys(months || {}).forEach(function (k) {
      var y = parseInt(String(k).slice(0, 4), 10);
      if (Number.isFinite(y)) set[y] = true;
    });
    (archives || []).forEach(function (a) {
      if (a && Number.isFinite(a.year)) set[a.year] = true;
    });
    return Object.keys(set)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      });
  }

  /**
   * Build archive entry for a calendar year. Full months kept for restore/export;
   * rollup + sparingYear for year view without hot months[].
   */
  function buildYearArchive(months, year, people, categories, settings) {
    var y = Number(year);
    var roll = yearRollup(months, y, people, categories, settings || {});
    var map = months || {};
    var archivedMonths = {};
    var sparingYear = 0;
    monthKeysForYear(y).forEach(function (key) {
      if (map[key]) {
        archivedMonths[key] = clonePlain(map[key]);
        sparingYear += sumSavingsForMonth(map[key], null);
      }
    });
    // Enrich rollup months with savingsSum
    (roll.months || []).forEach(function (row) {
      row.savingsSum = sumSavingsForMonth(map[row.key], null);
    });
    roll.totals = roll.totals || {};
    roll.totals.savingsSum = sparingYear;
    return {
      year: y,
      archivedAt: new Date().toISOString(),
      rollup: roll,
      sparingYear: sparingYear,
      months: archivedMonths
    };
  }

  /**
   * Archive year: remove months from hot map, append/replace archives entry.
   * Returns { stateMonths, archives, entry } — does not mutate inputs.
   */
  function archiveYearInState(months, archives, year, people, categories, settings) {
    var entry = buildYearArchive(months, year, people, categories, settings);
    var nextMonths = Object.assign({}, months || {});
    monthKeysForYear(year).forEach(function (key) {
      delete nextMonths[key];
    });
    var nextArchives = (archives || []).filter(function (a) {
      return a && a.year !== entry.year;
    });
    nextArchives.push(entry);
    nextArchives.sort(function (a, b) {
      return a.year - b.year;
    });
    return { months: nextMonths, archives: nextArchives, entry: entry };
  }

  /**
   * Restore archived year back into months. Full months required.
   * Returns { months, archives } or null if missing.
   */
  function restoreYearFromArchive(months, archives, year) {
    var entry = findArchive(archives, year);
    if (!entry || !entry.months || !Object.keys(entry.months).length) return null;
    var nextMonths = Object.assign({}, months || {});
    Object.keys(entry.months).forEach(function (key) {
      nextMonths[key] = clonePlain(entry.months[key]);
    });
    var nextArchives = (archives || []).filter(function (a) {
      return a && a.year !== Number(year);
    });
    return { months: nextMonths, archives: nextArchives, entry: entry };
  }

  function exportArchiveJson(entry) {
    return JSON.stringify(
      {
        type: "familie-budsjett-year-archive",
        version: 1,
        exportedAt: new Date().toISOString(),
        archive: entry
      },
      null,
      2
    );
  }

  /** Years older than (currentYear - keepRecentYears) with hot data, not yet archived. */
  function yearsSuggestedForArchive(months, archives, currentYear, keepRecentYears) {
    var keep = keepRecentYears == null ? 3 : Number(keepRecentYears);
    if (!Number.isFinite(keep) || keep < 1) keep = 3;
    var cy = Number(currentYear);
    if (!Number.isFinite(cy)) cy = new Date().getFullYear();
    var cutoff = cy - keep;
    var out = [];
    listYearsWithData(months, []).forEach(function (y) {
      if (y <= cutoff && yearHasMonthData(months, y) && !findArchive(archives, y)) {
        out.push(y);
      }
    });
    return out;
  }

  /**
   * Sum spareinnskudd linked to a goal across hot months + archived months.
   */
  function sumLinkedDepositsForGoal(months, archives, goalId) {
    if (!goalId) return 0;
    var gid = String(goalId);
    var sum = 0;
    function addFromMap(map) {
      Object.keys(map || {}).forEach(function (k) {
        var m = map[k];
        if (!m || !Array.isArray(m.savings)) return;
        m.savings.forEach(function (s) {
          if (s && s.goalId && String(s.goalId) === gid) {
            var n = Number(s.amount);
            if (Number.isFinite(n)) sum += n;
          }
        });
      });
    }
    addFromMap(months);
    (archives || []).forEach(function (a) {
      if (a && a.months) addFromMap(a.months);
    });
    return sum;
  }

  function effectiveGoalSaved(goal, months, archives) {
    var base = Number(goal && goal.saved);
    if (!Number.isFinite(base) || base < 0) base = 0;
    return base + sumLinkedDepositsForGoal(months, archives, goal && goal.id);
  }

  /**
   * Auto-promote aktiv → nådd when effective saved ≥ target.
   * Does not demote manual arkivert/forlatt. Returns updated goal (may mutate copy).
   */
  function applyGoalAutoStatus(goal, months, archives, atIso) {
    var g = goal || {};
    var status = normalizeGoalStatus(g.status);
    var eff = effectiveGoalSaved(g, months, archives);
    var target = Number(g.target);
    if (!Number.isFinite(target)) target = 0;
    if (status === "aktiv" && target > 0 && eff >= target) {
      return Object.assign({}, g, {
        status: "nådd",
        statusAt: atIso || new Date().toISOString()
      });
    }
    return Object.assign({}, g, { status: status });
  }

  function refreshSavingsGoalsStatus(goals, months, archives, atIso) {
    if (!Array.isArray(goals)) return [];
    return goals.map(function (g) {
      return applyGoalAutoStatus(g, months, archives, atIso);
    });
  }

  /**
   * ETA for a sparemål from a reference date (defaults to today).
   * Uses effective saved when months/archives provided via opts.
   */
  function savingsGoalEta(goal, fromDate, opts) {
    opts = opts || {};
    var target = Number(goal && goal.target);
    var saved =
      opts.months || opts.archives
        ? effectiveGoalSaved(goal, opts.months, opts.archives)
        : Number(goal && goal.saved);
    var monthly = Number(goal && goal.monthly);
    if (!Number.isFinite(target)) target = 0;
    if (!Number.isFinite(saved)) saved = 0;
    if (!Number.isFinite(monthly)) monthly = 0;
    var statusField = normalizeGoalStatus(goal && goal.status);
    if (statusField === "nådd" || statusField === "arkivert") {
      return {
        status: "reached",
        monthsNeeded: 0,
        remaining: 0,
        year: null,
        month: null,
        label: statusField === "arkivert" ? "arkivert" : "nådd"
      };
    }
    if (statusField === "forlatt") {
      return {
        status: "abandoned",
        monthsNeeded: null,
        remaining: Math.max(0, target - saved),
        year: null,
        month: null,
        label: "forlatt"
      };
    }
    var remaining = target - saved;
    if (remaining <= 0) {
      return {
        status: "reached",
        monthsNeeded: 0,
        remaining: 0,
        year: null,
        month: null,
        label: "nådd"
      };
    }
    if (monthly <= 0) {
      return {
        status: "need_monthly",
        monthsNeeded: null,
        remaining: remaining,
        year: null,
        month: null,
        label: "Sett månedlig beløp"
      };
    }
    var monthsNeeded = Math.ceil(remaining / monthly);
    var d = fromDate instanceof Date ? fromDate : new Date();
    if (Number.isNaN(d.getTime())) d = new Date();
    var total = d.getFullYear() * 12 + d.getMonth() + monthsNeeded;
    var year = Math.floor(total / 12);
    var month = total % 12;
    var shortNames = [
      "jan", "feb", "mar", "apr", "mai", "jun",
      "jul", "aug", "sep", "okt", "nov", "des"
    ];
    return {
      status: "eta",
      monthsNeeded: monthsNeeded,
      remaining: remaining,
      year: year,
      month: month,
      label: "ca. " + shortNames[month] + " " + year
    };
  }

  function savingsGoalProgress(goal, opts) {
    opts = opts || {};
    var target = Number(goal && goal.target);
    var saved =
      opts.months || opts.archives
        ? effectiveGoalSaved(goal, opts.months, opts.archives)
        : Number(goal && goal.saved);
    if (!Number.isFinite(target)) target = 0;
    if (!Number.isFinite(saved)) saved = 0;
    var pct = target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : saved > 0 ? 100 : 0;
    return {
      target: target,
      saved: saved,
      baseSaved: Number(goal && goal.saved) || 0,
      linkedSaved: Math.max(0, saved - (Number(goal && goal.saved) || 0)),
      remaining: Math.max(0, target - saved),
      pct: pct,
      reached: target > 0 ? saved >= target : saved > 0,
      status: normalizeGoalStatus(goal && goal.status)
    };
  }

  /**
   * Sum logged spareinnskudd (m.savings) for one month, optional person filter.
   * personId null/undefined/"samlet" = all people.
   */
  function sumSavingsForMonth(m, personId) {
    if (!m || !Array.isArray(m.savings)) return 0;
    return sumAmounts(m.savings, function (s) {
      if (personId == null || personId === "" || personId === "samlet") return true;
      return s.person === personId;
    });
  }

  /**
   * Sparing overview metrics (no tips/benchmarks).
   * - naa: current spare saldo from balances (manual)
   * - denneManeden: sum of logged savings in the viewed month
   * - iAar: sum of logged savings in the viewed calendar year
   * - totalt: sum of logged savings across all stored months (+ archives if provided)
   */
  function sparingStats(months, year, monthIndex, people, archives) {
    var y = Number(year);
    var mi = Number(monthIndex);
    if (!Number.isFinite(mi) || mi < 0) mi = 0;
    if (mi > 11) mi = 11;
    var key = y + "-" + String(mi + 1).padStart(2, "0");
    var monthsMap = months || {};
    var m = monthsMap[key] || {
      balances: {},
      savings: []
    };
    ensureBalancesShape(m, people);
    var active = activePeople(people);
    var byPerson = {};
    var samlet = {
      naa: 0,
      hasNaa: false,
      denneManeden: 0,
      planlagt: 0,
      iAar: 0,
      totalt: 0
    };

    function monthFromHotOrArchive(k) {
      if (monthsMap[k]) return monthsMap[k];
      var yy = parseInt(String(k).slice(0, 4), 10);
      var arch = findArchive(archives, yy);
      if (arch && arch.months && arch.months[k]) return arch.months[k];
      return null;
    }

    function sumYearForPerson(personId) {
      var sum = 0;
      for (var month = 0; month < 12; month++) {
        var k = y + "-" + String(month + 1).padStart(2, "0");
        sum += sumSavingsForMonth(monthFromHotOrArchive(k), personId);
      }
      // Prefer archive sparingYear for samlet when fully archived and no hot data
      return sum;
    }

    function sumAllForPerson(personId) {
      var sum = 0;
      var seen = {};
      Object.keys(monthsMap).forEach(function (k) {
        seen[k] = true;
        sum += sumSavingsForMonth(monthsMap[k], personId);
      });
      (archives || []).forEach(function (a) {
        if (!a || !a.months) return;
        Object.keys(a.months).forEach(function (k) {
          if (seen[k]) return;
          sum += sumSavingsForMonth(a.months[k], personId);
        });
      });
      return sum;
    }

    active.forEach(function (p) {
      var bal = (m.balances && m.balances[p.id]) || {};
      var spare = bal.spare == null || bal.spare === "" ? null : Number(bal.spare);
      var hasNaa = spare != null && !Number.isNaN(spare);
      var naa = hasNaa ? spare : 0;
      var denne = sumSavingsForMonth(m, p.id);
      var iAar = sumYearForPerson(p.id);
      var totalt = sumAllForPerson(p.id);
      var planlagt = plannedSparingFor(m, p.id);
      byPerson[p.id] = {
        naa: naa,
        hasNaa: hasNaa,
        denneManeden: denne,
        planlagt: planlagt,
        iAar: iAar,
        totalt: totalt
      };
      if (hasNaa) {
        samlet.naa += naa;
        samlet.hasNaa = true;
      }
      samlet.denneManeden += denne;
      samlet.planlagt += planlagt;
      samlet.iAar += iAar;
      samlet.totalt += totalt;
    });

    return {
      year: y,
      month: mi,
      key: key,
      byPerson: byPerson,
      samlet: samlet
    };
  }

  /**
   * Year overview: planInn / planUt / actualUt / tilOvers per month + totals.
   * tilOvers = planInn − planUt (planned remainder).
   * If months missing but archive exists, returns archive.rollup (with savingsSum).
   */
  function yearRollup(months, year, people, categories, settings, archives) {
    var y = Number(year);
    var hasHot = yearHasMonthData(months, y);
    if (!hasHot && archives) {
      var arch = findArchive(archives, y);
      if (arch && arch.rollup) {
        return clonePlain(arch.rollup);
      }
    }
    var rows = [];
    var totals = { planInn: 0, planUt: 0, actualUt: 0, tilOvers: 0, actualInn: 0, savingsSum: 0 };
    for (var month = 0; month < 12; month++) {
      var key = y + "-" + String(month + 1).padStart(2, "0");
      var m = (months && months[key]) || {
        balances: {},
        budgets: {},
        budgetLines: {},
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: []
      };
      var c = calcFamily(m, people, categories, settings, month);
      var planInn = c.planInn || 0;
      var planUt = c.plannedTotal || 0;
      var actualUt = c.samletUtgifter || 0;
      var actualInn = c.samletInntekt || 0;
      var tilOvers = planInn - planUt;
      var savingsSum = sumSavingsForMonth(m, null);
      rows.push({
        month: month,
        key: key,
        planInn: planInn,
        planUt: planUt,
        actualUt: actualUt,
        actualInn: actualInn,
        tilOvers: tilOvers,
        savingsSum: savingsSum
      });
      totals.planInn += planInn;
      totals.planUt += planUt;
      totals.actualUt += actualUt;
      totals.actualInn += actualInn;
      totals.tilOvers += tilOvers;
      totals.savingsSum += savingsSum;
    }
    return { year: y, months: rows, totals: totals };
  }

  /**
   * Multi-year trend cards: one rollup summary per year (hot or archive).
   */
  function multiYearSummaries(months, archives, people, categories, settings, yearList) {
    var years = yearList && yearList.length ? yearList.slice() : listYearsWithData(months, archives);
    years.sort(function (a, b) {
      return a - b;
    });
    return years.map(function (y) {
      var roll = yearRollup(months, y, people, categories, settings || {}, archives);
      var t = roll.totals || {};
      var archived = !!findArchive(archives, y) && !yearHasMonthData(months, y);
      return {
        year: y,
        archived: archived,
        planInn: t.planInn || 0,
        planUt: t.planUt || 0,
        actualUt: t.actualUt || 0,
        actualInn: t.actualInn || 0,
        tilOvers: t.tilOvers || 0,
        savingsSum: t.savingsSum != null ? t.savingsSum : 0
      };
    });
  }


  /** True if expense is marked as one-off (engangsutgift). Additive field. */
  function expenseIsOneOff(e) {
    return !!(e && (e.oneOff === true || e.engangs === true));
  }

  /**
   * Sum expenses for a month. opts.excludeOneOff skips engangsutgift.
   */
  function sumExpenses(m, opts) {
    opts = opts || {};
    var list = (m && m.expenses) || [];
    var sum = 0;
    for (var i = 0; i < list.length; i++) {
      var e = list[i];
      if (!e) continue;
      if (opts.excludeOneOff && expenseIsOneOff(e)) continue;
      sum += Number(e.amount) || 0;
    }
    return sum;
  }

  /**
   * Income-based felles split from planned lønn+ekstra in a month.
   * Falls back to equal if no income.
   */
  function incomeBasedSplit(m, people) {
    var active = activePeople(people);
    var out = {};
    if (!active.length) return out;
    var weights = {};
    var total = 0;
    active.forEach(function (p) {
      var w = plannedIncomeFor(m, p.id, "lønn") + plannedIncomeFor(m, p.id, "ekstra");
      if (!Number.isFinite(w) || w < 0) w = 0;
      weights[p.id] = w;
      total += w;
    });
    if (total <= 0) return equalSplit(people);
    return normalizeSplitTo100(weights, people);
  }

  /** Apply one split map to all active felles categories. */
  function applySplitToFellesCategories(categories, people, split) {
    var cleaned = normalizeSplitTo100(split || equalSplit(people), people);
    (categories || []).forEach(function (cat) {
      if (!cat || cat.archived || cat.owner !== "felles") return;
      setCategorySplit(cat, cleaned, people);
    });
    return cleaned;
  }

  function monthKeyFromParts(year, monthIndex) {
    return year + "-" + String(monthIndex + 1).padStart(2, "0");
  }

  function monthHasActivity(m) {
    if (!m) return false;
    if ((m.expenses && m.expenses.length) || (m.incomes && m.incomes.length) || (m.savings && m.savings.length)) {
      return true;
    }
    return false;
  }

  /**
   * Detect skipped months between first data and throughYear/throughMonthIndex.
   * Current month is never flagged. lightUse / missedHandled skip the prompt.
   */
  function detectMissedMonths(months, throughYear, throughMonthIndex) {
    var map = months || {};
    var keys = Object.keys(map).sort();
    if (!keys.length) return [];
    var first = keys[0];
    var fy = parseInt(first.slice(0, 4), 10);
    var fm = parseInt(first.slice(5, 7), 10) - 1;
    if (!Number.isFinite(fy) || !Number.isFinite(fm)) return [];
    var ty = Number(throughYear);
    var tm = Number(throughMonthIndex);
    if (!Number.isFinite(ty) || !Number.isFinite(tm)) return [];
    var missed = [];
    var y = fy;
    var m = fm;
    var seenActivity = false;
    while (y < ty || (y === ty && m <= tm)) {
      var key = monthKeyFromParts(y, m);
      var mm = map[key];
      var active = monthHasActivity(mm);
      if (active) seenActivity = true;
      var isCurrent = y === ty && m === tm;
      if (seenActivity && !active && !isCurrent) {
        var light = !!(mm && (mm.lightUse || mm.missedHandled));
        if (!light) {
          missed.push({ key: key, year: y, month: m });
        }
      }
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      if (missed.length >= 6) break;
    }
    return missed;
  }

  /** True if string looks like an arithmetic expression (not a plain number). */
  function looksLikeAmountExpression(input) {
    if (input == null) return false;
    var s = String(input);
    return /[+\-*/×÷()]/.test(s) || /[−]/.test(s);
  }


  /**
   * Parse bruk/spare amount; empty → null.
   */
  function parseBalanceAmount(v) {
    if (v == null || v === "") return null;
    var n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  /** Oppgitt − forventet (null if either missing). */
  function balanceVariance(oppgitt, forventet) {
    if (oppgitt == null || forventet == null) return null;
    return oppgitt - forventet;
  }

  /**
   * Forventet bruk nå = forrige måneds bruk + effektiv cashflow.
   * Effektiv cashflow = tilOvers (logget inn − sparing − ut) − autoSpendExtra
   * (Fast auto-tell som har forlatt konto men ikke er logget).
   * Formel: prev.bruk + tilOvers − autoSpendExtra
   */
  function expectedBrukFromPrev(prevBruk, tilOvers, autoSpendExtra) {
    if (prevBruk == null) return null;
    var t =
      tilOvers == null || !Number.isFinite(Number(tilOvers))
        ? 0
        : Number(tilOvers);
    var auto =
      autoSpendExtra == null || !Number.isFinite(Number(autoSpendExtra))
        ? 0
        : Number(autoSpendExtra);
    return prevBruk + t - auto;
  }

  /** Etter lønn (plan) = bruk + planInn − planUt. */
  function etterLonnFromBruk(bruk, planInn, planUt) {
    if (bruk == null) return null;
    return bruk + (Number(planInn) || 0) - (Number(planUt) || 0);
  }

  /**
   * Varians-meta for UI: mer/mindre/ok.
   * Toleranse 0.5 kr (øre-støy).
   */
  function varianceMeta(diff) {
    if (diff == null || !Number.isFinite(Number(diff))) return null;
    var d = Number(diff);
    if (Math.abs(d) < 0.5) {
      return { kind: "ok", amount: 0, abs: 0 };
    }
    if (d > 0) {
      return { kind: "more", amount: d, abs: d };
    }
    return { kind: "less", amount: d, abs: -d };
  }

  /**
   * True if any income/expense/saving in the month has a date stamp.
   */
  function monthHasDatedCashflow(m) {
    if (!m) return false;
    var lists = [m.incomes, m.expenses, m.savings];
    for (var i = 0; i < lists.length; i++) {
      var arr = lists[i];
      if (!arr || !arr.length) continue;
      for (var j = 0; j < arr.length; j++) {
        if (arr[j] && arr[j].date) return true;
      }
    }
    return false;
  }

  /**
   * Include entry in dated cashflow: undated always counts; dated only if <= asOf.
   */
  function cashflowEntryOnOrBefore(entry, asOf) {
    if (!asOf) return true;
    if (!entry || !entry.date) return true;
    return String(entry.date) <= String(asOf);
  }

  /**
   * Per-person cashflow parts with optional date filter and/or excluding lønn+ekstra.
   * Same share rules as calcPerson.
   *
   * opts:
   *   asOf: 'YYYY-MM-DD'|null — when filterDates, keep entries with date<=asOf (undated kept)
   *   filterDates: bool
   *   excludeSalaryIncome: bool — zero out logged lønn + ekstra (før lønn mode)
   */
  function personCashflowParts(m, personId, people, categories, opts) {
    opts = opts || {};
    var asOf = normalizeBalanceAsOf(opts.asOf);
    var filterDates = !!opts.filterDates && !!asOf;
    var excludeSalary = !!opts.excludeSalaryIncome;

    function keep(entry) {
      return !filterDates || cashflowEntryOnOrBefore(entry, asOf);
    }

    var lønn = sumAmounts(m.incomes, function (i) {
      return i.person === personId && i.type === "lønn" && keep(i);
    });
    var ekstra = sumAmounts(m.incomes, function (i) {
      return i.person === personId && i.type === "ekstra" && keep(i);
    });
    if (excludeSalary) {
      lønn = 0;
      ekstra = 0;
    }
    var sparing = sumAmounts(m.savings, function (s) {
      return s.person === personId && keep(s);
    });
    var ownExp = sumAmounts(m.expenses, function (e) {
      return e.owner === personId && keep(e);
    });
    // Felles share: filter expense list when dating
    var fellesPart = 0;
    if (filterDates) {
      var active = activePeople(people);
      var n = active.length || 1;
      (m.expenses || []).forEach(function (e) {
        if (!e || e.owner !== "felles" || !keep(e)) return;
        var amt = Number(e.amount) || 0;
        var cat = null;
        if (e.categoryId && categories) {
          for (var ci = 0; ci < categories.length; ci++) {
            if (categories[ci].id === e.categoryId) {
              cat = categories[ci];
              break;
            }
          }
        }
        if (cat) {
          fellesPart += fellesShare(cat, personId, people, amt);
        } else {
          fellesPart += amt / n;
        }
      });
    } else {
      fellesPart = fellesExpenseShareForPerson(m, personId, people, categories);
    }
    var utgifter = ownExp + fellesPart;
    var tilOvers = lønn + ekstra - sparing - utgifter;
    return {
      lønn: lønn,
      ekstra: ekstra,
      sparing: sparing,
      utgifter: utgifter,
      ownExp: ownExp,
      fellesShare: fellesPart,
      tilOvers: tilOvers,
      filterDates: filterDates,
      excludeSalaryIncome: excludeSalary,
      asOf: asOf
    };
  }

  /**
   * Resolve forventet cashflow for a balance timing mode.
   *
   * Rules (documented):
   * - after_salary: prev.bruk + full tilOvers − autoSpendExtra
   *   (current reconcile; logged lønn/ekstra count).
   * - before_salary: same but logged lønn + ekstra are excluded from cashflow
   *   (as if this month’s salary/extra has not landed). Planned income was never
   *   in tilOvers. Sparing + utgifter + auto Fast still count.
   * - dated: if the month has any dated cashflow, use entries with date<=asOf
   *   (undated kept); else full-month cashflow like after_salary. asOf is always
   *   kept for display. auto Fast still full month.
   */
  function expectedCashflowForBalanceWhen(m, personId, people, categories, when, asOf) {
    var mode = normalizeBalanceWhen(when);
    var asOfN = normalizeBalanceAsOf(asOf);
    var opts = { asOf: null, filterDates: false, excludeSalaryIncome: false };
    var source = "prev+cashflow+autoFast";

    if (mode === BALANCE_WHEN_BEFORE) {
      opts.excludeSalaryIncome = true;
      source = "prev+cashflowBeforeSalary+autoFast";
    } else if (mode === BALANCE_WHEN_DATED) {
      if (asOfN && monthHasDatedCashflow(m)) {
        opts.asOf = asOfN;
        opts.filterDates = true;
        source = "prev+cashflowToDate+autoFast";
      } else {
        source = "prev+cashflow+autoFast"; // no dates → etter lønn semantics
      }
    }

    var parts = personCashflowParts(m, personId, people, categories, opts);
    return {
      when: mode,
      asOf: mode === BALANCE_WHEN_DATED ? asOfN : null,
      tilOvers: parts.tilOvers,
      parts: parts,
      source: source,
      filteredByDate: !!opts.filterDates
    };
  }

  /** Short nb label when balance is a suggested seed (rolling carry). */
  function balanceSuggestedLabel() {
    return "Automatisk rullerende pot";
  }

  /** Hint under På konto when balances are suggested (unconfirmed). */
  function balanceSuggestedHint() {
    return "På konto er en korreksjon for denne måneden — nullstilles / gjelder ikke automatisk neste mnd. Trygg ruller: forrige + (lønn − utgifter).";
  }

  /** Short nb label for mode/date badge. */
  function balanceWhenLabel(when, asOf, suggested) {
    if (suggested) return balanceSuggestedLabel();
    var mode = normalizeBalanceWhen(when);
    if (mode === BALANCE_WHEN_BEFORE) return "Oppgitt før lønn";
    if (mode === BALANCE_WHEN_DATED) {
      var d = normalizeBalanceAsOf(asOf);
      if (!d) return "Oppgitt på dato";
      var parts = d.split("-");
      if (parts.length === 3) {
        var months = [
          "jan",
          "feb",
          "mar",
          "apr",
          "mai",
          "jun",
          "jul",
          "aug",
          "sep",
          "okt",
          "nov",
          "des"
        ];
        var mi = Number(parts[1]) - 1;
        var day = String(Number(parts[2]));
        var mon = months[mi] || parts[1];
        return "Oppgitt " + day + ". " + mon;
      }
      return "Oppgitt " + d;
    }
    return "Oppgitt etter lønn";
  }


  /**
   * Dual saldo-mode Trygg å bruke parts for UI transparency.
   * På konto nå already reflects paid Fast — do NOT re-subtract autoSpendExtra.
   * Primary "nå": bruk − futureReserve − spendBuffer
   *   (do NOT subtract remaining variable budgets).
   * Secondary "hvis hele budsjettet brukes":
   *   bruk − remainingBudgetAll − futureReserve − spendBuffer
   *   (remAll uses effectiveActual so Fast rem≈0; still no autoSpendExtra).
   * restBudget = remainingBudgetAll (variable rem; Fast already in bank).
   * autoSpendExtra is returned for transparency / cashflow paths only.
   * safeToSpend / raw follow primary "nå".
   */

  /**
   * Rough estimate when current month lacks bruk: prev month bruk minus
   * planned spends reserved for the viewed month (does NOT write balances).
   * Returns null if prevBruk missing.
   */
  function estimateSafeFromPrevBruk(prevBruk, plannedReserve) {
    if (prevBruk == null || prevBruk === "") return null;
    var b = Number(prevBruk);
    if (!Number.isFinite(b)) return null;
    var r =
      plannedReserve == null || plannedReserve === ""
        ? 0
        : Number(plannedReserve);
    if (!Number.isFinite(r)) r = 0;
    return b - r;
  }

  function safeToSpendSaldoBreakdown(parts) {
    var src = parts && typeof parts === "object" ? parts : {};
    var bruk = Number(src.bruk);
    if (!Number.isFinite(bruk)) bruk = 0;
    var rem = Number(src.remainingBudgetAll);
    if (!Number.isFinite(rem)) rem = 0;
    var remVar = Number(src.remainingVariableBudgets);
    if (!Number.isFinite(remVar)) remVar = rem;
    var auto = Number(src.autoSpendExtra);
    if (!Number.isFinite(auto)) auto = 0;
    var future = Number(src.futureReserve);
    if (!Number.isFinite(future)) future = 0;
    var buffer = Number(src.spendBuffer);
    if (!Number.isFinite(buffer)) buffer = 0;
    if (rem < 0) rem = 0;
    if (remVar < 0) remVar = 0;
    if (auto < 0) auto = 0;
    if (future < 0) future = 0;
    if (buffer < 0) buffer = 0;
    var restBudget = rem;
    var nowRaw = bruk - future - buffer;
    var ifUsedRaw = bruk - rem - future - buffer;
    return {
      bruk: bruk,
      remainingBudgetAll: rem,
      remainingVariableBudgets: remVar,
      autoSpendExtra: auto,
      restBudget: restBudget,
      futureReserve: future,
      spendBuffer: buffer,
      raw: nowRaw,
      safeToSpend: nowRaw,
      safeToSpendNowRaw: nowRaw,
      safeToSpendNow: nowRaw,
      safeToSpendIfBudgetUsedRaw: ifUsedRaw,
      safeToSpendIfBudgetUsed: ifUsedRaw,
      // Legacy aliases for conservative line
      conservativeRaw: ifUsedRaw,
      safeToSpendSaldoRaw: ifUsedRaw,
      safeToSpendSaldo: ifUsedRaw
    };
  }

  /**
   * «På konto nå» reconciliation per person + samlet.
   * prevBalances: previous month balances map { [pid]: { bruk, spare } } or null.
   * Forventet respects balances[pid].when / asOf (see expectedCashflowForBalanceWhen).
   * Independent of oppgitt.
   */
  function reconcilePaKonto(m, people, categories, monthIndex, prevBalances) {
    var active = activePeople(people);
    ensureMonthShape(m, people);
    var prev = prevBalances && typeof prevBalances === "object" ? prevBalances : null;
    var byPerson = {};
    var totalOppgitt = 0;
    var totalForventet = 0;
    var totalEtterLonn = 0;
    var totalDiff = 0;
    var hasOppgitt = false;
    var hasForventet = false;
    var hasEtterLonn = false;
    var hasDiff = false;
    var nOppgitt = 0;
    var nForventet = 0;

    active.forEach(function (p) {
      var bal = (m.balances && m.balances[p.id]) || {};
      var when = normalizeBalanceWhen(bal.when);
      var asOf = normalizeBalanceAsOf(bal.asOf);
      var oppgitt = parseBalanceAmount(bal.bruk);
      var spare = parseBalanceAmount(bal.spare);
      var cp = calcPerson(m, p.id, people, categories);
      var planUt = plannedUtForPerson(m, p.id, categories, people, monthIndex);
      var planInn = cp.planInn || 0;
      var prevBal = prev && prev[p.id] ? prev[p.id] : null;
      var prevBruk = prevBal ? parseBalanceAmount(prevBal.bruk) : null;
      var autoExtra = autoSpendExtraForPerson(
        m,
        p.id,
        people,
        categories,
        monthIndex
      );
      var cf = expectedCashflowForBalanceWhen(
        m,
        p.id,
        people,
        categories,
        when,
        asOf
      );
      var forventet = expectedBrukFromPrev(prevBruk, cf.tilOvers, autoExtra);
      var etterLonn = etterLonnFromBruk(oppgitt, planInn, planUt);
      var differanse = balanceVariance(oppgitt, forventet);
      var source = forventet != null ? cf.source : null;

      var parts = cf.parts || {};
      var inn = (Number(parts.lønn) || 0) + (Number(parts.ekstra) || 0);
      byPerson[p.id] = {
        personId: p.id,
        name: p.name,
        oppgitt: oppgitt,
        spare: spare,
        when: when,
        asOf: when === BALANCE_WHEN_DATED ? asOf : null,
        whenLabel: balanceWhenLabel(when, asOf),
        forventet: forventet,
        differanse: differanse,
        variance: varianceMeta(differanse),
        etterLonn: etterLonn,
        planInn: planInn,
        planUt: planUt,
        tilOvers: cp.tilOvers,
        tilOversForMode: cf.tilOvers,
        autoSpendExtra: autoExtra,
        effectiveTilOvers: (cf.tilOvers || 0) - (autoExtra || 0),
        prevBruk: prevBruk,
        source: source,
        filteredByDate: cf.filteredByDate,
        // Breakdown for UI audit (mode-aware cashflow parts)
        parts: parts,
        inn: inn,
        utgifter: Number(parts.utgifter) || 0,
        sparing: Number(parts.sparing) || 0,
        ownExp: Number(parts.ownExp) || 0,
        fellesShare: Number(parts.fellesShare) || 0,
        excludeSalaryIncome: !!parts.excludeSalaryIncome
      };

      if (oppgitt != null) {
        hasOppgitt = true;
        nOppgitt += 1;
        totalOppgitt += oppgitt;
      }
      if (forventet != null) {
        hasForventet = true;
        nForventet += 1;
        totalForventet += forventet;
      }
      if (etterLonn != null) {
        hasEtterLonn = true;
        totalEtterLonn += etterLonn;
      }
      if (differanse != null) {
        hasDiff = true;
        totalDiff += differanse;
      }
    });

    return {
      byPerson: byPerson,
      totalOppgitt: hasOppgitt ? totalOppgitt : null,
      totalForventet: hasForventet ? totalForventet : null,
      totalDifferanse: hasDiff ? totalDiff : null,
      totalVariance: varianceMeta(hasDiff ? totalDiff : null),
      totalEtterLonn: hasEtterLonn ? totalEtterLonn : null,
      hasOppgitt: hasOppgitt,
      hasForventet: hasForventet,
      hasDifferanse: hasDiff,
      counts: { oppgitt: nOppgitt, forventet: nForventet, people: active.length }
    };
  }

  return {
    ID_A: ID_A,
    ID_B: ID_B,
    uid: uid,
    defaultPeople: defaultPeople,
    activePeople: activePeople,
    personById: personById,
    nameOf: nameOf,
    mapLegacyOwner: mapLegacyOwner,
    equalSplit: equalSplit,
    getCategorySplit: getCategorySplit,
    fellesSharePercent: fellesSharePercent,
    fellesShare: fellesShare,
    setCategorySplit: setCategorySplit,
    normalizeSplitTo100: normalizeSplitTo100,
    ensureCategorySplits: ensureCategorySplits,
    isEqualSplit: isEqualSplit,
    splitSum: splitSum,
    ensureMonthShape: ensureMonthShape,
    ensureBalancesShape: ensureBalancesShape,
    monthHasBalances: monthHasBalances,
    monthHasSuggestedBalances: monthHasSuggestedBalances,
    copyBalancesFrom: copyBalancesFrom,
    clearAccidentalBalanceCarry: clearAccidentalBalanceCarry,
    ensureSuggestedBalances: ensureSuggestedBalances,
    computeRollingSuggestedForPerson: computeRollingSuggestedForPerson,
    resolveDisplayBrukFallback: resolveDisplayBrukFallback,
    shouldUseProjectedPotForOversikt: shouldUseProjectedPotForOversikt,
    projectPotFollowBudget: projectPotFollowBudget,
    plannedFixedBudgetTotal: plannedFixedBudgetTotal,
    plannedVariableBudgetTotal: plannedVariableBudgetTotal,
    computeCarryEndBrukForPerson: computeCarryEndBrukForPerson,
    computeMonthCarryPot: computeMonthCarryPot,
    refreshMonthCarryPot: refreshMonthCarryPot,
    findNearestPreviousWithCarrySource: findNearestPreviousWithCarrySource,
    monthHasCarrySource: monthHasCarrySource,
    openPlannedSpendDeductionForPerson: openPlannedSpendDeductionForPerson,
    openPlannedSpendDeductionForPersonRange: openPlannedSpendDeductionForPersonRange,
    computeSuggestedBrukFromPrev: computeSuggestedBrukFromPrev,
    clearSuggestedBalanceFlag: clearSuggestedBalanceFlag,
    markPlannedSpendsReflectedInBalance: markPlannedSpendsReflectedInBalance,
    monthHasPlanSeededBalances: monthHasPlanSeededBalances,
    brukReflectsSameMonthPlans: brukReflectsSameMonthPlans,
    healBrukReflectedSameMonthPlans: healBrukReflectedSameMonthPlans,
    balanceSuggestedLabel: balanceSuggestedLabel,
    balanceSuggestedHint: balanceSuggestedHint,
    findNearestPreviousWithBalances: findNearestPreviousWithBalances,
    findNearestPreviousWithConfirmedBalances: findNearestPreviousWithConfirmedBalances,
    migrateState: migrateState,
    plannedIncomeFor: plannedIncomeFor,
    plannedSparingFor: plannedSparingFor,
    plannedSparingTotal: plannedSparingTotal,
    emptyPlannedIncomeBlock: emptyPlannedIncomeBlock,
    PLANNED_INCOME_FIELDS: PLANNED_INCOME_FIELDS,
    budgetFor: budgetFor,
    budgetForOwner: budgetForOwner,
    setBudgetForOwner: setBudgetForOwner,
    cloneBudgetEntry: cloneBudgetEntry,
    budgetEntryHasValue: budgetEntryHasValue,
    getBudgetLines: getBudgetLines,
    hasBudgetLines: hasBudgetLines,
    sumBudgetLines: sumBudgetLines,
    sumBudgetLinesRaw: sumBudgetLinesRaw,
    lineMonthlyContribution: lineMonthlyContribution,
    monthIndexFromKey: monthIndexFromKey,
    normalizeBudgetLine: normalizeBudgetLine,
    setBudgetLines: setBudgetLines,
    syncBudgetFromLines: syncBudgetFromLines,
    cloneBudgetLinesTree: cloneBudgetLinesTree,
    copyBudgetLinesFrom: copyBudgetLinesFrom,
    yearRollup: yearRollup,
    sumSavingsForMonth: sumSavingsForMonth,
    sparingStats: sparingStats,
    normalizeSavingsGoal: normalizeSavingsGoal,
    normalizeSavingsGoals: normalizeSavingsGoals,
    normalizeGoalStatus: normalizeGoalStatus,
    normalizeArchives: normalizeArchives,
    findArchive: findArchive,
    yearHasMonthData: yearHasMonthData,
    listYearsWithData: listYearsWithData,
    buildYearArchive: buildYearArchive,
    archiveYearInState: archiveYearInState,
    restoreYearFromArchive: restoreYearFromArchive,
    exportArchiveJson: exportArchiveJson,
    yearsSuggestedForArchive: yearsSuggestedForArchive,
    sumLinkedDepositsForGoal: sumLinkedDepositsForGoal,
    effectiveGoalSaved: effectiveGoalSaved,
    applyGoalAutoStatus: applyGoalAutoStatus,
    refreshSavingsGoalsStatus: refreshSavingsGoalsStatus,
    multiYearSummaries: multiYearSummaries,
    savingsGoalEta: savingsGoalEta,
    savingsGoalProgress: savingsGoalProgress,
    GOAL_STATUSES: GOAL_STATUSES,
    actualForCategory: actualForCategory,
    actualForCategoryOwner: actualForCategoryOwner,
    categoryAutoSpends: categoryAutoSpends,
    effectiveActualForCategory: effectiveActualForCategory,
    effectiveActualForCategoryOwner: effectiveActualForCategoryOwner,
    autoSpendExtraForCategory: autoSpendExtraForCategory,
    autoSpendExtraTotal: autoSpendExtraTotal,
    autoSpendExtraForPerson: autoSpendExtraForPerson,
    normalizePlannedSpend: normalizePlannedSpend,
    normalizePlannedSpends: normalizePlannedSpends,
    plannedSpendsForMonth: plannedSpendsForMonth,
    plannedSpendsFromMonth: plannedSpendsFromMonth,
    plannedSpendsAfterMonth: plannedSpendsAfterMonth,
    plannedSpendReserve: plannedSpendReserve,
    plannedSpendReserveForPerson: plannedSpendReserveForPerson,
    calcPerson: calcPerson,
    remainingBudgetForPerson: remainingBudgetForPerson,
    plannedUtForPerson: plannedUtForPerson,
    plannedFixedBudgetForPerson: plannedFixedBudgetForPerson,
    plannedVariableBudgetForPerson: plannedVariableBudgetForPerson,
    plannedIncomeForPerson: plannedIncomeForPerson,
    plannedIncomeTotal: plannedIncomeTotal,
    plannedUtFelles: plannedUtFelles,
    calcFamily: calcFamily,
    personHasData: personHasData,
    reassignPersonData: reassignPersonData,
    monthHasExpected: monthHasExpected,
    shiftMonthKey: shiftMonthKey,
    monthsBetweenKeys: monthsBetweenKeys,
    findNearestPreviousWithExpected: findNearestPreviousWithExpected,
    copyExpectedFrom: copyExpectedFrom,
    fillMissingExpectedFrom: fillMissingExpectedFrom,
    rebaseExpectedFrom: rebaseExpectedFrom,
    rebaseForwardMonthsFrom: rebaseForwardMonthsFrom,
    propagateBudgetSlotForward: propagateBudgetSlotForward,
    propagatePlannedIncomeForward: propagatePlannedIncomeForward,
    isStaleIncompleteExpected: isStaleIncompleteExpected,
    healMonthExpectedFromPrevious: healMonthExpectedFromPrevious,
    healAllMonthsExpected: healAllMonthsExpected,
    ensureMonthExpected: ensureMonthExpected,
    evalAmountExpression: evalAmountExpression,
    looksLikeAmountExpression: looksLikeAmountExpression,
    expenseIsOneOff: expenseIsOneOff,
    sumExpenses: sumExpenses,
    incomeBasedSplit: incomeBasedSplit,
    applySplitToFellesCategories: applySplitToFellesCategories,
    detectMissedMonths: detectMissedMonths,
    monthHasActivity: monthHasActivity,
    // feature aliases
    categoryAutoSpends: categoryAutoSpends,
    plannedSpendsForMonth: plannedSpendsForMonth,
    plannedSpendsFromMonth: plannedSpendsFromMonth,
    plannedSpendReserve: plannedSpendReserve,
    normalizePlannedSpends: normalizePlannedSpends,
    parseBalanceAmount: parseBalanceAmount,
    balanceVariance: balanceVariance,
    expectedBrukFromPrev: expectedBrukFromPrev,
    etterLonnFromBruk: etterLonnFromBruk,
    varianceMeta: varianceMeta,
    reconcilePaKonto: reconcilePaKonto,
    estimateSafeFromPrevBruk: estimateSafeFromPrevBruk,
    safeToSpendSaldoBreakdown: safeToSpendSaldoBreakdown,
    BALANCE_WHEN_BEFORE: BALANCE_WHEN_BEFORE,
    BALANCE_WHEN_AFTER: BALANCE_WHEN_AFTER,
    BALANCE_WHEN_DATED: BALANCE_WHEN_DATED,
    normalizeBalanceWhen: normalizeBalanceWhen,
    normalizeBalanceAsOf: normalizeBalanceAsOf,
    emptyBalance: emptyBalance,
    monthHasDatedCashflow: monthHasDatedCashflow,
    personCashflowParts: personCashflowParts,
    expectedCashflowForBalanceWhen: expectedCashflowForBalanceWhen,
    balanceWhenLabel: balanceWhenLabel
  };
});
