/* === familie sync loader === */
(function () {
  "use strict";
  function loadSync(path) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", path, false);
      xhr.send(null);
      if (xhr.status >= 200 && xhr.status < 300 && xhr.responseText) {
        (0, eval)(xhr.responseText);
        return true;
      }
    } catch (e) {
      console.warn("sync load failed", path, e);
    }
    return false;
  }
  if (!window.FAMILIE_BUDGET_SUPABASE) loadSync("supabase-config.js");
  if (!window.FamilieBudsjettSync) loadSync("sync-core.js");
  if (!window.FamilieBudsjettCloud) loadSync("cloud-sync.js");
})();
/* === end sync loader === */

/**
 * Familiebudsjett – multi-person
 * localStorage: familie-budsjett-v1 (migrates a/b → people[])
 * Depends on FamilieBudsjettCalc (calc-core.js)
 */
(function () {
  "use strict";

  const Calc = window.FamilieBudsjettCalc;
  if (!Calc) {
    console.error("calc-core.js mangler");
    return;
  }

  const STORAGE_KEY = "familie-budsjett-v1";
  const MONTHS = [
    "Januar", "Februar", "Mars", "April", "Mai", "Juni",
    "Juli", "August", "September", "Oktober", "November", "Desember"
  ];
  const MONTHS_SHORT = [
    "Jan", "Feb", "Mar", "Apr", "Mai", "Jun",
    "Jul", "Aug", "Sep", "Okt", "Nov", "Des"
  ];

  /**
   * Suggested quick-add chips (NOT pre-installed). Fresh installs start with [].
   * Personal chips live under each person; felles chips under Felles (+ «Felles-forslag» under persons).
   * Uniqueness for chips/creation: same name + owner.
   */
  const PERSONAL_SUGGESTIONS = [
    { name: "Mat", type: "variabel", autoFill: false },
    { name: "Hygiene", type: "variabel", autoFill: false },
    { name: "Klær", type: "variabel", autoFill: false },
    { name: "Abonnement", type: "variabel", autoFill: false },
    { name: "Restaurant", type: "variabel", autoFill: false },
    { name: "Gøy", type: "variabel", autoFill: false },
    { name: "Spill", type: "variabel", autoFill: false },
    { name: "Tipping", type: "variabel", autoFill: false },
    { name: "Fond", type: "variabel", autoFill: false },
    { name: "Hund", type: "variabel", autoFill: false }
  ];
  /** Shared household suggestions (owner = felles). Mobil only in Felles-section chips. */
  const FELLES_SUGGESTIONS = [
    { name: "Lån", type: "fast", autoFill: true },
    { name: "Strøm", type: "fast", autoFill: true },
    { name: "Internett", type: "fast", autoFill: true },
    { name: "Forsikring", type: "fast", autoFill: true },
    { name: "Felleskost", type: "fast", autoFill: true },
    { name: "Bil", type: "variabel", autoFill: false },
    { name: "Ferie", type: "variabel", autoFill: false },
    { name: "Baby", type: "variabel", autoFill: false }
  ];
  const FELLES_SECTION_EXTRA = [
    { name: "Mobil", type: "fast", autoFill: true }
  ];
  /** Flat list for name lookups (type/autoFill). */
  const SUGGESTED_CATEGORIES = PERSONAL_SUGGESTIONS.concat(FELLES_SUGGESTIONS, FELLES_SECTION_EXTRA);

  /** Fresh install: no pre-seeded categories. */
  function seedCategories() {
    return [];
  }

  /** Planned income from Excel «Budsjett» (flat every month). */
  const EXCEL_PLANNED_INCOME = {
    p1: { lønn: 42500, ekstra: 2400 },
    p2: { lønn: 30000, ekstra: null }
  };
  /**
   * Category → amount per owner. Household (Lån/Strøm/…) summed into Felles;
   * personal variable lines stay on Mathias/Andrea. Mobil only on Mathias.
   */
  const EXCEL_BUDGETS_BY_OWNER = {
    p1: {
      "Mobil": 498,
      "Mat": 2500,
      "Hygiene": 250,
      "Klær": 250,
      "Abonnement": 1500,
      "Restaurant": 500,
      "Gøy": 500,
      "Spill": 1000,
      "Tipping": 200,
      "Fond": 500,
      "Hund": 1319
    },
    p2: {
      "Mat": 2500,
      "Hygiene": 500,
      "Klær": 800,
      "Abonnement": 500,
      "Restaurant": 500,
      "Gøy": 500,
      "Tipping": 200,
      "Hund": 1000,
      "Baby": 2319
    },
    felles: {
      "Lån": 23440,
      "Strøm": 1900,
      "Internett": 869,
      "Forsikring": 732
    }
  };

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function todayISO() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }

  function monthKey(year, month) {
    return year + "-" + String(month + 1).padStart(2, "0");
  }

  function prevMonthKey(year, month) {
    let y = year, m = month - 1;
    if (m < 0) { m = 11; y -= 1; }
    return monthKey(y, m);
  }

  function emptyMonth() {
    return {
      balances: {},
      budgets: {},
      budgetLines: {},
      plannedIncome: {},
      incomes: [],
      savings: [],
      expenses: []
    };
  }

  function DEFAULT_STATE() {
    const now = new Date();
    return {
      version: 2,
      people: Calc.defaultPeople(),
      view: { year: now.getFullYear(), month: now.getMonth() },
      categories: seedCategories(),
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

  function formatNOK(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const rounded = Math.round(n);
    const abs = Math.abs(rounded);
    const formatted = abs.toLocaleString("nb-NO");
    return (rounded < 0 ? "−" : "") + formatted + " kr";
  }

  function formatNOKSigned(n) {
    if (n == null || Number.isNaN(n)) return "—";
    const rounded = Math.round(n);
    const abs = Math.abs(rounded);
    const formatted = abs.toLocaleString("nb-NO");
    if (rounded > 0) return "+" + formatted + " kr";
    if (rounded < 0) return "−" + formatted + " kr";
    return formatted + " kr";
  }

  function parseAmount(str) {
    if (str == null || str === "") return null;
    const raw = String(str).trim();
    if (!raw) return null;
    // Expressions like 199+49+12 (safe parser – no arbitrary JS)
    if (Calc.looksLikeAmountExpression(raw)) {
      const expr = Calc.evalAmountExpression(raw);
      if (expr != null) return expr;
    }
    let s = raw.replace(/\s/g, "").replace(/kr/gi, "");
    // Accept both comma and dot; if both present, assume European (dot thousands, comma decimal)
    if (s.indexOf(",") >= 0 && s.indexOf(".") >= 0) {
      if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
        s = s.replace(/\./g, "").replace(",", ".");
      } else {
        s = s.replace(/,/g, "");
      }
    } else {
      s = s.replace(",", ".");
    }
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Format a number for amount inputs (Norwegian comma, no thousands). */
  function formatAmountInput(n) {
    if (n == null || !Number.isFinite(n)) return "";
    const rounded = Math.round(n * 100) / 100;
    return String(rounded).replace(".", ",");
  }

  /** Evaluate expression in an amount field and write back the result. */
  function resolveAmountField(el) {
    if (!el) return null;
    const raw = el.value;
    const n = parseAmount(raw);
    if (n != null && Calc.looksLikeAmountExpression(raw)) {
      el.value = formatAmountInput(n);
    }
    return n;
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function formatDateNb(iso) {
    if (!iso) return "";
    const parts = String(iso).split("-");
    if (parts.length !== 3) return iso;
    return parts[2] + "." + parts[1] + "." + parts[0];
  }

  function percent(part, whole) {
    if (!whole || whole <= 0) return part > 0 ? 100 : 0;
    return Math.min(999, Math.round((part / whole) * 100));
  }

  // ——— State ———
  let state = load();
  let pickYear = state.view.year;
  let toastTimer = null;
  // Ephemeral UI (not persisted): collapsed category groups + expanded row
  let catGroupsOpen = {}; // person/felles section keys → open (default true)
  let expandedCatId = null;
  let yearOverviewYear = null; // null → follow state.view.year
  let loggScope = "month"; // "month" | "year"

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return DEFAULT_STATE();
      const parsed = JSON.parse(raw);
      const migrated = Calc.migrateState(parsed);
      if (!Array.isArray(migrated.savingsGoals)) migrated.savingsGoals = [];
      // Keep existing categories (incl. previously seeded). Empty array stays empty.
      ensureCategoryOrders(migrated);
      return migrated;
    } catch (e) {
      console.warn("Kunne ikke lese lagring", e);
      return DEFAULT_STATE();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      var C=window.FamilieBudsjettCloud;
      if(C&&typeof C.schedulePush==="function") C.schedulePush();
    } catch (e) {
      showToast("Kunne ikke lagre. Er lagringsplassen full?");
    }
  }

  function getMonth(optKey) {
    const key = optKey || monthKey(state.view.year, state.view.month);
    let created = false;
    if (!state.months[key]) {
      state.months[key] = emptyMonth();
      created = true;
    }
    const m = state.months[key];
    ensureMonthShape(m);
    const result = Calc.ensureMonthExpected(state.months, key, state.people, {
      copyExpectedToNewMonths: state.settings.copyExpectedToNewMonths !== false,
      categories: state.categories
    });
    if (created || (result && result.copied)) save();
    return m;
  }

  function ensureMonthShape(m) {
    Calc.ensureMonthShape(m, state.people);
  }

  function activePeopleList() {
    return Calc.activePeople(state.people);
  }

  function nameOf(who) {
    return Calc.nameOf(state.people, who);
  }

  function activeCategories() {
    return state.categories.filter(function (c) { return !c.archived; });
  }

  function catById(id) {
    return state.categories.find(function (c) { return c.id === id; });
  }

  // ——— Calculations (via calc-core) ———
  function calcFamily(m) {
    return Calc.calcFamily(
      m,
      state.people,
      state.categories,
      state.settings || {},
      state.view.month
    );
  }

  function budgetFor(m, catId) {
    return Calc.budgetFor(m, catId, state.view.month);
  }

  function budgetForOwner(m, catId, ownerId) {
    return Calc.budgetForOwner(m, catId, ownerId, state.view.month);
  }

  function setBudgetForOwner(m, catId, ownerId, value) {
    return Calc.setBudgetForOwner(m, catId, ownerId, value);
  }

  function plannedIncomeFor(m, person, type) {
    ensureMonthShape(m);
    return Calc.plannedIncomeFor(m, person, type);
  }

  function prevMonthSpend() {
    const key = prevMonthKey(state.view.year, state.view.month);
    const m = state.months[key];
    if (!m || !Array.isArray(m.expenses) || !m.expenses.length) return null;
    return m.expenses.reduce(function (s, e) { return s + (e.amount || 0); }, 0);
  }

  // ——— DOM ———
  const $ = function (sel) { return document.querySelector(sel); };
  const $$ = function (sel) { return Array.from(document.querySelectorAll(sel)); };

  function showToast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  let openDialogEl = null;
  let lastFocusEl = null;

  /**
   * Robust dialog open for iOS Safari / file://
   * Prefer showModal when it works; always ensure visible via .is-open fallback.
   */
  function openDlg(id) {
    const el = typeof id === "string" ? $(id) : id;
    if (!el) return;
    lastFocusEl = document.activeElement;
    let nativeOk = false;
    if (typeof el.showModal === "function") {
      try {
        if (!el.open) el.showModal();
        nativeOk = !!el.open;
      } catch (err) {
        nativeOk = false;
      }
    }
    el.classList.add("is-open");
    el.setAttribute("open", "");
    if (!nativeOk) el.dataset.fallback = "1";
    else delete el.dataset.fallback;
    document.body.classList.add("modal-open");
    openDialogEl = el;
    const focusable = el.querySelector(
      "input:not([type=hidden]), select, textarea, button:not([disabled])"
    );
    setTimeout(function () {
      if (focusable) {
        try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); }
      }
    }, 40);
  }

  function closeDlg(id) {
    const el = typeof id === "string" ? $(id) : id;
    if (!el) return;
    try {
      if (typeof el.close === "function" && el.open) el.close();
    } catch (err) { /* ignore */ }
    el.classList.remove("is-open");
    el.removeAttribute("open");
    delete el.dataset.fallback;
    if (openDialogEl === el) openDialogEl = null;
    const still = Array.from(document.querySelectorAll("dialog.modal.is-open"));
    if (!still.length) document.body.classList.remove("modal-open");
    if (lastFocusEl && typeof lastFocusEl.focus === "function") {
      try { lastFocusEl.focus({ preventScroll: true }); } catch (e) { /* */ }
    }
  }

  // ——— Render ———
  function formatPlanInput(v) {
    if (v == null || v === "") return "";
    return String(v).replace(".", ",");
  }

  /** Move shared Plan-income calc pad back to its host (survives grid re-render). */
  function parkPlanIncCalc() {
    const panel = $("#planIncCalc");
    const host = $("#planIncCalcHost");
    if (panel && host && panel.parentNode !== host) {
      host.appendChild(panel);
    }
  }

  function renderHeaderEyebrow() {
    const el = $("#headerEyebrow");
    if (!el) return;
    const names = activePeopleList().map(function (p) { return p.name; });
    el.textContent = names.length ? names.join(" & ") : "Familie";
  }

  function renderWhoSeg(selected) {
    const seg = $("#expWhoSeg");
    if (!seg) return;
    const who = selected || "felles";
    let html = "";
    activePeopleList().forEach(function (person) {
      html +=
        '<label><input type="radio" name="expWho" value="' +
        escapeAttr(person.id) +
        '"' +
        (who === person.id ? " checked" : "") +
        " /><span>" +
        escapeHtml(person.name) +
        "</span></label>";
    });
    html +=
      '<label><input type="radio" name="expWho" value="felles"' +
      (who === "felles" ? " checked" : "") +
      " /><span>Felles</span></label>";
    seg.innerHTML = html;
  }

  function fillOwnerSelect(selectEl, selected) {
    if (!selectEl) return;
    let html = '<option value="felles">Felles</option>';
    activePeopleList().forEach(function (person) {
      html +=
        '<option value="' +
        escapeAttr(person.id) +
        '"' +
        (selected === person.id ? " selected" : "") +
        ">" +
        escapeHtml(person.name) +
        "</option>";
    });
    selectEl.innerHTML = html;
    if (selected) selectEl.value = selected;
  }

  function renderInnUtTabs() {
    const tabs = $("#innUtTabs");
    if (!tabs) return;
    const view = state.settings.innUtView || "samlet";
    let html =
      '<button type="button" class="view-tab' +
      (view === "samlet" ? " active" : "") +
      '" role="tab" aria-selected="' +
      (view === "samlet" ? "true" : "false") +
      '" data-innut-view="samlet">Samlet</button>';
    activePeopleList().forEach(function (person) {
      const on = view === person.id;
      html +=
        '<button type="button" class="view-tab' +
        (on ? " active" : "") +
        '" role="tab" aria-selected="' +
        (on ? "true" : "false") +
        '" data-innut-view="' +
        escapeAttr(person.id) +
        '">' +
        escapeHtml(person.name) +
        "</button>";
    });
    tabs.innerHTML = html;
    const note = $("#fellesNote");
    if (note) {
      note.hidden = view === "samlet";
      note.textContent =
        "Forventet ut = personens egne beløp + andel av Felles (etter %). Faktiske felleskjøp fordeles etter samme %.";
    }
  }

  function renderInnUtNumbers(c) {
    const view = state.settings.innUtView || "samlet";
    let planInn, actInn, planUt, actUt, netPlan, netActual;
    if (view === "samlet") {
      planInn = c.planInn;
      actInn = c.samletInntekt;
      planUt = c.plannedTotal;
      actUt = c.samletUtgifter;
      netPlan = c.netPlan;
      netActual = c.netActual;
    } else {
      const pc = c.byPerson && c.byPerson[view];
      if (!pc) {
        planInn = actInn = planUt = actUt = netPlan = netActual = 0;
      } else {
        planInn = pc.planInn;
        actInn = pc.actualInn;
        planUt = pc.planUt;
        actUt = pc.utgifter;
        netPlan = pc.netPlan;
        netActual = pc.tilOvers;
      }
    }
    $("#innPlan").textContent = formatNOK(planInn);
    $("#innActual").textContent = formatNOK(actInn);
    $("#utPlan").textContent = formatNOK(planUt);
    $("#utActual").textContent = formatNOK(actUt);
    $("#netPlan").textContent = formatNOK(netPlan);
    $("#netActual").textContent = formatNOK(netActual);
    const netItems = $$("#netBar .net-item");
    if (netItems[0]) {
      netItems[0].classList.toggle("pos", netPlan >= 0);
      netItems[0].classList.toggle("neg", netPlan < 0);
    }
    if (netItems[1]) {
      netItems[1].classList.toggle("pos", netActual >= 0);
      netItems[1].classList.toggle("neg", netActual < 0);
    }
  }

  function applyMainTab(tab) {
    const t =
      tab === "plan" ||
      tab === "logg" ||
      tab === "oversikt" ||
      tab === "mer" ||
      tab === "sparing"
        ? tab
        : "oversikt";
    state.settings.mainTab = t;
    const panels = {
      plan: $("#panelPlan"),
      oversikt: $("#panelOversikt"),
      logg: $("#panelLogg"),
      sparing: $("#panelSparing"),
      mer: $("#panelMer")
    };
    Object.keys(panels).forEach(function (k) {
      const el = panels[k];
      if (!el) return;
      const on = k === t;
      el.hidden = !on;
      if (on) el.removeAttribute("hidden");
      else el.setAttribute("hidden", "");
    });
    $$(".main-tab[data-tab]").forEach(function (btn) {
      const on = btn.getAttribute("data-tab") === t;
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.classList.toggle("is-active", on);
    });
    document.body.dataset.mainTab = t;
  }


  function findCategoryByName(name) {
    const n = String(name || "").trim().toLowerCase();
    return (state.categories || []).find(function (c) {
      return !c.archived && String(c.name || "").trim().toLowerCase() === n;
    }) || null;
  }

  /** Active category with same name + owner (chip / create uniqueness). */
  function findCategoryByNameOwner(name, owner) {
    const n = String(name || "").trim().toLowerCase();
    const o = owner || "felles";
    return (state.categories || []).find(function (c) {
      return (
        !c.archived &&
        String(c.name || "").trim().toLowerCase() === n &&
        (c.owner || "felles") === o
      );
    }) || null;
  }

  function suggestionByName(name) {
    const n = String(name || "").trim().toLowerCase();
    return SUGGESTED_CATEGORIES.find(function (c) {
      return String(c.name).toLowerCase() === n;
    }) || null;
  }

  function resolveSuggestOwner(rawOwner) {
    if (!rawOwner || rawOwner === "felles") return "felles";
    if (rawOwner === "p1" || rawOwner === "p2") {
      const p = Calc.personById(state.people, rawOwner);
      return p ? p.id : "felles";
    }
    if (Calc.personById(state.people, rawOwner)) return rawOwner;
    return "felles";
  }

  function nextCategoryOrder() {
    let max = -1;
    (state.categories || []).forEach(function (c) {
      const o = c.order != null ? Number(c.order) : -1;
      if (o > max) max = o;
    });
    return max + 1;
  }

  function ensureCategoryOrders(st) {
    const target = st || state;
    if (!target || !Array.isArray(target.categories)) return;
    let dirty = false;
    target.categories.forEach(function (c, i) {
      if (c.order == null || !Number.isFinite(Number(c.order))) {
        c.order = i;
        dirty = true;
      }
    });
    return dirty;
  }

  function categoriesSortedByOrder(list) {
    return (list || []).slice().sort(function (a, b) {
      const ao = a.order != null ? Number(a.order) : 9999;
      const bo = b.order != null ? Number(b.order) : 9999;
      if (ao !== bo) return ao - bo;
      return String(a.name || "").localeCompare(String(b.name || ""), "nb");
    });
  }

  function renumberCategoryOrders(orderedIds) {
    const map = {};
    orderedIds.forEach(function (id, i) { map[id] = i; });
    let next = orderedIds.length;
    state.categories.forEach(function (c) {
      if (Object.prototype.hasOwnProperty.call(map, c.id)) {
        c.order = map[c.id];
      } else if (c.order == null) {
        c.order = next++;
      }
    });
  }

  /**
   * Create a category (or return existing active by name).
   * opts: { name, type, owner, autoFill }
   */
  function addCategory(opts) {
    const name = String((opts && opts.name) || "").trim();
    if (!name) return null;
    let owner = opts.owner || "felles";
    if (owner !== "felles" && !Calc.personById(state.people, owner)) {
      owner = "felles";
    }
    const existing = findCategoryByNameOwner(name, owner);
    if (existing) return existing;
    const type = opts.type === "fast" ? "fast" : "variabel";
    const cat = {
      id: uid(),
      name: name,
      type: type,
      owner: owner,
      autoFill: opts.autoFill != null ? !!opts.autoFill : type === "fast",
      archived: false,
      order: nextCategoryOrder()
    };
    state.categories.push(cat);
    return cat;
  }

  function addCategoryFromSuggestion(name, ownerOverride) {
    const sug = suggestionByName(name);
    const owner = resolveSuggestOwner(
      ownerOverride != null ? ownerOverride : (sug && sug.owner) || "felles"
    );
    if (sug) {
      return addCategory({
        name: sug.name,
        type: sug.type,
        owner: owner,
        autoFill: sug.autoFill
      });
    }
    return addCategory({ name: name, type: "variabel", owner: owner, autoFill: false });
  }

  function remainingPersonalChips(personId) {
    const pid = resolveSuggestOwner(personId);
    return PERSONAL_SUGGESTIONS.filter(function (s) {
      return !findCategoryByNameOwner(s.name, pid);
    });
  }

  function remainingFellesChips(opts) {
    const includeMobil = !!(opts && opts.includeMobil);
    let list = FELLES_SUGGESTIONS.slice();
    if (includeMobil) list = list.concat(FELLES_SECTION_EXTRA);
    return list.filter(function (s) {
      return !findCategoryByNameOwner(s.name, "felles");
    });
  }

  /** Mer/manage: any suggestion not yet present for its natural owner. */
  function remainingSuggestionChips() {
    const people = activePeopleList();
    const out = [];
    const seen = {};
    people.forEach(function (p) {
      remainingPersonalChips(p.id).forEach(function (s) {
        const key = s.name.toLowerCase() + "|" + p.id;
        if (seen[key]) return;
        seen[key] = true;
        out.push({ name: s.name, type: s.type, autoFill: s.autoFill, owner: p.id, label: s.name });
      });
    });
    remainingFellesChips({ includeMobil: true }).forEach(function (s) {
      const key = s.name.toLowerCase() + "|felles";
      if (seen[key]) return;
      seen[key] = true;
      out.push({ name: s.name, type: s.type, autoFill: s.autoFill, owner: "felles", label: s.name });
    });
    return out;
  }

  /**
   * Fill planned income + budgets from Excel.
   * Household lines (Lån/Strøm/Internett/Forsikring) → Felles (summed).
   * Personal variable lines → Mathias / Andrea. Mobil → Mathias.
   * Applies to all 12 months of the given year. No fake transactions/balances.
   */
  function fillBudgetFromExcel(optYear) {
    const year = optYear != null ? optYear : state.view.year;
    const people = state.people || Calc.defaultPeople();
    let p1 = people.find(function (p) { return p.id === "p1"; });
    let p2 = people.find(function (p) { return p.id === "p2"; });
    if (!p1 && people[0]) p1 = people[0];
    if (!p2 && people[1]) p2 = people[1];
    const id1 = p1 ? p1.id : "p1";
    const id2 = p2 ? p2.id : "p2";

    // Create categories as needed: personal lines → person owner; household → felles
    // Same name may exist once per owner (Mat for Mathias + Mat for Andrea).
    const ownerMapsSpec = {
      p1: EXCEL_BUDGETS_BY_OWNER.p1,
      p2: EXCEL_BUDGETS_BY_OWNER.p2,
      felles: EXCEL_BUDGETS_BY_OWNER.felles || {}
    };
    const createOrder = ["felles", "p1", "p2"];
    const excelPairs = []; // { ownerId, catName, catId, amount }
    createOrder.forEach(function (ownerKey) {
      const map = ownerMapsSpec[ownerKey] || {};
      let owner = "felles";
      if (ownerKey === "p1") owner = id1;
      else if (ownerKey === "p2") owner = id2;
      Object.keys(map).forEach(function (catName) {
        const sug = suggestionByName(catName);
        let type = "variabel";
        let autoFill = false;
        if (sug) {
          type = sug.type;
          autoFill = !!sug.autoFill;
        } else if (
          catName === "Lån" || catName === "Strøm" || catName === "Internett" ||
          catName === "Forsikring" || catName === "Felleskost" || catName === "Mobil"
        ) {
          type = "fast";
          autoFill = true;
        }
        // Excel ownership wins (Mobil stays on Mathias even if chip list also offers Felles)
        const cat = addCategory({
          name: catName,
          type: type,
          owner: owner,
          autoFill: autoFill
        });
        if (cat) {
          excelPairs.push({
            ownerId: owner,
            catName: catName,
            catId: cat.id,
            amount: map[catName]
          });
        }
      });
    });

    let filledMonths = 0;
    const excelCatIds = {};
    excelPairs.forEach(function (p) { excelCatIds[p.catId] = true; });

    for (let month = 0; month < 12; month++) {
      const key = monthKey(year, month);
      if (!state.months[key]) state.months[key] = emptyMonth();
      const m = state.months[key];
      Calc.ensureMonthShape(m, people);

      const prev1 = (m.plannedIncome && m.plannedIncome[id1]) || {};
      const prev2 = (m.plannedIncome && m.plannedIncome[id2]) || {};
      m.plannedIncome[id1] = {
        lønn: EXCEL_PLANNED_INCOME.p1.lønn,
        ekstra: EXCEL_PLANNED_INCOME.p1.ekstra,
        sparing: prev1.sparing != null ? prev1.sparing : null
      };
      m.plannedIncome[id2] = {
        lønn: EXCEL_PLANNED_INCOME.p2.lønn,
        ekstra: EXCEL_PLANNED_INCOME.p2.ekstra,
        sparing: prev2.sparing != null ? prev2.sparing : null
      };

      Object.keys(excelCatIds).forEach(function (cid) {
        m.budgets[cid] = {};
      });
      excelPairs.forEach(function (p) {
        setBudgetForOwner(m, p.catId, p.ownerId, p.amount);
      });
      Object.keys(m.budgets).forEach(function (cid) {
        if (!Calc.budgetEntryHasValue(m.budgets[cid])) delete m.budgets[cid];
      });
      filledMonths += 1;
    }
    return { year: year, months: filledMonths };
  }

  function switchToPlanAndFocus(sel) {
    applyMainTab("plan");
    save();
    render();
    setTimeout(function () {
      const id = String(sel || "").replace(/^#/, "");
      const el = document.getElementById(id) || $(sel);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      const input = el.querySelector("input[data-plan-inc], input[data-budget]");
      if (input) {
        try { input.focus({ preventScroll: true }); } catch (err) { input.focus(); }
      }
    }, 80);
  }

  let savedScrollY = 0;
  function render() {
    savedScrollY = window.scrollY || 0;
    const m = getMonth();
    const c = calcFamily(m);

    const view = state.settings.innUtView || "samlet";
    if (view !== "samlet" && !activePeopleList().some(function (person) { return person.id === view; })) {
      state.settings.innUtView = "samlet";
    }
    const sparingView = state.settings.sparingView || "samlet";
    if (sparingView !== "samlet" && !activePeopleList().some(function (person) { return person.id === sparingView; })) {
      state.settings.sparingView = "samlet";
    }

    $("#monthLabel").textContent = MONTHS[state.view.month] + " " + state.view.year;
    applyMainTab(state.settings.mainTab || "oversikt");
    const txScopeSel = $("#txScope");
    if (txScopeSel) txScopeSel.value = loggScope === "year" ? "year" : "month";

    const heroTitle = $("#budgetHeroTitle");
    if (heroTitle) {
      heroTitle.textContent = "Budsjett for " + MONTHS[state.view.month];
    }

    renderHeaderEyebrow();

    const onboard = $("#budgetOnboard");
    if (onboard) {
      const noCats = !activeCategories().length;
      const needsBudget = !c.hasPlannedIncome && !c.hasBudgets;
      const showOnboard = noCats || needsBudget;
      onboard.hidden = !showOnboard;
      if (showOnboard) {
        const stepCats = noCats ? "is-current" : "is-done";
        const stepInc = c.hasPlannedIncome ? "is-done" : (noCats ? "" : "is-current");
        const stepPlan = c.hasBudgets ? "is-done" : (!noCats && c.hasPlannedIncome ? "is-current" : "");
        onboard.innerHTML =
          '<div class="onboard-inner">' +
          "<p><strong>3 steg til rolig oversikt</strong></p>" +
          '<ol class="onboard-steps">' +
          '<li class="' + stepCats + '">Personer OK – legg til kategorier med chips under hver</li>' +
          '<li class="' + stepInc + '">Sett forventet inntekt</li>' +
          '<li class="' + stepPlan + '">Sett forventet beløp på kategoriene</li>' +
          "</ol>" +
          '<p class="hint compact">Tips: «Kopier budsjett» tar forrige måned videre. Alt lagres på denne enheten.</p>' +
          '<button type="button" class="btn primary sm" id="btnOnboardScroll">' +
          (noCats ? "Se kategoriforslag" : "Sett budsjett nå") +
          "</button>" +
          "</div>";
      }
    }

    const stickyTotal = $("#catSpendStickyTotal");
    if (stickyTotal) {
      stickyTotal.textContent = formatNOK(c.plannedTotal);
    }
    const stickyBreak = $("#catSpendStickyBreak");
    if (stickyBreak) {
      const parts = activePeopleList().map(function (p) {
        const pc = c.byPerson && c.byPerson[p.id];
        return p.name + " " + formatNOK(pc ? pc.planUt : 0);
      });
      if ((c.planUtFelles || 0) > 0) {
        parts.push("Felles " + formatNOK(c.planUtFelles));
      }
      stickyBreak.textContent = parts.join(" · ");
      stickyBreak.hidden = !c.plannedTotal;
    }

    const sortSel = $("#sortSelect");
    if (sortSel && document.activeElement !== sortSel) {
      sortSel.value = state.settings.sort || "over";
    }

    renderKontoer(m, c);

    renderInnUtTabs();
    renderInnUtNumbers(c);

    renderSaldoHero(c);

    $("#familyEmpty").hidden = c.hasAnyData;

    renderPlannedIncome(m, c);
    renderMissingIncomeBanner(m);
    renderSafeSpend(c);
    renderHealth(c);
    renderVsPrev(c);
    renderPersonGrid(c);
    renderChart(c);
    renderCategories(m, c);
    renderTransactions(m);
    renderYearOverview();
    renderSparing();
    renderReminder(m);
    renderPeopleManage();
    updateStorageInfo();
    fillOwnerSelect($("#newCatOwner"), "felles");

    const mode = state.settings.chartMode || "actual";
    $$('input[name="chartMode"]').forEach(function (r) {
      if (document.activeElement !== r) r.checked = r.value === mode;
    });

    // Keep scroll stable when expanding cats / re-render (unless focusing an input)
    const active = document.activeElement;
    const typing =
      active &&
      (active.tagName === "INPUT" ||
        active.tagName === "TEXTAREA" ||
        active.tagName === "SELECT");
    if (!typing && savedScrollY > 0) {
      requestAnimationFrame(function () {
        window.scrollTo(0, savedScrollY);
      });
    }
  }

  function renderKontoer(m, c) {
    const grid = $("#kontoerGrid");
    if (!grid) return;
    ensureMonthShape(m);
    const focused = document.activeElement;
    const focusKey =
      focused && focused.getAttribute && focused.getAttribute("data-bal");

    const people = activePeopleList();
    grid.innerHTML = people
      .map(function (person) {
        const bal = (m.balances && m.balances[person.id]) || {};
        const bc =
          (c.balanceByPerson && c.balanceByPerson[person.id]) || {
            bruk: null,
            spare: null,
            sum: 0
          };
        return (
          '<div class="kontoer-person" data-bal-person="' +
          escapeAttr(person.id) +
          '"><h3>' +
          escapeHtml(person.name) +
          "</h3>" +
          '<div class="kontoer-fields">' +
          '<label class="field"><span>Bruk</span><div class="input-affix">' +
          '<input type="text" inputmode="decimal" data-bal="' +
          escapeAttr(person.id) +
          '-bruk" placeholder="0" autocomplete="off" value="' +
          escapeAttr(formatPlanInput(bal.bruk)) +
          '" /><span>kr</span></div></label>' +
          '<label class="field"><span>Spare</span><div class="input-affix spare">' +
          '<input type="text" inputmode="decimal" data-bal="' +
          escapeAttr(person.id) +
          '-spare" placeholder="0" autocomplete="off" value="' +
          escapeAttr(formatPlanInput(bal.spare)) +
          '" /><span>kr</span></div></label>' +
          "</div>" +
          '<div class="kontoer-person-sum"><span>Sum</span><strong>' +
          formatNOK(bc.sum) +
          "</strong></div></div>"
        );
      })
      .join("");

    const tb = $("#totalBruk");
    const ts = $("#totalSpare");
    const ta = $("#totalAlt");
    if (tb) tb.textContent = formatNOK(c.totalBruk || 0);
    if (ts) ts.textContent = formatNOK(c.totalSpare || 0);
    if (ta) ta.textContent = formatNOK(c.totalAlt || 0);

    if (focusKey) {
      const inp = grid.querySelector('[data-bal="' + focusKey + '"]');
      if (inp) {
        try {
          inp.focus({ preventScroll: true });
        } catch (e) {
          inp.focus();
        }
      }
    }
  }

    function renderPlannedIncome(m, c) {
    const grid = $("#planIncomeGrid");
    if (!grid) return;
    ensureMonthShape(m);
    const focused = document.activeElement;
    const focusKey =
      focused && focused.getAttribute && focused.getAttribute("data-plan-inc");

    // Keep shared calc pad outside the grid so re-render does not wipe it
    parkPlanIncCalc();

    grid.innerHTML = activePeopleList()
      .map(function (person) {
        const pi = (m.plannedIncome && m.plannedIncome[person.id]) || {};
        const personCalc = (c.byPerson && c.byPerson[person.id]) || { lønn: 0, ekstra: 0 };
        const lønnKey = person.id + "-lønn";
        const ekstraKey = person.id + "-ekstra";
        const sparingKey = person.id + "-sparing";
        const hasAnyPlan =
          (pi.lønn != null && pi.lønn !== "") ||
          (pi.ekstra != null && pi.ekstra !== "");
        return (
          '<div class="plan-person' +
          (hasAnyPlan ? "" : " needs-income") +
          '" data-plan-person="' +
          escapeAttr(person.id) +
          '"><h3>' +
          escapeHtml(person.name) +
          "</h3>" +
          '<label class="field"><div class="field-label-row"><span>Lønn</span>' +
          '<button type="button" class="btn ghost xs calc-toggle" data-calc-panel="planIncCalc" data-calc-for="' +
          escapeAttr(lønnKey) +
          '" aria-expanded="false" aria-controls="planIncCalc">Kalkulator</button></div>' +
          '<div class="input-affix green">' +
          '<input type="text" inputmode="decimal" data-plan-inc="' +
          escapeAttr(lønnKey) +
          '" placeholder="0" autocomplete="off" class="plan-inc-input" value="' +
          escapeAttr(formatPlanInput(pi.lønn)) +
          '" /><span>kr</span></div></label>' +
          '<label class="field"><div class="field-label-row"><span>Ekstra <em class="opt">(valgfritt)</em></span>' +
          '<button type="button" class="btn ghost xs calc-toggle" data-calc-panel="planIncCalc" data-calc-for="' +
          escapeAttr(ekstraKey) +
          '" aria-expanded="false" aria-controls="planIncCalc">Kalkulator</button></div>' +
          '<div class="input-affix green">' +
          '<input type="text" inputmode="decimal" data-plan-inc="' +
          escapeAttr(ekstraKey) +
          '" placeholder="0" autocomplete="off" class="plan-inc-input" value="' +
          escapeAttr(formatPlanInput(pi.ekstra)) +
          '" /><span>kr</span></div></label>' +
          '<label class="field"><div class="field-label-row"><span>Sparing</span>' +
          '<button type="button" class="btn ghost xs calc-toggle" data-calc-panel="planIncCalc" data-calc-for="' +
          escapeAttr(sparingKey) +
          '" aria-expanded="false" aria-controls="planIncCalc">Kalkulator</button></div>' +
          '<div class="input-affix spare">' +
          '<input type="text" inputmode="decimal" data-plan-inc="' +
          escapeAttr(sparingKey) +
          '" placeholder="0" autocomplete="off" class="plan-inc-input" title="Beløp du vil sette av hver måned" aria-describedby="planSparingHint-' +
          escapeAttr(person.id) +
          '" value="' +
          escapeAttr(formatPlanInput(pi.sparing)) +
          '" /><span>kr</span></div>' +
          '<span class="hint compact plan-sparing-hint" id="planSparingHint-' +
          escapeAttr(person.id) +
          '">Beløp du vil sette av hver måned</span></label>' +
          '<div class="plan-vs"><span>Faktisk: <strong data-plan-actual="' +
          escapeAttr(person.id) +
          '">' +
          formatNOK(personCalc.lønn + personCalc.ekstra) +
          "</strong></span></div></div>"
        );
      })
      .join("");

    if (focusKey) {
      const inp = grid.querySelector('[data-plan-inc="' + focusKey + '"]');
      if (inp) {
        try { inp.focus({ preventScroll: true }); } catch (e) { /* */ }
      }
    }
  }


  function peopleMissingPlannedIncome(m) {
    ensureMonthShape(m);
    return activePeopleList().filter(function (person) {
      const pi = (m.plannedIncome && m.plannedIncome[person.id]) || {};
      const hasLonn = pi.lønn != null && pi.lønn !== "";
      const hasEkstra = pi.ekstra != null && pi.ekstra !== "";
      return !hasLonn && !hasEkstra;
    });
  }

  function renderMissingIncomeBanner(m) {
    const el = $("#planMissingIncome");
    if (!el) return;
    const missing = peopleMissingPlannedIncome(m);
    if (!missing.length) {
      el.hidden = true;
      el.innerHTML = "";
      return;
    }
    el.hidden = false;
    const names = missing.map(function (p) { return escapeHtml(p.name); }).join(", ");
    const focusId = missing[0].id;
    const label =
      missing.length === 1
        ? "Sett forventet inntekt for " + names
        : "Sett forventet inntekt for " + names;
    el.innerHTML =
      "<p>" +
      label +
      "</p>" +
      '<button type="button" class="btn secondary sm" data-focus-plan-income="' +
      escapeAttr(focusId) +
      '">Gå til inntekt</button>';
  }

  function focusPlanIncomeForPerson(personId) {
    applyMainTab("plan");
    state.settings.mainTab = "plan";
    save();
    requestAnimationFrame(function () {
      const block = document.querySelector(
        '#planIncomeGrid [data-plan-person="' + String(personId).replace(/"/g, "") + '"]'
      );
      if (block) {
        try {
          block.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch (e) {
          block.scrollIntoView(true);
        }
      }
      const inp = document.querySelector(
        '#planIncomeGrid [data-plan-inc="' +
          String(personId).replace(/"/g, "") +
          '-lønn"]'
      );
      if (inp) {
        try {
          inp.focus({ preventScroll: true });
        } catch (e2) {
          try { inp.focus(); } catch (e3) { /* */ }
        }
      }
    });
  }

  function renderPersonGrid(c) {
    const grid = $("#personGrid");
    if (!grid) return;
    grid.innerHTML = activePeopleList()
      .map(function (person) {
        const pc = (c.byPerson && c.byPerson[person.id]) || {
          lønn: 0, ekstra: 0, sparing: 0, utgifter: 0, tilOvers: 0,
          planInn: 0, planUt: 0, netPlan: 0
        };
        const pos = pc.tilOvers >= 0 ? "pos" : "neg";
        return (
          '<section class="person-card dense" id="person-' +
          escapeAttr(person.id) +
          '" data-person="' +
          escapeAttr(person.id) +
          '"><div class="person-card-top"><h3>' +
          escapeHtml(person.name) +
          '</h3><span class="person-overs ' +
          pos +
          '">' +
          formatNOK(pc.tilOvers) +
          '</span></div><div class="person-rows dense">' +
          '<div class="person-row"><span>Inn</span><span class="amt">' +
          formatNOK(pc.lønn + pc.ekstra) +
          '</span></div>' +
          '<div class="person-row"><span>Ut</span><span class="amt">' +
          formatNOK(pc.utgifter) +
          '</span></div>' +
          '<div class="person-row muted"><span>Andel felles</span><span class="amt">' +
          formatNOK(pc.fellesShare || 0) +
          '</span></div>' +
          '<div class="person-row"><span>Sparing</span><span class="amt">' +
          formatNOK(pc.sparing) +
          '</span></div></div>' +
          '<div class="person-actions dense">' +
          '<button type="button" class="btn sm green" data-add-income="' +
          escapeAttr(person.id) +
          '">+ Inntekt</button>' +
          '<button type="button" class="btn sm blue" data-add-save="' +
          escapeAttr(person.id) +
          '">+ Sparing</button></div></section>'
        );
      })
      .join("");
  }

  function buildPeopleManageHtml() {
    const rows = state.people
      .map(function (person) {
        const hasData = Calc.personHasData(state, person.id);
        const archived = !!person.archived;
        let actions = "";
        if (archived) {
          actions =
            '<button type="button" class="btn people-action restore" data-people-archive="' +
            escapeAttr(person.id) +
            '">Gjenopprett</button>' +
            (!hasData
              ? '<button type="button" class="btn danger ghost people-action" data-people-delete="' +
                escapeAttr(person.id) +
                '">Slett permanent</button>'
              : "");
        } else {
          // Unified Fjern: archive (+ reassign) if data, else permanent delete
          actions =
            '<button type="button" class="btn danger ghost people-action" data-people-remove="' +
            escapeAttr(person.id) +
            '">Fjern</button>';
        }
        return (
          '<div class="people-card' +
          (archived ? " archived" : "") +
          '" data-people-id="' +
          escapeAttr(person.id) +
          '">' +
          '<label class="people-name-field"><span class="people-name-label">Navn</span>' +
          '<input type="text" class="people-name-input" data-people-rename="' +
          escapeAttr(person.id) +
          '" value="' +
          escapeAttr(person.name) +
          '" maxlength="40" autocomplete="off" aria-label="Navn på person" /></label>' +
          (archived ? '<span class="tag people-tag">Arkivert</span>' : "") +
          (hasData && !archived
            ? '<p class="people-card-hint">Har registrerte tall – fjerning arkiverer, flytter utgifter til Felles; inntekter blir i historikken.</p>'
            : "") +
          '<div class="people-card-actions">' +
          actions +
          "</div></div>"
        );
      })
      .join("");
    return (
      rows +
      '<div class="people-card people-card-felles" aria-hidden="false">' +
      '<div class="people-felles-title">Felles</div>' +
      '<p class="people-card-hint">Ikke en person – delte utgifter merkes «Felles» og fordeles likt mellom aktive personer. Kan ikke fjernes.</p>' +
      "</div>"
    );
  }

  function renderPeopleManage() {
    const focused = document.activeElement;
    const focusId =
      focused && focused.getAttribute && focused.getAttribute("data-people-rename");
    const focusVal = focusId && focused ? focused.value : null;
    const html = buildPeopleManageHtml();
    ["peopleManageList", "merPeopleManageList"].forEach(function (id) {
      const list = document.getElementById(id);
      if (list) list.innerHTML = html;
    });
    if (focusId) {
      const inp = document.querySelector(
        '#merPeopleManageList [data-people-rename="' +
          focusId.replace(/"/g, "") +
          '"], #peopleManageList [data-people-rename="' +
          focusId.replace(/"/g, "") +
          '"]'
      );
      // Prefer Mer list if visible, else first match
      const candidates = document.querySelectorAll('[data-people-rename="' + focusId.replace(/"/g, "") + '"]');
      let target = null;
      for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        const panel = el.closest(".tab-panel, .modal, dialog");
        if (panel && panel.hidden) continue;
        target = el;
        break;
      }
      if (!target && candidates.length) target = candidates[0];
      if (target) {
        if (focusVal != null) target.value = focusVal;
        try { target.focus({ preventScroll: true }); } catch (e) { /* */ }
      }
    }
  }

  var CHART_COLORS = [
    "#0f766e", "#ea580c", "#2563eb", "#7c3aed", "#059669",
    "#db2777", "#0891b2", "#ca8a04", "#dc2626", "#4f46e5"
  ];

  function buildChartSlices(c, mode) {
    const useActual = mode !== "budget";
    let items = c.catStats
      .map(function (s) {
        return {
          name: s.cat.name,
          value: useActual ? s.actual : s.planned
        };
      })
      .filter(function (x) { return x.value > 0; })
      .sort(function (a, b) { return b.value - a.value; });

    const total = items.reduce(function (s, x) { return s + x.value; }, 0);
    if (!total) return { slices: [], total: 0 };

    // Group tiny slices / cap at 8
    const kept = [];
    let other = 0;
    items.forEach(function (item, i) {
      const pct = (item.value / total) * 100;
      if (i < 8 && pct >= 3) kept.push(item);
      else other += item.value;
    });
    if (other > 0) kept.push({ name: "Annet", value: other });
    return { slices: kept, total: total };
  }

  function polarToCartesian(cx, cy, r, angleDeg) {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }

  function describeArc(cx, cy, r, startAngle, endAngle) {
    const start = polarToCartesian(cx, cy, r, endAngle);
    const end = polarToCartesian(cx, cy, r, startAngle);
    const large = endAngle - startAngle <= 180 ? "0" : "1";
    return [
      "M", start.x, start.y,
      "A", r, r, 0, large, 0, end.x, end.y
    ].join(" ");
  }

  function renderChart(c) {
    const mode = state.settings.chartMode || "actual";
    const svg = $("#pieChart");
    const legend = $("#chartLegend");
    const empty = $("#chartEmpty");
    const wrap = $("#chartWrap");
    const data = buildChartSlices(c, mode);

    if (!data.slices.length) {
      svg.innerHTML = "";
      legend.innerHTML = "";
      wrap.hidden = true;
      empty.hidden = false;
      empty.querySelector("p").textContent =
        mode === "budget"
          ? "Ingen forventede utgifter satt ennå"
          : "Ingen utgifter logget ennå";
      return;
    }
    wrap.hidden = false;
    empty.hidden = true;

    const cx = 100, cy = 100, rOuter = 78, rInner = 46;
    let angle = 0;
    let paths = "";
    // Full circle special case
    if (data.slices.length === 1) {
      const color = CHART_COLORS[0];
      paths =
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + rOuter + '" fill="' + color + '"></circle>' +
        '<circle cx="' + cx + '" cy="' + cy + '" r="' + rInner + '" fill="#ffffff"></circle>';
    } else {
      data.slices.forEach(function (slice, i) {
        const sweep = (slice.value / data.total) * 360;
        const start = angle;
        const end = angle + sweep;
        // Donut segment via two arcs + lines
        const p1 = polarToCartesian(cx, cy, rOuter, start);
        const p2 = polarToCartesian(cx, cy, rOuter, end);
        const p3 = polarToCartesian(cx, cy, rInner, end);
        const p4 = polarToCartesian(cx, cy, rInner, start);
        const large = sweep > 180 ? 1 : 0;
        const d = [
          "M", p1.x, p1.y,
          "A", rOuter, rOuter, 0, large, 1, p2.x, p2.y,
          "L", p3.x, p3.y,
          "A", rInner, rInner, 0, large, 0, p4.x, p4.y,
          "Z"
        ].join(" ");
        paths +=
          '<path d="' + d + '" fill="' + CHART_COLORS[i % CHART_COLORS.length] + '" stroke="#fff" stroke-width="1.5"></path>';
        angle = end;
      });
    }
    // Center label
    const centerLabel = mode === "budget" ? "Forventet" : "Faktisk";
    paths +=
      '<text x="100" y="96" text-anchor="middle" font-size="11" fill="#5b6b66" font-weight="650">' +
      centerLabel +
      "</text>" +
      '<text x="100" y="114" text-anchor="middle" font-size="13" fill="#14201c" font-weight="800">' +
      escapeHtml(formatNOK(data.total).replace(" kr", "")) +
      ' kr</text>';
    svg.innerHTML = paths;
    svg.setAttribute(
      "aria-label",
      (mode === "budget" ? "Forventede utgifter" : "Faktiske utgifter") +
        " per kategori, totalt " +
        formatNOK(data.total)
    );

    legend.innerHTML = data.slices
      .map(function (slice, i) {
        const pct = Math.round((slice.value / data.total) * 100);
        return (
          "<li>" +
          '<span class="chart-swatch" style="background:' +
          CHART_COLORS[i % CHART_COLORS.length] +
          '"></span>' +
          '<span class="name">' +
          escapeHtml(slice.name) +
          "</span>" +
          '<span class="amt">' +
          formatNOK(slice.value) +
          "</span>" +
          '<span class="pct">' +
          pct +
          "%</span>" +
          "</li>"
        );
      })
      .join("");
  }

  function monthHealthStatus(c) {
    const ratio = c.plannedTotal > 0 ? c.actualBudgeted / c.plannedTotal : null;
    let status = "ok";
    let label = "På plan";
    if (ratio == null && c.samletUtgifter > 0) {
      status = "info";
      label = "Uten budsjett";
    } else if (ratio != null && ratio > 1.15) {
      status = "bad";
      label = "Over plan";
    } else if (ratio != null && ratio > 1.0) {
      status = "warn";
      label = "Litt over";
    } else if (ratio != null && ratio > 0.9) {
      status = "warn";
      label = "Tett på";
    } else if (!c.hasAnyData || (c.plannedTotal <= 0 && c.samletUtgifter <= 0)) {
      status = "idle";
      label = "";
    }
    const pct =
      c.plannedTotal > 0
        ? Math.min(120, Math.round((c.actualBudgeted / c.plannedTotal) * 100))
        : c.samletUtgifter > 0
          ? 100
          : 0;
    return { status: status, label: label, ratio: ratio, pct: pct };
  }

  function renderSafeSpend(c) {
    const valEl = $("#safeSpendValue");
    const hintEl = $("#safeSpendHint");
    const titleEl = $("#safeSpendTitle");
    const mini = $("#planSafeMini");
    const miniVal = $("#planSafeMiniValue");
    const miniLabel = mini && mini.querySelector(".plan-safe-label");
    const view = (state.settings && state.settings.innUtView) || "samlet";
    const isPerson = view !== "samlet";
    const pc = isPerson && c && c.byPerson ? c.byPerson[view] : null;
    const whoName = isPerson ? nameOf(view) : "";

    // Pick household or per-person Trygg å bruke (same tabs as Inn/Ut)
    let amount, raw, mode, remAll, remFast, buf, planHead, brukForHint, hasBrukForHint;
    if (isPerson && pc) {
      amount = typeof pc.safeToSpend === "number" ? pc.safeToSpend : 0;
      raw = typeof pc.safeToSpendRaw === "number" ? pc.safeToSpendRaw : 0;
      mode = pc.safeToSpendMode || "plan";
      remAll =
        typeof pc.remainingBudgetAll === "number" ? pc.remainingBudgetAll : 0;
      remFast =
        typeof pc.remainingFastBudgets === "number"
          ? pc.remainingFastBudgets
          : 0;
      buf =
        typeof pc.spendBufferShare === "number" ? pc.spendBufferShare : 0;
      planHead =
        typeof pc.safeToSpendPlan === "number" ? pc.safeToSpendPlan : 0;
      const bal = c.balanceByPerson && c.balanceByPerson[view];
      brukForHint =
        bal && bal.bruk != null && Number.isFinite(Number(bal.bruk))
          ? Number(bal.bruk)
          : 0;
      hasBrukForHint = !!(pc.hasBrukBalance);
    } else {
      amount = c && typeof c.safeToSpend === "number" ? c.safeToSpend : 0;
      raw = c && typeof c.safeToSpendRaw === "number" ? c.safeToSpendRaw : 0;
      mode = (c && c.safeToSpendMode) || "plan";
      remAll =
        c && typeof c.remainingBudgetAll === "number"
          ? c.remainingBudgetAll
          : 0;
      remFast =
        c && typeof c.remainingFastBudgets === "number"
          ? c.remainingFastBudgets
          : 0;
      buf = c && typeof c.spendBuffer === "number" ? c.spendBuffer : 0;
      planHead =
        c && typeof c.safeToSpendPlan === "number" ? c.safeToSpendPlan : 0;
      brukForHint =
        c && typeof c.totalBruk === "number" ? c.totalBruk : 0;
      hasBrukForHint = !!(c && c.hasBrukBalances);
    }

    const fromSaldo = mode === "saldo";
    const show = !!(
      c &&
      (c.hasPlannedIncome ||
        c.hasBudgets ||
        c.samletUtgifter > 0 ||
        c.hasBrukBalances ||
        (pc && (pc.planInn > 0 || pc.utgifter > 0 || pc.hasBrukBalance)))
    );

    const baseTitle = fromSaldo
      ? "Trygg å bruke (fra saldo)"
      : "Trygg å bruke";
    const titled = isPerson && whoName
      ? baseTitle + " · " + whoName
      : baseTitle;

    if (titleEl) titleEl.textContent = titled;
    if (miniLabel) miniLabel.textContent = titled;

    if (valEl) {
      valEl.textContent = show ? formatNOK(amount) : "—";
      valEl.className =
        "safe-spend-value" +
        (amount <= 0 && raw < 0
          ? " is-over"
          : amount <= 0
            ? " is-zero"
            : amount < 2000
              ? " is-tight"
              : "");
    }
    if (hintEl) {
      const wantSaldo = !c || c.useSaldoInSafeToSpend !== false;
      if (!show) {
        hintEl.classList.remove("is-saldo-short");
        hintEl.textContent = wantSaldo
          ? "Sett brukssaldo for mer treffsikkert tall – eller plan-formel: forventet inn minus brukt minus faste igjen."
          : "Det du trygt kan bruke nå: forventet inntekt minus det du har brukt, minus faste utgifter som gjenstår.";
      } else if (fromSaldo) {
        const saldoShort =
          amount <= 0 &&
          (planHead > 0 || (remAll > 0 && remAll > brukForHint));
        hintEl.classList.toggle(
          "is-saldo-short",
          !!saldoShort || (amount <= 0 && raw < 0)
        );
        const whose =
          isPerson && whoName ? " for " + whoName : "";
        if (amount <= 0 && (raw < 0 || saldoShort)) {
          hintEl.textContent =
            "Saldo på bruk" +
            whose +
            " dekker ikke gjenstående budsjett" +
            (buf > 0 ? " + buffer" : "") +
            (planHead > 0
              ? " (plan-modus ville vist ca. " + formatNOK(planHead) + ")"
              : "") +
            ". Oppdater saldo eller plan.";
        } else if (amount <= 0) {
          hintEl.textContent =
            "Ingen fri margin på bruk akkurat nå (gjenstående budsjett" +
            (buf > 0 ? " og buffer" : "") +
            " er dekket først).";
        } else {
          hintEl.textContent =
            "Fra brukssaldo" +
            whose +
            ": ca. " +
            formatNOK(amount) +
            " etter gjenstående plan" +
            (remAll > 0 ? " (" + formatNOK(remAll) + " igjen)" : "") +
            (buf > 0
              ? " og buffer " +
                formatNOK(buf) +
                (isPerson ? " (andel)" : "")
              : "") +
            ". Spare er utenfor.";
        }
      } else {
        hintEl.classList.remove("is-saldo-short");
        let base;
        if (amount <= 0 && raw < 0) {
          base =
            "Du har brukt mer enn forventet hittil. Juster plan eller hold igjen litt – det ordner seg.";
        } else if (amount <= 0) {
          base =
            "Ingen fri buffer akkurat nå (faste utgifter er dekket først).";
        } else {
          base =
            "Du kan bruke ca. " +
            formatNOK(amount) +
            " uten å røre faste utgifter" +
            (remFast > 0 ? " (" + formatNOK(remFast) + " faste igjen)" : "") +
            ".";
        }
        if (wantSaldo && !hasBrukForHint) {
          base += " Sett brukssaldo for mer treffsikkert tall.";
        }
        hintEl.textContent = base;
      }
    }
    if (mini && miniVal) {
      if (show) {
        mini.hidden = false;
        miniVal.textContent = formatNOK(amount);
      } else {
        mini.hidden = true;
      }
    }
  }

  function renderSaldoHero(c) {
    const nowEl = $("#saldoNowBruk");
    const etterEl = $("#saldoEtterLonn");
    const wrap = $("#saldoHeroCard");
    const legacy = $("#statForventetWrap");
    if (nowEl) {
      nowEl.textContent = c && c.hasBrukBalances
        ? formatNOK(c.totalBruk || 0)
        : "—";
    }
    if (etterEl) {
      if (c && c.etterLonn != null) {
        etterEl.textContent = formatNOK(c.etterLonn);
        etterEl.className =
          "saldo-hero-value" + (c.etterLonn < 0 ? " is-neg" : "");
      } else {
        etterEl.textContent = "Sett bruk først";
        etterEl.className = "saldo-hero-value is-muted";
      }
    }
    // Hide legacy «Forventet på konto etter» — merged into this card
    if (legacy) legacy.hidden = true;
    if (wrap) wrap.hidden = false;
  }

  function renderHealth(c) {
    const pill = $("#healthPill");
    const box = $("#healthSummary");
    const meter = $("#healthMeter");
    const fill = $("#healthMeterFill");
    const meterLabel = $("#healthMeterLabel");
    const health = monthHealthStatus(c);

    if (health.status === "idle") {
      if (pill) pill.hidden = true;
      if (box) box.hidden = true;
      if (meter) meter.hidden = true;
      return;
    }

    if (pill) {
      pill.hidden = !health.label;
      pill.textContent = health.label;
      pill.className =
        "pill health-visible " +
        (health.status === "bad"
          ? "red"
          : health.status === "warn"
            ? "orange"
            : health.status === "info"
              ? "blue"
              : "green");
    }

    if (meter && fill && meterLabel) {
      meter.hidden = false;
      const width = Math.min(100, health.pct);
      fill.style.width = width + "%";
      fill.className =
        "health-meter-fill" +
        (health.status === "bad"
          ? " bad"
          : health.status === "warn"
            ? " warn"
            : health.status === "info"
              ? " info"
              : "");
      meterLabel.textContent =
        health.label +
        (c.plannedTotal > 0 ? " · " + health.pct + "%" : "");
    }

    if (!box) return;
    const overCats = c.catStats
      .filter(function (s) {
        return s.actual > s.planned && (s.planned > 0 || s.actual > 0);
      })
      .sort(function (a, b) {
        return b.actual - b.planned - (a.actual - a.planned);
      });

    let html = "<strong>Månedhelse:</strong> ";
    if (c.plannedTotal > 0) {
      html +=
        "brukt " +
        formatNOK(c.actualBudgeted) +
        " av " +
        formatNOK(c.plannedTotal) +
        " budsjettert (" +
        percent(c.actualBudgeted, c.plannedTotal) +
        "%).";
    } else {
      html += "ingen budsjettbeløp satt ennå.";
    }
    if (overCats.length) {
      html += "<ul>";
      overCats.slice(0, 3).forEach(function (s) {
        const diff = s.actual - s.planned;
        html +=
          "<li>" +
          escapeHtml(s.cat.name) +
          ": " +
          formatNOK(s.actual) +
          (s.planned > 0 ? " / " + formatNOK(s.planned) : "") +
          " (" +
          formatNOKSigned(diff) +
          ")</li>";
      });
      html += "</ul>";
    } else if (c.plannedTotal > 0) {
      html += "<ul><li>Ingen kategorier over budsjett 👍</li></ul>";
    }
    box.innerHTML = html;
    box.hidden = false;
  }

  function renderVsPrev(c) {
    const el = $("#vsPrevMonth");
    const prev = prevMonthSpend();
    if (prev == null || prev === 0) {
      el.hidden = true;
      return;
    }
    const cur = c.samletUtgifter;
    const change = ((cur - prev) / prev) * 100;
    const rounded = Math.round(change);
    const sign = rounded > 0 ? "+" : "";
    el.textContent =
      "Utgifter vs forrige måned: " +
      sign +
      rounded +
      "% (" +
      formatNOK(prev) +
      " → " +
      formatNOK(cur) +
      ")";
    el.hidden = false;
  }

  function sortCatStats(stats, sort) {
    const arr = stats.slice();
    if (sort === "alpha") {
      arr.sort(function (a, b) {
        return a.cat.name.localeCompare(b.cat.name, "nb");
      });
    } else if (sort === "egen") {
      arr.sort(function (a, b) {
        const ao = a.cat.order != null ? Number(a.cat.order) : 9999;
        const bo = b.cat.order != null ? Number(b.cat.order) : 9999;
        if (ao !== bo) return ao - bo;
        return a.cat.name.localeCompare(b.cat.name, "nb");
      });
    } else {
      arr.sort(function (a, b) {
        const aOver = a.actual - a.planned;
        const bOver = b.actual - b.planned;
        const aIsOver = a.actual > a.planned || (a.planned === 0 && a.actual > 0);
        const bIsOver = b.actual > b.planned || (b.planned === 0 && b.actual > 0);
        if (aIsOver !== bIsOver) return aIsOver ? -1 : 1;
        if (aIsOver && bIsOver) return bOver - aOver;
        // Stable secondary: user order
        const ao = a.cat.order != null ? Number(a.cat.order) : 9999;
        const bo = b.cat.order != null ? Number(b.cat.order) : 9999;
        if (ao !== bo) return ao - bo;
        return a.cat.name.localeCompare(b.cat.name, "nb");
      });
    }
    return arr;
  }

  function fellesShareRowsForPerson(m, personId, stats) {
    const people = state.people;
    return (stats || [])
      .map(function (s) {
        const plannedFull = budgetForOwner(m, s.cat.id, "felles");
        const actualFull = Calc.actualForCategoryOwner(m, s.cat.id, s.cat.name, "felles");
        if (plannedFull <= 0 && actualFull <= 0) return null;
        const pct = Calc.fellesSharePercent(s.cat, personId, people);
        const planned = Calc.fellesShare(s.cat, personId, people, plannedFull);
        const actual = Calc.fellesShare(s.cat, personId, people, actualFull);
        return {
          cat: s.cat,
          ownerId: personId,
          planned: planned,
          actual: actual,
          remain: planned - actual,
          over: (actual > planned && planned > 0) || (planned === 0 && actual > 0),
          readOnlyShare: true,
          splitPct: pct
        };
      })
      .filter(Boolean);
  }

  function renderSectionChipsHtml(ownerId) {
    const isFelles = ownerId === "felles";
    let html = '<div class="cat-section-quick">';
    html +=
      '<div class="cat-quick-actions">' +
      '<button type="button" class="btn primary cat-new-btn" data-new-cat-owner="' +
      escapeAttr(ownerId) +
      '">+ Ny kategori</button>' +
      "</div>";

    if (isFelles) {
      const chips = remainingFellesChips({ includeMobil: true });
      html += '<div class="cat-chips-block">';
      html += '<p class="cat-chips-label">Felles-forslag</p>';
      if (chips.length) {
        html += '<div class="cat-chips">';
        chips.forEach(function (s) {
          html +=
            '<button type="button" class="cat-chip" data-suggest="' +
            escapeAttr(s.name) +
            '" data-suggest-owner="felles">' +
            escapeHtml(s.name) +
            "</button>";
        });
        html += "</div>";
      } else {
        html += '<p class="cat-chips-empty hint compact">Alle felles-forslag er lagt til</p>';
      }
      html += "</div>";
    } else {
      const personal = remainingPersonalChips(ownerId);
      html += '<div class="cat-chips-block">';
      html += '<p class="cat-chips-label">Forslag for ' + escapeHtml(nameOf(ownerId)) + "</p>";
      if (personal.length) {
        html += '<div class="cat-chips">';
        personal.forEach(function (s) {
          html +=
            '<button type="button" class="cat-chip" data-suggest="' +
            escapeAttr(s.name) +
            '" data-suggest-owner="' +
            escapeAttr(ownerId) +
            '">' +
            escapeHtml(s.name) +
            "</button>";
        });
        html += "</div>";
      } else {
        html += '<p class="cat-chips-empty hint compact">Personlige forslag er lagt til</p>';
      }
      html += "</div>";

      const shared = remainingFellesChips({ includeMobil: false });
      html += '<div class="cat-chips-block cat-chips-felles-forslag">';
      html += '<p class="cat-chips-label">Felles-forslag <span class="cat-chips-sub">(legges til som Felles)</span></p>';
      if (shared.length) {
        html += '<div class="cat-chips">';
        shared.forEach(function (s) {
          html +=
            '<button type="button" class="cat-chip cat-chip-felles" data-suggest="' +
            escapeAttr(s.name) +
            '" data-suggest-owner="felles">' +
            escapeHtml(s.name) +
            "</button>";
        });
        html += "</div>";
      } else {
        html += '<p class="cat-chips-empty hint compact">Felles-forslag er lagt til</p>';
      }
      html += "</div>";
    }
    html += "</div>";
    return html;
  }

  function categoryBelongsInSection(m, cat, ownerId) {
    if ((cat.owner || "felles") === ownerId) return true;
    // Legacy: same category used with per-owner budgets under another owner field
    const planned = budgetForOwner(m, cat.id, ownerId);
    const actual = Calc.actualForCategoryOwner(m, cat.id, cat.name, ownerId);
    return planned > 0 || actual > 0;
  }

  function renderCategories(m, c) {
    const list = $("#categoryList");
    const empty = $("#categoryEmpty");
    const stats = c.catStats.slice();
    const hasOwnedRows = stats.some(function (s) { return !!s.cat; });

    if (empty) {
      empty.hidden = hasOwnedRows;
      if (!hasOwnedRows) {
        empty.innerHTML =
          '<span class="empty-icon" aria-hidden="true">✨</span>' +
          "<p><strong>Kom i gang med kategorier</strong></p>" +
          "<p class=\"hint compact\">Trykk forslag under Mathias, Andrea eller Felles – eller «+ Ny kategori».</p>";
      }
    }

    const sort = state.settings.sort || "over";
    const people = activePeopleList();

    function ownerRows(ownerId) {
      const rows = stats
        .filter(function (s) {
          return categoryBelongsInSection(m, s.cat, ownerId);
        })
        .map(function (s) {
          const planned = budgetForOwner(m, s.cat.id, ownerId);
          const actual = Calc.actualForCategoryOwner(m, s.cat.id, s.cat.name, ownerId);
          return {
            cat: s.cat,
            ownerId: ownerId,
            planned: planned,
            actual: actual,
            remain: planned - actual,
            over: (actual > planned && planned > 0) || (planned === 0 && actual > 0)
          };
        });
      return sortCatStats(rows, sort);
    }

    function sectionOpen(key) {
      if (Object.prototype.hasOwnProperty.call(catGroupsOpen, key)) {
        return !!catGroupsOpen[key];
      }
      return true;
    }

    function renderOwnerSection(key, label, ownerId, hint) {
      const rows = ownerRows(ownerId);
      const planned = rows.reduce(function (s, x) { return s + x.planned; }, 0);
      const actual = rows.reduce(function (s, x) { return s + x.actual; }, 0);
      const open = sectionOpen(key);
      const pct = planned > 0 ? Math.min(100, percent(actual, planned)) : (actual > 0 ? 100 : 0);
      const over = actual > planned && (planned > 0 || actual > 0);
      let html =
        '<div class="cat-group person-budget-group' +
        (open ? " is-open" : "") +
        '" data-cat-group="' +
        escapeAttr(key) +
        '">' +
        '<button type="button" class="cat-group-header sticky-group" data-toggle-group="' +
        escapeAttr(key) +
        '" aria-expanded="' +
        (open ? "true" : "false") +
        '">' +
        '<span class="cat-group-chevron" aria-hidden="true">' +
        (open ? "▾" : "▸") +
        "</span>" +
        '<span class="cat-group-title">' +
        escapeHtml(label) +
        "</span>" +
        '<span class="group-sum">' +
        formatNOK(planned) +
        "</span>" +
        '<span class="group-progress' +
        (over ? " over" : "") +
        '" aria-hidden="true"><span style="width:' +
        pct +
        '%"></span></span>' +
        "</button>";
      if (open) {
        html += '<div class="cat-group-body">';
        if (hint) {
          html += '<p class="hint compact cat-owner-hint">' + escapeHtml(hint) + "</p>";
        }
        const faste = rows.filter(function (r) { return r.cat.type === "fast"; });
        const variable = rows.filter(function (r) { return r.cat.type !== "fast"; });
        function subLabel(t, arr) {
          if (!arr.length) return "";
          return (
            '<div class="cat-subhead">' +
            escapeHtml(t) +
            "</div>" +
            arr.map(function (r) { return renderCatOwnerRow(m, r); }).join("")
          );
        }
        html += subLabel("Faste", faste) + subLabel("Variable", variable);
        if (ownerId !== "felles") {
          const shareRows = fellesShareRowsForPerson(m, ownerId, stats);
          if (shareRows.length) {
            html +=
              '<div class="cat-subhead">Andel felles</div>' +
              shareRows.map(function (r) { return renderCatOwnerRow(m, r); }).join("");
          }
        }
        html += renderSectionChipsHtml(ownerId);
        html += "</div>";
      }
      html += "</div>";
      return html;
    }

    let html = "";
    people.forEach(function (p) {
      html += renderOwnerSection("person:" + p.id, p.name, p.id, null);
    });
    html += renderOwnerSection(
      "felles",
      "Felles",
      "felles",
      "Delte husstandskostnader. Fordeling per kategori (standard 50/50) – endre under «Fordeling» når kategorien er utvidet."
    );
    list.innerHTML = html;
    const quick = $("#catQuickAdd");
    if (quick) {
      quick.innerHTML = "";
      quick.hidden = true;
    }
    enableCatListDrag(list);
  }

  function renderQuickAddChips() {
    // Chips live inside each Plan section (renderCategories).
    const wrap = $("#catQuickAdd");
    if (wrap) {
      wrap.innerHTML = "";
      wrap.hidden = true;
    }
  }

  function openNewCatDialog(presetName, defaultOwner) {
    const owner = resolveSuggestOwner(defaultOwner || "felles");
    fillOwnerSelect($("#newCatOwner"), owner);
    renderCatManage();
    if (presetName) $("#newCatName").value = presetName;
    else $("#newCatName").value = "";
    const sug = presetName ? suggestionByName(presetName) : null;
    if (sug) {
      $("#newCatType").value = sug.type;
    } else {
      $("#newCatType").value = "variabel";
    }
    fillOwnerSelect($("#newCatOwner"), owner);
    openDlg("#dlgCats");
    setTimeout(function () {
      const el = $("#newCatName");
      if (el) {
        try { el.focus(); } catch (err) { /* */ }
      }
    }, 60);
  }

  function renderCatLinesBlock(m, s) {
    if (s.readOnlyShare) return "";
    const lines = Calc.getBudgetLines(m, s.cat.id, s.ownerId);
    const hasLines = lines.length > 0;
    const sumMonthly = Calc.sumBudgetLines(lines, state.view.month);
    const monthOpts = MONTHS.map(function (name, i) {
      return { i: i, name: name };
    });
    const rows = lines
      .map(function (line) {
        const calcKey = "line|" + s.cat.id + "|" + s.ownerId + "|" + line.id;
        const amt =
          line.amount != null && line.amount !== ""
            ? String(line.amount).replace(".", ",")
            : "";
        const interval = line.interval || "month";
        const mode = line.mode || "spread";
        const payMonth = line.month != null ? Number(line.month) : 0;
        const unit =
          interval === "year" ? "kr/år" : interval === "quarter" ? "kr/kv" : "kr";
        const showExtra = interval === "year" || interval === "quarter";
        const monthlyHint = Calc.lineMonthlyContribution(line, state.view.month);
        let hintHtml = "";
        if (showExtra && mode === "spread") {
          const raw = Number(line.amount) || 0;
          const per = interval === "year" ? raw / 12 : raw / 3;
          const period = interval === "year" ? "år" : "kvartal";
          hintHtml =
            '<p class="hint compact cat-line-interval-hint">' +
            escapeHtml(formatNOK(raw)) +
            "/" +
            period +
            " ≈ " +
            escapeHtml(formatNOK(per)) +
            "/mnd</p>";
        } else if (showExtra && mode === "once") {
          hintHtml =
            '<p class="hint compact cat-line-interval-hint">Telles ' +
            escapeHtml(formatNOK(Number(line.amount) || 0)) +
            " i " +
            escapeHtml(MONTHS[payMonth] || "") +
            (interval === "quarter" ? " (og samme kvartalsmåned)" : "") +
            "</p>";
        }
        const monthSelect =
          '<label class="cat-line-month-label">Betales i' +
          '<select class="cat-line-month" data-line-month="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" aria-label="Betalingsmåned">' +
          monthOpts
            .map(function (o) {
              return (
                '<option value="' +
                o.i +
                '"' +
                (o.i === payMonth ? " selected" : "") +
                ">" +
                escapeHtml(o.name) +
                "</option>"
              );
            })
            .join("") +
          "</select></label>";
        const modeRadios =
          '<div class="cat-line-mode" role="radiogroup" aria-label="Hvordan telles i månedsbudsjett">' +
          '<label class="cat-line-mode-opt"><input type="radio" name="line-mode-' +
          escapeAttr(line.id) +
          '" data-line-mode="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" value="spread"' +
          (mode === "spread" ? " checked" : "") +
          " /> Fordel</label>" +
          '<label class="cat-line-mode-opt"><input type="radio" name="line-mode-' +
          escapeAttr(line.id) +
          '" data-line-mode="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" value="once"' +
          (mode === "once" ? " checked" : "") +
          " /> I måned</label>" +
          "</div>";
        const extra =
          showExtra
            ? '<div class="cat-line-extra">' +
              modeRadios +
              monthSelect +
              hintHtml +
              '<p class="hint compact cat-line-contrib">Denne måneden: ' +
              escapeHtml(formatNOK(monthlyHint)) +
              "</p>" +
              "</div>"
            : "";
        return (
          '<div class="cat-line-row" data-line-id="' +
          escapeAttr(line.id) +
          '">' +
          '<input type="text" class="cat-line-name" maxlength="40" data-line-name="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" value="' +
          escapeAttr(line.name || "") +
          '" placeholder="Navn (f.eks. Netflix)" autocomplete="off" aria-label="Navn på underlinje" />' +
          '<div class="cat-line-amt-wrap">' +
          '<input type="text" inputmode="decimal" class="cat-line-amount amount-expr" data-line-amount="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" data-calc-input-key="' +
          escapeAttr(calcKey) +
          '" value="' +
          escapeAttr(amt) +
          '" placeholder="0" autocomplete="off" aria-label="Beløp underlinje" />' +
          '<span class="unit">' +
          escapeHtml(unit) +
          "</span>" +
          '<button type="button" class="btn ghost xs calc-toggle" data-calc-panel="planIncCalc" data-calc-for="' +
          escapeAttr(calcKey) +
          '" aria-expanded="false" aria-controls="planIncCalc">Kalkulator</button>' +
          "</div>" +
          '<label class="cat-line-interval-label">Intervall' +
          '<select class="cat-line-interval" data-line-interval="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" aria-label="Intervall">' +
          '<option value="month"' +
          (interval === "month" ? " selected" : "") +
          ">Månedlig</option>" +
          '<option value="year"' +
          (interval === "year" ? " selected" : "") +
          ">Årlig</option>" +
          '<option value="quarter"' +
          (interval === "quarter" ? " selected" : "") +
          ">Kvartalsvis</option>" +
          "</select></label>" +
          extra +
          '<button type="button" class="btn ghost xs cat-line-del" data-line-del="' +
          escapeAttr(line.id) +
          '" data-line-cat="' +
          escapeAttr(s.cat.id) +
          '" data-line-owner="' +
          escapeAttr(s.ownerId) +
          '" aria-label="Slett underlinje">×</button>' +
          "</div>"
        );
      })
      .join("");
    return (
      '<div class="cat-lines-block" data-lines-cat="' +
      escapeAttr(s.cat.id) +
      '" data-lines-owner="' +
      escapeAttr(s.ownerId) +
      '">' +
      '<div class="cat-lines-label">Underlinjer' +
      (hasLines ? " · " + formatNOK(sumMonthly) + " denne mnd" : "") +
      "</div>" +
      '<p class="hint compact cat-lines-hint">Valgfritt: del opp forventet (f.eks. Netflix, Spotify). Årlige/kvartalsvise beløp fordeles eller telles i valgt måned.</p>' +
      rows +
      '<button type="button" class="btn secondary sm" data-line-add="' +
      escapeAttr(s.cat.id) +
      '" data-line-owner="' +
      escapeAttr(s.ownerId) +
      '">+ Linje</button>' +
      "</div>"
    );
  }

  function renderCatOwnerRow(m, s) {
    const planned = s.planned;
    const actual = s.actual;
    const remain = planned - actual;
    const pctRaw = planned > 0 ? percent(actual, planned) : (actual > 0 ? 100 : 0);
    const pct = Math.min(100, pctRaw);
    const isOver = actual > planned && (planned > 0 || actual > 0);
    const overRatio = planned > 0 ? actual / planned : (actual > 0 ? 2 : 0);
    const isMildOver = isOver && overRatio < 1.15; // <15% over → amber, not red
    const isExact = planned > 0 && actual === planned;
    const isSoftWarn = !isOver && planned > 0 && pctRaw >= 80;
    const progClass = isOver
      ? (isMildOver ? "warn" : "over")
      : isSoftWarn || pct >= 80
        ? "warn"
        : "";
    const rowClass = isOver
      ? (isMildOver ? "over-soft" : "over")
      : isExact
        ? "exact"
        : isSoftWarn
          ? "warn-soft under"
          : "under";
    const remainClass = remain < 0 ? (isMildOver ? "warn" : "bad") : "ok";
    const remainText =
      planned === 0 && actual === 0
        ? "Sett forventet"
        : remain < 0
          ? formatNOK(Math.abs(remain)) + " over plan"
          : formatNOK(remain) + " igjen";

    const raw = budgetForOwner(m, s.cat.id, s.ownerId);
    const entry = m.budgets && m.budgets[s.cat.id];
    let hasSet = false;
    if (entry != null && typeof entry === "object") {
      hasSet = entry[s.ownerId] != null && entry[s.ownerId] !== "";
    } else if (s.ownerId === "felles" && entry != null && entry !== "" && typeof entry !== "object") {
      hasSet = true;
    }
    const budgetVal = hasSet ? String(raw).replace(".", ",") : "";
    const catLines = Calc.getBudgetLines(m, s.cat.id, s.ownerId);
    const linesDrive = catLines.length > 0;
    const displayBudgetVal = linesDrive
      ? String(Calc.sumBudgetLines(catLines, state.view.month)).replace(".", ",")
      : budgetVal;

    const expandKey = (s.readOnlyShare ? "share:" : "") + s.ownerId + ":" + s.cat.id;
    const expanded = expandedCatId === expandKey;
    const isFast = s.cat.type === "fast";
    const fastBadge = isFast ? '<span class="badge-fast">Fast</span>' : "";
    const warnTag = isOver
      ? '<span class="cat-warn-tag' +
        (isMildOver ? "" : " over") +
        '">' +
        (isMildOver ? "Litt over" : "Over plan") +
        "</span>"
      : isSoftWarn
        ? '<span class="cat-warn-tag">Snart full</span>'
        : "";
    const ownerLabel = s.ownerId === "felles" ? "Felles" : nameOf(s.ownerId);

      const fordelingHtml =
        s.ownerId === "felles" && expanded
          ? renderFordelingBlock(s.cat, planned)
          : "";

      return (
      '<div class="cat-row compact ' +
      rowClass +
      (expanded ? " is-expanded" : "") +
      (s.readOnlyShare ? " is-share" : "") +
      '" data-cat="' +
      escapeAttr(s.cat.id) +
      '" data-budget-owner="' +
      escapeAttr(s.ownerId) +
      '" data-cat-type="' +
      escapeAttr(s.cat.type) +
      '">' +
      (s.readOnlyShare
        ? ""
        : '<button type="button" class="cat-drag-handle" data-cat-drag="' +
          escapeAttr(s.cat.id) +
          '" aria-label="Flytt ' +
          escapeAttr(s.cat.name) +
          '" title="Hold og dra for å endre rekkefølge">⠿</button>') +
      '<button type="button" class="cat-row-summary" data-expand-cat="' +
      escapeAttr(expandKey) +
      '" aria-expanded="' +
      (expanded ? "true" : "false") +
      '">' +
      '<span class="cat-name"><span class="cat-name-wrap">' +
      escapeHtml(s.cat.name) +
      (s.readOnlyShare ? '<span class="badge-share">Andel</span>' : "") +
      fastBadge +
      warnTag +
      "</span></span>" +
      '<span class="cat-plan-val">' +
      formatNOK(planned) +
      "</span>" +
      '<span class="progress thin ' +
      progClass +
      '" aria-hidden="true"><span style="width:' +
      pct +
      '%"></span></span>' +
      '<span class="cat-actual-mini' +
      (isOver ? " bad" : "") +
      '">' +
      formatNOK(actual) +
      "</span>" +
      "</button>" +
      (expanded
        ? '<div class="cat-row-detail">' +
          '<div class="cat-detail-meta">' +
          escapeHtml(ownerLabel) +
          (s.readOnlyShare
            ? " · din andel av felles"
            : s.ownerId === "felles"
              ? " · forventet for husstanden"
              : " · forventet for denne personen") +
          (s.cat.autoFill ? " · autofyll" : "") +
          (s.splitPct != null ? " · " + s.splitPct + " %" : "") +
          "</div>" +
          '<div class="cat-detail-row">' +
          "<span>Faktisk (denne)</span><strong>" +
          formatNOK(actual) +
          "</strong></div>" +
          '<div class="cat-detail-row">' +
          '<span class="cat-remain ' +
          remainClass +
          '">' +
          escapeHtml(remainText) +
          "</span></div>" +
          (s.readOnlyShare
            ? ""
            : '<div class="cat-budget-row' +
              (linesDrive ? " is-derived" : "") +
              '">' +
              "<label>Forventet" +
              (linesDrive ? " (sum)" : "") +
              "</label>" +
              '<input type="text" inputmode="decimal" data-budget="' +
              escapeAttr(s.cat.id) +
              '" data-budget-owner="' +
              escapeAttr(s.ownerId) +
              '" value="' +
              escapeAttr(displayBudgetVal) +
              '" placeholder="0" autocomplete="off"' +
              (linesDrive ? " readonly" : "") +
              ' aria-label="Forventet ' +
              escapeAttr(s.cat.name) +
              " (" +
              escapeAttr(ownerLabel) +
              ')" />' +
              '<span class="unit">kr</span>' +
              "</div>" +
              renderCatLinesBlock(m, s)) +
          fordelingHtml +
          '<div class="progress ' +
          progClass +
          '" aria-hidden="true"><span style="width:' +
          pct +
          '%"></span></div>' +
          "</div>"
        : "") +
      "</div>"
    );
  }

  function renderFordelingBlock(cat, plannedFelles) {
    const people = activePeopleList();
    const split = Calc.getCategorySplit(cat, state.people);
    const sum = Calc.splitSum(split, state.people);
    const sumOk = Math.abs(sum - 100) < 0.1;
    const allZero = people.every(function (p) {
      const v = split[p.id];
      return !v || Number(v) === 0;
    });
    let rows = people
      .map(function (p) {
        const pct = split[p.id] != null ? split[p.id] : 0;
        const shareKr =
          plannedFelles > 0 ? (plannedFelles * pct) / 100 : 0;
        return (
          '<div class="fordeling-person">' +
          '<label class="fordeling-name" for="split-' +
          escapeAttr(cat.id) +
          "-" +
          escapeAttr(p.id) +
          '">' +
          escapeHtml(p.name) +
          "</label>" +
          '<input type="number" inputmode="decimal" min="0" max="100" step="1" class="fordeling-pct" data-split-cat="' +
          escapeAttr(cat.id) +
          '" data-split-person="' +
          escapeAttr(p.id) +
          '" id="split-' +
          escapeAttr(cat.id) +
          "-" +
          escapeAttr(p.id) +
          '" value="' +
          escapeAttr(String(pct)) +
          '" aria-label="Andel ' +
          escapeAttr(p.name) +
          '" />' +
          '<span class="unit">%</span>' +
          '<span class="fordeling-kr">' +
          formatNOK(shareKr) +
          "</span>" +
          "</div>"
        );
      })
      .join("");
    const fixLabel = allZero
      ? "Fordel likt (100 %)"
      : "Normaliser til 100 %";
    const fixHtml = sumOk
      ? ""
      : '<div class="fordeling-fix-actions">' +
        '<button type="button" class="btn secondary sm" data-normalize-split="' +
        escapeAttr(cat.id) +
        '">' +
        fixLabel +
        "</button>" +
        '<span class="hint compact">Andelene må summere til 100 %.</span>' +
        "</div>";
    return (
      '<div class="fordeling-block' +
      (sumOk ? "" : " has-bad-sum") +
      '" data-fordeling-cat="' +
      escapeAttr(cat.id) +
      '">' +
      '<div class="fordeling-label">Fordeling</div>' +
      rows +
      '<div class="fordeling-sum' +
      (sumOk ? "" : " warn") +
      '">' +
      (sumOk
        ? "Sum " + formatNum(sum) + " %"
        : "Sum " + formatNum(sum) + " % — må være 100 %") +
      "</div>" +
      fixHtml +
      "</div>"
    );
  }

  function formatNum(n) {
    const x = Math.round(Number(n) * 100) / 100;
    return String(x).replace(".", ",");
  }

  function getYearOverviewYear() {
    return yearOverviewYear != null ? yearOverviewYear : state.view.year;
  }

  function renderYearOverview() {
    const section = $("#sectionMerYear");
    if (!section) return;
    const y = getYearOverviewYear();
    const label = $("#yearOverviewLabel");
    if (label) label.textContent = String(y);
    const roll = Calc.yearRollup(
      state.months,
      y,
      state.people,
      state.categories,
      state.settings || {}
    );
    const t = roll.totals;
    const totalsEl = $("#yearOverviewTotals");
    if (totalsEl) {
      totalsEl.innerHTML =
        '<div class="year-total-card"><span>Plan inn</span><strong>' +
        formatNOK(t.planInn) +
        "</strong></div>" +
        '<div class="year-total-card"><span>Plan ut</span><strong>' +
        formatNOK(t.planUt) +
        "</strong></div>" +
        '<div class="year-total-card"><span>Faktisk ut</span><strong>' +
        formatNOK(t.actualUt) +
        "</strong></div>" +
        '<div class="year-total-card' +
        (t.tilOvers < 0 ? " is-neg" : " is-pos") +
        '"><span>Til overs</span><strong>' +
        formatNOK(t.tilOvers) +
        "</strong></div>";
    }
    const body = $("#yearOverviewBody");
    if (body) {
      body.innerHTML = roll.months
        .map(function (row) {
          const name = MONTHS[row.month].slice(0, 3);
          const cls = row.tilOvers < 0 ? "neg" : row.planInn || row.planUt || row.actualUt ? "" : "muted";
          return (
            '<tr class="' +
            cls +
            '" data-jump-month="' +
            row.month +
            '" data-jump-year="' +
            y +
            '">' +
            "<td>" +
            escapeHtml(name) +
            "</td>" +
            "<td>" +
            formatNOK(row.planInn) +
            "</td>" +
            "<td>" +
            formatNOK(row.planUt) +
            "</td>" +
            "<td>" +
            formatNOK(row.actualUt) +
            "</td>" +
            '<td class="' +
            (row.tilOvers < 0 ? "bad" : "ok") +
            '">' +
            formatNOK(row.tilOvers) +
            "</td>" +
            "</tr>"
          );
        })
        .join("");
    }
    const bars = $("#yearOverviewBars");
    if (bars) {
      const maxV = Math.max(
        1,
        ...roll.months.map(function (r) {
          return Math.max(r.planUt || 0, r.actualUt || 0, r.planInn || 0);
        })
      );
      const w = 300;
      const h = 56;
      const gap = 2;
      const groupW = (w - gap * 11) / 12;
      let svg =
        '<svg viewBox="0 0 ' +
        w +
        " " +
        h +
        '" width="100%" height="' +
        h +
        '" role="img" aria-label="Søylediagram for året">' +
        '<rect x="0" y="0" width="' +
        w +
        '" height="' +
        h +
        '" fill="transparent"/>';
      roll.months.forEach(function (row, i) {
        const x = i * (groupW + gap);
        const planH = Math.round(((row.planUt || 0) / maxV) * (h - 4));
        const actH = Math.round(((row.actualUt || 0) / maxV) * (h - 4));
        const bw = Math.max(2, (groupW - 2) / 2);
        svg +=
          '<rect x="' +
          x +
          '" y="' +
          (h - planH) +
          '" width="' +
          bw +
          '" height="' +
          planH +
          '" rx="1" fill="#0f766e" opacity="0.45"/>';
        svg +=
          '<rect x="' +
          (x + bw + 1) +
          '" y="' +
          (h - actH) +
          '" width="' +
          bw +
          '" height="' +
          actH +
          '" rx="1" fill="#b45309" opacity="0.7"/>';
      });
      svg += "</svg>";
      bars.innerHTML =
        svg +
        '<div class="year-bars-legend"><span class="leg plan">Plan ut</span><span class="leg actual">Faktisk ut</span></div>';
    }
  }


  function renderSparingTabs() {
    const tabs = $("#sparingTabs");
    if (!tabs) return;
    const view = state.settings.sparingView || "samlet";
    let html =
      '<button type="button" class="view-tab' +
      (view === "samlet" ? " active" : "") +
      '" role="tab" aria-selected="' +
      (view === "samlet" ? "true" : "false") +
      '" data-sparing-view="samlet">Samlet</button>';
    activePeopleList().forEach(function (person) {
      const on = view === person.id;
      html +=
        '<button type="button" class="view-tab' +
        (on ? " active" : "") +
        '" role="tab" aria-selected="' +
        (on ? "true" : "false") +
        '" data-sparing-view="' +
        escapeAttr(person.id) +
        '">' +
        escapeHtml(person.name) +
        "</button>";
    });
    tabs.innerHTML = html;
  }

  function renderSparing() {
    const section = $("#sectionSparing") || $("#sectionMerSparing");
    if (!section) return;
    renderSparingTabs();
    const stats = Calc.sparingStats(
      state.months,
      state.view.year,
      state.view.month,
      state.people
    );
    const view = state.settings.sparingView || "samlet";
    const slice =
      view === "samlet"
        ? stats.samlet
        : (stats.byPerson && stats.byPerson[view]) || {
            naa: 0,
            hasNaa: false,
            denneManeden: 0,
            planlagt: 0,
            iAar: 0,
            totalt: 0
          };

    const naaEl = $("#sparingNaa");
    const monthEl = $("#sparingMonth");
    const yearEl = $("#sparingYear");
    const totalEl = $("#sparingTotal");
    const naaHint = $("#sparingNaaHint");
    const yearHint = $("#sparingYearHint");

    if (naaEl) {
      naaEl.textContent = slice.hasNaa ? formatNOK(slice.naa) : "—";
    }
    if (monthEl) monthEl.textContent = formatNOK(slice.denneManeden || 0);
    const planlagtEl = $("#sparingPlanlagt");
    if (planlagtEl) planlagtEl.textContent = formatNOK(slice.planlagt || 0);
    const planlagtHint = $("#sparingPlanlagtHint");
    if (planlagtHint) {
      planlagtHint.textContent =
        view === "samlet"
          ? "Fra Plan → Sparing (alle)"
          : "Fra Plan → Sparing · " + nameOf(view);
    }
    if (yearEl) yearEl.textContent = formatNOK(slice.iAar || 0);
    if (totalEl) totalEl.textContent = formatNOK(slice.totalt || 0);
    if (naaHint) {
      naaHint.textContent =
        view === "samlet"
          ? "Sum spare saldo (Oversikt → Kontoer)"
          : "Spare saldo for " + nameOf(view);
    }
    if (yearHint) yearHint.textContent = String(state.view.year);

    const m = getMonth();
    ensureMonthShape(m);
    const list = $("#sparingList");
    const emptyHint = $("#sparingEmptyHint");
    let rows = (m.savings || []).slice();
    if (view !== "samlet") {
      rows = rows.filter(function (s) { return s.person === view; });
    }
    rows.sort(function (a, b) {
      const da = a.date || "";
      const db = b.date || "";
      if (da !== db) return db.localeCompare(da);
      return (b.id || "").localeCompare(a.id || "");
    });
    if (list) {
      if (!rows.length) {
        list.innerHTML = "";
      } else {
        list.innerHTML = rows
          .map(function (s) {
            const note = (s.note || "").trim();
            return (
              '<button type="button" class="sparing-row" data-edit-saving="' +
              escapeAttr(s.id) +
              '"><span class="sparing-row-main"><span class="sparing-row-who">' +
              escapeHtml(nameOf(s.person)) +
              '</span><span class="sparing-row-meta">' +
              escapeHtml(s.date || "") +
              (note ? " · " + escapeHtml(note) : "") +
              '</span></span><span class="sparing-row-amt">' +
              formatNOK(s.amount) +
              "</span></button>"
            );
          })
          .join("");
      }
    }
    if (emptyHint) {
      emptyHint.hidden = rows.length > 0 || (slice.denneManeden || 0) > 0 || (slice.hasNaa && slice.naa);
    }
    renderSavingsGoals();
  }

  function goalOwnerLabel(person) {
    if (person === "samlet") return "Husstand";
    if (person === "felles") return "Felles";
    return nameOf(person);
  }

  function fillGoalWhoSeg(selected) {
    const seg = $("#goalWhoSeg");
    if (!seg) return;
    const sel = selected || "samlet";
    let html =
      '<label><input type="radio" name="goalWho" value="samlet"' +
      (sel === "samlet" ? " checked" : "") +
      " /><span>Husstand</span></label>";
    html +=
      '<label><input type="radio" name="goalWho" value="felles"' +
      (sel === "felles" ? " checked" : "") +
      " /><span>Felles</span></label>";
    activePeopleList().forEach(function (person) {
      html +=
        '<label><input type="radio" name="goalWho" value="' +
        escapeAttr(person.id) +
        '"' +
        (sel === person.id ? " checked" : "") +
        " /><span>" +
        escapeHtml(person.name) +
        "</span></label>";
    });
    seg.innerHTML = html;
  }

  function openGoal(edit) {
    $("#goalTitle").textContent = edit ? "Rediger sparemål" : "Nytt sparemål";
    $("#goalId").value = edit ? edit.id : "";
    $("#goalName").value = edit ? edit.name || "" : "";
    $("#goalTarget").value = edit ? String(edit.target).replace(".", ",") : "";
    let monthlyPrefill = "";
    if (edit) {
      monthlyPrefill = String(edit.monthly).replace(".", ",");
    } else {
      const m = getMonth();
      ensureMonthShape(m);
      const view = state.settings.sparingView || "samlet";
      let planned = 0;
      if (view !== "samlet" && view !== "felles") {
        planned = Calc.plannedSparingFor(m, view);
      } else {
        planned = Calc.plannedSparingTotal(m, state.people);
      }
      if (planned > 0) monthlyPrefill = String(planned).replace(".", ",");
    }
    $("#goalMonthly").value = monthlyPrefill;
    $("#goalSaved").value = edit
      ? String(edit.saved != null ? edit.saved : 0).replace(".", ",")
      : "0";
    const defaultWho =
      edit
        ? edit.person
        : (state.settings.sparingView && state.settings.sparingView !== "samlet"
            ? state.settings.sparingView
            : "samlet");
    fillGoalWhoSeg(defaultWho);
    $("#goalDelete").hidden = !edit;
    openDlg("#dlgGoal");
    setTimeout(function () { $("#goalName").focus(); }, 50);
  }

  function renderSavingsGoals() {
    if (!Array.isArray(state.savingsGoals)) state.savingsGoals = [];
    const list = $("#goalsList");
    const emptyHint = $("#goalsEmptyHint");
    if (!list) return;
    const view = state.settings.sparingView || "samlet";
    let goals = state.savingsGoals.slice();
    if (view !== "samlet") {
      goals = goals.filter(function (g) { return g.person === view; });
    }
    goals.sort(function (a, b) {
      const pa = Calc.savingsGoalProgress(a);
      const pb = Calc.savingsGoalProgress(b);
      if (pa.reached !== pb.reached) return pa.reached ? 1 : -1;
      return String(a.name || "").localeCompare(String(b.name || ""), "nb");
    });
    if (!goals.length) {
      list.innerHTML = "";
      if (emptyHint) emptyHint.hidden = false;
      return;
    }
    if (emptyHint) emptyHint.hidden = true;
    const now = new Date();
    list.innerHTML = goals
      .map(function (g) {
        const prog = Calc.savingsGoalProgress(g);
        const eta = Calc.savingsGoalEta(g, now);
        const etaClass =
          eta.status === "reached"
            ? " is-reached"
            : eta.status === "need_monthly"
              ? " is-need"
              : "";
        return (
          '<button type="button" class="goal-card" data-edit-goal="' +
          escapeAttr(g.id) +
          '"><div class="goal-card-top"><span class="goal-card-name">' +
          escapeHtml(g.name) +
          '</span><span class="goal-card-who">' +
          escapeHtml(goalOwnerLabel(g.person)) +
          '</span></div><div class="goal-card-meta"><span><strong>' +
          formatNOK(prog.saved) +
          "</strong> av " +
          formatNOK(prog.target) +
          "</span><span>" +
          formatNOK(g.monthly) +
          '/mnd</span></div><div class="goal-progress" aria-hidden="true"><span style="width:' +
          Math.round(prog.pct) +
          '%"></span></div><div class="goal-card-eta' +
          etaClass +
          '">' +
          escapeHtml(eta.label) +
          "</div></button>"
        );
      })
      .join("");
  }

  function allTxForMonth(m) {
    const items = [];
    m.expenses.forEach(function (e) {
      const cat = e.categoryId ? catById(e.categoryId) : null;
      items.push({
        kind: "expense",
        id: e.id,
        amount: e.amount,
        date: e.date,
        note: e.note,
        label: (cat && cat.name) || e.category || "Utgift",
        who: nameOf(e.owner),
        raw: e
      });
    });
    m.incomes.forEach(function (i) {
      items.push({
        kind: "income",
        id: i.id,
        amount: i.amount,
        date: i.date,
        note: i.note,
        label: i.type === "ekstra" ? "Ekstra" : "Lønn",
        who: nameOf(i.person),
        raw: i
      });
    });
    m.savings.forEach(function (s) {
      items.push({
        kind: "saving",
        id: s.id,
        amount: s.amount,
        date: s.date,
        note: s.note,
        label: "Sparing",
        who: nameOf(s.person),
        raw: s
      });
    });
    items.sort(function (a, b) {
      const da = a.date || "";
      const db = b.date || "";
      if (da !== db) return db.localeCompare(da);
      return (b.id || "").localeCompare(a.id || "");
    });
    return items;
  }

  function renderTransactions(m) {
    const list = $("#txList");
    const empty = $("#txEmpty");
    const q = ($("#txSearch").value || "").trim().toLowerCase();
    const filter = $("#txFilter").value || "all";
    const scopeEl = $("#txScope");
    if (scopeEl) loggScope = scopeEl.value === "year" ? "year" : "month";

    let items = [];
    if (loggScope === "year") {
      const y = state.view.year;
      for (let mo = 0; mo < 12; mo++) {
        const key = monthKey(y, mo);
        const mm = state.months[key];
        if (!mm) continue;
        ensureMonthShape(mm);
        allTxForMonth(mm).forEach(function (t) {
          t._monthKey = key;
          items.push(t);
        });
      }
    } else {
      items = allTxForMonth(m);
    }
    if (filter !== "all") {
      items = items.filter(function (t) { return t.kind === filter; });
    }
    if (q) {
      items = items.filter(function (t) {
        const hay = [t.label, t.note, t.who, t.kind].join(" ").toLowerCase();
        return hay.indexOf(q) >= 0;
      });
    }

    if (!items.length) {
      list.innerHTML = "";
      empty.hidden = false;
      if (q || filter !== "all" || loggScope === "year") {
        empty.querySelector("p").textContent = "Ingen treff for filteret.";
      } else {
        empty.querySelector("p").textContent = "Ingen transaksjoner denne måneden ennå.";
      }
      return;
    }
    empty.hidden = true;

    list.innerHTML = items
      .map(function (t) {
        const title = t.note || t.label;
        const meta =
          t.label +
          " · " +
          t.who +
          (t._monthKey ? " · " + t._monthKey : "") +
          (t.date ? " · " + formatDateNb(t.date) : "");
        const sign = t.kind === "expense" ? "" : t.kind === "saving" ? "" : "";
        return (
          '<button type="button" class="tx-item" data-tx="' +
          escapeAttr(t.id) +
          '" data-kind="' +
          escapeAttr(t.kind) +
          '">' +
          '<div class="title">' +
          escapeHtml(title) +
          "</div>" +
          '<div class="amount ' +
          escapeAttr(t.kind) +
          '">' +
          (t.kind === "expense" ? "" : t.kind === "income" ? "+" : "") +
          formatNOK(t.amount) +
          "</div>" +
          '<div class="meta">' +
          escapeHtml(meta) +
          "</div>" +
          "</button>"
        );
      })
      .join("");
  }

  function renderReminder(m) {
    const el = $("#dayReminder");
    const today = todayISO();
    if (state.settings.reminderDismissedDate === today) {
      el.hidden = true;
      return;
    }
    // Only show in current calendar month view
    const now = new Date();
    if (state.view.year !== now.getFullYear() || state.view.month !== now.getMonth()) {
      el.hidden = true;
      return;
    }
    const loggedToday = m.expenses.some(function (e) { return e.date === today; });
    el.hidden = loggedToday;
  }

  function updateStorageInfo() {
    const el = $("#storageInfo");
    if (!el) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY) || "";
      const kb = Math.round((raw.length * 2) / 1024);
      const nMonths = Object.keys(state.months).length;
      const nTx =
        Object.values(state.months).reduce(function (s, m) {
          return (
            s +
            (m.expenses ? m.expenses.length : 0) +
            (m.incomes ? m.incomes.length : 0) +
            (m.savings ? m.savings.length : 0)
          );
        }, 0);
      el.textContent =
        "Lagring: ~" +
        kb +
        " kB · " +
        nMonths +
        " måneder · " +
        nTx +
        " transaksjoner · " +
        activePeopleList().length +
        " personer · nøkkel " +
        STORAGE_KEY;
    } catch (e) {
      el.textContent = "";
    }
  }

  function categoryOptionLabel(c, nameCounts) {
    const base = c.name || "";
    if ((nameCounts[String(base).toLowerCase()] || 0) > 1) {
      const who = c.owner === "felles" ? "Felles" : nameOf(c.owner);
      return base + " · " + who;
    }
    return base;
  }

  /** Categories allowed for expense «who»: person → own + Felles; felles → only Felles. */
  function categoriesForWho(who) {
    const cats = activeCategories();
    if (!who || who === "felles") {
      return cats.filter(function (c) { return c.owner === "felles"; });
    }
    return cats.filter(function (c) {
      return c.owner === who || c.owner === "felles";
    });
  }

  function currentExpWho() {
    const whoEl = document.querySelector('#dlgExpense input[name="expWho"]:checked');
    return whoEl ? whoEl.value : "felles";
  }

  function fillCategorySelect(selectEl, selectedId, who) {
    if (who == null) who = currentExpWho();
    const cats = categoriesForWho(who);
    const nameCounts = {};
    cats.forEach(function (c) {
      const k = String(c.name || "").toLowerCase();
      nameCounts[k] = (nameCounts[k] || 0) + 1;
    });
    const faste = cats.filter(function (c) { return c.type === "fast"; });
    const vars = cats.filter(function (c) { return c.type !== "fast"; });
    let html = "";
    if (!cats.length) {
      html = '<option value="" disabled selected>Legg til kategori først</option>';
      selectEl.innerHTML = html;
      return;
    }
    const validSelected = selectedId && cats.some(function (c) { return c.id === selectedId; });
    const pickId = validSelected ? selectedId : null;
    function opts(list) {
      return list
        .map(function (c) {
          return (
            '<option value="' +
            escapeAttr(c.id) +
            '"' +
            (pickId && c.id === pickId ? " selected" : "") +
            ">" +
            escapeHtml(categoryOptionLabel(c, nameCounts)) +
            "</option>"
          );
        })
        .join("");
    }
    if (faste.length) {
      html += '<optgroup label="Faste">' + opts(faste) + "</optgroup>";
    }
    if (vars.length) {
      html += '<optgroup label="Variable">' + opts(vars) + "</optgroup>";
    }
    selectEl.innerHTML = html;
    if (!pickId) {
      const last = state.settings && state.settings.lastExpense;
      if (
        last &&
        last.categoryId &&
        cats.some(function (c) { return c.id === last.categoryId; })
      ) {
        selectEl.value = last.categoryId;
      } else {
        const matOwn = cats.find(function (c) {
          return c.name === "Mat" && c.owner === who;
        });
        const matAny = cats.find(function (c) { return c.name === "Mat"; });
        const mat = matOwn || matAny;
        if (mat) selectEl.value = mat.id;
        else if (cats[0]) selectEl.value = cats[0].id;
      }
    }
  }

  function updateExpNewCatOwnerHint() {
    const hint = $("#expNewCatOwnerHint");
    if (!hint) return;
    const who = currentExpWho();
    hint.textContent = "Eier: " + (who === "felles" ? "Felles" : nameOf(who));
  }

  function hideExpNewCat() {
    const panel = $("#expNewCat");
    if (panel) panel.hidden = true;
    const toggle = $("#expNewCatToggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    const nameEl = $("#expNewCatName");
    if (nameEl) nameEl.value = "";
    const typeEl = $("#expNewCatType");
    if (typeEl) typeEl.value = "variabel";
  }

  function showExpNewCat() {
    const panel = $("#expNewCat");
    if (!panel) return;
    panel.hidden = false;
    const toggle = $("#expNewCatToggle");
    if (toggle) toggle.setAttribute("aria-expanded", "true");
    updateExpNewCatOwnerHint();
    setTimeout(function () {
      try { $("#expNewCatName").focus(); } catch (err) { /* */ }
    }, 30);
  }

  function saveExpNewCategory() {
    const nameEl = $("#expNewCatName");
    const name = nameEl ? nameEl.value.trim() : "";
    if (!name) {
      showToast("Skriv inn navn på kategorien");
      try { if (nameEl) nameEl.focus(); } catch (err) { /* */ }
      return;
    }
    const who = currentExpWho();
    const owner = who === "felles" ? "felles" : who;
    const typeEl = $("#expNewCatType");
    const type = typeEl && typeEl.value === "fast" ? "fast" : "variabel";
    const created = addCategory({
      name: name,
      type: type,
      owner: owner,
      autoFill: type === "fast"
    });
    if (!created) {
      showToast("Kunne ikke legge til");
      return;
    }
    save();
    hideExpNewCat();
    fillCategorySelect($("#expCategory"), created.id, who);
    render();
    showToast("Kategori lagt til");
  }

  function renderMonthGrid() {
    $("#pickYear").textContent = String(pickYear);
    const grid = $("#monthGrid");
    const now = new Date();
    grid.innerHTML = MONTHS_SHORT.map(function (label, i) {
      const isCurrent =
        pickYear === state.view.year && i === state.view.month;
      const isToday = pickYear === now.getFullYear() && i === now.getMonth();
      return (
        '<button type="button" data-pick-month="' +
        i +
        '"' +
        (isCurrent ? ' class="current"' : "") +
        (isToday && !isCurrent ? ' style="font-weight:800"' : "") +
        ">" +
        label +
        "</button>"
      );
    }).join("");
  }

  function ownerOptionsHtml(selected) {
    let html =
      '<option value="felles"' +
      (selected === "felles" ? " selected" : "") +
      ">Felles</option>";
    activePeopleList().forEach(function (person) {
      html +=
        '<option value="' +
        escapeAttr(person.id) +
        '"' +
        (selected === person.id ? " selected" : "") +
        ">" +
        escapeHtml(person.name) +
        "</option>";
    });
    if (selected && selected !== "felles" && !activePeopleList().some(function (x) { return x.id === selected; })) {
      const archived = Calc.personById(state.people, selected);
      if (archived) {
        html +=
          '<option value="' +
          escapeAttr(archived.id) +
          '" selected>' +
          escapeHtml(archived.name) +
          " (arkivert)</option>";
      }
    }
    return html;
  }

  function renderCatManage() {
    const list = $("#catManageList");
    ensureCategoryOrders(state);
    const sorted = state.categories.slice().sort(function (a, b) {
      if (a.archived !== b.archived) return a.archived ? 1 : -1;
      const ao = a.order != null ? Number(a.order) : 9999;
      const bo = b.order != null ? Number(b.order) : 9999;
      if (ao !== bo) return ao - bo;
      return a.name.localeCompare(b.name, "nb");
    });
    const chips = remainingSuggestionChips();
    const chipsEl = $("#catManageChips");
    if (chipsEl) {
      if (chips.length) {
        chipsEl.hidden = false;
        chipsEl.innerHTML =
          '<p class="cat-chips-label">Forslag</p><div class="cat-chips">' +
          chips
            .map(function (s) {
              const own = s.owner || "felles";
              const suffix =
                own === "felles"
                  ? ""
                  : " (" + nameOf(own) + ")";
              return (
                '<button type="button" class="cat-chip" data-suggest="' +
                escapeAttr(s.name) +
                '" data-suggest-owner="' +
                escapeAttr(own) +
                '">' +
                escapeHtml(s.name) +
                escapeHtml(suffix) +
                "</button>"
              );
            })
            .join("") +
          "</div>";
      } else {
        chipsEl.hidden = true;
        chipsEl.innerHTML = "";
      }
    }
    list.innerHTML = sorted
      .map(function (c) {
        return (
          '<div class="cat-manage-item' +
          (c.archived ? " archived" : "") +
          '" data-manage="' +
          escapeAttr(c.id) +
          '">' +
          '<div class="cat-manage-top">' +
          '<button type="button" class="cat-drag-handle manage-drag" data-manage-drag="' +
          escapeAttr(c.id) +
          '" aria-label="Flytt" title="Hold og dra">⠿</button>' +
          '<input type="text" data-rename="' +
          escapeAttr(c.id) +
          '" value="' +
          escapeAttr(c.name) +
          '" maxlength="40" />' +
          "</div>" +
          '<div class="cat-manage-controls">' +
          '<select data-type="' +
          escapeAttr(c.id) +
          '">' +
          '<option value="fast"' +
          (c.type === "fast" ? " selected" : "") +
          ">Fast</option>" +
          '<option value="variabel"' +
          (c.type === "variabel" ? " selected" : "") +
          ">Variabel</option>" +
          "</select>" +
          '<select data-owner="' +
          escapeAttr(c.id) +
          '">' +
          ownerOptionsHtml(c.owner) +
          "</select>" +
          '<label class="chk"><input type="checkbox" data-autofill="' +
          escapeAttr(c.id) +
          '"' +
          (c.autoFill ? " checked" : "") +
          " /> Autofyll budsjett</label>" +
          '<button type="button" class="btn sm ghost" data-archive="' +
          escapeAttr(c.id) +
          '">' +
          (c.archived ? "Gjenopprett" : "Arkiver") +
          "</button>" +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    enableManageListDrag(list);
  }

  // ——— Dialog helpers ———
  function openExpense(edit) {
    const last = (state.settings && state.settings.lastExpense) || {};
    $("#expenseTitle").textContent = edit ? "Rediger kjøp" : "Kjøpt noe";
    $("#expId").value = edit ? edit.id : "";
    $("#expAmount").value = edit ? String(edit.amount).replace(".", ",") : "";
    const _expCalc = $("#expCalc");
    if (_expCalc) _expCalc.hidden = true;
    $$('.calc-toggle[data-calc-panel="expCalc"]').forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
    $$(".amount-chip").forEach(function (c) {
      const v = c.getAttribute("data-amount");
      const cur = edit ? String(edit.amount) : "";
      c.classList.toggle("is-active", !!edit && v === cur);
    });
    $("#expNote").value = edit ? edit.note || "" : "";
    $("#expDate").value = edit ? edit.date || todayISO() : todayISO();
    const whoDefault = edit
      ? edit.owner
      : last.owner || (activePeopleList()[0] && activePeopleList()[0].id) || "felles";
    renderWhoSeg(whoDefault);
    hideExpNewCat();
    let catSel = edit ? edit.categoryId : last.categoryId || null;
    const allowed = categoriesForWho(whoDefault);
    if (catSel && !allowed.some(function (c) { return c.id === catSel; })) {
      catSel = null;
    }
    fillCategorySelect($("#expCategory"), catSel, whoDefault);
    $("#expDelete").hidden = !edit;
    const stay = $("#expStayOpen");
    if (stay) {
      stay.checked = !edit && !!state.settings.expStayOpen;
      const wrap = stay.closest(".exp-stay-wrap");
      if (wrap) wrap.hidden = !!edit;
    }
    openDlg("#dlgExpense");
    setTimeout(function () {
      const amt = $("#expAmount");
      if (!amt) return;
      try { amt.focus(); amt.select && amt.select(); } catch (err) { /* */ }
    }, 30);
  }

  function openIncome(person, edit) {
    $("#incomeTitle").textContent = edit
      ? "Rediger inntekt"
      : "Legg til inntekt – " + nameOf(person || (edit && edit.person));
    $("#incId").value = edit ? edit.id : "";
    $("#incPerson").value = edit ? edit.person : person;
    $("#incAmount").value = edit ? String(edit.amount).replace(".", ",") : "";
    const _incCalc = $("#incCalc");
    if (_incCalc) _incCalc.hidden = true;
    $$('.calc-toggle[data-calc-panel="incCalc"]').forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
    $("#incNote").value = edit ? edit.note || "" : "";
    $("#incDate").value = edit ? edit.date || todayISO() : todayISO();
    $("#incType").value = edit ? edit.type || "lønn" : "lønn";
    $("#incDelete").hidden = !edit;
    openDlg("#dlgIncome");
    setTimeout(function () { $("#incAmount").focus(); }, 50);
  }

  function openSaving(person, edit) {
    $("#savingTitle").textContent = edit
      ? "Rediger sparing"
      : "Legg til sparing – " + nameOf(person || (edit && edit.person));
    $("#savId").value = edit ? edit.id : "";
    $("#savPerson").value = edit ? edit.person : person;
    $("#savAmount").value = edit ? String(edit.amount).replace(".", ",") : "";
    const _savCalc = $("#savCalc");
    if (_savCalc) _savCalc.hidden = true;
    $$('.calc-toggle[data-calc-panel="savCalc"]').forEach(function (b) {
      b.setAttribute("aria-expanded", "false");
    });
    $("#savNote").value = edit ? edit.note || "" : "";
    $("#savDate").value = edit ? edit.date || todayISO() : todayISO();
    $("#savDelete").hidden = !edit;
    openDlg("#dlgSaving");
    setTimeout(function () { $("#savAmount").focus(); }, 50);
  }

  function findTx(kind, id) {
    const m = getMonth();
    if (kind === "expense") return m.expenses.find(function (x) { return x.id === id; });
    if (kind === "income") return m.incomes.find(function (x) { return x.id === id; });
    if (kind === "saving") return m.savings.find(function (x) { return x.id === id; });
    return null;
  }

  function downloadBlob(filename, blob) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1500);
  }

  function exportCsv() {
    const rows = [["dato", "type", "kategori", "hvem", "beløp", "notat", "måned"]];
    Object.keys(state.months)
      .sort()
      .forEach(function (key) {
        const m = state.months[key];
        (m.expenses || []).forEach(function (e) {
          const cat = e.categoryId ? catById(e.categoryId) : null;
          rows.push([
            e.date || "",
            "utgift",
            (cat && cat.name) || e.category || "",
            nameOf(e.owner),
            String(e.amount != null ? e.amount : "").replace(".", ","),
            e.note || "",
            key
          ]);
        });
        (m.incomes || []).forEach(function (i) {
          rows.push([
            i.date || "",
            i.type || "lønn",
            "",
            nameOf(i.person),
            String(i.amount != null ? i.amount : "").replace(".", ","),
            i.note || "",
            key
          ]);
        });
        (m.savings || []).forEach(function (s) {
          rows.push([
            s.date || "",
            "sparing",
            "",
            nameOf(s.person),
            String(s.amount != null ? s.amount : "").replace(".", ","),
            s.note || "",
            key
          ]);
        });
      });
    const csv = rows
      .map(function (r) {
        return r
          .map(function (cell) {
            const s = String(cell);
            if (/[;"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
            return s;
          })
          .join(";");
      })
      .join("\n");
    downloadBlob(
      "familie-budsjett-transaksjoner-" + todayISO() + ".csv",
      new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })
    );
  }


  // ——— Long-press drag reorder (Pointer Events, mobile Safari friendly) ———
  function enableCatListDrag(listEl) {
    if (!listEl || listEl.dataset.dragBound === "1") return;
    listEl.dataset.dragBound = "1";
    bindLongPressDrag(listEl, {
      handleSelector: "[data-cat-drag]",
      itemSelector: ".cat-row",
      getId: function (item) { return item.getAttribute("data-cat"); },
      sameGroup: function (a, b) {
        // Reorder within same owner section + type (Fast/Variable)
        const ga = a.closest(".cat-group-body");
        const gb = b.closest(".cat-group-body");
        if (ga !== gb) return false;
        return a.getAttribute("data-cat-type") === b.getAttribute("data-cat-type");
      },
      onReorder: function (orderedIds) {
        // Merge: keep relative order of other types; apply new order for moved type set
        applyPartialCatReorder(orderedIds);
        state.settings.sort = "egen";
        const sortSel = $("#sortSelect");
        if (sortSel) sortSel.value = "egen";
        save();
        render();
        showToast("Rekkefølge lagret");
      }
    });
  }

  function enableManageListDrag(listEl) {
    if (!listEl) return;
    if (listEl.dataset.dragBound === "1") {
      // re-bind not needed; handler uses live DOM
      return;
    }
    listEl.dataset.dragBound = "1";
    bindLongPressDrag(listEl, {
      handleSelector: "[data-manage-drag]",
      itemSelector: ".cat-manage-item",
      getId: function (item) { return item.getAttribute("data-manage"); },
      sameGroup: function (a, b) {
        return !a.classList.contains("archived") && !b.classList.contains("archived");
      },
      onReorder: function (orderedIds) {
        renumberCategoryOrders(orderedIds);
        state.settings.sort = "egen";
        save();
        renderCatManage();
        render();
        showToast("Rekkefølge lagret");
      }
    });
  }

  function applyPartialCatReorder(visibleIds) {
    // visibleIds = new order for one Fast or Variable subgroup (unique cat ids)
    const idSet = {};
    visibleIds.forEach(function (id) { idSet[id] = true; });
    const all = categoriesSortedByOrder(state.categories);
    const result = [];
    let vi = 0;
    const used = {};
    // Walk all-by-order; when encountering a member of the moved set,
    // emit next unused visibleId instead
    all.forEach(function (c) {
      if (idSet[c.id]) {
        while (vi < visibleIds.length && used[visibleIds[vi]]) vi++;
        if (vi < visibleIds.length) {
          result.push(visibleIds[vi]);
          used[visibleIds[vi]] = true;
          vi++;
        }
      } else {
        result.push(c.id);
      }
    });
    visibleIds.forEach(function (id) {
      if (!used[id]) result.push(id);
    });
    renumberCategoryOrders(result);
  }

  function bindLongPressDrag(container, opts) {
    const LONG_MS = 380;
    let pressTimer = null;
    let dragging = null;
    let startY = 0;
    let pointerId = null;
    let ghost = null;

    function clearPress() {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }

    function endDrag(commit) {
      clearPress();
      if (!dragging) return;
      const item = dragging;
      item.classList.remove("is-dragging");
      if (ghost && ghost.parentNode) ghost.parentNode.removeChild(ghost);
      ghost = null;
      document.body.classList.remove("is-cat-dragging");
      if (commit) {
        const parent = item.parentNode;
        if (parent) {
          const siblings = Array.prototype.slice.call(parent.querySelectorAll(opts.itemSelector)).filter(function (el) {
            return opts.sameGroup(item, el);
          });
          // Collect unique ids in DOM order within group
          const ids = [];
          const seen = {};
          siblings.forEach(function (el) {
            const id = opts.getId(el);
            if (id && !seen[id]) {
              seen[id] = true;
              ids.push(id);
            }
          });
          if (ids.length) opts.onReorder(ids);
        }
      }
      dragging = null;
      pointerId = null;
    }

    function onPointerDown(e) {
      const handle = e.target.closest(opts.handleSelector);
      if (!handle || !container.contains(handle)) return;
      const item = handle.closest(opts.itemSelector);
      if (!item) return;
      // Don't start drag from inputs
      if (e.target.closest("input, select, textarea, a")) return;
      startY = e.clientY;
      pointerId = e.pointerId;
      clearPress();
      pressTimer = setTimeout(function () {
        pressTimer = null;
        dragging = item;
        item.classList.add("is-dragging");
        document.body.classList.add("is-cat-dragging");
        ghost = item.cloneNode(true);
        ghost.classList.add("cat-drag-ghost");
        ghost.style.width = item.offsetWidth + "px";
        document.body.appendChild(ghost);
        ghost.style.top = (e.clientY - 20) + "px";
        ghost.style.left = item.getBoundingClientRect().left + "px";
        try { handle.setPointerCapture(pointerId); } catch (err) { /* */ }
        if (navigator.vibrate) try { navigator.vibrate(12); } catch (err2) { /* */ }
      }, LONG_MS);
    }

    function onPointerMove(e) {
      if (pointerId != null && e.pointerId !== pointerId) return;
      if (!dragging) {
        // cancel long-press if finger moved too much
        if (pressTimer && Math.abs(e.clientY - startY) > 10) clearPress();
        return;
      }
      e.preventDefault();
      if (ghost) ghost.style.top = (e.clientY - 20) + "px";
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const over = el && el.closest ? el.closest(opts.itemSelector) : null;
      if (!over || over === dragging || !container.contains(over)) return;
      if (!opts.sameGroup(dragging, over)) return;
      const rect = over.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) {
        over.parentNode.insertBefore(dragging, over);
      } else {
        over.parentNode.insertBefore(dragging, over.nextSibling);
      }
    }

    function onPointerUp(e) {
      if (pointerId != null && e.pointerId !== pointerId) return;
      if (dragging) endDrag(true);
      else clearPress();
      pointerId = null;
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove, { passive: false });
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", function () { endDrag(false); });
  }

  function handleSuggestClick(name, ownerAttr) {
    if (!name) return;
    const owner = resolveSuggestOwner(ownerAttr || "felles");
    const cat = addCategoryFromSuggestion(name, owner);
    if (!cat) return;
    state.settings.sort = state.settings.sort || "egen";
    save();
    render();
    renderCatManage();
    const who = owner === "felles" ? "Felles" : nameOf(owner);
    showToast(cat.name + " lagt til · " + who);
  }


  // ——— Bind ———
  function renderSyncUI() {
    var Cloud = window.FamilieBudsjettCloud;
    var Sync = window.FamilieBudsjettSync;
    var labelEl = $("#syncStatusLabel");
    var detailEl = $("#syncStatusDetail");
    var box = $("#syncStatusBox");
    var loggedOut = $("#syncLoggedOut");
    var loggedIn = $("#syncLoggedIn");
    var configHint = $("#syncConfigHint");
    if (!labelEl || !detailEl) return;
    var configured = Cloud && Cloud.isConfigured && Cloud.isConfigured();
    var meta = Cloud && Cloud.loadMeta ? Cloud.loadMeta() : {};
    var status = Cloud && Cloud.getStatus
      ? Cloud.getStatus()
      : (Sync ? Sync.syncStatusLabel(meta, !!configured) : { label: "Kun lokalt", detail: "", kind: "local" });
    labelEl.textContent = status.label || "Kun lokalt";
    detailEl.textContent = status.detail || "";
    if (box) {
      box.classList.remove("is-synced", "is-pending", "is-error", "is-local");
      box.classList.add("is-" + (status.kind || "local"));
    }
    if (configHint) configHint.hidden = !!configured;
    var hasUser = !!(meta && meta.userId);
    if (loggedOut) loggedOut.hidden = hasUser;
    if (loggedIn) loggedIn.hidden = !hasUser;
    var userLine = $("#syncUserLine");
    if (userLine) {
      userLine.textContent = hasUser
        ? ("Innlogget som @" + (meta.username || "bruker") + (meta.householdName ? " · " + meta.householdName : ""))
        : "";
    }
    var inviteLine = $("#syncInviteLine");
    var inviteCodeEl = $("#syncInviteCode");
    if (inviteLine && inviteCodeEl) {
      if (meta.inviteCode) {
        inviteLine.hidden = false;
        inviteCodeEl.textContent = meta.inviteCode;
      } else {
        inviteLine.hidden = true;
      }
    }
  }

  function applyCloudState(payload) {
    if (!payload || typeof payload !== "object") return;
    state = Calc.migrateState(payload);
    if (!Array.isArray(state.savingsGoals)) state.savingsGoals = [];
    ensureCategoryOrders(state);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      showToast("Kunne ikke lagre. Er lagringsplassen full?");
    }
    pickYear = state.view.year;
    render();
    renderSyncUI();
  }

  function bindSyncUI() {
    var Cloud = window.FamilieBudsjettCloud;
    renderSyncUI();
    var btnMerSync = $("#btnMerSync");
    if (btnMerSync) {
      btnMerSync.addEventListener("click", function () {
        applyMainTab("mer");
        var el = $("#sectionMerSync");
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
    function creds() {
      return {
        username: ($("#syncUsername") && $("#syncUsername").value) || "",
        password: ($("#syncPassword") && $("#syncPassword").value) || ""
      };
    }
    function runAuth(mode) {
      if (!Cloud || !Cloud.isConfigured || !Cloud.isConfigured()) {
        showToast("Sky-synk er ikke konfigurert ennå");
        renderSyncUI();
        return;
      }
      var c = creds();
      var p = mode === "signup" ? Cloud.signUp(c.username, c.password) : Cloud.signIn(c.username, c.password);
      p.then(function () {
        showToast(mode === "signup" ? "Konto opprettet" : "Innlogget");
        return Cloud.afterAuthReady();
      }).then(function () {
        renderSyncUI();
        render();
      }).catch(function (err) {
        showToast((err && err.message) || "Innlogging feilet");
        renderSyncUI();
      });
    }
    var btnLogin = $("#btnSyncLogin");
    if (btnLogin) btnLogin.addEventListener("click", function () { runAuth("login"); });
    var btnSignup = $("#btnSyncSignup");
    if (btnSignup) btnSignup.addEventListener("click", function () { runAuth("signup"); });
    var btnLogout = $("#btnSyncLogout");
    if (btnLogout) {
      btnLogout.addEventListener("click", function () {
        if (!Cloud) return;
        Cloud.signOut().then(function () {
          showToast("Logget ut (lokal data beholdt)");
          renderSyncUI();
        });
      });
    }
    var btnJoin = $("#btnSyncJoin");
    if (btnJoin) {
      btnJoin.addEventListener("click", function () {
        if (!Cloud) return;
        var code = ($("#syncJoinCode") && $("#syncJoinCode").value) || "";
        Cloud.joinHouseholdFlow(code).then(function () {
          renderSyncUI();
          render();
        }).catch(function (err) {
          showToast((err && err.message) || "Kunne ikke bli med");
          renderSyncUI();
        });
      });
    }
    var btnNow = $("#btnSyncNow");
    if (btnNow) {
      btnNow.addEventListener("click", function () {
        if (!Cloud) return;
        Cloud.pullNow().then(function (pulled) {
          if (pulled && pulled.action === "noop") return Cloud.pushNow();
          return pulled;
        }).then(function (r) {
          if (r && r.ok) showToast("Synket");
          renderSyncUI();
          render();
        }).catch(function (err) {
          showToast((err && err.message) || "Synk feilet");
          renderSyncUI();
        });
      });
    }
    var btnCopy = $("#btnSyncCopyInvite");
    if (btnCopy) {
      btnCopy.addEventListener("click", function () {
        var meta = Cloud && Cloud.loadMeta ? Cloud.loadMeta() : {};
        var code = meta.inviteCode || "";
        if (!code) return;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(function () { showToast("Kode kopiert"); })
            .catch(function () { showToast(code); });
        } else showToast(code);
      });
    }
  }

  function bind() {
    bindSyncUI();
    $("#prevMonth").addEventListener("click", function () {
      let y = state.view.year, m = state.view.month - 1;
      if (m < 0) { m = 11; y -= 1; }
      state.view = { year: y, month: m };
      save();
      render();
    });
    $("#nextMonth").addEventListener("click", function () {
      let y = state.view.year, m = state.view.month + 1;
      if (m > 11) { m = 0; y += 1; }
      state.view = { year: y, month: m };
      save();
      render();
    });

    $("#monthLabel").addEventListener("click", function () {
      pickYear = state.view.year;
      renderMonthGrid();
      openDlg("#dlgMonth");
    });
    $("#yearPrev").addEventListener("click", function () {
      pickYear -= 1;
      renderMonthGrid();
    });
    $("#yearNext").addEventListener("click", function () {
      pickYear += 1;
      renderMonthGrid();
    });
    $("#monthGrid").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-pick-month]");
      if (!btn) return;
      state.view = {
        year: pickYear,
        month: parseInt(btn.getAttribute("data-pick-month"), 10)
      };
      save();
      closeDlg("#dlgMonth");
      render();
    });

    $("#btnCopyBudget").addEventListener("click", function () {
      const key = monthKey(state.view.year, state.view.month);
      const prevKey = prevMonthKey(state.view.year, state.view.month);
      const prev = state.months[prevKey];
      const prevHasBudgets = prev && prev.budgets && Object.keys(prev.budgets).length;
      const prevHasLines = prev && prev.budgetLines && Object.keys(prev.budgetLines).length;
      if (!prev || (!prevHasBudgets && !prevHasLines)) {
        showToast("Ingen budsjett i forrige måned å kopiere");
        return;
      }
      const m = getMonth();
      Calc.copyExpectedFrom(prev, m, state.people, state.view.month);
      save();
      render();
      showToast("Budsjett, underlinjer og forventet inntekt kopiert");
    });

    $("#sortSelect").addEventListener("change", function () {
      state.settings.sort = $("#sortSelect").value;
      save();
      render();
    });

    // Main tabs: Plan | Oversikt | Kjøpt noe (action) | Sparing | Mer (Logg via Mer)
    const mainTabs = $("#mainTabs");
    if (mainTabs) {
      mainTabs.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-tab]");
        if (!btn) return;
        applyMainTab(btn.getAttribute("data-tab"));
        save();
        // Soft scroll to top of content
        const main = $("#main");
        if (main) {
          try { main.scrollIntoView({ behavior: "smooth", block: "start" }); } catch (err) { /* */ }
        }
      });
    }

    // Category group collapse + row expand
    $("#categoryList").addEventListener("click", function (e) {
      const groupBtn = e.target.closest("[data-toggle-group]");
      if (groupBtn) {
        e.preventDefault();
        const key = groupBtn.getAttribute("data-toggle-group");
        const currentlyOpen = Object.prototype.hasOwnProperty.call(catGroupsOpen, key)
          ? !!catGroupsOpen[key]
          : true;
        catGroupsOpen[key] = !currentlyOpen;
        render();
        return;
      }
      const expandBtn = e.target.closest("[data-expand-cat]");
      if (expandBtn) {
        // Don't steal focus from inputs inside detail
        if (e.target.closest("input, select, textarea, label.cat-budget-row")) return;
        e.preventDefault();
        const id = expandBtn.getAttribute("data-expand-cat");
        expandedCatId = expandedCatId === id ? null : id;
        render();
        if (expandedCatId) {
          setTimeout(function () {
            let key = expandedCatId;
            if (key.indexOf("share:") === 0) key = key.slice(6);
            const colon = key.indexOf(":");
            let sel;
            if (colon > 0) {
              const owner = key.slice(0, colon);
              const catId = key.slice(colon + 1);
              sel =
                '#categoryList [data-budget="' +
                catId +
                '"][data-budget-owner="' +
                owner +
                '"]';
            } else {
              sel = '#categoryList [data-budget="' + key + '"]';
            }
            let inp = document.querySelector(sel);
            if (!inp && colon > 0) {
              const catId = key.slice(colon + 1);
              inp = document.querySelector(
                '#categoryList [data-split-cat="' + catId + '"]'
              );
            }
            if (inp) {
              try { inp.focus({ preventScroll: true }); } catch (err) { inp.focus(); }
            }
          }, 30);
        }
        return;
      }
    });

    const setCopy = $("#setCopyExpected");
    if (setCopy) {
      setCopy.addEventListener("change", function () {
        state.settings.copyExpectedToNewMonths = !!setCopy.checked;
        save();
        showToast(
          setCopy.checked
            ? "Kopierer forventet til nye måneder"
            : "Automatisk kopiering avslått"
        );
      });
    }

    const setSaldoSafe = $("#setUseSaldoSafe");
    if (setSaldoSafe) {
      setSaldoSafe.addEventListener("change", function () {
        state.settings.useSaldoInSafeToSpend = !!setSaldoSafe.checked;
        save();
        render();
        showToast(
          setSaldoSafe.checked
            ? "Trygg å bruke bruker brukssaldo"
            : "Trygg å bruke bruker plan-formel"
        );
      });
    }

    const setSpendBuf = $("#setSpendBuffer");
    if (setSpendBuf) {
      function commitSpendBuffer() {
        const raw = parseAmount(setSpendBuf.value);
        const n = raw == null || raw < 0 ? 0 : raw;
        state.settings.spendBuffer = n;
        if (n === 0) setSpendBuf.value = "";
        else setSpendBuf.value = String(n);
        save();
        render();
      }
      setSpendBuf.addEventListener("change", commitSpendBuffer);
      setSpendBuf.addEventListener("blur", commitSpendBuffer);
    }

    function onBalanceField(el) {
      if (!el || !el.getAttribute) return;
      const key = el.getAttribute("data-bal");
      if (!key) return;
      const parts = key.split("-");
      if (parts.length < 2) return;
      const field = parts[parts.length - 1];
      const personId = parts.slice(0, -1).join("-");
      if (field !== "bruk" && field !== "spare") return;
      const m = getMonth();
      ensureMonthShape(m);
      if (!m.balances[personId]) m.balances[personId] = { bruk: null, spare: null };
      m.balances[personId][field] = parseAmount(el.value);
      save();
      render();
    }
    document.addEventListener("change", function (e) {
      const t = e.target;
      if (t && t.matches && t.matches("input[data-bal]")) onBalanceField(t);
    });
    document.addEventListener("blur", function (e) {
      const t = e.target;
      if (t && t.matches && t.matches("input[data-bal]")) onBalanceField(t);
    }, true);

    const fabBuy = $("#fabBuy");
    if (fabBuy) fabBuy.addEventListener("click", function () { openExpense(null); });
    $("#reminderLog").addEventListener("click", function () { openExpense(null); });

    const chips = $("#expAmountChips");
    if (chips) {
      chips.addEventListener("click", function (e) {
        const btn = e.target.closest(".amount-chip");
        if (!btn) return;
        e.preventDefault();
        const amt = btn.getAttribute("data-amount");
        const inp = $("#expAmount");
        if (!inp || !amt) return;
        inp.value = amt;
        $$(".amount-chip").forEach(function (c) {
          c.classList.toggle("is-active", c === btn);
        });
        try { inp.focus({ preventScroll: true }); } catch (err) { inp.focus(); }
      });
    }

    // ——— Beløp-kalkulator (pad + uttrykk i felt) ———
    const CALC_TARGET = {
      expCalc: "expAmount",
      incCalc: "incAmount",
      savCalc: "savAmount",
      planIncCalc: null // dynamic via data-calc-for / panel.dataset.calcFor
    };

    function getCalcDisplay(panel) {
      return panel ? panel.querySelector("[data-calc-display]") : null;
    }

    function setCalcExpr(panel, expr) {
      const d = getCalcDisplay(panel);
      if (!d) return;
      d.textContent = expr === "" ? "0" : expr;
      d.dataset.expr = expr;
    }

    function getCalcExpr(panel) {
      const d = getCalcDisplay(panel);
      if (!d) return "";
      return d.dataset.expr != null ? d.dataset.expr : (d.textContent === "0" ? "" : d.textContent);
    }

    function findPlanIncInput(key) {
      if (!key) return null;
      const byCalc = document.querySelectorAll("[data-calc-input-key]");
      for (let i = 0; i < byCalc.length; i++) {
        if (byCalc[i].getAttribute("data-calc-input-key") === key) return byCalc[i];
      }
      const nodes = document.querySelectorAll("[data-plan-inc]");
      for (let i = 0; i < nodes.length; i++) {
        if (nodes[i].getAttribute("data-plan-inc") === key) return nodes[i];
      }
      return null;
    }

    function resolveCalcTargetInput(panelId) {
      if (panelId === "planIncCalc") {
        const panel = document.getElementById(panelId);
        return findPlanIncInput(panel && panel.dataset.calcFor);
      }
      const targetId = CALC_TARGET[panelId];
      return targetId ? document.getElementById(targetId) : null;
    }

    function syncCalcToggleState(panelId, activeFor) {
      $$('.calc-toggle[data-calc-panel="' + (panelId || "") + '"]').forEach(function (b) {
        const forKey = b.getAttribute("data-calc-for");
        const on = activeFor
          ? forKey === activeFor
          : !forKey; // dialog toggles have no data-calc-for
        b.setAttribute("aria-expanded", on ? "true" : "false");
      });
    }

    function closeCalcPanel(panelId) {
      const panel = panelId ? document.getElementById(panelId) : null;
      if (panel) {
        panel.hidden = true;
        if (panelId === "planIncCalc") {
          delete panel.dataset.calcFor;
          parkPlanIncCalc();
        }
      }
      $$('.calc-toggle[data-calc-panel="' + (panelId || "") + '"]').forEach(function (b) {
        b.setAttribute("aria-expanded", "false");
      });
    }

    function openCalcPanel(panelId, calcFor) {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      Object.keys(CALC_TARGET).forEach(function (id) {
        if (id !== panelId) closeCalcPanel(id);
      });
      if (panelId === "planIncCalc") {
        if (!calcFor) return;
        panel.dataset.calcFor = calcFor;
        const esc = calcFor.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        let inpPlace = document.querySelector('[data-calc-input-key="' + esc + '"]');
        if (!inpPlace) {
          inpPlace = document.querySelector('[data-plan-inc="' + esc + '"]');
        }
        const field =
          (inpPlace && inpPlace.closest(".cat-line-amt-wrap")) ||
          (inpPlace && inpPlace.closest(".field")) ||
          (inpPlace && inpPlace.closest(".cat-line-row"));
        if (field && field.parentNode) {
          field.parentNode.insertBefore(panel, field.nextSibling);
        } else {
          parkPlanIncCalc();
        }
      }
      panel.hidden = false;
      const inp = resolveCalcTargetInput(panelId);
      const seed = inp && inp.value ? String(inp.value).trim() : "";
      setCalcExpr(panel, seed);
      if (panelId === "planIncCalc") syncCalcToggleState(panelId, calcFor);
      else syncCalcToggleState(panelId, null);
    }

    function toggleCalcPanel(panelId, calcFor) {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      if (panelId === "planIncCalc") {
        if (!panel.hidden && panel.dataset.calcFor === calcFor) {
          closeCalcPanel(panelId);
          return;
        }
        openCalcPanel(panelId, calcFor);
        return;
      }
      if (panel.hidden) openCalcPanel(panelId);
      else closeCalcPanel(panelId);
    }

    function appendCalcKey(panel, key) {
      let expr = getCalcExpr(panel);
      if (key === "C") {
        setCalcExpr(panel, "");
        return;
      }
      if (key === "⌫") {
        setCalcExpr(panel, expr.slice(0, -1));
        return;
      }
      if (key === "=") {
        const n = Calc.evalAmountExpression(expr || "0");
        if (n == null) {
          showToast("Ugyldig regnestykke");
          return;
        }
        setCalcExpr(panel, formatAmountInput(n));
        return;
      }
      if (key === "," || key === ".") {
        const chunk = (expr.split(/[+\-×÷*/()]/).pop() || "");
        if (chunk.indexOf(",") >= 0 || chunk.indexOf(".") >= 0) return;
        setCalcExpr(panel, expr + ",");
        return;
      }
      setCalcExpr(panel, expr + key);
    }

    function useCalcResult(panelId) {
      const panel = document.getElementById(panelId);
      if (!panel) return;
      let expr = getCalcExpr(panel);
      let n = Calc.evalAmountExpression(expr);
      if (n == null) n = parseAmount(expr);
      if (n == null) {
        showToast("Ugyldig beløp");
        return;
      }
      const inp = resolveCalcTargetInput(panelId);
      if (inp) {
        inp.value = formatAmountInput(n);
        $$(".amount-chip").forEach(function (c) { c.classList.remove("is-active"); });
        if (panelId === "planIncCalc") {
          closeCalcPanel(panelId);
          try {
            inp.dispatchEvent(new Event("change", { bubbles: true }));
          } catch (err) {
            /* */
          }
          return;
        }
        try { inp.focus({ preventScroll: true }); } catch (err) { /* */ }
      }
      closeCalcPanel(panelId);
    }

    document.addEventListener("click", function (e) {
      const toggle = e.target.closest(".calc-toggle");
      if (toggle) {
        e.preventDefault();
        const id = toggle.getAttribute("data-calc-panel");
        const calcFor = toggle.getAttribute("data-calc-for");
        if (id) toggleCalcPanel(id, calcFor || undefined);
        return;
      }
      const useBtn = e.target.closest("[data-calc-use]");
      if (useBtn) {
        e.preventDefault();
        const panel = useBtn.closest(".amount-calc");
        if (panel && panel.id) useCalcResult(panel.id);
        return;
      }
      const keyBtn = e.target.closest("[data-calc-key]");
      if (keyBtn) {
        e.preventDefault();
        const panel = keyBtn.closest(".amount-calc");
        if (!panel) return;
        appendCalcKey(panel, keyBtn.getAttribute("data-calc-key"));
      }
    });

    // Evaluate expressions in amount fields on blur / Enter
    function onAmountExprCommit(el) {
      if (!el || !el.classList || !el.classList.contains("amount-expr")) return;
      resolveAmountField(el);
    }
    document.addEventListener("blur", function (e) {
      onAmountExprCommit(e.target);
      // Plan / budsjett / saldo: also resolve expressions in the field
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.matches("[data-plan-inc], [data-budget], [data-line-amount], input[data-bal]")) {
        resolveAmountField(t);
      }
    }, true);
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      const t = e.target;
      if (!t || !t.matches) return;
      if (t.classList.contains("amount-expr") || t.matches("[data-plan-inc], [data-budget], [data-line-amount]")) {
        resolveAmountField(t);
        // Let form submit / blur handlers run after
      }
    });
    $("#reminderDismiss").addEventListener("click", function () {
      state.settings.reminderDismissedDate = todayISO();
      save();
      $("#dayReminder").hidden = true;
    });

    function openSettingsDialog() {
      updateStorageInfo();
      renderPeopleManage();
      const setCopy = $("#setCopyExpected");
      if (setCopy) {
        setCopy.checked = state.settings.copyExpectedToNewMonths !== false;
      }
      const setSaldo = $("#setUseSaldoSafe");
      if (setSaldo) {
        setSaldo.checked = state.settings.useSaldoInSafeToSpend !== false;
      }
      const setBuf = $("#setSpendBuffer");
      if (setBuf && document.activeElement !== setBuf) {
        const b = state.settings.spendBuffer;
        setBuf.value =
          b == null || b === "" || Number(b) === 0 ? "" : String(b);
      }
      openDlg("#dlgSettings");
    }

    $("#btnSettings").addEventListener("click", openSettingsDialog);
    $("#settingsClose").addEventListener("click", function () { closeDlg("#dlgSettings"); });

    // Mer tab shortcuts
    const btnMerYear = $("#btnMerYear");
    if (btnMerYear) {
      btnMerYear.addEventListener("click", function () {
        applyMainTab("mer");
        save();
        render();
        setTimeout(function () {
          const el = $("#sectionMerYear");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 60);
      });
    }

    const btnMerSparing = $("#btnMerSparing");
    if (btnMerSparing) {
      btnMerSparing.addEventListener("click", function () {
        applyMainTab("sparing");
        save();
        render();
      });
    }

    const btnMerLogg = $("#btnMerLogg");
    if (btnMerLogg) {
      btnMerLogg.addEventListener("click", function () {
        applyMainTab("logg");
        save();
        render();
      });
    }

    const sparingTabs = $("#sparingTabs");
    if (sparingTabs) {
      sparingTabs.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-sparing-view]");
        if (!btn) return;
        state.settings.sparingView = btn.getAttribute("data-sparing-view");
        save();
        render();
      });
    }

    const btnSparingAdd = $("#btnSparingAdd");
    if (btnSparingAdd) {
      btnSparingAdd.addEventListener("click", function () {
        const view = state.settings.sparingView || "samlet";
        const people = activePeopleList();
        let personId = view !== "samlet" ? view : null;
        if (!personId || !people.some(function (p) { return p.id === personId; })) {
          personId = people[0] ? people[0].id : null;
        }
        if (!personId) {
          showToast("Legg til en person først");
          return;
        }
        openSaving(personId, null);
      });
    }

    const sparingList = $("#sparingList");
    if (sparingList) {
      sparingList.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-edit-saving]");
        if (!btn) return;
        const id = btn.getAttribute("data-edit-saving");
        const tx = findTx("saving", id);
        if (tx) openSaving(tx.person, tx);
      });
    }

    const btnGoalAdd = $("#btnGoalAdd");
    if (btnGoalAdd) {
      btnGoalAdd.addEventListener("click", function () {
        openGoal(null);
      });
    }

    const goalsList = $("#goalsList");
    if (goalsList) {
      goalsList.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-edit-goal]");
        if (!btn) return;
        const id = btn.getAttribute("data-edit-goal");
        const g = (state.savingsGoals || []).find(function (x) {
          return x.id === id;
        });
        if (g) openGoal(g);
      });
    }

    const yPrev = $("#yearOverviewPrev");
    const yNext = $("#yearOverviewNext");
    if (yPrev) {
      yPrev.addEventListener("click", function () {
        yearOverviewYear = getYearOverviewYear() - 1;
        renderYearOverview();
      });
    }
    if (yNext) {
      yNext.addEventListener("click", function () {
        yearOverviewYear = getYearOverviewYear() + 1;
        renderYearOverview();
      });
    }
    const yearBody = $("#yearOverviewBody");
    if (yearBody) {
      yearBody.addEventListener("click", function (e) {
        const tr = e.target.closest("tr[data-jump-month]");
        if (!tr) return;
        state.view = {
          year: parseInt(tr.getAttribute("data-jump-year"), 10),
          month: parseInt(tr.getAttribute("data-jump-month"), 10)
        };
        save();
        applyMainTab("oversikt");
        render();
      });
    }

    const btnMerPeople = $("#btnMerPeople");
    if (btnMerPeople) {
      btnMerPeople.addEventListener("click", function () {
        const el = $("#sectionMerPeople");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        const inp = $("#merNewPersonName");
        if (inp) {
          setTimeout(function () {
            try { inp.focus({ preventScroll: true }); } catch (err) { /* */ }
          }, 200);
        }
      });
    }
    const btnMerSettings = $("#btnMerSettings");
    if (btnMerSettings) {
      btnMerSettings.addEventListener("click", openSettingsDialog);
    }
    const btnMerBackup = $("#btnMerBackup");
    if (btnMerBackup) {
      btnMerBackup.addEventListener("click", function () {
        exportJsonBackup();
      });
    }
    const btnFillExcel = $("#btnFillExcel");
    if (btnFillExcel) {
      btnFillExcel.addEventListener("click", function () {
        if (
          !confirm(
            "Fylle forventet inntekt og budsjett fra Excel for alle 12 måneder i " +
              state.view.year +
              "?\n\nFelles: Lån/Strøm/Internett/Forsikring (summert). Personlige linjer under Mathias/Andrea. Mobil under Mathias.\n\nEksisterende plan-tall overskrives. Kjøp, inntekter og saldo endres ikke."
          )
        ) {
          return;
        }
        const r = fillBudgetFromExcel(state.view.year);
        save();
        render();
        showToast("Budsjett fylt fra Excel (" + r.year + ", " + r.months + " mnd)");
      });
    }
    const btnMerReset = $("#btnMerReset");
    if (btnMerReset) {
      btnMerReset.addEventListener("click", function () {
        $("#btnReset").click();
      });
    }

    $("#btnManageCats").addEventListener("click", function () {
      openNewCatDialog();
    });
    $("#catsClose").addEventListener("click", function () { closeDlg("#dlgCats"); });

    // Quick-add chips + Ny kategori (Plan / Mer / manage) — event delegation
    document.addEventListener("click", function (e) {
      const chip = e.target.closest("[data-suggest]");
      if (chip) {
        e.preventDefault();
        handleSuggestClick(
          chip.getAttribute("data-suggest"),
          chip.getAttribute("data-suggest-owner")
        );
        return;
      }
      const newBtn = e.target.closest("[data-new-cat-owner]");
      if (newBtn) {
        e.preventDefault();
        openNewCatDialog(null, newBtn.getAttribute("data-new-cat-owner"));
        return;
      }
      if (e.target.closest("#btnNewCatPlan") || e.target.closest("#btnNewCatMer")) {
        e.preventDefault();
        openNewCatDialog(null, "felles");
        return;
      }
    });

    const btnClearCats = $("#btnClearCategories");
    if (btnClearCats) {
      btnClearCats.addEventListener("click", function () {
        if (
          !confirm(
            "Fjerne alle kategorier? Budsjettbeløp for kategoriene slettes ikke automatisk fra måneder, men kategoriene forsvinner fra Plan. Dette kan ikke angres."
          )
        ) {
          return;
        }
        state.categories = [];
        save();
        render();
        showToast("Alle kategorier fjernet");
      });
    }

    const btnEditInn = $("#btnEditInn");
    if (btnEditInn) {
      btnEditInn.addEventListener("click", function () {
        switchToPlanAndFocus("#sectionPlanIncome");
      });
    }
    const btnEditUt = $("#btnEditUt");
    if (btnEditUt) {
      btnEditUt.addEventListener("click", function () {
        switchToPlanAndFocus("#sectionPlanExpenses");
      });
    }
    const onboardHost = $("#budgetOnboard");
    if (onboardHost) {
      onboardHost.addEventListener("click", function (e) {
        if (!e.target.closest("#btnOnboardScroll")) return;
        const noCats = !activeCategories().length;
        switchToPlanAndFocus(noCats ? "#sectionPlanExpenses" : "#budgetHero");
      });
    }

    // Planned income inputs
    function onPlanInc(e) {
      const input = e.target.closest("[data-plan-inc]");
      if (!input) return;
      const key = input.getAttribute("data-plan-inc"); // p1-lønn
      const dash = key.lastIndexOf("-");
      if (dash < 1) return;
      const person = key.slice(0, dash);
      const type = key.slice(dash + 1);
      const m = getMonth();
      ensureMonthShape(m);
      if (!m.plannedIncome[person]) m.plannedIncome[person] = Calc.emptyPlannedIncomeBlock ? Calc.emptyPlannedIncomeBlock() : { lønn: null, ekstra: null, sparing: null };
      const v = parseAmount(input.value);
      m.plannedIncome[person][type] = v;
      save();
      render();
    }
    $("#planIncomeGrid").addEventListener("change", onPlanInc);
    $("#planIncomeGrid").addEventListener("blur", onPlanInc, true);
    $("#planIncomeGrid").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.matches("[data-plan-inc]")) e.target.blur();
    });

    // Chart mode
    document.body.addEventListener("change", function (e) {
      if (e.target && e.target.name === "chartMode") {
        state.settings.chartMode = e.target.value;
        save();
        render();
      }
    });

    // Budget inputs (delegated) — per owner
    $("#categoryList").addEventListener("change", function (e) {
      if (e.target.closest("[data-line-name], [data-line-amount]")) return;
      const input = e.target.closest("[data-budget]");
      if (!input) return;
      if (input.readOnly || input.hasAttribute("readonly")) return;
      const id = input.getAttribute("data-budget");
      const owner = input.getAttribute("data-budget-owner") || "felles";
      const m = getMonth();
      const v = parseAmount(input.value);
      setBudgetForOwner(m, id, owner, v);
      save();
      render();
    });
    $("#categoryList").addEventListener("keydown", function (e) {
      if (e.key === "Enter" && e.target.matches("[data-budget]")) {
        e.target.blur();
      }
      if (e.key === "Enter" && e.target.matches("[data-split-cat]")) {
        e.target.blur();
      }
      if (
        e.key === "Enter" &&
        (e.target.matches("[data-line-name]") || e.target.matches("[data-line-amount]"))
      ) {
        e.target.blur();
      }
    });


    function commitLinesFromDom(catId, ownerId) {
      const m = getMonth();
      const root = document.querySelector(
        '#categoryList [data-lines-cat="' +
          catId +
          '"][data-lines-owner="' +
          ownerId +
          '"]'
      );
      if (!root) return;
      const rows = root.querySelectorAll(".cat-line-row");
      const lines = [];
      rows.forEach(function (row) {
        const id = row.getAttribute("data-line-id");
        const nameInp = row.querySelector("[data-line-name]");
        const amtInp = row.querySelector("[data-line-amount]");
        const intSel = row.querySelector("[data-line-interval]");
        const monthSel = row.querySelector("[data-line-month]");
        const modeInp = row.querySelector("[data-line-mode]:checked");
        const interval = intSel ? intSel.value : "month";
        const mode = modeInp ? modeInp.value : "spread";
        let month = monthSel ? Number(monthSel.value) : 0;
        if (!Number.isFinite(month)) month = 0;
        const entry = {
          id: id || uid(),
          name: nameInp ? nameInp.value : "",
          amount: amtInp ? parseAmount(amtInp.value) : 0
        };
        if (interval === "year" || interval === "quarter") {
          entry.interval = interval;
          entry.mode = mode === "once" ? "once" : "spread";
          entry.month = Math.max(0, Math.min(11, Math.floor(month)));
        }
        lines.push(entry);
      });
      Calc.setBudgetLines(m, catId, ownerId, lines, state.view.month);
      save();
      render();
    }

    $("#categoryList").addEventListener("click", function (e) {
      const addBtn = e.target.closest("[data-line-add]");
      if (addBtn) {
        e.preventDefault();
        const catId = addBtn.getAttribute("data-line-add");
        const ownerId = addBtn.getAttribute("data-line-owner") || "felles";
        const m = getMonth();
        const lines = Calc.getBudgetLines(m, catId, ownerId).slice();
        if (!lines.length) {
          const cur = budgetForOwner(m, catId, ownerId);
          lines.push({ id: uid(), name: "", amount: cur > 0 ? cur : 0 });
        } else {
          lines.push({ id: uid(), name: "", amount: 0 });
        }
        Calc.setBudgetLines(m, catId, ownerId, lines, state.view.month);
        save();
        render();
        setTimeout(function () {
          const last = document.querySelector(
            '#categoryList [data-lines-cat="' +
              catId +
              '"][data-lines-owner="' +
              ownerId +
              '"] .cat-line-row:last-child .cat-line-name'
          );
          if (last) {
            try { last.focus({ preventScroll: true }); } catch (err) { last.focus(); }
          }
        }, 40);
        return;
      }
      const delBtn = e.target.closest("[data-line-del]");
      if (delBtn) {
        e.preventDefault();
        const lineId = delBtn.getAttribute("data-line-del");
        const catId = delBtn.getAttribute("data-line-cat");
        const ownerId = delBtn.getAttribute("data-line-owner") || "felles";
        const m = getMonth();
        const next = Calc.getBudgetLines(m, catId, ownerId).filter(function (l) {
          return l.id !== lineId;
        });
        Calc.setBudgetLines(m, catId, ownerId, next, state.view.month);
        save();
        render();
      }
    });

    function onLineField(e) {
      const nameInp = e.target.closest("[data-line-name]");
      const amtInp = e.target.closest("[data-line-amount]");
      const intSel = e.target.closest("[data-line-interval]");
      const monthSel = e.target.closest("[data-line-month]");
      const modeInp = e.target.closest("[data-line-mode]");
      const inp = nameInp || amtInp || intSel || monthSel || modeInp;
      if (!inp) return;
      commitLinesFromDom(
        inp.getAttribute("data-line-cat"),
        inp.getAttribute("data-line-owner") || "felles"
      );
    }
    $("#categoryList").addEventListener("change", onLineField);

    // Felles fordeling % (delegated)
    function commitSplitFromDom(catId) {
      const cat = catById(catId);
      if (!cat) return;
      const inputs = $$('#categoryList [data-split-cat="' + catId + '"]');
      const split = {};
      inputs.forEach(function (inp) {
        const pid = inp.getAttribute("data-split-person");
        let raw = String(inp.value || "").trim().replace(",", ".");
        let n = raw === "" ? 0 : Number(raw);
        if (Number.isNaN(n) || n < 0) n = 0;
        if (n > 100) n = 100;
        split[pid] = Math.round(n * 100) / 100;
      });
      Calc.setCategorySplit(cat, split, state.people);
      save();
      render();
    }
    function updateFordelingSumHint(catId) {
      const block = $('#categoryList [data-fordeling-cat="' + catId + '"]');
      if (!block) return;
      const inputs = block.querySelectorAll("[data-split-cat]");
      let sum = 0;
      inputs.forEach(function (inp) {
        let raw = String(inp.value || "").trim().replace(",", ".");
        let n = raw === "" ? 0 : Number(raw);
        if (!Number.isNaN(n)) sum += n;
      });
      sum = Math.round(sum * 100) / 100;
      const el = block.querySelector(".fordeling-sum");
      if (!el) return;
      const ok = Math.abs(sum - 100) < 0.1;
      el.classList.toggle("warn", !ok);
      el.textContent = ok
        ? "Sum " + formatNum(sum) + " %"
        : "Sum " + formatNum(sum) + " % — må være 100 %";
      const blockWrap = el.closest(".fordeling-block");
      if (blockWrap) blockWrap.classList.toggle("has-bad-sum", !ok);
    }
    $("#categoryList").addEventListener("input", function (e) {
      const inp = e.target.closest("[data-split-cat]");
      if (!inp) return;
      updateFordelingSumHint(inp.getAttribute("data-split-cat"));
    });
    $("#categoryList").addEventListener("change", function (e) {
      const inp = e.target.closest("[data-split-cat]");
      if (!inp) return;
      commitSplitFromDom(inp.getAttribute("data-split-cat"));
    });
    $("#categoryList").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-normalize-split]");
      if (!btn) return;
      const catId = btn.getAttribute("data-normalize-split");
      const cat = catById(catId);
      if (!cat) return;
      const inputs = $$('#categoryList [data-split-cat="' + catId + '"]');
      const raw = {};
      let sum = 0;
      inputs.forEach(function (inp) {
        const pid = inp.getAttribute("data-split-person");
        let n = Number(String(inp.value || "").trim().replace(",", "."));
        if (!Number.isFinite(n) || n < 0) n = 0;
        raw[pid] = n;
        sum += n;
      });
      const next = Calc.normalizeSplitTo100(raw, state.people);
      Calc.setCategorySplit(cat, next, state.people);
      save();
      render();
      showToast(
        sum <= 0
          ? "Fordelt likt (100 %)"
          : "Normalisert til 100 %"
      );
    });

    // Tx click → edit
    $("#txList").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-tx]");
      if (!btn) return;
      const id = btn.getAttribute("data-tx");
      const kind = btn.getAttribute("data-kind");
      const tx = findTx(kind, id);
      if (!tx) return;
      if (kind === "expense") openExpense(tx);
      else if (kind === "income") openIncome(tx.person, tx);
      else openSaving(tx.person, tx);
    });

    $("#txSearch").addEventListener("input", function () { renderTransactions(getMonth()); });
    $("#txFilter").addEventListener("change", function () { renderTransactions(getMonth()); });
    const txScope = $("#txScope");
    if (txScope) {
      txScope.addEventListener("change", function () {
        loggScope = txScope.value === "year" ? "year" : "month";
        renderTransactions(getMonth());
      });
    }

    // Person actions
    document.body.addEventListener("click", function (e) {
      const focusInc = e.target.closest("[data-focus-plan-income]");
      if (focusInc) {
        focusPlanIncomeForPerson(focusInc.getAttribute("data-focus-plan-income"));
        return;
      }
      const addInc = e.target.closest("[data-add-income]");
      if (addInc) {
        openIncome(addInc.getAttribute("data-add-income"), null);
        return;
      }
      const addSav = e.target.closest("[data-add-save]");
      if (addSav) {
        openSaving(addSav.getAttribute("data-add-save"), null);
      }
    });

    // Expense form
    $("#expenseClose").addEventListener("click", function () { closeDlg("#dlgExpense"); });
    $("#expCancel").addEventListener("click", function () { closeDlg("#dlgExpense"); });
    $("#formExpense").addEventListener("submit", function (e) {
      e.preventDefault();
      resolveAmountField($("#expAmount"));
      const amount = parseAmount($("#expAmount").value);
      if (amount == null || amount <= 0) {
        showToast("Skriv inn et beløp");
        try { $("#expAmount").focus(); } catch (err) { /* */ }
        return;
      }
      const whoEl = document.querySelector('#dlgExpense input[name="expWho"]:checked');
      const catId = $("#expCategory").value;
      const cat = catById(catId);
      const m = getMonth();
      const id = $("#expId").value;
      const payload = {
        id: id || uid(),
        owner: whoEl ? whoEl.value : "felles",
        categoryId: catId,
        category: cat ? cat.name : "",
        amount: amount,
        note: $("#expNote").value.trim(),
        date: $("#expDate").value || todayISO()
      };
      if (id) {
        const idx = m.expenses.findIndex(function (x) { return x.id === id; });
        if (idx >= 0) m.expenses[idx] = payload;
        else m.expenses.push(payload);
      } else {
        m.expenses.push(payload);
      }
      state.settings.lastExpense = {
        categoryId: payload.categoryId,
        owner: payload.owner
      };
      const stayEl = $("#expStayOpen");
      const stayOpen = !id && stayEl && stayEl.checked;
      state.settings.expStayOpen = !!(stayEl && stayEl.checked);
      save();
      if (stayOpen) {
        render();
        $("#expId").value = "";
        $("#expAmount").value = "";
        $("#expNote").value = "";
        $("#expDate").value = todayISO();
        $$(".amount-chip").forEach(function (c) { c.classList.remove("is-active"); });
        renderWhoSeg(state.settings.lastExpense.owner);
        hideExpNewCat();
        fillCategorySelect(
          $("#expCategory"),
          state.settings.lastExpense.categoryId,
          state.settings.lastExpense.owner
        );
        $("#expenseTitle").textContent = "Kjøpt noe";
        $("#expDelete").hidden = true;
        showToast("Lagret – legg inn neste");
        setTimeout(function () {
          try { $("#expAmount").focus(); } catch (err) { /* */ }
        }, 30);
      } else {
        closeDlg("#dlgExpense");
        render();
        showToast("Kjøp lagret");
      }
    });
    $("#expDelete").addEventListener("click", function () {
      const id = $("#expId").value;
      if (!id || !confirm("Slette dette kjøpet? Du kan legge det inn på nytt etterpå.")) return;
      const m = getMonth();
      m.expenses = m.expenses.filter(function (x) { return x.id !== id; });
      save();
      closeDlg("#dlgExpense");
      render();
      showToast("Kjøp slettet");
    });

    const expWhoSeg = $("#expWhoSeg");
    if (expWhoSeg) {
      expWhoSeg.addEventListener("change", function (e) {
        if (!e.target || e.target.name !== "expWho") return;
        const who = e.target.value;
        const cur = $("#expCategory").value;
        const allowed = categoriesForWho(who);
        const keep = allowed.some(function (c) { return c.id === cur; }) ? cur : null;
        fillCategorySelect($("#expCategory"), keep, who);
        updateExpNewCatOwnerHint();
      });
    }
    const expNewToggle = $("#expNewCatToggle");
    if (expNewToggle) {
      expNewToggle.addEventListener("click", function () {
        const panel = $("#expNewCat");
        if (panel && !panel.hidden) hideExpNewCat();
        else showExpNewCat();
      });
    }
    const expNewCancel = $("#expNewCatCancel");
    if (expNewCancel) expNewCancel.addEventListener("click", hideExpNewCat);
    const expNewSave = $("#expNewCatSave");
    if (expNewSave) expNewSave.addEventListener("click", saveExpNewCategory);
    const expNewName = $("#expNewCatName");
    if (expNewName) {
      expNewName.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          saveExpNewCategory();
        }
      });
    }

    // Income form
    $("#incomeClose").addEventListener("click", function () { closeDlg("#dlgIncome"); });
    $("#incCancel").addEventListener("click", function () { closeDlg("#dlgIncome"); });
    $("#formIncome").addEventListener("submit", function (e) {
      e.preventDefault();
      resolveAmountField($("#incAmount"));
      const amount = parseAmount($("#incAmount").value);
      if (amount == null || amount <= 0) {
        showToast("Skriv inn et beløp");
        return;
      }
      const m = getMonth();
      const id = $("#incId").value;
      const payload = {
        id: id || uid(),
        person: $("#incPerson").value,
        type: $("#incType").value || "lønn",
        amount: amount,
        note: $("#incNote").value.trim(),
        date: $("#incDate").value || todayISO()
      };
      if (id) {
        const idx = m.incomes.findIndex(function (x) { return x.id === id; });
        if (idx >= 0) m.incomes[idx] = payload;
        else m.incomes.push(payload);
      } else {
        m.incomes.push(payload);
      }
      save();
      closeDlg("#dlgIncome");
      render();
      showToast("Inntekt lagret");
    });
    $("#incDelete").addEventListener("click", function () {
      const id = $("#incId").value;
      if (!id || !confirm("Slette denne inntekten?")) return;
      const m = getMonth();
      m.incomes = m.incomes.filter(function (x) { return x.id !== id; });
      save();
      closeDlg("#dlgIncome");
      render();
      showToast("Slettet");
    });

    // Saving form
    const goalClose = $("#goalClose");
    if (goalClose) {
      goalClose.addEventListener("click", function () { closeDlg("#dlgGoal"); });
    }
    const goalCancel = $("#goalCancel");
    if (goalCancel) {
      goalCancel.addEventListener("click", function () { closeDlg("#dlgGoal"); });
    }
    const formGoal = $("#formGoal");
    if (formGoal) {
      formGoal.addEventListener("submit", function (e) {
        e.preventDefault();
        resolveAmountField($("#goalTarget"));
        resolveAmountField($("#goalMonthly"));
        resolveAmountField($("#goalSaved"));
        const name = ($("#goalName").value || "").trim();
        const target = parseAmount($("#goalTarget").value);
        const monthly = parseAmount($("#goalMonthly").value);
        let saved = parseAmount($("#goalSaved").value);
        if (!name) {
          showToast("Skriv inn navn");
          return;
        }
        if (target == null || target < 0) {
          showToast("Ugyldig målbeløp");
          return;
        }
        if (monthly == null || monthly < 0) {
          showToast("Ugyldig månedlig beløp");
          return;
        }
        if (saved == null || saved < 0) saved = 0;
        const whoEl = document.querySelector('#dlgGoal input[name="goalWho"]:checked');
        const person = (whoEl && whoEl.value) || "samlet";
        if (!Array.isArray(state.savingsGoals)) state.savingsGoals = [];
        const id = $("#goalId").value;
        const payload = Calc.normalizeSavingsGoal(
          {
            id: id || uid(),
            name: name,
            target: target,
            monthly: monthly,
            saved: saved,
            person: person
          },
          state.people
        );
        const idx = state.savingsGoals.findIndex(function (x) {
          return x.id === payload.id;
        });
        if (idx >= 0) state.savingsGoals[idx] = payload;
        else state.savingsGoals.push(payload);
        closeDlg("#dlgGoal");
        save();
        render();
        showToast("Sparemål lagret");
      });
    }
    const goalDelete = $("#goalDelete");
    if (goalDelete) {
      goalDelete.addEventListener("click", function () {
        const id = $("#goalId").value;
        if (!id) return;
        if (!confirm("Slette dette sparemålet?")) return;
        state.savingsGoals = (state.savingsGoals || []).filter(function (x) {
          return x.id !== id;
        });
        closeDlg("#dlgGoal");
        save();
        render();
        showToast("Sparemål slettet");
      });
    }

    $("#savingClose").addEventListener("click", function () { closeDlg("#dlgSaving"); });
    $("#savCancel").addEventListener("click", function () { closeDlg("#dlgSaving"); });
    $("#formSaving").addEventListener("submit", function (e) {
      e.preventDefault();
      resolveAmountField($("#savAmount"));
      const amount = parseAmount($("#savAmount").value);
      if (amount == null || amount <= 0) {
        showToast("Skriv inn et beløp");
        return;
      }
      const m = getMonth();
      const id = $("#savId").value;
      const payload = {
        id: id || uid(),
        person: $("#savPerson").value,
        amount: amount,
        note: $("#savNote").value.trim(),
        date: $("#savDate").value || todayISO()
      };
      if (id) {
        const idx = m.savings.findIndex(function (x) { return x.id === id; });
        if (idx >= 0) m.savings[idx] = payload;
        else m.savings.push(payload);
      } else {
        m.savings.push(payload);
      }
      save();
      closeDlg("#dlgSaving");
      render();
      showToast("Sparing lagret");
    });
    $("#savDelete").addEventListener("click", function () {
      const id = $("#savId").value;
      if (!id || !confirm("Slette denne sparingen?")) return;
      const m = getMonth();
      m.savings = m.savings.filter(function (x) { return x.id !== id; });
      save();
      closeDlg("#dlgSaving");
      render();
      showToast("Slettet");
    });

    // New category
    $("#formNewCat").addEventListener("submit", function (e) {
      e.preventDefault();
      const name = $("#newCatName").value.trim();
      if (!name) return;
      const created = addCategory({
        name: name,
        type: $("#newCatType").value,
        owner: $("#newCatOwner").value,
        autoFill: $("#newCatType").value === "fast"
      });
      $("#newCatName").value = "";
      $("#newCatType").value = "variabel";
      fillOwnerSelect($("#newCatOwner"), "felles");
      save();
      renderCatManage();
      render();
      showToast(created ? "Kategori lagt til" : "Kunne ikke legge til");
    });

    $("#catManageList").addEventListener("change", function (e) {
      const t = e.target;
      const rename = t.getAttribute("data-rename");
      if (rename) {
        const cat = catById(rename);
        if (cat) {
          cat.name = t.value.trim() || cat.name;
          save();
          render();
        }
        return;
      }
      const type = t.getAttribute("data-type");
      if (type) {
        const cat = catById(type);
        if (cat) {
          cat.type = t.value;
          save();
          render();
        }
        return;
      }
      const owner = t.getAttribute("data-owner");
      if (owner) {
        const cat = catById(owner);
        if (cat) {
          cat.owner = t.value;
          save();
          render();
        }
        return;
      }
      const af = t.getAttribute("data-autofill");
      if (af) {
        const cat = catById(af);
        if (cat) {
          cat.autoFill = t.checked;
          save();
          render();
        }
      }
    });

    $("#catManageList").addEventListener("click", function (e) {
      const btn = e.target.closest("[data-archive]");
      if (!btn) return;
      const cat = catById(btn.getAttribute("data-archive"));
      if (!cat) return;
      cat.archived = !cat.archived;
      save();
      renderCatManage();
      render();
      showToast(cat.archived ? "Kategori arkivert" : "Kategori gjenopprettet");
    });

    // Inn/Ut view tabs
    const innUtTabs = $("#innUtTabs");
    if (innUtTabs) {
      innUtTabs.addEventListener("click", function (e) {
        const btn = e.target.closest("[data-innut-view]");
        if (!btn) return;
        state.settings.innUtView = btn.getAttribute("data-innut-view");
        save();
        render();
      });
    }

    // People management
    function addPersonFromInput(inputEl) {
      const name = ((inputEl && inputEl.value) || "").trim();
      if (!name) {
        showToast("Skriv inn et navn");
        if (inputEl) {
          try { inputEl.focus(); } catch (err) { /* */ }
        }
        return;
      }
      const id = "p" + uid();
      state.people.push({ id: id, name: name, archived: false });
      if (inputEl) inputEl.value = "";
      Object.keys(state.months).forEach(function (k) {
        Calc.ensureMonthShape(state.months[k], state.people);
      });
      Calc.ensureCategorySplits(state.categories, state.people);
      save();
      renderPeopleManage();
      render();
      showToast(name + " lagt til");
    }

    function onPeopleRename(e) {
      const t = e.target;
      const id = t && t.getAttribute && t.getAttribute("data-people-rename");
      if (!id) return;
      const person = Calc.personById(state.people, id);
      if (!person) return;
      person.name = t.value.trim() || person.name;
      save();
      renderPeopleManage();
      render();
    }

    ["btnAddPerson", "btnMerAddPerson"].forEach(function (bid) {
      const btn = document.getElementById(bid);
      if (!btn) return;
      btn.addEventListener("click", function () {
        const inputId = bid === "btnMerAddPerson" ? "merNewPersonName" : "newPersonName";
        addPersonFromInput(document.getElementById(inputId));
      });
    });
    ["newPersonName", "merNewPersonName"].forEach(function (iid) {
      const inp = document.getElementById(iid);
      if (!inp) return;
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          addPersonFromInput(inp);
        }
      });
    });

    const peopleList = $("#peopleManageList");
    const merPeopleList = $("#merPeopleManageList");
    [peopleList, merPeopleList].forEach(function (peopleList) {
      if (!peopleList) return;
      peopleList.addEventListener("change", onPeopleRename);
      peopleList.addEventListener("click", function (e) {
        const rem = e.target.closest("[data-people-remove]");
        if (rem) {
          const id = rem.getAttribute("data-people-remove");
          const person = Calc.personById(state.people, id);
          if (!person || person.archived) return;
          if (activePeopleList().length <= 1) {
            showToast("Må ha minst én aktiv person");
            return;
          }
          const hasData = Calc.personHasData(state, id);
          if (hasData) {
            if (
              !confirm(
                "Fjerne " +
                  person.name +
                  "?\n\nPersonen arkiveres (skjules). Utgifter og kategorier flyttes til Felles. Inntekter blir stående på personen i historikken (synlig i Logg-filter)."
              )
            )
              return;
            Calc.reassignPersonData(state, id, "felles");
            person.archived = true;
            if (state.settings.innUtView === id) state.settings.innUtView = "samlet";
            if (state.settings.sparingView === id) state.settings.sparingView = "samlet";
            Calc.ensureCategorySplits(state.categories, state.people);
            save();
            renderPeopleManage();
            render();
            showToast(
              person.name +
                " arkivert – utgifter til Felles. Inntekter synes fortsatt i Logg."
            );
          } else {
            if (!confirm("Fjerne " + person.name + " permanent? Ingen registrerte tall.")) return;
            state.people = state.people.filter(function (x) { return x.id !== id; });
            save();
            renderPeopleManage();
            render();
            showToast(person.name + " fjernet");
          }
          return;
        }
        const arch = e.target.closest("[data-people-archive]");
        if (arch) {
          const id = arch.getAttribute("data-people-archive");
          const person = Calc.personById(state.people, id);
          if (!person) return;
          if (!person.archived) {
            if (activePeopleList().length <= 1) {
              showToast("Må ha minst én aktiv person");
              return;
            }
            if (Calc.personHasData(state, id)) {
              if (
                !confirm(
                  "Arkivere " +
                    person.name +
                    "?\n\nUtgifter og kategorier flyttes til Felles. Inntekter blir stående på personen i historikken (synlig i Logg-filter). Personen skjules fra oversikter."
                )
              )
                return;
              Calc.reassignPersonData(state, id, "felles");
            } else if (!confirm("Arkivere " + person.name + "?")) {
              return;
            }
            person.archived = true;
            if (state.settings.innUtView === id) state.settings.innUtView = "samlet";
            if (state.settings.sparingView === id) state.settings.sparingView = "samlet";
            showToast(person.name + " arkivert");
          } else {
            person.archived = false;
            showToast(person.name + " gjenopprettet");
          }
          Calc.ensureCategorySplits(state.categories, state.people);
          save();
          renderPeopleManage();
          render();
          return;
        }
        const del = e.target.closest("[data-people-delete]");
        if (del) {
          const id = del.getAttribute("data-people-delete");
          const person = Calc.personById(state.people, id);
          if (!person) return;
          if (Calc.personHasData(state, id)) {
            showToast("Kan ikke slette – bruk arkiver (har data)");
            return;
          }
          if (activePeopleList().filter(function (x) { return x.id !== id; }).length < 1 && !person.archived) {
            showToast("Må ha minst én person");
            return;
          }
          if (!confirm("Slette " + person.name + " permanent?")) return;
          state.people = state.people.filter(function (x) { return x.id !== id; });
          save();
          renderPeopleManage();
          render();
          showToast("Slettet");
        }
      });
    });

    function exportJsonBackup() {
      downloadBlob(
        "familie-budsjett-backup-" + todayISO() + ".json",
        new Blob([JSON.stringify(state, null, 2)], { type: "application/json" })
      );
      showToast("Backup lagret (JSON)");
    }

    // Settings export/import + prominent backup
    $("#btnExportJson").addEventListener("click", exportJsonBackup);
    const btnBackupTop = $("#btnBackupTop");
    if (btnBackupTop) btnBackupTop.addEventListener("click", exportJsonBackup);
    const btnBackupSettings = $("#btnBackupSettings");
    if (btnBackupSettings) btnBackupSettings.addEventListener("click", exportJsonBackup);
    $("#btnExportCsv").addEventListener("click", function () {
      exportCsv();
      showToast("CSV eksportert");
    });
    $("#importFile").addEventListener("change", function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const parsed = JSON.parse(reader.result);
          if (!parsed || typeof parsed !== "object") throw new Error("bad");
          if (!confirm("Erstatte alt budsjettdata med denne filen?")) {
            e.target.value = "";
            return;
          }
          state = Calc.migrateState(parsed);
          if (!Array.isArray(state.savingsGoals)) state.savingsGoals = [];
          ensureCategoryOrders(state);
          save();
          closeDlg("#dlgSettings");
          render();
          showToast("Import ferdig");
        } catch (err) {
          showToast("Kunne ikke lese JSON-filen");
        }
        e.target.value = "";
      };
      reader.readAsText(file);
    });
    $("#btnReset").addEventListener("click", function () {
      if (
        !confirm(
          "Slette ALT lagret budsjettdata? Dette kan ikke angres (med mindre du har eksportert backup)."
        )
      )
        return;
      state = DEFAULT_STATE();
      save();
      closeDlg("#dlgSettings");
      render();
      showToast("Nullstilt");
    });

    // Close dialogs on backdrop click + Escape (native + fallback)
    function scrubClosedDialog(dlg) {
      setTimeout(function () {
        if (dlg.open) return;
        dlg.classList.remove("is-open");
        dlg.removeAttribute("open");
        delete dlg.dataset.fallback;
        if (!$$("dialog.modal.is-open").length) {
          document.body.classList.remove("modal-open");
        }
      }, 0);
    }
    $$("dialog.modal").forEach(function (dlg) {
      dlg.addEventListener("click", function (e) {
        if (e.target === dlg) closeDlg(dlg);
      });
      dlg.addEventListener("cancel", function () { scrubClosedDialog(dlg); });
      dlg.addEventListener("close", function () { scrubClosedDialog(dlg); });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      const openOnes = $$("dialog.modal.is-open");
      if (!openOnes.length) return;
      e.preventDefault();
      closeDlg(openOnes[openOnes.length - 1]);
    });
  }

  // Init
  bind();
  // Ensure current month exists (triggers autoFill if needed)
  getMonth();
  save();
  render();
  renderSyncUI();
  if (window.FamilieBudsjettCloud && typeof window.FamilieBudsjettCloud.init === "function") {
    window.FamilieBudsjettCloud.init({
      getState: function () { return state; },
      applyCloudState: applyCloudState,
      showToast: showToast,
      onMeta: function () { renderSyncUI(); },
      confirmFn: function (msg) { return window.confirm(msg); }
    });
  }
  if (state.settings && state.settings.pendingBalancesMigrationToast) {
    state.settings.pendingBalancesMigrationToast = false;
    save();
    showToast(
      "Gammel saldo lagt på " +
        ((state.people && state.people[0] && state.people[0].name) || "første person") +
        " (bruk). Andrea/andre startet på 0."
    );
  }
})();
