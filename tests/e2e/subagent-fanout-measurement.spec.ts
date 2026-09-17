import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard, sendPrompt } from "./helpers/index.js";
import { harnessProject, REPO_ROOT } from "./lifecycle.js";

/**
 * L2 — the fan-out stall measurement matrix (test-plan #P1) and the mitigation
 * delta (#P4).
 *
 * The change's Decision 1 is a MEASURE-FIRST gate: the cap constant must be
 * chosen from a measured table, not a plausible guess. This spec is that
 * harness. It drives an N-wide `Agent` fan-out from a parent session and records
 * the parent's own `eventLoopMaxMs` (the bridge heartbeat's destructive-read-free
 * process metric) plus survival, gated and ungated.
 *
 * Substrate: the real pi-dashboard-subagents producer (so the Agent tool exists)
 * on the seeded docker harness. Each `Agent` child loads extensions
 * synchronously in the parent process, which is the measured loop block.
 * `eventLoopMaxMs` is reset every 15 s heartbeat, so the cell polls `/api/health`
 * for a full heartbeat window after the turn and takes the max.
 *
 * Honest scope: this harness runs ctx=small × host=idle. The ~220 k-context and
 * loaded-host dimensions from the design matrix need a real session chain and a
 * controlled host load, which this container cannot synthesize; that limit is
 * recorded alongside the table in `design.md` rather than papered over.
 *
 * Config lives in the container; the bridge reads it at SESSION init, so a new
 * session per cell is enough — no server restart.
 *
 * See change: bound-subagent-fanout-under-host-pressure.
 */

const CONFIG_PATH = "/home/pi/.pi/dashboard/config.json";
const UNGATED = 0; // maxConcurrentSubagents: 0 disables admission
const GATED = 2; // DEFAULT_MAX_CONCURRENT_SUBAGENTS
const OUT_PATH = path.join(REPO_ROOT, "test-results", "fanout-measurement.json");

let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const project = harnessProject();
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${project}`],
    { encoding: "utf8", timeout: 30_000 },
  )
    .trim()
    .split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/** Set the admission cap the NEXT session's bridge will read. */
function setCap(cap: number): void {
  inContainer(
    `node -e 'const fs=require("fs");const p="${CONFIG_PATH}";let c={};try{c=JSON.parse(fs.readFileSync(p,"utf8"))}catch{};c.maxConcurrentSubagents=${cap};fs.writeFileSync(p,JSON.stringify(c))'`,
  );
}

async function sessionIds(page: import("@playwright/test").Page): Promise<string[]> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as Array<{ id: string }>).map((s) => s.id);
}

async function readSession(page: import("@playwright/test").Page, sessionId: string): Promise<any> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as any[]).find((s) => s.id === sessionId);
}

async function spawnAndOpen(page: import("@playwright/test").Page): Promise<string> {
  await gotoDashboard(page);
  const before = new Set(await sessionIds(page));
  const spawned = await page.request.post("/api/session/spawn", { data: { cwd: FIXTURE_GIT } });
  expect(spawned.ok(), "spawn into the git fixture").toBe(true);
  let sessionId = "";
  await expect
    .poll(
      async () => {
        sessionId = (await sessionIds(page)).find((id) => !before.has(id)) ?? "";
        return sessionId !== "";
      },
      { timeout: 120_000 },
    )
    .toBe(true);
  await page.goto(`/session/${sessionId}`);
  await page.keyboard.press("Escape").catch(() => undefined);
  return sessionId;
}

interface Cell {
  n: number;
  cap: number;
  eventLoopMaxMs: number;
  telemetryObserved: boolean;
  timeToFirstChildStartMs: number;
  survived: boolean;
  fanoutAdmitted: number;
  fanoutRefused: number;
}

test.describe("subagent fan-out stall measurement (L2)", () => {
  test("#P1/#P4 the gated cap lowers the parent stall at the fatal width", async ({ page }) => {
    test.setTimeout(900_000);

    // One WS collector for the whole test: timestamps the first Agent
    // `tool_execution_start` after `armAt` (time-to-first-child-start). NOT
    // `tool_call`: the bridge forwards EVERY Agent tool_call BEFORE the gate
    // runs, including the ones it refuses, so a tool_call proves nothing about
    // an admitted child starting. `tool_execution_start` fires only for a call
    // that actually began executing.
    let armAt = 0;
    let firstChildAt = 0;
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const payload = typeof frame.payload === "string" ? frame.payload : "";
        if (!payload.includes("tool_execution_start")) return;
        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          return;
        }
        const events: any[] = parsed?.event ? [parsed.event] : [];
        for (const ev of events) {
          if (ev?.eventType !== "tool_execution_start" || ev.data?.toolName !== "Agent") continue;
          if (armAt && !firstChildAt) firstChildAt = Date.now();
        }
      });
    });

    async function runCell(n: number, cap: number): Promise<Cell> {
      setCap(cap);
      const sessionId = await spawnAndOpen(page);
      firstChildAt = 0;
      armAt = Date.now();
      await sendPrompt(page, `[[faux:fanout-width]] [[fanout:${n}]] run the fanout measurement`);
      await expect(page.getByText(/fanout width complete/i).first()).toBeVisible({
        timeout: 240_000,
      });
      const timeToFirstChildStartMs = firstChildAt ? firstChildAt - armAt : -1;
      // Reject an incomplete cell BEFORE it can be written to the table: no
      // Agent `tool_execution_start` means no admitted child was observed
      // starting, so the cell is not a measurement.
      expect(
        timeToFirstChildStartMs,
        `N=${n} cap=${cap} observed an admitted child start`,
      ).toBeGreaterThanOrEqual(0);

      // Poll a full heartbeat window; `eventLoopMaxMs` resets every 15 s, so the
      // stall may land in the beat AFTER the turn.
      let eventLoopMaxMs = 0;
      let telemetryObserved = false;
      let fanoutAdmitted = 0;
      let fanoutRefused = 0;
      const deadline = Date.now() + 22_000;
      while (Date.now() < deadline) {
        const res = await page.request.get("/api/health");
        const body = await res.json();
        const metrics = (body.agents ?? []).find((a: any) => a.sessionId === sessionId);
        if (metrics) {
          if (typeof metrics.eventLoopMaxMs === "number") {
            telemetryObserved = true;
            eventLoopMaxMs = Math.max(eventLoopMaxMs, metrics.eventLoopMaxMs);
          }
          fanoutAdmitted = Math.max(fanoutAdmitted, metrics.fanoutAdmitted ?? 0);
          fanoutRefused = Math.max(fanoutRefused, metrics.fanoutRefused ?? 0);
        }
        await page.waitForTimeout(1_000);
      }
      // A missing record must NOT read as survival: require the session to exist.
      const session = await readSession(page, sessionId);
      const survived = Boolean(session) && session.status !== "ended";
      return {
        n,
        cap,
        eventLoopMaxMs,
        telemetryObserved,
        timeToFirstChildStartMs,
        survived,
        fanoutAdmitted,
        fanoutRefused,
      };
    }

    // #P1 — the ungated matrix. Widths include the census fatal widths.
    const ungated: Cell[] = [];
    for (const n of [1, 2, 3, 4, 7]) ungated.push(await runCell(n, UNGATED));

    // #P4 — the fatal width, gated at the chosen default cap.
    const gatedAtFatal = await runCell(7, GATED);

    const table = { ungated, gatedAtFatal };
    fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
    fs.writeFileSync(OUT_PATH, JSON.stringify(table, null, 2) + "\n");
    console.log(`[fanout-measurement] wrote ${OUT_PATH}`);
    console.log(JSON.stringify(table, null, 2));

    // #P1 — every cell produced REAL telemetry (not a vacuous 0) and the parent
    // survived (a missing session record must not read as survival).
    for (const cell of [...ungated, gatedAtFatal]) {
      expect(cell.telemetryObserved, `N=${cell.n} cap=${cell.cap} telemetry observed`).toBe(true);
      expect(cell.eventLoopMaxMs, `N=${cell.n} cap=${cell.cap} recorded a stall`).toBeGreaterThanOrEqual(0);
      expect(cell.survived, `N=${cell.n} cap=${cell.cap} parent survived`).toBe(true);
    }

    // #P4 — the mitigation actually moved the stall: at the fatal width, the
    // gated cap admits fewer concurrent children and the parent's max loop block
    // is strictly lower than the ungated run in the same cell.
    const ungatedAtFatal = ungated.find((c) => c.n === 7)!;
    expect(gatedAtFatal.fanoutRefused, "the gated run refused the excess children").toBeGreaterThan(0);
    expect(gatedAtFatal.eventLoopMaxMs).toBeLessThan(ungatedAtFatal.eventLoopMaxMs);
  });
});
