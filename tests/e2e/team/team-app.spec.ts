/**
 * AI Team app against a REAL dashboard + REAL pi sessions, identity armed.
 *
 * Covers (test-plan add-team-plugin): F22 same-origin sign-in lands back on the requested
 * `/apps/team/…` path and no `/api/plugins/team/*` request leaves the page before it; F15 a
 * second user sees neither the first user's private persona nor can subscribe to their
 * session; F16 a persona edit flags the conversation and "Restart to apply" resumes it; the
 * real spawn carries the isolation flags (D6/D15) and the guard extension signalled ready
 * (D7) — a session without it would have been aborted, so a created conversation proves it.
 *
 * Needs the `pi` CLI on PATH. No model is called: nothing here sends a prompt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type Page, test } from "@playwright/test";
import WebSocket from "ws";
import { type FakeOidcIssuer, startFakeOidcIssuer } from "../../../packages/shared/src/test-support/fake-oidc-issuer.js";
import { bootDedicated, type DedicatedInstance, USERS } from "../identity-matrix/matrix-lifecycle.js";

const hasPi = (() => {
  try {
    execFileSync("pi", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
test.skip(!hasPi, "needs the pi CLI on PATH to spawn real sessions");
test.describe.configure({ mode: "serial", timeout: 180_000 });

let issuer: FakeOidcIssuer;
let inst: DedicatedInstance;
let base = "";
const work = fs.mkdtempSync(path.join("/tmp", "pi-team-e2e-"));

interface User {
  name: string;
  ctx: BrowserContext;
  page: Page;
  token: () => string;
  teamRequestsBeforeSignIn: string[];
}

const API = "/api/plugins/team";
const enc = encodeURIComponent;

async function api(user: User, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(`${base}${API}${p}`, {
    method,
    headers: { authorization: `Bearer ${user.token()}`, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    /* empty */
  }
  return { status: res.status, json };
}

/** Open the team app signed out, sign in through the dashboard login seam. */
async function signInViaApp(browser: Browser, name: string, startPath: string): Promise<User> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  let bearer = "";
  // Team API requests that carried NO bearer: i.e. made before there was a credential.
  const before: string[] = [];
  page.on("request", (r) => {
    const a = r.headers().authorization;
    if (a?.startsWith("Bearer ") && r.url().includes("/api/")) bearer = a.slice(7);
    if (!a && r.url().includes(`${API}/`)) before.push(r.url());
  });
  await page.goto(`${base}${startPath}`);
  await page.getByTestId("signin").click();
  await page.fill("#username", name);
  await page.fill("#password", `${name}-pw`);
  await page.click("#kc-login");
  await expect(page.locator(".user-chip")).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => bearer, { message: `${name} bearer` }).not.toBe("");
  return { name, ctx, page, token: () => bearer, teamRequestsBeforeSignIn: before };
}

let anna: User;
let bela: User;

test.beforeAll(async ({ browser }) => {
  issuer = await startFakeOidcIssuer({ host: "127.0.0.1", users: USERS, redirectUriPrefixes: ["http://127.0.0.1:", "http://localhost:"] });
  inst = await bootDedicated("A", issuer.issuer);
  // Make anna the team admin, then restart so the plugin reads it.
  const cfgPath = path.join(inst.home, ".pi", "dashboard", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  cfg.plugins = { ...cfg.plugins, team: { admins: [{ iss: issuer.issuer, sub: "sub-anna" }], idleMinutes: 0 } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  // Plugin discovery is anchored at the runtime package's location; when the hoisted workspace
  // symlink resolves it to another checkout (git worktrees) the team plugin is not among the
  // discovered packages. Installing it into the instance's plugin dir makes the spec independent
  // of that (a duplicate id is skipped, so a normal checkout is unaffected).
  const pluginsDir = path.join(inst.home, ".pi", "dashboard", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const link = path.join(pluginsDir, "team-plugin");
  if (!fs.existsSync(link)) fs.symlinkSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/team-plugin"), link);
  await inst.restart();
  base = `http://127.0.0.1:${inst.port}`;
  anna = await signInViaApp(browser, "anna", `/apps/team/agent/${enc("shared:backend")}`);
  bela = await signInViaApp(browser, "bela", "/apps/team/");
});

test.afterAll(async () => {
  const local = path.join(inst.home, ".pi", "dashboard", "local", "token");
  const pids: number[] = [];
  try {
    const res = await fetch(`${base}/api/sessions`, { headers: { "x-pi-local-token": fs.readFileSync(local, "utf8").trim() } });
    for (const s of ((await res.json()) as { data?: { pid?: number }[] }).data ?? []) if (s.pid) pids.push(s.pid);
  } catch {
    /* dashboard already gone */
  }
  await inst?.stop(pids);
  await issuer?.close();
  fs.rmSync(work, { recursive: true, force: true });
});

test("F22: signed-out visit signs in via the dashboard seam, lands back on the requested app path, no team data before sign-in", async () => {
  expect(anna.teamRequestsBeforeSignIn).toEqual([]);
  expect(new URL(anna.page.url()).pathname).toBe(`/apps/team/agent/${enc("shared:backend")}`);
  const me = await api(anna, "GET", "/me");
  expect(me.json).toMatchObject({ mode: "multi", admin: true });
  expect((await api(bela, "GET", "/me")).json.admin).toBe(false);
});

test("admin creates a shared persona; the grid shows it; opening it spawns a real guarded session", async () => {
  const created = await api(anna, "POST", "/personas", {
    slug: "backend",
    scope: "shared",
    name: "Backend",
    description: "Backend helper",
    instructions: "MARKER-BACKEND-INSTRUCTIONS",
    tools: "files",
  });
  expect(created.status, JSON.stringify(created.json)).toBe(201);

  await anna.page.goto(`${base}/apps/team/`);
  const card = anna.page.locator('[data-key="shared:backend"]');
  await expect(card).toBeVisible();
  await card.getByTestId("talk").click();
  // create = real pi spawn + guard-ready wait (≤ 30 s)
  await expect(anna.page).toHaveURL(/\/apps\/team\/agent\/shared%3Abackend\/c\//, { timeout: 60_000 });
  // ensure → real pi spawn → guard ready → ChatView mounts
  await expect(anna.page.locator(".transcript, [data-testid=transcript]").first()).toBeVisible({ timeout: 90_000 });
  await expect(anna.page.getByText("Ügynök indítása…")).toHaveCount(0, { timeout: 90_000 });

  const convs = await api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`);
  expect(convs.json.conversations.length).toBe(1);
  const local = fs.readFileSync(path.join(inst.home, ".pi", "dashboard", "local", "token"), "utf8").trim();
  const sessions = (await (await fetch(`${base}/api/sessions`, { headers: { "x-pi-local-token": local } })).json()) as {
    data: { id: string; pid?: number; cwd: string; sessionFile?: string; principalOwner?: { sub: string } }[];
  };
  const team = sessions.data.find((s) => s.cwd.includes(`${path.sep}workspace`));
  expect(team, "team session registered in the user's own workspace").toBeTruthy();
  // Owner-stamped for the signed-in user (D5) — the isolation basis for every owner gate.
  expect(team?.principalOwner?.sub).toBe("sub-anna");
  // D15: the transcript lives in pi's default per-cwd folder (pinned with --session-dir).
  const encoded = `--${(team?.cwd as string).replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  expect(team?.sessionFile ?? "").toContain(`${path.sep}${encoded}${path.sep}`);
  // D6: the rendered persona file sits outside every target and carries the instructions.
  const personaFile = path.join(inst.home, ".pi", "dashboard", "team", "users");
  const rendered = fs.readdirSync(personaFile, { recursive: true }).map(String).find((f) => f.endsWith(path.join("runtime", "shared-backend", "persona.md")));
  expect(rendered, "persona.md rendered under runtime/").toBeTruthy();
  expect(fs.readFileSync(path.join(personaFile, rendered as string), "utf8")).toContain("MARKER-BACKEND-INSTRUCTIONS");
});

test("F15: bela sees none of anna's data and cannot subscribe to her session", async () => {
  await api(anna, "POST", "/personas", { slug: "secret", name: "Secret", instructions: "x" });
  const belaPersonas = await api(bela, "GET", "/personas");
  expect(belaPersonas.json.personas.map((p: { key: string }) => p.key)).not.toContain("private:secret");
  expect((await api(bela, "PUT", `/personas/${enc("private:secret")}`, { name: "x", instructions: "" })).status).toBe(404);

  // anna's conversation session id (from her list route + local sessions) is refused over bela's socket
  const local = fs.readFileSync(path.join(inst.home, ".pi", "dashboard", "local", "token"), "utf8").trim();
  const sessions = (await (await fetch(`${base}/api/sessions`, { headers: { "x-pi-local-token": local } })).json()) as { data: { id: string; cwd: string }[] };
  const annaSession = sessions.data.find((s) => s.cwd.includes(`${path.sep}workspace`))?.id;
  expect(annaSession).toBeTruthy();
  const ticketRes = await fetch(`${base}/api/ws-ticket`, { method: "POST", headers: { authorization: `Bearer ${bela.token()}`, "content-type": "application/json" }, body: JSON.stringify({ scope: "browser" }) });
  const ticket = ((await ticketRes.json()) as { data: { ticket: string } }).data.ticket;
  const frames: Array<{ type?: string; sessionId?: string }> = [];
  const ws = new WebSocket(`${base.replace("http", "ws")}/ws?ticket=${enc(ticket)}`, { headers: { Origin: base } });
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
  ws.send(JSON.stringify({ type: "subscribe", sessionId: annaSession, lastSeq: 0 }));
  await new Promise((r) => setTimeout(r, 2_500));
  ws.close();
  expect(frames.some((f) => f.sessionId === annaSession && (f.type === "event" || f.type === "event_replay"))).toBe(false);
});

test("F16: a persona edit flags the conversation; 'Restart to apply' resumes the same conversation", async () => {
  // Make sure the conversation has a LIVE session first (the stale flag only applies to a live one).
  const list0 = (await api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations;
  const convId = list0[0].id as string;
  expect((await api(anna, "POST", `/agents/${enc("shared:backend")}/conversations/${convId}/session?project=_ws`)).status).toBe(200);
  await expect
    .poll(async () => (await api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations[0].status, { timeout: 30_000 })
    .toMatch(/running|busy/);
  const upd = await api(anna, "PUT", `/personas/${enc("shared:backend")}`, {
    name: "Backend",
    description: "Backend helper",
    instructions: "MARKER-EDITED",
    tools: "files",
  });
  expect(upd.status).toBe(200);
  await anna.page.goto(`${base}/apps/team/`);
  const card = anna.page.locator('[data-key="shared:backend"]');
  await expect(card.getByText("Újraindítás a frissítéshez")).toBeVisible({ timeout: 20_000 });
  const before = (await api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations[0].id;
  await card.getByText("Újraindítás a frissítéshez").first().click();
  await expect(card.getByText("Újraindítás a frissítéshez")).toHaveCount(0, { timeout: 20_000 });
  // next open resumes the SAME conversation with the new persona
  await card.getByTestId("talk").click();
  await expect(anna.page).toHaveURL(new RegExp(`/c/${before}`));
  await expect(anna.page.getByText("Előző beszélgetés folytatása…")).toHaveCount(0, { timeout: 90_000 });
  const after = (await api(anna, "GET", `/agents/${enc("shared:backend")}/conversations?project=_ws`)).json.conversations;
  expect(after.map((c: { id: string }) => c.id)).toEqual([before]);
  expect(after[0].personaStale).toBe(false);
  os.platform();
});
