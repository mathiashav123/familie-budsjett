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

  function ensureBalancesShape(m, people) {
    if (!m.balances || typeof m.balances !== "object") m.balances = {};
    (people || []).forEach(function (p) {
      if (!p || !p.id) return;
      if (!m.balances[p.id] || typeof m.balances[p.id] !== "object") {
        m.balances[p.id] = { bruk: null, spare: null };
      } else {
        if (!("bruk" in m.balances[p.id])) m.balances[p.id].bruk = null;
        if (!("spare" in m.balances[p.id])) m.balances[p.id].spare = null;
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

  function copyBalancesFrom(sourceMonth, targetMonth, people) {
    if (!sourceMonth || !targetMonth) return targetMonth;
    if (monthHasBalances(targetMonth)) return targetMonth;
    ensureBalancesShape(targetMonth, people);
    ensureBalancesShape(sourceMonth, people);
    var src = sourceMonth.balances || {};
    Object.keys(src).forEach(function (pid) {
      if (!targetMonth.balances[pid]) {
        targetMonth.balances[pid] = { bruk: null, spare: null };
      }
      if (!src[pid]) return;
      if (src[pid].bruk != null && src[pid].bruk !== "") {
        targetMonth.balances[pid].bruk = src[pid].bruk;
      }
      if (src[pid].spare != null && src[pid].spare !== "") {
        targetMonth.balances[pid].spare = src[pid].spare;
      }
    });
    return targetMonth;
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
        savingsGoals: []
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
            spare: b.spare != null && b.spare !== "" ? b.spare : null
          };
        });
      } else if (src.saldoBefore != null && src.saldoBefore !== "") {
        var firstId = (people[0] && people[0].id) || ID_A;
        people.forEach(function (p) {
          m.balances[p.id] = {
            bruk: p.id === firstId ? Number(src.saldoBefore) : 0,
            spare: null
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
          date: s.date || ""
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
      months[key] = m;
    });

    ensureCategorySplits(cats, people);

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
      savingsGoals: normalizeSavingsGoals(parsed.savingsGoals, people)
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

  function plannedUtFelles(m, categories, monthIndex) {
    var sum = 0;
    (categories || []).forEach(function (cat) {
      if (cat.archived) return;
      sum += budgetForOwner(m, cat.id, "felles", monthIndex);
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
      var ownActual = actualForCategoryOwner(m, cat.id, cat.name, personId);
      sum += Math.max(0, (ownPlanned || 0) - (ownActual || 0));
      var fellesPlanned = budgetForOwner(m, cat.id, "felles", monthIndex);
      var fellesActual = actualForCategoryOwner(m, cat.id, cat.name, "felles");
      var remFelles = Math.max(0, (fellesPlanned || 0) - (fellesActual || 0));
      if (remFelles) {
        sum += fellesShare(cat, personId, people, remFelles);
      }
    });
    return sum;
  }

  function calcFamily(m, people, categories, settings, monthIndex) {
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
    var activeCats = (categories || []).filter(function (c) {
      return !c.archived;
    });
    var catStats = activeCats.map(function (cat) {
      var planned = budgetFor(m, cat.id, monthIndex);
      var actual = actualForCategory(m, cat.id, cat.name);
      plannedTotal += planned;
      actualBudgeted += actual;
      var plannedByOwner = { felles: budgetForOwner(m, cat.id, "felles", monthIndex) };
      active.forEach(function (p) {
        plannedByOwner[p.id] = budgetForOwner(m, cat.id, p.id, monthIndex);
      });
      return {
        cat: cat,
        planned: planned,
        plannedByOwner: plannedByOwner,
        actual: actual,
        remain: planned - actual,
        over:
          (actual > planned && planned > 0) || (planned === 0 && actual > 0)
      };
    });

    var netPlan = planInn - plannedTotal;
    var netActual = samletInntekt - samletUtgifter;

    // remainingFast = sum over Fast cats of max(0, budget − actual)
    // remainingBudgetAll = all categories (fast + variabel) remaining planned spend
    var remainingFastBudgets = 0;
    var remainingBudgetAll = 0;
    catStats.forEach(function (s) {
      var rem = Math.max(0, (s.planned || 0) - (s.actual || 0));
      remainingBudgetAll += rem;
      if (s.cat && s.cat.type === "fast") {
        remainingFastBudgets += rem;
      }
    });

    // Legacy / plan-based: planInn − actualExpenses − remainingFast
    var safeToSpendPlanRaw = planInn - samletUtgifter - remainingFastBudgets;
    var safeToSpendPlan = Math.max(0, safeToSpendPlanRaw);

    var opts = settings && typeof settings === "object" ? settings : {};
    var useSaldo =
      opts.useSaldoInSafeToSpend !== false; // default ON
    var spendBuffer = 0;
    if (opts.spendBuffer != null && opts.spendBuffer !== "") {
      var bufN = Number(opts.spendBuffer);
      if (Number.isFinite(bufN) && bufN > 0) spendBuffer = bufN;
    }

    // Saldo-based (primary when bruk is set + toggle on):
    // max(0, totalBruk − remainingBudgetAll − buffer). Spare stays out.
    var safeToSpendSaldoRaw = null;
    var safeToSpendSaldo = null;
    if (hasBruk) {
      safeToSpendSaldoRaw = totalBruk - remainingBudgetAll - spendBuffer;
      safeToSpendSaldo = Math.max(0, safeToSpendSaldoRaw);
    }

    var safeToSpendMode = "plan";
    var safeToSpendRaw = safeToSpendPlanRaw;
    var safeToSpend = safeToSpendPlan;
    if (useSaldo && hasBruk) {
      safeToSpendMode = "saldo";
      safeToSpendRaw = safeToSpendSaldoRaw;
      safeToSpend = safeToSpendSaldo;
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

      var planRawP = (cp.planInn || 0) - (cp.utgifter || 0) - remFastP;
      var planSafeP = Math.max(0, planRawP);

      var saldoRawP = null;
      var saldoSafeP = null;
      if (hasPersonBruk) {
        saldoRawP = brukN - remAllP - bufferShareEach;
        saldoSafeP = Math.max(0, saldoRawP);
      }

      var modeP = "plan";
      var rawP = planRawP;
      var safeP = planSafeP;
      if (useSaldo && hasPersonBruk) {
        modeP = "saldo";
        rawP = saldoRawP;
        safeP = saldoSafeP;
      }

      cp.remainingBudgetAll = remAllP;
      cp.remainingFastBudgets = remFastP;
      cp.spendBufferShare = bufferShareEach;
      cp.hasBrukBalance = hasPersonBruk;
      cp.safeToSpendMode = modeP;
      cp.safeToSpendPlanRaw = planRawP;
      cp.safeToSpendPlan = planSafeP;
      cp.safeToSpendSaldoRaw = saldoRawP;
      cp.safeToSpendSaldo = saldoSafeP;
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
      netPlan: netPlan,
      netActual: netActual,
      remainingFastBudgets: remainingFastBudgets,
      remainingBudgetAll: remainingBudgetAll,
      spendBuffer: spendBuffer,
      hasBrukBalances: hasBruk,
      useSaldoInSafeToSpend: useSaldo,
      safeToSpendMode: safeToSpendMode,
      safeToSpendPlanRaw: safeToSpendPlanRaw,
      safeToSpendPlan: safeToSpendPlan,
      safeToSpendSaldoRaw: safeToSpendSaldoRaw,
      safeToSpendSaldo: safeToSpendSaldo,
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
    copyBalancesFrom(sourceMonth, targetMonth, people);
    return targetMonth;
  }

  /**
   * On first visit to an empty month: copy expected from nearest previous
   * month that has planned income / budgets. Never overwrites a month that
   * already has expected values (user-customized or previously carried).
   *
   * opts.copyExpectedToNewMonths — default true
   * When false: legacy autoFill-only for categories marked autoFill
   *   (planned income is still copied for continuity with prior behavior).
   * Returns { copied: boolean, sourceKey: string|null, mode: "all"|"autofill"|null }
   */
  function ensureMonthExpected(months, key, people, opts) {
    opts = opts || {};
    var copyAll = opts.copyExpectedToNewMonths !== false;
    var categories = opts.categories || [];
    if (!months || !key) {
      return { copied: false, sourceKey: null, mode: null };
    }
    if (!months[key]) {
      months[key] = {
        balances: {},
        budgets: {},
        budgetLines: {},
        plannedIncome: {},
        incomes: [],
        savings: [],
        expenses: []
      };
    }
    var m = months[key];
    ensureMonthShape(m, people);
    if (monthHasExpected(m)) {
      // Still carry balances into months that already have expected but no balances
      if (!monthHasBalances(m)) {
        var balKeyEarly = findNearestPreviousWithBalances(
          months,
          key,
          opts.maxLookback
        );
        if (balKeyEarly) {
          copyBalancesFrom(months[balKeyEarly], m, people);
          return {
            copied: true,
            sourceKey: balKeyEarly,
            mode: "balances"
          };
        }
      }
      return { copied: false, sourceKey: null, mode: null };
    }
    var srcKey = findNearestPreviousWithExpected(
      months,
      key,
      opts.maxLookback
    );
    if (!srcKey) {
      return { copied: false, sourceKey: null, mode: null };
    }
    var src = months[srcKey];
    if (copyAll) {
      copyExpectedFrom(src, m, people, monthIndexFromKey(key));
      if (!monthHasBalances(m)) {
        var balKey = findNearestPreviousWithBalances(
          months,
          key,
          opts.maxLookback
        );
        if (balKey) copyBalancesFrom(months[balKey], m, people);
      }
      return { copied: true, sourceKey: srcKey, mode: "all" };
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
    if (!monthHasBalances(m)) {
      copyBalancesFrom(src, m, people);
      if (monthHasBalances(m)) any = true;
    }
    return {
      copied: any,
      sourceKey: any ? srcKey : null,
      mode: any ? "autofill" : null
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
   * Progress model: each goal has explicit `saved` ("Spart mot dette målet").
   * Spare saldo and spareinnskudd stay separate overview metrics; they are NOT
   * auto-linked (avoids ambiguity when several goals share one person/konto).
   * person: person id | "felles" | "samlet" (husstand).
   */
  function normalizeSavingsGoal(g, people) {
    g = g || {};
    var person = mapLegacyOwner(g.person || "samlet");
    if (person !== "felles" && person !== "samlet" && !personById(people, person)) {
      person = "samlet";
    }
    var target = Number(g.target);
    var monthly = Number(g.monthly);
    var saved = Number(g.saved);
    return {
      id: g.id || uid(),
      name: (g.name && String(g.name).trim()) || "Sparemål",
      target: Number.isFinite(target) && target >= 0 ? target : 0,
      monthly: Number.isFinite(monthly) && monthly >= 0 ? monthly : 0,
      saved: Number.isFinite(saved) && saved >= 0 ? saved : 0,
      person: person
    };
  }

  function normalizeSavingsGoals(list, people) {
    if (!Array.isArray(list)) return [];
    return list.map(function (g) {
      return normalizeSavingsGoal(g, people);
    });
  }

  /**
   * ETA for a sparemål from a reference date (defaults to today).
   * monthsNeeded = ceil(remaining / monthly); add that many calendar months
   * to the reference month. Label: "ca. mnd ÅÅÅÅ" / "nådd" / need monthly.
   */
  function savingsGoalEta(goal, fromDate) {
    var target = Number(goal && goal.target);
    var saved = Number(goal && goal.saved);
    var monthly = Number(goal && goal.monthly);
    if (!Number.isFinite(target)) target = 0;
    if (!Number.isFinite(saved)) saved = 0;
    if (!Number.isFinite(monthly)) monthly = 0;
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

  function savingsGoalProgress(goal) {
    var target = Number(goal && goal.target);
    var saved = Number(goal && goal.saved);
    if (!Number.isFinite(target)) target = 0;
    if (!Number.isFinite(saved)) saved = 0;
    var pct = target > 0 ? Math.min(100, Math.max(0, (saved / target) * 100)) : (saved > 0 ? 100 : 0);
    return {
      target: target,
      saved: saved,
      remaining: Math.max(0, target - saved),
      pct: pct,
      reached: target > 0 ? saved >= target : saved > 0
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
   * - totalt: sum of logged savings across all stored months
   */
  function sparingStats(months, year, monthIndex, people) {
    var y = Number(year);
    var mi = Number(monthIndex);
    if (!Number.isFinite(mi) || mi < 0) mi = 0;
    if (mi > 11) mi = 11;
    var key =
      y + "-" + String(mi + 1).padStart(2, "0");
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

    function sumYearForPerson(personId) {
      var sum = 0;
      for (var month = 0; month < 12; month++) {
        var k =
          y + "-" + String(month + 1).padStart(2, "0");
        sum += sumSavingsForMonth(monthsMap[k], personId);
      }
      return sum;
    }

    function sumAllForPerson(personId) {
      var sum = 0;
      Object.keys(monthsMap).forEach(function (k) {
        sum += sumSavingsForMonth(monthsMap[k], personId);
      });
      return sum;
    }

    active.forEach(function (p) {
      var bal = (m.balances && m.balances[p.id]) || {};
      var spare =
        bal.spare == null || bal.spare === "" ? null : Number(bal.spare);
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
   */
  function yearRollup(months, year, people, categories, settings) {
    var rows = [];
    var totals = { planInn: 0, planUt: 0, actualUt: 0, tilOvers: 0, actualInn: 0 };
    var y = Number(year);
    for (var month = 0; month < 12; month++) {
      var key =
        y + "-" + String(month + 1).padStart(2, "0");
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
      rows.push({
        month: month,
        key: key,
        planInn: planInn,
        planUt: planUt,
        actualUt: actualUt,
        actualInn: actualInn,
        tilOvers: tilOvers
      });
      totals.planInn += planInn;
      totals.planUt += planUt;
      totals.actualUt += actualUt;
      totals.actualInn += actualInn;
      totals.tilOvers += tilOvers;
    }
    return { year: y, months: rows, totals: totals };
  }

  /** True if string looks like an arithmetic expression (not a plain number). */
  function looksLikeAmountExpression(input) {
    if (input == null) return false;
    var s = String(input);
    return /[+\-*/×÷()]/.test(s) || /[−]/.test(s);
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
    copyBalancesFrom: copyBalancesFrom,
    findNearestPreviousWithBalances: findNearestPreviousWithBalances,
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
    savingsGoalEta: savingsGoalEta,
    savingsGoalProgress: savingsGoalProgress,
    actualForCategory: actualForCategory,
    actualForCategoryOwner: actualForCategoryOwner,
    calcPerson: calcPerson,
    remainingBudgetForPerson: remainingBudgetForPerson,
    plannedUtForPerson: plannedUtForPerson,
    plannedUtFelles: plannedUtFelles,
    calcFamily: calcFamily,
    personHasData: personHasData,
    reassignPersonData: reassignPersonData,
    monthHasExpected: monthHasExpected,
    shiftMonthKey: shiftMonthKey,
    findNearestPreviousWithExpected: findNearestPreviousWithExpected,
    copyExpectedFrom: copyExpectedFrom,
    ensureMonthExpected: ensureMonthExpected,
    evalAmountExpression: evalAmountExpression,
    looksLikeAmountExpression: looksLikeAmountExpression
  };
});
