// To telefoner mot en falsk Supabase: samtidige endringer skal flettes, ikke overskrives.
import fs from "fs";
import vm from "vm";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const Calc = require("./calc-core.js");
let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("  ✗", m); } };

// ——— falsk server (PostgREST-semantikk for households) ———
let tick = Date.parse("2026-10-29T10:00:00Z");
const server = { row: null, members: new Set() };
function ts() { tick += 1000; return new Date(tick).toISOString(); }
async function fakeFetch(url, init) {
  const u = new URL(url); const p = u.pathname; const q = u.searchParams; const body = init.body ? JSON.parse(init.body) : null;
  const res = (code, data) => ({ ok: code < 400, status: code, text: async () => (data === undefined ? "" : JSON.stringify(data)) });
  if (p === "/rest/v1/household_members") return res(200, server.row ? [{ household_id: server.row.id, role: "owner" }] : []);
  if (p === "/rest/v1/households" && init.method === "GET") return res(200, server.row ? [JSON.parse(JSON.stringify(server.row))] : []);
  if (p === "/rest/v1/households" && init.method === "PATCH") {
    const f = q.get("updated_at");
    if (f && f.replace(/^eq\./, "") !== server.row.updated_at) return res(200, []);
    server.row.payload = body.payload; server.row.updated_at = ts();
    return res(200, [JSON.parse(JSON.stringify(server.row))]);
  }
  if (p === "/rest/v1/rpc/create_household") {
    server.row = { id: "h1", name: "Familie", invite_code: "ABCD2345", payload: body.p_payload, updated_at: ts() };
    return res(200, Object.assign({ existing: false }, server.row));
  }
  if (p === "/rest/v1/rpc/join_household_by_code") return res(200, Object.assign({ existing: true }, server.row));
  if (p.startsWith("/rest/v1/profiles")) return res(201, []);
  return res(404, { message: "nope " + p });
}

function device(name, initialState) {
  const store = {};
  const localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  const ctx = { console, URL, JSON, Date, Math, setTimeout: () => 0, clearTimeout: () => {}, localStorage, fetch: fakeFetch, TextEncoder, TextDecoder,
    CompressionStream: globalThis.CompressionStream, DecompressionStream: globalThis.DecompressionStream, Response, Blob, btoa, atob, Uint8Array, Promise };
  ctx.self = ctx; ctx.window = ctx; ctx.document = { addEventListener() {}, visibilityState: "visible" }; ctx.addEventListener = () => {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("sync-core.js", "utf8"), ctx);
  ctx.FAMILIE_BUDGET_SUPABASE = { url: "https://fake.supabase.co", anonKey: "anon" };
  vm.runInContext(fs.readFileSync("cloud-sync.js", "utf8"), ctx);
  localStorage.setItem("familie-budsjett-supabase-session-v1", JSON.stringify({ access_token: "t", refresh_token: "r", expires_at: 9e9, user: { id: "u1" } }));
  const dev = { name, state: Calc.migrateState(JSON.parse(JSON.stringify(initialState))), backups: 0, store };
  const Cloud = ctx.FamilieBudsjettCloud;
  Cloud.init({ getState: () => dev.state, applyCloudState: s => { dev.state = Calc.migrateState(JSON.parse(JSON.stringify(s))); },
    showToast() {}, onMeta() {}, confirmFn: () => true, backupFn: () => { dev.backups++; } });
  dev.Cloud = Cloud;
  dev.edit = async fn => { fn(dev.state); Cloud.schedulePush(); };
  dev.push = () => Cloud.pushNow();
  dev.pull = () => Cloud.pullNow();
  return dev;
}
const flush = () => new Promise(r => setTimeout(r, 30));
const exp = (id, amount, owner, note) => ({ id, amount, categoryId: "mat", owner, date: "2026-10-29", note: note || "" });

const export0 = JSON.parse(fs.readFileSync(fs.existsSync("/workspace/familie-budsjett-rettet-2026-10-28.json") ? "/workspace/familie-budsjett-rettet-2026-10-28.json" : "familie-budsjett-mobil.html", "utf8").startsWith("{") ? fs.readFileSync("/workspace/familie-budsjett-rettet-2026-10-28.json", "utf8") : "{}");
const base0 = export0.people ? export0 : Calc.wizardState({ people: [{ name: "A" }, { name: "B" }], now: new Date(2026, 9, 1) });
const K = "2026-10";
const countExp = s => (s.months[K] && s.months[K].expenses || []).length;

// 1) Mathias oppretter husstand
const A = device("A", base0);
await A.Cloud.afterAuthReady(); await flush();
ok(server.row && server.row.id === "h1", "husstand opprettet");
const n0 = countExp(A.state);

// 2) Andrea: ny telefon (tom/standard data) logger inn med samme bruker → får husstandens data, ingen sammenslåing med standardtall
const B = device("B", Calc.migrateState({}));
await B.Cloud.afterAuthReady(); await flush();
ok(countExp(B.state) === n0, "ny telefon får alle kjøp fra husstanden (" + countExp(B.state) + "/" + n0 + ")");
ok(JSON.stringify(B.state.people) === JSON.stringify(A.state.people), "samme personer på begge telefoner");
ok(B.backups === 0, "ingen unødig backup av tom telefon");

// 3) Begge legger inn kjøp samtidig (offline), så synker begge
A.state.months[K].expenses.push(exp("eA1", 111, A.state.people[0].id, "Rema A"));
A.Cloud.schedulePush();
B.state.months[K].expenses.push(exp("eB1", 222, B.state.people[1] ? B.state.people[1].id : B.state.people[0].id, "Kiwi B"));
B.Cloud.schedulePush();
await A.push(); await B.push(); await A.pull();
const ids = s => s.months[K].expenses.map(e => e.id);
ok(ids(A.state).includes("eA1") && ids(A.state).includes("eB1"), "A har begge kjøp etter synk");
ok(ids(B.state).includes("eA1") && ids(B.state).includes("eB1"), "B har begge kjøp etter synk");
ok(countExp(A.state) === n0 + 2 && countExp(B.state) === n0 + 2, "ingen duplikater / tap");

// 4) A endrer budsjett, B sletter eget kjøp samtidig
const catId = Object.keys(A.state.months[K].budgets || {})[0];
if (catId) {
  const owner = Object.keys(A.state.months[K].budgets[catId])[0];
  A.state.months[K].budgets[catId][owner] = 4321; A.Cloud.schedulePush();
}
B.state.months[K].expenses = B.state.months[K].expenses.filter(e => e.id !== "eB1"); B.Cloud.schedulePush();
await A.push(); await B.push(); await A.pull();
ok(!ids(A.state).includes("eB1") && !ids(B.state).includes("eB1"), "sletting fra B gjelder også A");
if (catId) {
  const owner = Object.keys(B.state.months[K].budgets[catId])[0];
  ok(B.state.months[K].budgets[catId][owner] === 4321, "budsjettendring fra A kom til B");
}
ok(ids(B.state).includes("eA1"), "A sitt kjøp overlevde B sin opplasting");

// 5) Kappløp: B pusher mens A har gammel versjon (PATCH med utdatert updated_at avvises → flettes)
A.state.months[K].expenses.push(exp("eA2", 50, A.state.people[0].id)); A.Cloud.schedulePush();
B.state.months[K].expenses.push(exp("eB2", 60, B.state.people[0].id)); B.Cloud.schedulePush();
await B.push(); await A.push(); await B.pull();
ok(["eA2", "eB2"].every(i => ids(A.state).includes(i) && ids(B.state).includes(i)), "begge nye kjøp overlever kappløp");
const cloud = server.row.payload;
ok(JSON.stringify(cloud).includes("eA2") && JSON.stringify(cloud).includes("eB2"), "skyen har begge");

// 6) Ingen endring på eksisterende tall (felles + personlige kjøp uendret bortsett fra nye)
const orig = new Map(base0.months[K].expenses.map(e => [e.id, JSON.stringify(e)]));
ok(A.state.months[K].expenses.filter(e => orig.has(e.id)).every(e => orig.get(e.id) === JSON.stringify(e)), "opprinnelige kjøp uendret");
ok(Object.keys(base0.months).every(k => A.state.months[k]), "alle måneder beholdt");

// 7) Telefon med egne data (aldri synket) logger inn → husstand vinner, egen data lastes ned som backup
const C = device("C", Calc.wizardState({ people: [{ name: "X", salary: 1 }], budgets: [{ name: "Mat", amount: 1 }], now: new Date(2026, 9, 1) }));
await C.Cloud.afterAuthReady(); await flush();
ok(C.backups === 1, "egen data lastet ned som backup før henting");
ok(JSON.stringify(C.state.people) === JSON.stringify(A.state.people), "husstandens data hentet");
ok(JSON.stringify(server.row.payload).includes("eA2"), "husstanden ikke overskrevet av ny telefon");

// 8) Rene merge-enhetstester
const S = (await import("./sync-core.js")).default || require("./sync-core.js");
const m = S.merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3 });
ok(m.a === 2 && m.b === 3, "ulike felt endret på hver side → begge beholdes");
const m2 = S.merge3([{ id: 1, v: 1 }], [{ id: 1, v: 1 }, { id: 2 }], [{ id: 1, v: 5 }]);
ok(m2.length === 2 && m2.find(x => x.id === 1).v === 5, "post endret i sky + ny lokal post");

console.log(`\n=== Multi-device sync: ${passed} passed, ${failed} failed ===`);
process.exit(failed ? 1 : 0);
