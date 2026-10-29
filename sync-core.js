/**
 * Familiebudsjett – pure sync helpers (Node + browser)
 * Last-write-wins helpers; no I/O.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.FamilieBudsjettSync = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function parseTs(s) {
    if (!s) return 0;
    var t = Date.parse(String(s));
    return Number.isFinite(t) ? t : 0;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function generateInviteCode(len) {
    var n = len || 8;
    var out = "";
    var i;
    for (i = 0; i < n; i++) {
      out += INVITE_ALPHABET.charAt(Math.floor(Math.random() * INVITE_ALPHABET.length));
    }
    return out;
  }

  /** True if local budget looks non-empty (worth confirming before overwrite). */
  function hasMeaningfulLocalData(state) {
    if (!state || typeof state !== "object") return false;
    if (Array.isArray(state.categories) && state.categories.length > 0) return true;
    if (Array.isArray(state.savingsGoals) && state.savingsGoals.length > 0) return true;
    var months = state.months;
    if (!months || typeof months !== "object") return false;
    var key;
    for (key in months) {
      if (!Object.prototype.hasOwnProperty.call(months, key)) continue;
      var m = months[key];
      if (!m || typeof m !== "object") continue;
      if (Array.isArray(m.expenses) && m.expenses.length > 0) return true;
      if (Array.isArray(m.savings) && m.savings.length > 0) return true;
      if (m.budgets && typeof m.budgets === "object") {
        var bk;
        for (bk in m.budgets) {
          if (Object.prototype.hasOwnProperty.call(m.budgets, bk)) return true;
        }
      }
      if (m.plannedIncome && typeof m.plannedIncome === "object") {
        var pid;
        for (pid in m.plannedIncome) {
          if (!Object.prototype.hasOwnProperty.call(m.plannedIncome, pid)) continue;
          var pi = m.plannedIncome[pid];
          if (!pi || typeof pi !== "object") continue;
          if (pi["lønn"] || pi.lonn || pi.ekstra || pi.sparing) return true;
        }
      }
      if (m.balances && typeof m.balances === "object") {
        var bid;
        for (bid in m.balances) {
          if (!Object.prototype.hasOwnProperty.call(m.balances, bid)) continue;
          var bal = m.balances[bid];
          if (!bal) continue;
          if ((bal.bruk != null && Number(bal.bruk) !== 0) || (bal.spare != null && Number(bal.spare) !== 0) || (bal.forLonn != null && Number(bal.forLonn) !== 0)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  function payloadsRoughlyEqual(a, b) {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch (e) {
      return false;
    }
  }

  /**
   * Decide pull / push / conflict / noop (last-write-wins v1).
   * Spec: on ambiguous conflict, prefer cloud (caller toasts + can keep local once).
   *
   * @param {object} opts
   * @param {string|null} opts.cloudUpdatedAt
   * @param {string|null} opts.localChangeAt - last local save time
   * @param {string|null} opts.lastSyncedCloudAt - cloud updated_at at last successful sync
   * @param {string|null} [opts.lastPullAt]
   * @param {boolean} [opts.forcePull]
   * @param {boolean} [opts.forcePush]
   */
  function decideSyncAction(opts) {
    opts = opts || {};
    if (opts.forcePull) return { action: "pull", prefer: "cloud", reason: "force-pull" };
    if (opts.forcePush) return { action: "push", prefer: "local", reason: "force-push" };

    var cloudTs = parseTs(opts.cloudUpdatedAt);
    var localTs = parseTs(opts.localChangeAt);
    var syncedCloudTs = parseTs(opts.lastSyncedCloudAt);
    var lastPullTs = parseTs(opts.lastPullAt);

    var localDirty = localTs > syncedCloudTs && localTs > lastPullTs;
    // Also dirty if we never synced but have a local change timestamp
    if (!opts.lastSyncedCloudAt && localTs > 0) localDirty = true;

    var cloudNewerThanSynced = cloudTs > syncedCloudTs;
    var cloudExists = cloudTs > 0;

    if (!cloudExists) {
      return localDirty
        ? { action: "push", prefer: "local", reason: "no-cloud-yet" }
        : { action: "noop", prefer: null, reason: "empty" };
    }

    if (localDirty && cloudNewerThanSynced) {
      // Both sides changed since last sync → prefer cloud per v1
      return { action: "conflict", prefer: "cloud", reason: "both-changed" };
    }
    if (cloudNewerThanSynced && !localDirty) {
      return { action: "pull", prefer: "cloud", reason: "cloud-newer" };
    }
    if (localDirty && !cloudNewerThanSynced) {
      return { action: "push", prefer: "local", reason: "local-newer" };
    }
    // Tie-break: if cloud updated_at is strictly after local change, pull
    if (cloudTs > localTs) {
      return { action: "pull", prefer: "cloud", reason: "cloud-ts-gt-local" };
    }
    return { action: "noop", prefer: null, reason: "in-sync" };
  }

  function formatLastSyncNb(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return "";
    try {
      return d.toLocaleString("nb-NO", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit"
      });
    } catch (e) {
      return String(iso);
    }
  }

  /**
   * Norwegian status label for Mer → Konto / Synk.
   * @returns {{ label: string, detail: string, kind: string }}
   */
  function syncStatusLabel(meta, configured) {
    meta = meta || {};
    if (!configured) {
      return {
        label: "Kun lokalt",
        detail: "Synk mellom PC og telefon er ikke aktiv ennå. Data lagres lokalt.",
        kind: "local"
      };
    }
    if (!meta.userId && !meta.username) {
      return {
        label: "Kun lokalt",
        detail: "Opprett husstand eller logg inn for å synke PC og telefon",
        kind: "local"
      };
    }
    if (meta.pendingPush) {
      return {
        label: "Synker…",
        detail: meta.lastSyncAt ? "Sist: " + formatLastSyncNb(meta.lastSyncAt) : "Laster opp…",
        kind: "pending"
      };
    }
    if (meta.lastError) {
      return {
        label: "Synk feilet",
        detail: String(meta.lastError).slice(0, 120),
        kind: "error"
      };
    }
    if (meta.householdId && meta.lastSyncAt) {
      return {
        label: "Synket",
        detail: "Sist synket " + formatLastSyncNb(meta.lastSyncAt),
        kind: "synced"
      };
    }
    if (meta.householdId) {
      return {
        label: "Innlogget",
        detail: "Husstand klar – venter på første synk",
        kind: "pending"
      };
    }
    return {
      label: "Innlogget",
      detail: "Opprett husstand eller bli med med kode",
      kind: "local"
    };
  }

  /** Normalize invite code input. */
  function normalizeInviteCode(raw) {
    return String(raw || "")
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
  }

  /**
   * Cheap fingerprint for skip-unchanged push (not cryptographic).
   */
  function payloadFingerprint(state) {
    try {
      var s = JSON.stringify(state);
      var hash = 2166136261;
      for (var i = 0; i < s.length; i++) {
        hash ^= s.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return s.length + ":" + (hash >>> 0).toString(16);
    } catch (e) {
      return String(Date.now());
    }
  }

  function estimatePayloadBytes(state) {
    try {
      return JSON.stringify(state).length;
    } catch (e) {
      return 0;
    }
  }

  /**
   * Pack state for cloud households.payload.
   * Small payloads: plain state (backward compatible).
   * Large: { _fb: 1, enc: "json", active, archives } structured split
   *   so readers can ignore archives detail if needed; still one JSONB.
   * Optional gzip-b64 when CompressionStream/zlib available (async helper outside).
   *
   * Structured form always includes version + updated_at for smarter clients.
   */
  /**
   * Slim archive for routine sync: keep rollup/refs, drop cold months[].
   * Full months only when includeArchiveMonths is true (restore/export).
   */
  function slimArchiveEntry(a) {
    if (!a || typeof a !== "object") return a;
    var months = a.months && typeof a.months === "object" ? a.months : null;
    var monthCount = months ? Object.keys(months).length : Number(a.monthCount) || 0;
    return {
      year: a.year,
      archivedAt: a.archivedAt || null,
      rollup: a.rollup && typeof a.rollup === "object" ? a.rollup : null,
      sparingYear: a.sparingYear || 0,
      monthCount: monthCount,
      monthsLazy: true
    };
  }

  function slimArchivesForSync(archives) {
    return (archives || []).map(slimArchiveEntry);
  }

  function archiveHasFullMonths(a) {
    return !!(a && a.months && typeof a.months === "object" && Object.keys(a.months).length);
  }

  /**
   * Merge remote archives into local: never wipe full months when remote is lazy/slim.
   */
  function mergeArchivesPreservingMonths(localArchives, remoteArchives) {
    var local = Array.isArray(localArchives) ? localArchives : [];
    var remote = Array.isArray(remoteArchives) ? remoteArchives : [];
    var byYear = {};
    local.forEach(function (a) {
      if (a && Number.isFinite(Number(a.year))) byYear[a.year] = a;
    });
    remote.forEach(function (r) {
      if (!r || !Number.isFinite(Number(r.year))) return;
      var y = r.year;
      var prev = byYear[y];
      if (!prev) {
        byYear[y] = r;
        return;
      }
      if (archiveHasFullMonths(r)) {
        byYear[y] = r;
        return;
      }
      // Remote slim: keep local months, refresh rollup/refs from remote
      byYear[y] = Object.assign({}, prev, {
        archivedAt: r.archivedAt || prev.archivedAt || null,
        rollup: r.rollup || prev.rollup || null,
        sparingYear: r.sparingYear != null ? r.sparingYear : prev.sparingYear,
        monthCount: r.monthCount != null ? r.monthCount : prev.monthCount,
        months: archiveHasFullMonths(prev) ? prev.months : (prev.months || {})
      });
      if (byYear[y].monthsLazy && archiveHasFullMonths(byYear[y])) {
        delete byYear[y].monthsLazy;
      }
    });
    return Object.keys(byYear)
      .map(Number)
      .sort(function (a, b) { return a - b; })
      .map(function (y) { return byYear[y]; });
  }

  function packCloudPayload(state, opts) {
    opts = opts || {};
    var st = state && typeof state === "object" ? state : {};
    var archives = Array.isArray(st.archives) ? st.archives : [];
    var includeMonths = opts.includeArchiveMonths === true;
    var packedArchives = includeMonths ? archives : slimArchivesForSync(archives);
    var active = Object.assign({}, st);
    // Structured split: activePayload without heavy archive months (refs + archives[] beside it)
    active.archives = [];
    var bytes = estimatePayloadBytes(st);
    var forceStruct = !!opts.forceStructured || bytes >= (opts.threshold || 96 * 1024) || archives.length > 0;
    if (!forceStruct) {
      return st;
    }
    return {
      _fb: 1,
      version: st.version || 2,
      updated_at: opts.updatedAt || isoNow(),
      activePayload: active,
      archives: packedArchives,
      archiveRefs: archives.map(function (a) {
        var months = a.months && typeof a.months === "object" ? a.months : null;
        return {
          year: a.year,
          archivedAt: a.archivedAt || null,
          monthCount: months ? Object.keys(months).length : Number(a.monthCount) || 0,
          sparingYear: a.sparingYear || 0,
          monthsIncluded: includeMonths && !!(months && Object.keys(months).length)
        };
      }),
      archivesLazy: !includeMonths
    };
  }

  /**
   * Unpack cloud payload → plain app state.
   * Accepts legacy plain state OR {_fb:1,...} envelope.
   */
  function unpackCloudPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (payload._fb === 1) {
      if (payload.enc === "gzip-b64" && typeof payload.body === "string") {
        // Caller should decompress via unpackGzipCloudPayload; return marker
        return payload;
      }
      var active = payload.activePayload && typeof payload.activePayload === "object"
        ? Object.assign({}, payload.activePayload)
        : Object.assign({}, payload);
      delete active._fb;
      delete active.activePayload;
      delete active.archiveRefs;
      if (Array.isArray(payload.archives)) {
        active.archives = payload.archives;
      } else if (!Array.isArray(active.archives)) {
        active.archives = [];
      }
      return active;
    }
    if (!Array.isArray(payload.archives)) {
      // additive default for older clouds
      var clone = Object.assign({}, payload);
      if (clone.archives == null) clone.archives = [];
      return clone;
    }
    return payload;
  }

  function isGzipCloudPayload(payload) {
    return !!(payload && payload._fb === 1 && payload.enc === "gzip-b64" && payload.body);
  }

  /** Build gzip-b64 envelope from UTF-8 JSON string (body already compressed+b64). */
  function wrapGzipCloudPayload(base64Body, rawBytes, meta) {
    meta = meta || {};
    return {
      _fb: 1,
      enc: "gzip-b64",
      body: base64Body,
      bytes: rawBytes || null,
      version: meta.version || 2,
      updated_at: meta.updated_at || isoNow()
    };
  }

  // ——— 3-veis fletting (per post) ———
  // base = sist synkede versjon, local = denne enheten, remote = skyen nå.
  // Endringer fra begge sider beholdes. Samme post endret begge steder → lokal vinner.
  function isPlainObj(x) { return x !== null && typeof x === "object" && !Array.isArray(x); }
  function jeq(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
  function isIdArray(a) {
    return Array.isArray(a) && a.length > 0 && a.every(function (x) { return isPlainObj(x) && x.id != null; });
  }
  function mergeIdArrays(b, l, r) {
    b = Array.isArray(b) ? b : []; l = Array.isArray(l) ? l : []; r = Array.isArray(r) ? r : [];
    var bm = {}, lm = {}, rm = {};
    b.forEach(function (x) { if (x && x.id != null) bm[x.id] = x; });
    l.forEach(function (x) { if (x && x.id != null) lm[x.id] = x; });
    r.forEach(function (x) { if (x && x.id != null) rm[x.id] = x; });
    var order = [], seen = {};
    r.concat(l).forEach(function (x) { if (x && x.id != null && !seen[x.id]) { seen[x.id] = 1; order.push(x.id); } });
    var out = [];
    order.forEach(function (id) {
      var inB = id in bm, inL = id in lm, inR = id in rm;
      if (inL && inR) { out.push(merge3(bm[id], lm[id], rm[id])); return; }
      if (inL && !inR) {
        // slettet i skyen? bare slett hvis lokal ikke er endret
        if (inB && jeq(bm[id], lm[id])) return;
        out.push(lm[id]); return;
      }
      if (inR && !inL) {
        if (inB && jeq(bm[id], rm[id])) return; // slettet lokalt
        out.push(rm[id]);
      }
    });
    return out;
  }
  function merge3(b, l, r) {
    if (jeq(l, r)) return l;
    if (b !== undefined && jeq(l, b)) return r;
    if (b !== undefined && jeq(r, b)) return l;
    if (isPlainObj(l) && isPlainObj(r)) {
      var bb = isPlainObj(b) ? b : {};
      var out = {};
      var keys = {};
      Object.keys(l).concat(Object.keys(r)).forEach(function (k) { keys[k] = 1; });
      Object.keys(keys).forEach(function (k) {
        var lv = l[k], rv = r[k], bv = bb[k];
        var inL = Object.prototype.hasOwnProperty.call(l, k), inR = Object.prototype.hasOwnProperty.call(r, k);
        var v;
        if (inL && inR) v = merge3(bv, lv, rv);
        else if (inL) v = (bv !== undefined && jeq(bv, lv)) ? undefined : lv;
        else v = (bv !== undefined && jeq(bv, rv)) ? undefined : rv;
        if (v !== undefined) out[k] = v;
      });
      return out;
    }
    if ((isIdArray(l) || isIdArray(r) || isIdArray(b)) && Array.isArray(l) && Array.isArray(r)) {
      return mergeIdArrays(b, l, r);
    }
    return l; // ekte konflikt på en enkeltverdi → denne enheten vinner
  }
  /** Flett hele budsjett-staten. Arkiv flettes med eksisterende arkiv-logikk. */
  function mergeStates(base, local, remote) {
    if (!isPlainObj(remote)) return local;
    if (!isPlainObj(local)) return remote;
    var b = isPlainObj(base) ? base : {};
    var L = Object.assign({}, local), R = Object.assign({}, remote), B = Object.assign({}, b);
    delete L.archives; delete R.archives; delete B.archives;
    // view/ui er per enhet
    delete B.view; var view = L.view; delete L.view; delete R.view;
    var out = merge3(B, L, R);
    if (view !== undefined) out.view = view;
    out.archives = mergeArchivesPreservingMonths(local.archives || [], remote.archives || []);
    return out;
  }

  return {
    parseTs: parseTs,
    merge3: merge3,
    mergeStates: mergeStates,
    isoNow: isoNow,
    generateInviteCode: generateInviteCode,
    hasMeaningfulLocalData: hasMeaningfulLocalData,
    payloadsRoughlyEqual: payloadsRoughlyEqual,
    decideSyncAction: decideSyncAction,
    formatLastSyncNb: formatLastSyncNb,
    syncStatusLabel: syncStatusLabel,
    normalizeInviteCode: normalizeInviteCode,
    payloadFingerprint: payloadFingerprint,
    estimatePayloadBytes: estimatePayloadBytes,
    packCloudPayload: packCloudPayload,
    unpackCloudPayload: unpackCloudPayload,
    slimArchiveEntry: slimArchiveEntry,
    slimArchivesForSync: slimArchivesForSync,
    archiveHasFullMonths: archiveHasFullMonths,
    mergeArchivesPreservingMonths: mergeArchivesPreservingMonths,
    isGzipCloudPayload: isGzipCloudPayload,
    wrapGzipCloudPayload: wrapGzipCloudPayload,
    SYNC_META_KEY: "familie-budsjett-sync-meta-v1"
  };
});
