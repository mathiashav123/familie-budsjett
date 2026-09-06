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
          if ((bal.bruk != null && Number(bal.bruk) !== 0) || (bal.spare != null && Number(bal.spare) !== 0)) {
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

  return {
    parseTs: parseTs,
    isoNow: isoNow,
    generateInviteCode: generateInviteCode,
    hasMeaningfulLocalData: hasMeaningfulLocalData,
    payloadsRoughlyEqual: payloadsRoughlyEqual,
    decideSyncAction: decideSyncAction,
    formatLastSyncNb: formatLastSyncNb,
    syncStatusLabel: syncStatusLabel,
    normalizeInviteCode: normalizeInviteCode,
    SYNC_META_KEY: "familie-budsjett-sync-meta-v1"
  };
});
