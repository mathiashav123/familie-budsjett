/**
 * Familiebudsjett – free household sync (Supabase free tier, no SDK)
 * Auth: username + password (synthetic email, Confirm email OFF).
 * Uses fetch against Auth + REST + RPC. Requires sync-core.js + supabase-config.js.
 */
(function (root) {
  "use strict";

  var Sync = root.FamilieBudsjettSync;
  if (!Sync) {
    console.error("sync-core.js mangler");
    return;
  }

  var META_KEY = Sync.SYNC_META_KEY;
  var PUSH_DEBOUNCE_MS = 1500;
  var AUTH_EMAIL_DOMAIN = "familie-local.invalid";
  var SESSION_KEY = "familie-budsjett-supabase-session-v1";
  var pushTimer = null;
  var pulling = false;
  var pushing = false;
  var host = null;
  var bootstrapped = false;
  var memorySession = null;

  function loadMeta() {
    try {
      var raw = localStorage.getItem(META_KEY);
      if (!raw) return defaultMeta();
      return Object.assign(defaultMeta(), JSON.parse(raw) || {});
    } catch (e) {
      return defaultMeta();
    }
  }

  function defaultMeta() {
    return {
      userId: null,
      username: null,
      userEmail: null,
      householdId: null,
      householdName: null,
      inviteCode: null,
      localChangeAt: null,
      lastSyncedCloudAt: null,
      lastPullAt: null,
      lastPushAt: null,
      lastSyncAt: null,
      pendingPush: false,
      lastError: null,
      keepLocalOnce: false
    };
  }

  function saveMeta(meta) {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta));
    } catch (e) {
      console.warn("Kunne ikke lagre sync-meta", e);
    }
  }

  function getConfig() {
    return root.FAMILIE_BUDGET_SUPABASE || {};
  }

  function isConfigured() {
    var c = getConfig();
    return !!(c && c.url && c.anonKey && String(c.url).indexOf("http") === 0);
  }

  function pagesRedirectUrl() {
    try {
      var u = new URL(window.location.href);
      return u.origin + u.pathname;
    } catch (e) {
      return "https://mathiashav123.github.io/familie-budsjett/";
    }
  }

  function normalizeUsername(raw) {
    return String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "_")
      .replace(/[^a-z0-9._-]/g, "");
  }

  function validateUsername(username) {
    var u = normalizeUsername(username);
    if (u.length < 3) return { ok: false, error: "Brukernavn må være minst 3 tegn" };
    if (u.length > 32) return { ok: false, error: "Brukernavn kan være maks 32 tegn" };
    if (!/^[a-z0-9][a-z0-9._-]*$/.test(u)) {
      return { ok: false, error: "Bruk kun bokstaver, tall, . _ -" };
    }
    return { ok: true, username: u };
  }

  function validatePassword(password) {
    var p = String(password || "");
    if (p.length < 6) return { ok: false, error: "Passord må være minst 6 tegn" };
    if (p.length > 72) return { ok: false, error: "Passord er for langt" };
    return { ok: true, password: p };
  }

  function usernameToEmail(username) {
    return normalizeUsername(username) + "@" + AUTH_EMAIL_DOMAIN;
  }

  function loadSession() {
    if (memorySession) return memorySession;
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      memorySession = JSON.parse(raw);
      return memorySession;
    } catch (e) {
      return null;
    }
  }

  function saveSession(session) {
    memorySession = session;
    try {
      if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
      else localStorage.removeItem(SESSION_KEY);
    } catch (e) { /* ignore */ }
  }

  function authHeaders(extra) {
    var c = getConfig();
    var h = {
      apikey: c.anonKey,
      "Content-Type": "application/json"
    };
    var s = loadSession();
    if (s && s.access_token) h.Authorization = "Bearer " + s.access_token;
    else h.Authorization = "Bearer " + c.anonKey;
    if (extra) Object.assign(h, extra);
    return h;
  }

  async function api(method, path, body, opts) {
    opts = opts || {};
    var c = getConfig();
    if (!c.url) throw new Error("Supabase er ikke konfigurert");
    var url = String(c.url).replace(/\/$/, "") + path;
    var init = { method: method, headers: authHeaders(opts.headers || {}) };
    if (body !== undefined) init.body = JSON.stringify(body);
    var res = await fetch(url, init);
    var text = await res.text();
    var data = null;
    if (text) {
      try { data = JSON.parse(text); } catch (e) { data = text; }
    }
    if (!res.ok) {
      var msg =
        (data && (data.msg || data.message || data.error_description || data.error)) ||
        ("HTTP " + res.status);
      var err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  function setError(meta, err) {
    var msg = err && (err.message || String(err));
    meta.lastError = msg || "Ukjent feil";
    meta.pendingPush = false;
    saveMeta(meta);
    return meta;
  }

  function clearError(meta) {
    meta.lastError = null;
    return meta;
  }

  function getSessionUser() {
    var s = loadSession();
    if (!s || !s.access_token || !s.user) return null;
    // crude expiry check
    if (s.expires_at && Date.now() / 1000 > s.expires_at - 30) {
      // try refresh later; still return user for now
    }
    return s.user;
  }

  async function refreshSessionIfNeeded() {
    var s = loadSession();
    if (!s || !s.refresh_token) return s;
    var expiresAt = s.expires_at || 0;
    if (Date.now() / 1000 < expiresAt - 60) return s;
    try {
      var data = await api("POST", "/auth/v1/token?grant_type=refresh_token", {
        refresh_token: s.refresh_token
      });
      var next = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || s.refresh_token,
        expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600)),
        user: data.user || s.user
      };
      saveSession(next);
      return next;
    } catch (e) {
      console.warn("refresh failed", e);
      return s;
    }
  }

  async function ensureProfile(user, username) {
    if (!user) return;
    var uname = username || (user.user_metadata && user.user_metadata.username) || null;
    if (!uname && user.email && String(user.email).indexOf("@" + AUTH_EMAIL_DOMAIN) > 0) {
      uname = String(user.email).split("@")[0];
    }
    if (!uname) return;
    try {
      await api("POST", "/rest/v1/profiles?on_conflict=user_id", {
        user_id: user.id,
        username: normalizeUsername(uname)
      }, {
        headers: {
          Prefer: "resolution=merge-duplicates,return=minimal"
        }
      });
    } catch (e) {
      console.warn("profile upsert", e);
    }
  }

  async function signUp(username, password) {
    if (!isConfigured()) throw new Error("Supabase er ikke konfigurert");
    var vu = validateUsername(username);
    if (!vu.ok) throw new Error(vu.error);
    var vp = validatePassword(password);
    if (!vp.ok) throw new Error(vp.error);
    var email = usernameToEmail(vu.username);
    var data;
    try {
      data = await api("POST", "/auth/v1/signup", {
        email: email,
        password: vp.password,
        data: { username: vu.username }
      });
    } catch (e) {
      var m = e.message || "";
      if (/already|registered|exists/i.test(m)) {
        throw new Error("Brukernavnet er opptatt – prøv å logge inn");
      }
      throw e;
    }
    if (!data.access_token) {
      throw new Error(
        "Konto opprettet, men mangler sesjon. Slå AV «Confirm email» i Supabase Auth (gratis)."
      );
    }
    var session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600)),
      user: data.user
    };
    saveSession(session);
    await ensureProfile(session.user, vu.username);
    var meta = loadMeta();
    meta.userId = session.user.id;
    meta.username = vu.username;
    meta.userEmail = email;
    clearError(meta);
    saveMeta(meta);
    return { user: session.user, username: vu.username };
  }

  async function signIn(username, password) {
    if (!isConfigured()) throw new Error("Supabase er ikke konfigurert");
    var vu = validateUsername(username);
    if (!vu.ok) throw new Error(vu.error);
    var vp = validatePassword(password);
    if (!vp.ok) throw new Error(vp.error);
    var email = usernameToEmail(vu.username);
    var data;
    try {
      data = await api("POST", "/auth/v1/token?grant_type=password", {
        email: email,
        password: vp.password
      });
    } catch (e) {
      throw new Error("Feil brukernavn eller passord");
    }
    var session = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_at || (Math.floor(Date.now() / 1000) + (data.expires_in || 3600)),
      user: data.user
    };
    saveSession(session);
    await ensureProfile(session.user, vu.username);
    var meta = loadMeta();
    meta.userId = session.user.id;
    meta.username = vu.username;
    meta.userEmail = email;
    clearError(meta);
    saveMeta(meta);
    return { user: session.user, username: vu.username };
  }

  async function signOut() {
    try {
      await refreshSessionIfNeeded();
      await api("POST", "/auth/v1/logout", {});
    } catch (e) { /* ignore */ }
    saveSession(null);
    var meta = loadMeta();
    meta.userId = null;
    meta.username = null;
    meta.userEmail = null;
    meta.householdId = null;
    meta.householdName = null;
    meta.inviteCode = null;
    meta.pendingPush = false;
    meta.lastError = null;
    saveMeta(meta);
  }

  async function fetchMembershipHousehold() {
    await refreshSessionIfNeeded();
    var user = getSessionUser();
    if (!user) return null;
    var mem = await api(
      "GET",
      "/rest/v1/household_members?select=household_id,role&user_id=eq." +
        encodeURIComponent(user.id) +
        "&limit=1"
    );
    if (!mem || !mem.length) return null;
    var hid = mem[0].household_id;
    var hh = await api(
      "GET",
      "/rest/v1/households?select=id,name,invite_code,updated_at,payload&id=eq." +
        encodeURIComponent(hid) +
        "&limit=1"
    );
    return hh && hh[0] ? hh[0] : null;
  }

  function applyHouseholdToMeta(meta, row) {
    if (!row) return meta;
    meta.householdId = row.id;
    meta.householdName = row.name || "Familie";
    meta.inviteCode = row.invite_code || null;
    return meta;
  }

  async function createHouseholdWithLocal() {
    await refreshSessionIfNeeded();
    var state = host.getState();
    var row = await api("POST", "/rest/v1/rpc/create_household", {
      p_name: "Familie",
      p_payload: state
    });
    var meta = loadMeta();
    applyHouseholdToMeta(meta, {
      id: row.id,
      name: row.name,
      invite_code: row.invite_code
    });
    meta.lastSyncedCloudAt = row.updated_at || Sync.isoNow();
    meta.lastPushAt = Sync.isoNow();
    meta.lastSyncAt = Sync.isoNow();
    meta.pendingPush = false;
    clearError(meta);
    saveMeta(meta);
    return row;
  }

  async function joinWithInviteCode(code) {
    await refreshSessionIfNeeded();
    var normalized = Sync.normalizeInviteCode(code);
    if (normalized.length < 4) throw new Error("Ugyldig invitasjonskode");
    return await api("POST", "/rest/v1/rpc/join_household_by_code", { p_code: normalized });
  }

  async function pushNow() {
    if (pushing) return { ok: false, reason: "busy" };
    var meta = loadMeta();
    if (!meta.householdId || !isConfigured()) return { ok: false, reason: "no-household" };
    await refreshSessionIfNeeded();
    if (!getSessionUser()) return { ok: false, reason: "not-logged-in" };

    pushing = true;
    meta.pendingPush = true;
    saveMeta(meta);
    if (host && host.onMeta) host.onMeta(meta);

    try {
      var state = host.getState();
      var now = Sync.isoNow();
      var rows = await api(
        "PATCH",
        "/rest/v1/households?id=eq." + encodeURIComponent(meta.householdId),
        { payload: state, updated_at: now },
        { headers: { Prefer: "return=representation" } }
      );
      var row = Array.isArray(rows) ? rows[0] : rows;
      meta = loadMeta();
      meta.lastSyncedCloudAt = (row && row.updated_at) || now;
      meta.lastPushAt = now;
      meta.lastSyncAt = now;
      meta.pendingPush = false;
      if (row) applyHouseholdToMeta(meta, row);
      clearError(meta);
      saveMeta(meta);
      if (host && host.onMeta) host.onMeta(meta);
      return { ok: true };
    } catch (err) {
      meta = setError(loadMeta(), err);
      if (host && host.onMeta) host.onMeta(meta);
      return { ok: false, error: err };
    } finally {
      pushing = false;
    }
  }

  function schedulePush() {
    var meta = loadMeta();
    meta.localChangeAt = Sync.isoNow();
    meta.pendingPush = !!(meta.householdId && isConfigured());
    saveMeta(meta);
    if (host && host.onMeta) host.onMeta(meta);
    if (!meta.householdId || !isConfigured()) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () {
      pushTimer = null;
      pushNow().then(function (r) {
        if (r && r.error && host && host.showToast) host.showToast("Kunne ikke synke til sky");
        if (host && host.onMeta) host.onMeta(loadMeta());
      });
    }, PUSH_DEBOUNCE_MS);
  }

  async function pullAndMaybeApply(opts) {
    opts = opts || {};
    if (pulling) return { ok: false, reason: "busy" };
    if (!isConfigured()) return { ok: false, reason: "not-configured" };
    await refreshSessionIfNeeded();
    var user = getSessionUser();
    if (!user) return { ok: false, reason: "not-logged-in" };

    pulling = true;
    try {
      var row = await fetchMembershipHousehold();
      var meta = loadMeta();
      meta.userId = user.id;
      if (!meta.username && user.user_metadata && user.user_metadata.username) {
        meta.username = user.user_metadata.username;
      }
      if (!row) {
        saveMeta(meta);
        return { ok: true, needsHousehold: true };
      }
      applyHouseholdToMeta(meta, row);
      saveMeta(meta);

      var decision = Sync.decideSyncAction({
        cloudUpdatedAt: row.updated_at,
        localChangeAt: meta.localChangeAt,
        lastSyncedCloudAt: meta.lastSyncedCloudAt,
        lastPullAt: meta.lastPullAt,
        forcePull: !!opts.forcePull,
        forcePush: !!opts.forcePush
      });

      if (decision.action === "noop") {
        meta.lastSyncAt = meta.lastSyncAt || Sync.isoNow();
        clearError(meta);
        saveMeta(meta);
        return { ok: true, action: "noop" };
      }

      if (decision.action === "push" || (decision.action === "conflict" && meta.keepLocalOnce)) {
        meta.keepLocalOnce = false;
        saveMeta(meta);
        var pushed = await pushNow();
        return { ok: !!pushed.ok, action: "push", error: pushed.error };
      }

      if (decision.action === "pull" || decision.action === "conflict") {
        var localState = host.getState();
        var cloudPayload = row.payload;
        var differs = !Sync.payloadsRoughlyEqual(localState, cloudPayload);
        var localHas = Sync.hasMeaningfulLocalData(localState);
        var confirmFn = (host && host.confirmFn) || function (msg) { return window.confirm(msg); };

        if (decision.action === "conflict" && localHas && differs && !opts.silent) {
          var takeCloud = confirmFn(
            "Skyen har andre data enn denne enheten.\n\nOK = hent fra sky (anbefalt)\nAvbryt = behold lokal og last opp"
          );
          if (!takeCloud) {
            meta.keepLocalOnce = true;
            saveMeta(meta);
            var pushedLocal = await pushNow();
            return { ok: !!pushedLocal.ok, action: "keep-local", error: pushedLocal.error };
          }
        } else if (localHas && differs && decision.action === "pull" && !opts.silent && meta.lastSyncedCloudAt) {
          var okPull = confirmFn(
            "Finne nyere data i skyen. Erstatte det som ligger lokalt på denne enheten?"
          );
          if (!okPull) return { ok: true, action: "skipped-pull" };
        }

        if (cloudPayload && typeof cloudPayload === "object") {
          host.applyCloudState(cloudPayload);
          meta = loadMeta();
          meta.lastSyncedCloudAt = row.updated_at;
          meta.lastPullAt = Sync.isoNow();
          meta.lastSyncAt = Sync.isoNow();
          meta.localChangeAt = meta.lastPullAt;
          meta.pendingPush = false;
          clearError(meta);
          saveMeta(meta);
          if (host.showToast) host.showToast("Hentet fra sky");
          if (host.onMeta) host.onMeta(meta);
          return { ok: true, action: "pull" };
        }
      }
      return { ok: true, action: decision.action };
    } catch (err) {
      var m = setError(loadMeta(), err);
      if (host && host.onMeta) host.onMeta(m);
      return { ok: false, error: err };
    } finally {
      pulling = false;
    }
  }

  async function afterAuthReady() {
    await refreshSessionIfNeeded();
    var user = getSessionUser();
    var meta = loadMeta();
    if (!user) {
      meta.userId = null;
      saveMeta(meta);
      if (host && host.onMeta) host.onMeta(meta);
      return { loggedIn: false };
    }
    meta.userId = user.id;
    if (user.user_metadata && user.user_metadata.username) meta.username = user.user_metadata.username;
    clearError(meta);
    saveMeta(meta);
    await ensureProfile(user, meta.username);

    var row = await fetchMembershipHousehold();
    if (!row) {
      if (host && host.showToast) host.showToast("Oppretter husstand…");
      await createHouseholdWithLocal();
      if (host && host.showToast) host.showToast("Synket til sky");
      if (host && host.onMeta) host.onMeta(loadMeta());
      return { loggedIn: true, created: true };
    }
    applyHouseholdToMeta(meta, row);
    saveMeta(meta);
    var result = await pullAndMaybeApply({ silent: false });
    if (host && host.onMeta) host.onMeta(loadMeta());
    return { loggedIn: true, pull: result };
  }

  async function joinHouseholdFlow(code) {
    var row = await joinWithInviteCode(code);
    var meta = loadMeta();
    applyHouseholdToMeta(meta, {
      id: row.id,
      name: row.name,
      invite_code: row.invite_code
    });
    saveMeta(meta);

    var localState = host.getState();
    var differs = !Sync.payloadsRoughlyEqual(localState, row.payload);
    var localHas = Sync.hasMeaningfulLocalData(localState);
    if (localHas && differs) {
      var confirmFn = (host && host.confirmFn) || function (msg) { return window.confirm(msg); };
      var takeCloud = confirmFn(
        "Du har lokal data som skiller seg fra husstanden.\n\nOK = hent husstandens data fra sky\nAvbryt = behold lokal (lastes opp til husstanden)"
      );
      if (!takeCloud) {
        await pushNow();
        if (host.showToast) host.showToast("Lokal data lastet opp");
        return { ok: true, action: "pushed-local" };
      }
    }
    if (row.payload && typeof row.payload === "object") {
      host.applyCloudState(row.payload);
      meta = loadMeta();
      meta.lastSyncedCloudAt = row.updated_at;
      meta.lastPullAt = Sync.isoNow();
      meta.lastSyncAt = Sync.isoNow();
      meta.localChangeAt = meta.lastPullAt;
      clearError(meta);
      saveMeta(meta);
      if (host.showToast) host.showToast("Hentet fra sky");
    }
    if (host && host.onMeta) host.onMeta(loadMeta());
    return { ok: true, action: "joined" };
  }

  function getStatus() {
    var meta = loadMeta();
    var status = Sync.syncStatusLabel(meta, isConfigured());
    if (meta.username && status.kind !== "local") {
      status.detail = "@" + meta.username + " · " + (status.detail || "");
    }
    return status;
  }

  function init(hostApi) {
    host = hostApi || {};
    var meta = loadMeta();
    if (host.onMeta) host.onMeta(meta);
    if (!isConfigured()) return { configured: false };

    function onFocusPull() {
      if (!isConfigured() || !getSessionUser()) return;
      pullAndMaybeApply({ silent: false }).then(function () {
        if (host.onMeta) host.onMeta(loadMeta());
      });
    }
    window.addEventListener("focus", onFocusPull);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") onFocusPull();
    });

    bootstrapped = true;
    afterAuthReady().catch(function (err) {
      setError(loadMeta(), err);
      if (host.onMeta) host.onMeta(loadMeta());
    });
    return { configured: true, client: true };
  }

  root.FamilieBudsjettCloud = {
    init: init,
    isConfigured: isConfigured,
    loadMeta: loadMeta,
    saveMeta: saveMeta,
    schedulePush: schedulePush,
    pushNow: pushNow,
    pullNow: function () { return pullAndMaybeApply({ forcePull: true }); },
    signUp: signUp,
    signIn: signIn,
    signOut: signOut,
    createHouseholdWithLocal: createHouseholdWithLocal,
    joinHouseholdFlow: joinHouseholdFlow,
    getStatus: getStatus,
    pagesRedirectUrl: pagesRedirectUrl,
    afterAuthReady: afterAuthReady,
    normalizeUsername: normalizeUsername,
    usernameToEmail: usernameToEmail,
    AUTH_EMAIL_DOMAIN: AUTH_EMAIL_DOMAIN
  };
})(typeof self !== "undefined" ? self : window);
