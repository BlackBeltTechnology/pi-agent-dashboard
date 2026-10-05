/**
 * Shared boot for the team E2E specs: fake OIDC issuer + one private dashboard (identity
 * armed, real pi sessions) with the team plugin configured. See change: add-team-plugin.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { type FakeOidcIssuer, startFakeOidcIssuer } from "../../../packages/shared/src/test-support/fake-oidc-issuer.js";
import { bootDedicated, type DedicatedInstance, USERS } from "../identity-matrix/matrix-lifecycle.js";

export const API = "/api/plugins/team";
export const enc = encodeURIComponent;

export const hasPi = (() => {
  try {
    execFileSync("pi", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

export interface User {
  name: string;
  ctx: BrowserContext;
  page: Page;
  token: () => string;
  /** Team API requests that carried NO bearer, i.e. were made before there was a credential. */
  unauthenticatedTeamRequests: string[];
}

export interface TeamHarness {
  issuer: FakeOidcIssuer;
  inst: DedicatedInstance;
  base: string;
  work: string;
  dir(name: string): string;
  localToken(): string;
  api(user: User, method: string, p: string, body?: unknown): Promise<{ status: number; json: any }>;
  signInViaApp(browser: Browser, name: string, startPath: string): Promise<User>;
  sessions(): Promise<Array<{ id: string; pid?: number; cwd: string; sessionFile?: string; principalOwner?: { sub: string }; status?: string }>>;
  stop(): Promise<void>;
}

export interface HarnessOptions {
  /** Merged into `plugins.team` (the admin list for anna is always added). */
  team?: Record<string, unknown> | ((ctx: { work: string; dir: (n: string) => string }) => Record<string, unknown>);
  /** Files written under the instance HOME before boot (relative paths). */
  homeFiles?: Record<string, string>;
  /** `models.json` providers written to `~/.pi/agent/models.json`. */
  modelsJson?: Record<string, unknown>;
}

export async function bootTeamHarness(opts: HarnessOptions = {}): Promise<TeamHarness> {
  const work = fs.realpathSync(fs.mkdtempSync(path.join("/tmp", "pi-team-e2e-")));
  const dir = (name: string) => {
    const d = path.join(work, name);
    fs.mkdirSync(d, { recursive: true });
    return fs.realpathSync(d);
  };
  const issuer = await startFakeOidcIssuer({ host: "127.0.0.1", users: USERS, redirectUriPrefixes: ["http://127.0.0.1:", "http://localhost:"] });
  const inst = await bootDedicated("A", issuer.issuer);
  const cfgPath = path.join(inst.home, ".pi", "dashboard", "config.json");
  const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  const extra = typeof opts.team === "function" ? opts.team({ work, dir }) : (opts.team ?? {});
  cfg.plugins = { ...cfg.plugins, team: { admins: [{ iss: issuer.issuer, sub: "sub-anna" }], idleMinutes: 0, ...extra } };
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  for (const [rel, content] of Object.entries(opts.homeFiles ?? {})) {
    const f = path.join(inst.home, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  if (opts.modelsJson) {
    const f = path.join(inst.home, ".pi", "agent", "models.json");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ providers: opts.modelsJson }, null, 2));
  }
  // Plugin discovery is anchored at the runtime package's location; when the hoisted workspace
  // symlink resolves it to another checkout (git worktrees) the team plugin is not among the
  // discovered packages. Installing it into the instance's plugin dir makes the specs independent
  // of that (a duplicate id is skipped, so a normal checkout is unaffected).
  const pluginsDir = path.join(inst.home, ".pi", "dashboard", "plugins");
  fs.mkdirSync(pluginsDir, { recursive: true });
  const link = path.join(pluginsDir, "team-plugin");
  if (!fs.existsSync(link)) fs.symlinkSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../packages/team-plugin"), link);
  await inst.restart();
  const base = `http://127.0.0.1:${inst.port}`;

  const localToken = () => fs.readFileSync(path.join(inst.home, ".pi", "dashboard", "local", "token"), "utf8").trim();
  const h: TeamHarness = {
    issuer,
    inst,
    base,
    work,
    dir,
    localToken,
    async api(user, method, p, body) {
      const res = await fetch(`${base}${API}${p}`, {
        method,
        headers: { authorization: `Bearer ${user.token()}`, ...(body ? { "content-type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* empty body */
      }
      return { status: res.status, json };
    },
    async signInViaApp(browser, name, startPath) {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      let bearer = "";
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
      return { name, ctx, page, token: () => bearer, unauthenticatedTeamRequests: before };
    },
    async sessions() {
      const res = await fetch(`${base}/api/sessions`, { headers: { "x-pi-local-token": localToken() } });
      return ((await res.json()) as { data?: any[] }).data ?? [];
    },
    async stop() {
      const pids: number[] = [];
      try {
        for (const s of await h.sessions()) if (s.pid) pids.push(s.pid);
      } catch {
        /* dashboard already gone */
      }
      await inst.stop(pids);
      await issuer.close();
      fs.rmSync(work, { recursive: true, force: true });
    },
  };
  return h;
}
