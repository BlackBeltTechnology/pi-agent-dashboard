/**
 * Rendered-UI + API verification that a page-load burst of worktree cwds never
 * produces a false `403 cwd not allowed` when git is slow (test-plan #F10).
 *
 * The original Electron symptom: dozens of red `GET /api/mcp-client/effective?cwd=<worktree>`
 * 403s for worktrees whose main repo IS pinned. `isAllowedCwd` derived the main
 * checkout with up to 10 synchronous git probes on a 200 ms budget each, so a slow
 * git turned a timeout into a refusal. Only a real server, real git and a real
 * browser show the symptom gone, so the harness's `git` is replaced by a PATH-level
 * shim that sleeps before every call (the server's tool registry caches the resolved
 * git PATH, so the shim takes the real binary's place — a `PATH` edit would not be seen
 * by the already-running server).
 *
 * Shape:
 *   - a pinned repo with 3 linked worktrees that are neither pinned nor hold a session
 *     (admission MUST derive their main checkout through git);
 *   - the same 3 worktrees as live session cards, so their MCP / KB pills render;
 *   - git slowed to 500 ms per call (an admission is ~4 sequential probe phases, so this
 *     reproduces the old false 403 — every probe far over the old 200 ms budget — while
 *     the whole chain still fits the 3 s decision deadline).
 *
 * See change: harden-plugin-cwd-admission.
 */
import { execFileSync } from "node:child_process";
import type { BusClient } from "@blackbelt-technology/pi-dashboard-bus-client";
import { connectBus, expect, type Page, shutdownSession, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const ROOT = "/fixtures/__admission-burst-e2e__";
const REPO = `${ROOT}/repo`;
/** Worktrees shown as live session cards (their pills render). */
const WORKTREES = [1, 2, 3].map((n) => `${ROOT}/wt-${n}`);
/** Worktrees with NO session and no pin: admission must derive their main checkout via git. */
const SESSIONLESS = [4, 5, 6].map((n) => `${ROOT}/wt-${n}`);
const GIT_DELAY_SECONDS = "0.5";

function containerName(): string {
  const name = execFileSync("docker", ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"], {
    encoding: "utf8",
  })
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (!name) throw new Error(`no container publishing port ${DASHBOARD_PORT}`);
  return name;
}

/** Run a shell command in the harness container (default user). */
function inContainer(script: string, user?: string): string {
  const args = ["exec", ...(user ? ["-u", user] : []), containerName(), "sh", "-c", script];
  return execFileSync("docker", args, { encoding: "utf8" });
}

/** Send one WS verb to the dashboard from inside the container (loopback). */
function wsVerb(message: Record<string, unknown>): void {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      containerName(),
      "node",
      "-e",
      `const ws = new WebSocket("ws://127.0.0.1:${DASHBOARD_PORT}/ws");
       ws.onopen = () => { ws.send(${JSON.stringify(JSON.stringify(message))}); setTimeout(() => process.exit(0), 700); };
       setTimeout(() => process.exit(0), 5000);`,
    ],
    { encoding: "utf8" },
  );
}

let realGit = "";

/** Replace the container's git with a shim that sleeps, then execs the real binary. */
function installSlowGit(): void {
  realGit = inContainer("command -v git").trim();
  inContainer(
    `[ -e "${realGit}.real" ] || mv "${realGit}" "${realGit}.real"; ` +
      `printf '#!/bin/sh\\nsleep ${GIT_DELAY_SECONDS}\\nexec %s "$@"\\n' "${realGit}.real" > "${realGit}"; chmod 755 "${realGit}"`,
    "root",
  );
}

/** Put the real git back. Idempotent and safe to call when nothing was installed. */
function restoreGit(): void {
  if (!realGit) return;
  try {
    inContainer(`[ -e "${realGit}.real" ] && mv -f "${realGit}.real" "${realGit}" || true`, "root");
  } catch {
    /* container already down */
  }
}

async function spawnAt(page: Page, cwd: string): Promise<string> {
  const list = async (): Promise<Array<{ id: string; cwd: string }>> =>
    ((await (await page.request.get("/api/sessions", { timeout: 15_000 })).json()) as { data?: Array<{ id: string; cwd: string }> })
      .data ?? [];
  const before = new Set((await list()).map((s) => s.id));
  const res = await page.request.post("/api/session/spawn", { data: { cwd }, timeout: 60_000 });
  expect(res.ok(), `spawn at ${cwd}: ${res.status()}`).toBe(true);
  let id = "";
  await expect
    .poll(
      async () => {
        const fresh = (await list()).find((s) => s.cwd === cwd && !before.has(s.id));
        if (fresh) id = fresh.id;
        return Boolean(fresh);
      },
      { timeout: 120_000, message: `no session registered for ${cwd}` },
    )
    .toBe(true);
  return id;
}

test.describe("worktree admission burst under slow git", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);
  const spawned: string[] = [];

  test.beforeAll(() => {
    inContainer(
      `rm -rf ${ROOT} && mkdir -p ${REPO} && cd ${REPO} && git init -q && git -c user.email=e@e -c user.name=E commit -q --allow-empty -m seed && ` +
        [...WORKTREES, ...SESSIONLESS].map((w, i) => `git worktree add -q -b e2e-burst-${i + 1} ${w}`).join(" && "),
    );
    wsVerb({ type: "pin_directory", path: REPO });
  });

  test.afterAll(async () => {
    restoreGit();
    let client: BusClient | undefined;
    try {
      client = await connectBus();
      for (const id of spawned) await shutdownSession(client, id);
    } catch {
      /* best effort */
    } finally {
      client?.close();
    }
    try {
      wsVerb({ type: "unpin_directory", path: REPO });
      inContainer(`rm -rf ${ROOT}`);
    } catch {
      /* best effort */
    }
  });

  test("F10: no 403 for a worktree cwd, and every worktree MCP pill converges to a server count", async ({ page }) => {
    await gotoDashboard(page);
    // Live cards for the first three worktrees (real git), so their pills render.
    for (const w of WORKTREES) spawned.push(await spawnAt(page, w));

    installSlowGit();
    const statuses = new Map<string, number[]>();
    page.on("response", (r) => {
      const m = /\/api\/(mcp-client\/effective|kb\/stats)\?cwd=([^&]+)/.exec(r.url());
      if (!m) return;
      const cwd = decodeURIComponent(m[2]);
      if (!WORKTREES.includes(cwd)) return;
      const key = `${m[1]} ${cwd}`;
      statuses.set(key, [...(statuses.get(key) ?? []), r.status()]);
    });
    await page.reload();

    // The pills settle: no loading placeholder, error marker or "not tracked" remains, and
    // each worktree pill reads a server count — or "untrusted", the honest summary for a
    // fresh folder pi has not trusted yet. Either one means `/effective` answered 200, i.e. the
    // admission itself succeeded; neither a refusal nor a transient 503 left a pill behind.
    const settled = page.getByTestId("mcp-folder-pill-count").or(page.getByTestId("mcp-folder-pill-untrusted"));
    await expect(settled.first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("mcp-folder-pill-loading")).toHaveCount(0, { timeout: 120_000 });
    await expect(page.getByTestId("mcp-folder-pill-error")).toHaveCount(0);
    await expect(page.getByTestId("mcp-folder-pill-not-tracked")).toHaveCount(0);
    expect(await settled.count()).toBeGreaterThanOrEqual(WORKTREES.length);

    // Sessionless admission: worktrees of the pinned repo that are neither pinned nor session
    // cwds, so the server MUST derive the main checkout via git (slowed above). Each request is
    // 200, or a transient 503 that converges on retry — never a false 403.
    const probe = await page.evaluate(async ([wts]: [string[]]) => {
      const seen: number[] = [];
      const pollUntil200 = async (url: string): Promise<void> => {
        for (let i = 0; i < 40; i++) {
          const status = (await fetch(url)).status;
          seen.push(status);
          if (status === 200) return;
          await new Promise((r) => setTimeout(r, 500));
        }
      };
      const urls = wts.flatMap((w) =>
        ["mcp-client/effective", "kb/stats"].map((route) => `/api/${route}?cwd=${encodeURIComponent(w)}`),
      );
      for (const url of urls) await pollUntil200(url);
      return seen;
    }, [SESSIONLESS] as [string[]]);
    expect(probe).not.toContain(403);
    expect(probe.filter((s) => s === 200).length).toBe(SESSIONLESS.length * 2);

    for (const [key, list] of statuses) expect(list, key).not.toContain(403);
  });
});
