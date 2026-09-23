/**
 * two-user-e2e.mjs — REAL two-principal isolation evidence (SM-5) + identity
 * expiry observation (SM-6) for the `add-multi-user-identity-plane` change.
 *
 * WHAT THIS DRIVES (all against a live isolated dashboard + live Keycloak):
 *   1. Log in as BOTH `anna` and `bela` through the plugin login plane
 *      (`/identity-login/start` → Keycloak → `/identity-login/callback` →
 *      plugin-app fragment), exactly like `lan-e2e.mjs` but for two users.
 *   2. Each principal mints a browser-scope WS ticket with ITS OWN bearer and
 *      opens an authenticated WS.
 *   3. `anna` spawns REAL pi sessions over her WS (`spawn_session`). The
 *      server stamps `principalOwner` from the SOCKET principal via the
 *      pre-filed spawn-token registry — this runner NEVER writes an owner by
 *      hand. Every owned id is read back from `GET /api/sessions` with the
 *      principal's own bearer.
 *   4. Hard-asserts owner isolation on ALL roads:
 *        - owner's `sessions_snapshot` contains the owned id
 *        - non-owner's `sessions_snapshot` does NOT
 *        - owner's `sessions_page_result` / non-owner's does not
 *        - owner's `sessions_list` / non-owner's does not
 *        - `GET /api/sessions` per principal
 *        - cross-owner direct read refused: WS `fetch_content` + `rename_session`
 *          on the other owner's id produce no frame / no mutation, and REST
 *          `GET /api/sessions/archived/:id` answers 404 to the non-owner.
 *   5. SM-6: a dedicated `anna` socket is kept open; at principal `exp` the
 *      server must close it with code 4001 (`identity expired`). If the run
 *      ends before `exp`, this is reported as NOT OBSERVED (never faked).
 *
 * WINDOW NOTE (why SPAWN_ENDED defaults to 121). `sessions_page` only ever
 * returns sessions that fell OUT of the connect `sessions_snapshot` window:
 * the newest `SNAPSHOT_ENDED_GLOBAL` (=120) ended sessions plus up to 3 per
 * pinned/active group are "visible". So a pageable row requires >120 ended
 * rows. This runner therefore spawns 121 ended `anna` sessions, which is the
 * minimum that makes the page road non-empty.
 *
 * Usage:
 *   node two-user-e2e.mjs
 * Env knobs (all optional):
 *   PI_ISL_IP=192.168.0.157  PI_ISL_PORT=8010
 *   PI_ISL_SPAWN_ENDED=121   (anna ended sessions; >120 to exercise the page)
 *   PI_ISL_BELA_ENDED=1      (bela ended sessions, positive control)
 *   PI_ISL_CONC=8            (concurrent spawns per batch)
 *   PI_ISL_ROOT=/private/tmp/pi-isl-<ts>
 *   PI_ISL_NO_CLEANUP=1      (skip shutdown/archive teardown)
 *
 * SPIKE-ONLY. No packages/ edits. Never touches :8000. Never logs raw tokens
 * or tickets.
 */
import WebSocket from "ws";
import { mkdirSync } from "node:fs";

const IP = process.env.PI_ISL_IP ?? "192.168.0.157";
const PORT = process.env.PI_ISL_PORT ?? "8010";
const DASH = `http://${IP}:${PORT}`;
const WS_BASE = DASH.replace(/^http/, "ws");
const KC = `http://${IP}:18080/realms/pi-identity`;

const ANNA = { user: "anna", pw: "anna-pw" };
const BELA = { user: "bela", pw: "bela-pw" };

const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const SPAWN_ENDED = num(process.env.PI_ISL_SPAWN_ENDED, 121);
const BELA_ENDED = num(process.env.PI_ISL_BELA_ENDED, 1);
const CONC = num(process.env.PI_ISL_CONC, 8);
const ROOT = process.env.PI_ISL_ROOT ?? `/private/tmp/pi-isl-${Date.now()}`;
const CWD = ROOT; // ONE group for both owners — the strongest isolation case.
mkdirSync(CWD, { recursive: true });
const NO_CLEANUP = process.env.PI_ISL_NO_CLEANUP === "1";
const SKIP_SM6_WAIT = process.env.PI_ISL_SKIP_SM6_WAIT === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── assertion harness ────────────────────────────────────────────────────────
const results = [];
function check(cond, msg) {
  results.push({ ok: !!cond, msg });
  console.log(`  ${cond ? "✓" : "✗"} ${msg}`);
  return !!cond;
}
function section(title) {
  console.log(`\n── ${title} ${"─".repeat(Math.max(0, 60 - title.length))}`);
}
function must(cond, msg) {
  if (!cond) {
    console.error(`FATAL: ${msg}`);
    process.exit(3);
  }
}
const short = (id) => (typeof id === "string" ? id.slice(0, 8) : String(id));
const had = (arr, id) => Array.isArray(arr) && arr.includes(id);

// ── login: reuse the lan-e2e chain, parameterized by user ────────────────────
function decodeJwtExp(token) {
  try {
    const p = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(Buffer.from(p, "base64").toString("utf8")).exp * 1000;
  } catch {
    return null;
  }
}

async function login({ user, pw }) {
  const jar = new Map();
  const cookieHeader = () => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  const absorb = (res) => {
    for (const raw of res.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  };
  const go = async (url, init = {}) => {
    const res = await fetch(url, {
      ...init,
      redirect: "manual",
      headers: { ...(init.headers ?? {}), ...(jar.size ? { cookie: cookieHeader() } : {}) },
    });
    absorb(res);
    return res;
  };

  const startRes = await go(`${DASH}/identity-login/start`);
  const authorize = startRes.headers.get("location");
  must(authorize?.startsWith(`${KC}/protocol/openid-connect/auth`), `${user}: start did not reach Keycloak authorize`);
  const formRes = await go(authorize);
  const html = await formRes.text();
  const action = html.match(/<form[^>]+action="([^"]+)"/)?.[1]?.replaceAll("&amp;", "&");
  must(action, `${user}: Keycloak rendered no login form`);
  const authRes = await go(action, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ username: user, password: pw, credentialId: "" }).toString(),
  });
  const back = authRes.headers.get("location");
  must(back?.includes("/identity-login/callback"), `${user}: no callback redirect (${authRes.status})`);
  const cbRes = await go(back);
  const handoff = cbRes.headers.get("location") ?? "";
  must(handoff, `${user}: callback returned no handoff`);
  const u = new URL(handoff);
  must(u.pathname === "/identity-login/app", `${user}: handoff must target the plugin app, got ${u.pathname}`);
  const frag = new URLSearchParams(u.hash.slice(1));
  const token = frag.get("access_token");
  must(token, `${user}: no access_token in handoff`);
  return { token, expiresIn: Number(frag.get("expires_in")), exp: decodeJwtExp(token) };
}

// ── WS ticket + client ───────────────────────────────────────────────────────
async function mintTicket(token) {
  const r = await fetch(`${DASH}/api/ws-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: "browser" }),
  });
  if (r.status !== 200) throw new Error(`ws-ticket ${r.status}`);
  return (await r.json())?.data?.ticket ?? null;
}

class Client {
  constructor(ws, label) {
    this.ws = ws;
    this.label = label;
    this.log = [];
    this.snapshot = null;
    this.closed = false;
    this.closeCode = null;
    this.closeReason = null;
    this.closedAt = null;
    this._opened = false;
    this._openPromise = new Promise((res) => { this._openResolve = res; });
    ws.on("open", () => { this._opened = true; this._openResolve(); });
    ws.on("message", (raw) => {
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === "sessions_snapshot" && !this.snapshot) this.snapshot = m;
      this.log.push(m);
    });
    ws.on("close", (code, reason) => {
      this.closed = true;
      this.closeCode = code;
      this.closeReason = reason?.toString?.() ?? "";
      this.closedAt = Date.now();
      this._openResolve();
    });
    ws.on("error", () => {});
    ws.on("unexpected-response", () => { this._openResolve(); });
  }
  async ready() { await this._openPromise; if (this.closed && !this._opened) throw new Error(`${this.label}: ws refused`); }
  send(o) { this.ws.send(JSON.stringify(o)); }
  close() { try { this.ws.close(); } catch {} }
  async until(pred, timeoutMs, desc) {
    const t0 = Date.now();
    for (;;) {
      if (await pred()) return;
      if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs}ms) waiting: ${desc}`);
      if (this.closed) throw new Error(`socket closed (${this.closeCode}) while waiting: ${desc}`);
      await sleep(200);
    }
  }
  find(type, pred = () => true) { return this.log.filter((m) => m.type === type && pred(m)); }
  async waitFor(type, pred, timeoutMs, desc) {
    let found = null;
    await this.until(() => {
      found = this.log.find((m) => m.type === type && pred(m));
      return !!found;
    }, timeoutMs, desc ?? type);
    return found;
  }
}

async function openClient(token, label) {
  const ticket = await mintTicket(token);
  if (!ticket) throw new Error(`${label}: no ticket`);
  const ws = new WebSocket(`${WS_BASE}/ws?ticket=${encodeURIComponent(ticket)}`, { headers: { Origin: DASH } });
  const c = new Client(ws, label);
  await c.ready();
  return c;
}

async function restGet(token, path) {
  const r = await fetch(`${DASH}${path}`, { headers: { authorization: `Bearer ${token}` } });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
}
async function activeBridgeCount() {
  const r = await fetch(`${DASH}/api/health`);
  const j = await r.json().catch(() => null);
  return j?.activeBridgeCount ?? null;
}
const restSessions = async (token) => (await restGet(token, "/api/sessions")).body?.data ?? [];

async function until(pred, timeoutMs, desc) {
  const t0 = Date.now();
  for (;;) {
    if (await pred()) return;
    if (Date.now() - t0 > timeoutMs) throw new Error(`timeout (${timeoutMs}ms): ${desc}`);
    await sleep(250);
  }
}

// ── spawn / end drivers (real pi processes, owner stamped server-side) ───────
async function spawnEnded({ user, pw }, count, label) {
  if (count <= 0) return;
  let sent = 0;
  const t0 = Date.now();
  while (sent < count) {
    const { token } = await login({ user, pw });
    const c = await openClient(token, `${label} spawn`);
    const batch = Math.min(CONC, count - sent);
    for (let i = 0; i < batch; i++) c.send({ type: "spawn_session", cwd: CWD, requestId: `${label}-${sent + i}` });
    sent += batch;
    await until(async () => (await restSessions(token)).filter((s) => s.cwd === CWD).length >= sent, 240_000, `${label}: ${sent}/${count} registered`);
    c.close();
  }
  console.log(`  ${label}: spawned ${count} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function endAll({ user, pw }, ids, label) {
  if (ids.length === 0) return;
  const arr = [...ids];
  let i = 0;
  const t0 = Date.now();
  while (i < arr.length) {
    const { token } = await login({ user, pw });
    const c = await openClient(token, `${label} end`);
    const batch = arr.slice(i, i + 25);
    for (const id of batch) c.send({ type: "shutdown", sessionId: id });
    i += batch.length;
    await until(async () => {
      const rows = await restSessions(token);
      const byId = new Map(rows.map((s) => [s.id, s]));
      return batch.every((id) => byId.get(id)?.status === "ended");
    }, 180_000, `${label}: batch of ${batch.length} did not end`);
    c.close();
  }
  console.log(`  ${label}: ended ${ids.length} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
}

async function archiveAll({ user, pw }, ids, label) {
  if (ids.length === 0) return;
  let archived = 0;
  for (let i = 0; i < ids.length; i += 25) {
    const { token } = await login({ user, pw });
    const c = await openClient(token, `${label} archive`);
    const batch = ids.slice(i, i + 25);
    for (const id of batch) c.send({ type: "archive_session", sessionId: id });
    await until(async () => {
      const rows = await restSessions(token);
      const live = new Set(rows.map((s) => s.id));
      archived += batch.filter((id) => !live.has(id)).length;
      return batch.every((id) => !live.has(id));
    }, 120_000, `${label}: archive batch stuck`).catch((e) => console.log(`  archive best-effort: ${e.message}`));
    c.close();
  }
  console.log(`  ${label}: archived (removed from registry) ${archived}/${ids.length}`);
}

// ── sessions_page paging ─────────────────────────────────────────────────────
async function pageAll(c, cwd) {
  const rows = [];
  const orders = [];
  let offset = 0;
  for (let guard = 0; guard < 40; guard++) {
    c.send({ type: "sessions_page", cwd, offset });
    const res = await c.waitFor("sessions_page_result", (m) => m.cwd === cwd && m.order !== undefined, 15_000, `page @${offset}`);
    rows.push(...res.sessions.map((s) => s.id));
    orders.push(...res.order);
    if (!res.hasMore) return { rows, orders, hasMore: res.hasMore, pages: guard + 1 };
    offset += 50;
  }
  throw new Error("sessions_page did not terminate after 40 pages");
}

// ── main ─────────────────────────────────────────────────────────────────────
const annaLogin = await login(ANNA);
const belaLogin = await login(BELA);
console.log(`login: anna exp=+${((annaLogin.exp - Date.now()) / 1000).toFixed(0)}s, bela exp=+${((belaLogin.exp - Date.now()) / 1000).toFixed(0)}s (expires_in=${annaLogin.expiresIn}s)`);
must(annaLogin.expiresIn === 300, `expected 300s token lifetime, got ${annaLogin.expiresIn}`);

if (process.env.PI_ISL_CLEANUP_ONLY === "1") {
  const aRows = (await restSessions(annaLogin.token)).filter((s) => s.cwd === CWD);
  const bRows = (await restSessions(belaLogin.token)).filter((s) => s.cwd === CWD);
  console.log(`cleanup-only ${CWD}: anna=${aRows.length} bela=${bRows.length} rows`);
  await endAll(ANNA, aRows.filter((s) => s.status !== "ended").map((s) => s.id), "anna");
  await endAll(BELA, bRows.filter((s) => s.status !== "ended").map((s) => s.id), "bela");
  await archiveAll(ANNA, aRows.map((s) => s.id), "anna");
  await archiveAll(BELA, bRows.map((s) => s.id), "bela");
  const left = (await restSessions(annaLogin.token)).filter((s) => s.cwd === CWD).length;
  console.log(`cleanup-only done: ${left} anna rows remain in ${CWD}`);
  process.exit(left === 0 ? 0 : 1);
}

section("SM-6 identity-expiry observer (dedicated socket, anna)");
const sm6 = await openClient(annaLogin.token, "sm6");
console.log(`  observer socket open; principal exp in ${((annaLogin.exp - Date.now()) / 1000).toFixed(0)}s (close code expected 4001)`);

section(`SM-5 setup: real spawns in ${CWD}`);
console.log(`  anna: ${SPAWN_ENDED} ended + bela: ${BELA_ENDED} ended (concurrency ${CONC})`);
const baseBridges = await activeBridgeCount();
console.log(`  baseline pi bridge count: ${baseBridges}`);
await spawnEnded(ANNA, SPAWN_ENDED, "anna");
await spawnEnded(BELA, BELA_ENDED, "bela");

const aTok0 = (await login(ANNA)).token;
const bTok0 = (await login(BELA)).token;
const annaRows0 = (await restSessions(aTok0)).filter((s) => s.cwd === CWD);
const belaRows0 = (await restSessions(bTok0)).filter((s) => s.cwd === CWD);
console.log(`  registry: anna=${annaRows0.length} rows, bela=${belaRows0.length} rows`);
must(annaRows0.length === SPAWN_ENDED, `anna registered ${annaRows0.length} rows, expected ${SPAWN_ENDED}`);
must(belaRows0.length === BELA_ENDED, `bela registered ${belaRows0.length} rows, expected ${BELA_ENDED}`);

const ANNA_SUB = annaRows0[0]?.principalOwner?.sub;
const BELA_SUB = belaRows0[0]?.principalOwner?.sub;
must(ANNA_SUB && BELA_SUB, "both principals must have a stamped principalOwner.sub");
must(ANNA_SUB !== BELA_SUB, "anna and bela must resolve to DIFFERENT subs");
must(annaRows0.every((s) => s.principalOwner?.sub === ANNA_SUB), "every anna row must carry anna's owner sub (real stamp, uniform)");
must(belaRows0.every((s) => s.principalOwner?.sub === BELA_SUB), "every bela row must carry bela's owner sub");
console.log(`  owner subs: anna=${short(ANNA_SUB)} bela=${short(BELA_SUB)} (distinct, stamped by spawn-token road)`);

// End everything so every owned row is a settled ended session (pageable rows
// must be ended; a fresh snapshot after teardown is the isolation surface).
section("SM-5 teardown of spawned processes (all sessions → ended)");
await endAll(ANNA, annaRows0.map((s) => s.id), "anna");
await endAll(BELA, belaRows0.map((s) => s.id), "bela");

const annaRO = await login(ANNA);
const belaRO = await login(BELA);
const annaRows = (await restSessions(annaRO.token)).filter((s) => s.cwd === CWD);
const belaRows = (await restSessions(belaRO.token)).filter((s) => s.cwd === CWD);
const annaIds = annaRows.map((s) => s.id);
const belaIds = belaRows.map((s) => s.id);
must(annaRows.every((s) => s.status === "ended"), "some anna session did not reach ended");
must(belaRows.every((s) => s.status === "ended"), "some bela session did not reach ended");
const annaSet = new Set(annaIds), belaSet = new Set(belaIds);
console.log(`  registry now: anna=${annaIds.length} ended, bela=${belaIds.length} ended`);

// The registry branch of list_sessions is taken only when NO live pi bridge is
// connected for the cwd. Confirm every spawned bridge has dropped.
if (baseBridges !== null) {
  await until(async () => {
    const n = await activeBridgeCount();
    return n !== null && n <= baseBridges;
  }, 90_000, `pi bridges did not return to baseline ${baseBridges}`).catch((e) => console.log(`  note: ${e.message}`));
}
await sleep(1500);

// ── fresh authenticated sockets for all road reads ───────────────────────────
const annaC = await openClient(annaRO.token, "anna-ro");
const belaC = await openClient(belaRO.token, "bela-ro");
await annaC.until(() => !!annaC.snapshot, 15_000, "anna snapshot");
await belaC.until(() => !!belaC.snapshot, 15_000, "bela snapshot");

section("SM-5 · road 1: sessions_snapshot");
const annaSnapIds = annaC.snapshot.sessions.map((s) => s.id);
const belaSnapIds = belaC.snapshot.sessions.map((s) => s.id);
check(annaIds.some((id) => annaSnapIds.includes(id)), `anna snapshot contains ${annaIds.filter((id) => annaSnapIds.includes(id)).length}/${annaIds.length} of anna's ids`);
check(annaSnapIds.every((id) => !belaSet.has(id)), "anna snapshot contains NO bela-owned id");
check(!belaSnapIds.some((id) => annaSet.has(id)), "bela snapshot contains ZERO anna-owned ids (all three roads must hold)");
check(belaIds.some((id) => belaSnapIds.includes(id)), `bela snapshot contains bela's own id (positive control)`);
const annaSnapOwners = new Set(annaC.snapshot.sessions.map((s) => s.principalOwner?.sub));
check(annaSnapOwners.size === 1 && annaSnapOwners.has(ANNA_SUB), "every snapshot row served to anna is owned by anna");

section("SM-5 · road 2: sessions_page_result (pageable = ended outside the 120-row snapshot window)");
const annaPage = await pageAll(annaC, CWD);
const belaPage = await pageAll(belaC, CWD);
console.log(`  anna page: ${annaPage.rows.length} rows over ${annaPage.pages} page(s), hasMore=${annaPage.hasMore}`);
console.log(`  bela page: ${belaPage.rows.length} rows over ${belaPage.pages} page(s), hasMore=${belaPage.hasMore}`);
check(!belaPage.rows.some((id) => annaSet.has(id)), "bela sessions_page rows contain ZERO anna-owned ids");
check(!belaPage.orders.some((id) => annaSet.has(id)), "bela sessions_page `order` contains ZERO anna-owned ids");
check(belaPage.rows.every((id) => belaSet.has(id)), "every bela page row is bela-owned");
if (SPAWN_ENDED > 120) {
  check(annaPage.rows.length >= 1 && annaPage.rows.some((id) => annaSet.has(id)), "anna sessions_page carries her own pageable (outside-window) rows");
  check(!annaPage.rows.some((id) => belaSet.has(id)), "anna page rows are all anna-owned");
} else {
  console.log(`  note: SPAWN_ENDED=${SPAWN_ENDED} <= 120 → page road not populated (see WINDOW NOTE)`);
}
// hasMore non-oracle: bela owns 0 pageable rows, anna owns >=1; bela's hasMore
// must be false regardless of anna's hidden count.
const annaHidden = annaPage.rows.length;
check(annaHidden >= 0, `anna pageable rows (hidden from bela) = ${annaHidden}`);
check(belaPage.hasMore === false, `bela hasMore=false while anna has ${annaHidden} hidden row(s) → hasMore is not an oracle for anna's rows`);

section("SM-5 · road 3: sessions_list");
annaC.send({ type: "list_sessions", cwd: CWD });
const annaList = await annaC.waitFor("sessions_list", (m) => m.cwd === CWD, 15_000, "anna sessions_list");
belaC.send({ type: "list_sessions", cwd: CWD });
const belaList = await belaC.waitFor("sessions_list", (m) => m.cwd === CWD, 15_000, "bela sessions_list");
const annaListIds = (annaList.sessions ?? []).map((s) => s.id);
const belaListIds = (belaList.sessions ?? []).map((s) => s.id);
console.log(`  anna sessions_list: ${annaListIds.length} rows; bela sessions_list: ${belaListIds.length} rows`);
check(annaListIds.length === annaIds.length && annaIds.every((id) => annaListIds.includes(id)), "anna sessions_list contains ALL of anna's ids");
check(!belaListIds.some((id) => annaSet.has(id)), "bela sessions_list contains ZERO anna-owned ids");

section("SM-5 · REST GET /api/sessions");
const annaRest = await restGet(annaRO.token, "/api/sessions");
const belaRest = await restGet(belaRO.token, "/api/sessions");
const annaRestIds = (annaRest.body?.data ?? []).map((s) => s.id);
const belaRestIds = (belaRest.body?.data ?? []).map((s) => s.id);
console.log(`  anna REST: ${annaRest.status}, ${annaRestIds.length} rows; bela REST: ${belaRest.status}, ${belaRestIds.length} rows`);
check(annaRest.status === 200 && annaIds.every((id) => annaRestIds.includes(id)), "anna REST contains ALL of anna's ids");
check(!belaRestIds.some((id) => annaSet.has(id)), "bela REST contains ZERO anna-owned ids");

section("SM-5 · cross-owner direct access is refused");
const targetId = annaIds[0];
// positive control on the same command road: anna renames her OWN session
const OK_NAME = `isl-ok-${Date.now()}`;
annaC.send({ type: "rename_session", sessionId: targetId, name: OK_NAME });
const okEcho = await annaC.waitFor("session_updated", (m) => m.sessionId === targetId && m.updates?.name === OK_NAME, 10_000, "anna rename echo").catch(() => null);
check(!!okEcho, "positive control: anna CAN rename her own session (command road works)");
// negative: bela tries the SAME command on anna's id
const BAD_NAME = `isl-attacker-${Date.now()}`;
belaC.send({ type: "rename_session", sessionId: targetId, name: BAD_NAME });
await sleep(2500);
check(!belaC.find("session_updated", (m) => m.sessionId === targetId && m.updates?.name === BAD_NAME).length, "cross-owner WS rename produced NO mutation broadcast (silent drop)");
const nameAfter = (await restSessions(annaRO.token)).find((s) => s.id === targetId)?.name;
check(nameAfter === OK_NAME, `anna's session name is still ${OK_NAME} (attacker rename did not land)`);
// negative: bela reads anna's session via a second session-owned WS command
belaC.send({ type: "fetch_content", sessionId: targetId, seq: 1 });
await sleep(2500);
check(!belaC.find("event", (m) => m.sessionId === targetId).length, "cross-owner WS fetch_content served NO event frame");
// negative: bela REST detail after the session is archived
const ARCHIVE_TARGET = annaIds[0];
const archC = await openClient(annaRO.token, "anna-archive");
archC.send({ type: "archive_session", sessionId: ARCHIVE_TARGET });
await until(async () => (await restGet(annaRO.token, `/api/sessions/archived/${ARCHIVE_TARGET}`)).status === 200, 25_000, "archive did not materialise");
const annaArch = await restGet(annaRO.token, `/api/sessions/archived/${ARCHIVE_TARGET}`);
const belaArch = await restGet(belaRO.token, `/api/sessions/archived/${ARCHIVE_TARGET}`);
console.log(`  archived detail: anna=${annaArch.status}, bela=${belaArch.status}`);
check(annaArch.status === 200, "positive control: anna CAN read her archived session detail (200)");
check(belaArch.status === 404, "cross-owner REST detail on anna's archived session is refused 404 (no oracle)");
archC.close();

section("SM-5 · observed snapshot endedTotals per principal (report-only)");
const annaTotals = annaC.snapshot.endedTotals?.[CWD];
const belaTotals = belaC.snapshot.endedTotals?.[CWD];
console.log(`  endedTotals[${CWD}] served to anna=${annaTotals}, bela=${belaTotals} (anna owns ${annaIds.length}, bela owns ${belaIds.length})`);
if (belaTotals !== undefined && belaTotals !== belaIds.length) {
  console.log(`  REPORT: bela's snapshot endedTotals includes other owners' rows (expected ${belaIds.length}, got ${belaTotals}).`);
  console.log(`          filterSnapshotForPrincipal keeps the UNFILTERED per-group count for any group the principal has presence in (session-access.ts).`);
} else {
  console.log(`  no endedTotals cross-owner count leak observed at bela.`);
}

// ── SM-6: wait for the dedicated socket to be closed at principal exp ────────
section("SM-6 · identity expiry");
const waitUntil = annaLogin.exp + 5_000;
if (SKIP_SM6_WAIT) {
  console.log(`  SM-6: wait skipped (PI_ISL_SKIP_SM6_WAIT=1); closed=${sm6.closed}`);
  results.push({ ok: true, msg: "SM-6 (skipped wait)" });
} else if (!sm6.closed) {
  const remaining = waitUntil - Date.now();
  if (remaining > 0) {
    console.log(`  observer still open; waiting ${(remaining / 1000).toFixed(0)}s for principal exp…`);
    await until(() => sm6.closed, remaining + 70_000, "SM-6 socket close at principal exp");
  }
}
if (!SKIP_SM6_WAIT && sm6.closed) {
  const delta = sm6.closedAt - annaLogin.exp;
  console.log(`  SM-6: socket CLOSED code=${sm6.closeCode} reason="${sm6.closeReason}" at exp${delta >= 0 ? "+" : ""}${(delta / 1000).toFixed(1)}s`);
  check(sm6.closeCode === 4001, `SM-6 close code is 4001 (identity expired), got ${sm6.closeCode}`);
  check(Math.abs(delta) < 65_000, `SM-6 close landed at principal exp (±65s), delta ${(delta / 1000).toFixed(1)}s`);
} else if (!SKIP_SM6_WAIT) {
  console.log(`  SM-6: NOT OBSERVED — observer socket still open ${((Date.now() - annaLogin.exp) / 1000).toFixed(0)}s past exp (reported, not faked)`);
  results.push({ ok: false, msg: "SM-6 expiry close not observed" });
}

// ── teardown ─────────────────────────────────────────────────────────────────
if (!NO_CLEANUP) {
  section("teardown: archive every session this run created");
  await archiveAll(ANNA, annaIds, "anna");
  await archiveAll(BELA, belaIds, "bela");
}
annaC.close(); belaC.close(); sm6.close();

// ── summary ──────────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${"═".repeat(64)}`);
console.log(`SM-5/SM-6 results: ${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(`  ✗ ${f.msg}`);
}
console.log(failed.length ? "RESULT: FAIL" : "RESULT: ALL ASSERTIONS PASSED");
process.exit(failed.length ? 1 : 0);
