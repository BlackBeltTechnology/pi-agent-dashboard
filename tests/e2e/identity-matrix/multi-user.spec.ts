/**
 * L3 multi-user session scoping on an EMPTY, login-enforced dashboard
 * (change: add-multi-user-identity-plane, §6.2 / §8.1 / §8.2 / D23 / D24).
 *
 * anna + bela sign in through the core `/login` page in separate browsers and
 * spawn REAL pi sessions over their own authenticated sockets (the road the UI
 * uses). Asserts, end to end:
 *   S1 empty setup: signed out ⇒ 401; both users start with nothing.
 *   S2 a new session is visible to its owner only (REST + live sidebar).
 *   S3 a non-owner cannot reach it (direct URL, subscribe, rename, read,
 *      prompt, shutdown) and receives NO live frame about it or its folder.
 *   S4 symmetric for bela's own session.
 *   S5 a pi started from a terminal (no owner) is invisible to both users;
 *      the host-only local token (CLI) sees every session (D23 break-glass).
 *   S6 sign out → back in: ownership is kept.
 *   S7 dashboard restart: ownership survives (persisted to `.meta.json`).
 *
 * Regressions this pins (multi-user run, 2026-09-24): live session_added /
 * session_updated / sessions_reordered fanned out to every socket; the owner was
 * wiped from `.meta.json` by the full-overwrite save and by the reattach
 * re-register; the local token saw an empty list.
 *
 * Needs `pi` on PATH (skipped otherwise). Uses a DEDICATED dashboard (it
 * restarts it and spawns processes) against the matrix's fake OIDC issuer.
 */
import { type ChildProcess, execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import WebSocket from "ws";
import { bootDedicated, type DedicatedInstance, readState } from "./matrix-lifecycle.js";

const hasPi = (() => {
  try {
    execFileSync("pi", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

test.describe.configure({ mode: "serial", timeout: 180_000 });
test.skip(!hasPi, "needs the pi CLI on PATH to spawn real sessions");

let inst: DedicatedInstance;
let base: string;
const work = fs.mkdtempSync(path.join(process.platform === "win32" ? os.tmpdir() : "/tmp", "pi-mu-work-"));
const dir = (name: string) => {
  const d = path.join(work, name);
  fs.mkdirSync(d, { recursive: true });
  return fs.realpathSync(d);
};
let terminalPi: ChildProcess | undefined;

interface User {
  name: string;
  ctx: BrowserContext;
  page: Page;
  token: () => string;
}
let anna: User;
let bela: User;
let A1 = "";
let B1 = "";
let annaDir = "";

const localToken = () => fs.readFileSync(path.join(inst.home, ".pi", "dashboard", "local", "token"), "utf8").trim();
async function sessions(auth: string | "LOCAL" | null): Promise<{ id: string; cwd: string; pid?: number; name?: string }[]> {
  const headers: Record<string, string> =
    auth === "LOCAL" ? { "x-pi-local-token": localToken() } : auth ? { authorization: `Bearer ${auth}` } : {};
  const res = await fetch(`${base}/api/sessions`, { headers });
  if (res.status !== 200) return [];
  return ((await res.json()) as { data?: { id: string; cwd: string }[] }).data ?? [];
}
const ids = async (auth: string | "LOCAL") => (await sessions(auth)).map((s) => s.id);

async function openWs(token: string) {
  const r = await fetch(`${base}/api/ws-ticket`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ scope: "browser" }),
  });
  const ticket = ((await r.json()) as { data: { ticket: string } }).data.ticket;
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?ticket=${encodeURIComponent(ticket)}`, { headers: { Origin: base } });
  const frames: { sessionId?: string; type: string }[] = [];
  ws.on("message", (raw) => {
    try {
      frames.push(JSON.parse(raw.toString()));
    } catch {
      /* ignore */
    }
  });
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });
  return { ws, frames, send: (o: unknown) => ws.send(JSON.stringify(o)) };
}

async function spawnIn(user: User, cwd: string): Promise<string> {
  const before = new Set(await ids(user.token()));
  const c = await openWs(user.token());
  c.send({ type: "spawn_session", cwd, requestId: `${user.name}-${Date.now()}` });
  let id = "";
  const deadline = Date.now() + 90_000;
  while (!id && Date.now() < deadline) {
    id = (await sessions(user.token())).find((s) => s.cwd === cwd && !before.has(s.id))?.id ?? "";
    if (!id) await new Promise((r) => setTimeout(r, 500));
  }
  c.ws.close();
  const replies = c.frames.filter((m) => /spawn|error|denied|grant/i.test(m.type));
  expect(id, `${user.name}'s spawn in ${cwd} registered; spawn-related frames: ${JSON.stringify(replies).slice(0, 600)}`).not.toBe("");
  return id;
}

async function signIn(browser: Browser, name: string): Promise<User> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let bearer = "";
  page.on("request", (r) => {
    const a = r.headers().authorization;
    if (a?.startsWith("Bearer ") && r.url().includes("/api/")) bearer = a.slice(7);
  });
  await page.goto(`${base}/`);
  await page.waitForURL(/\/login/);
  await page.getByRole("button", { name: /Sign in with Keycloak/ }).click();
  await page.fill("#username", name);
  await page.fill("#password", `${name}-pw`);
  await page.click("#kc-login");
  await expect(page.getByTestId("user-bar")).toBeVisible({ timeout: 20_000 });
  const skip = page.getByRole("button", { name: /^Skip/ });
  if (await skip.isVisible().catch(() => false)) await skip.click();
  await expect.poll(() => bearer, { message: `${name} bearer` }).not.toBe("");
  return { name, ctx, page, token: () => bearer };
}
const sidebar = (u: User) =>
  u.page.$$eval("[data-session-id]", (els) => [...new Set(els.map((e) => e.getAttribute("data-session-id")))]);

test.beforeAll(async ({ browser }) => {
  inst = await bootDedicated("A", readState().issuer);
  base = `http://127.0.0.1:${inst.port}`;
  anna = await signIn(browser, "anna");
  bela = await signIn(browser, "bela");
});

test.afterAll(async () => {
  // Keepers outlive a dashboard by design: stop every spawned pi AND its keeper.
  const pids = new Set<number>();
  for (const s of await sessions("LOCAL").catch(() => [])) {
    if (!s.pid) continue;
    pids.add(s.pid);
    try {
      const ppid = Number(execFileSync("ps", ["-o", "ppid=", "-p", String(s.pid)], { encoding: "utf8" }).trim());
      const cmd = execFileSync("ps", ["-o", "command=", "-p", String(ppid)], { encoding: "utf8" });
      if (cmd.includes("keeper.cjs")) pids.add(ppid);
    } catch {
      /* gone */
    }
  }
  if (terminalPi?.pid) pids.add(-terminalPi.pid);
  await anna?.ctx.close();
  await bela?.ctx.close();
  await inst?.stop([...pids]);
  fs.rmSync(work, { recursive: true, force: true });
});

test("S1 empty setup: signed out is refused; both users start with nothing", async () => {
  expect((await fetch(`${base}/api/sessions`)).status).toBe(401);
  expect(await ids(anna.token())).toEqual([]);
  expect(await ids(bela.token())).toEqual([]);
  // Each browser shows its OWN identity (fake-issuer users carry no display name).
  await expect(anna.page.getByTestId("user-bar")).toContainText("anna@example.test");
  await expect(bela.page.getByTestId("user-bar")).toContainText("bela");
  await expect(bela.page.getByTestId("user-bar")).not.toContainText("anna");
});

test("S2 a new session is visible to its owner only — REST and the LIVE sidebar", async () => {
  annaDir = dir("anna");
  A1 = await spawnIn(anna, annaDir);
  expect(await ids(anna.token())).toContain(A1);
  expect(await ids(bela.token())).not.toContain(A1);
  await expect.poll(() => sidebar(anna), { message: "anna's sidebar shows her session live" }).toContain(A1);
  // bela's page stayed open through the spawn: a live fan-out would show it here.
  await bela.page.waitForTimeout(2_000);
  expect(await sidebar(bela)).not.toContain(A1);
});

test("S3 a non-owner cannot reach it and receives no live frame about it", async () => {
  const c = await openWs(bela.token());
  c.send({ type: "subscribe", sessionId: A1 });
  c.send({ type: "rename_session", sessionId: A1, name: "HACKED-BY-BELA" });
  c.send({ type: "fetch_content", sessionId: A1, seq: 1 });
  c.send({ type: "send_prompt", sessionId: A1, text: "bela was here" });
  c.send({ type: "shutdown", sessionId: A1 });
  await new Promise((r) => setTimeout(r, 3_000));
  expect(c.frames.filter((m) => JSON.stringify(m).includes(A1))).toEqual([]);
  // Folder-level frames (git HEAD, openspec) incl. the on-connect replays must
  // not disclose anna's folder either (it is not pinned).
  expect(c.frames.filter((m) => JSON.stringify(m).includes(annaDir)).map((m) => m.type)).toEqual([]);
  c.ws.close();
  const mine = (await sessions(anna.token())).find((s) => s.id === A1);
  expect(mine, "still alive for anna").toBeTruthy();
  expect(mine?.name).not.toBe("HACKED-BY-BELA");
  await bela.page.goto(`${base}/session/${A1}`);
  await bela.page.waitForTimeout(2_000);
  expect(await sidebar(bela)).not.toContain(A1);
});

test("S4 symmetric: bela's own session is hers alone", async () => {
  B1 = await spawnIn(bela, dir("bela"));
  expect(await ids(bela.token())).toContain(B1);
  expect(await ids(anna.token())).not.toContain(B1);
  await expect.poll(() => sidebar(bela)).toContain(B1);
  await anna.page.waitForTimeout(2_000);
  const a = await sidebar(anna);
  expect(a).toContain(A1);
  expect(a).not.toContain(B1);
});

test("S5 a terminal-started pi (no owner) is invisible to users; the local token sees everything", async () => {
  const cwd = dir("terminal");
  const before = new Set(await ids("LOCAL"));
  terminalPi = spawn("bash", ["-c", "tail -f /dev/null | pi --mode rpc"], {
    cwd,
    env: inst.terminalEnv,
    stdio: "ignore",
    detached: true,
  });
  let T1 = "";
  await expect
    .poll(async () => {
      T1 = (await sessions("LOCAL")).find((s) => s.cwd === cwd && !before.has(s.id))?.id ?? "";
      return T1;
    }, { timeout: 60_000, message: "terminal pi registered with THIS dashboard" })
    .not.toBe("");
  expect(await ids(anna.token())).not.toContain(T1);
  expect(await ids(bela.token())).not.toContain(T1);
  const all = await ids("LOCAL");
  expect(all).toEqual(expect.arrayContaining([A1, B1, T1]));
});

test("S6 sign out and back in: ownership is kept", async ({ browser }) => {
  await anna.page.goto(`${base}/`);
  await anna.page.getByTestId("user-bar-signout").click();
  await anna.page.waitForURL(/\/login/);
  await expect(anna.page.locator("body")).toContainText(/signed out/i);
  await anna.ctx.close();
  anna = await signIn(browser, "anna");
  expect(await ids(anna.token())).toContain(A1);
  expect(await ids(anna.token())).not.toContain(B1);
});

test("S7 dashboard restart: ownership survives (persisted, not wiped by reattach)", async () => {
  await inst.restart();
  await expect
    .poll(async () => (await ids(anna.token())).includes(A1), { timeout: 30_000, message: "anna's session back after restart" })
    .toBe(true);
  expect(await ids(anna.token())).not.toContain(B1);
  expect(await ids(bela.token())).toContain(B1);
  expect(await ids(bela.token())).not.toContain(A1);
});
