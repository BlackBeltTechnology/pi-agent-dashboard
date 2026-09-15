import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { FIXTURE_GIT, gotoDashboard, sendPrompt } from "./helpers/index.js";
import { DASHBOARD_PORT, REPO_ROOT } from "./lifecycle.js";

/** The harness container, resolved from the compose project in `.pi-test-harness.json`. */
let containerId: string | undefined;
function harnessContainer(): string {
  if (containerId) return containerId;
  const state = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, ".pi-test-harness.json"), "utf8"),
  ) as { project?: string };
  if (!state.project) throw new Error(".pi-test-harness.json carries no compose project");
  const id = execFileSync(
    "docker",
    ["ps", "-q", "--filter", `label=com.docker.compose.project=${state.project}`],
    { encoding: "utf8", timeout: 30_000 },
  ).trim().split("\n")[0];
  if (!id) throw new Error(`no running container for compose project ${state.project}`);
  containerId = id;
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

/**
 * L3 — a session that DIES mid-`Agent` leaves no card spinning, live or after a
 * cold re-hydration.
 *
 * F6 (live): the pi process is killed out of band while a tool call is in
 * flight. The bridge socket closes, the gateway finalizes the session, and
 * `sessionManager.onEnded` synthesizes the terminal events into the session's
 * own stream: `tool_execution_end{isError, healedBy:"session_ended"}` per open
 * call plus `subagent_failed` per non-terminal subagent.
 *
 * SUBSTRATE — a long-sleeping bash call (`faux:session-death-open-tool`), NOT a
 * nested faux subagent. A faux subagent cannot be kept alive in the harness:
 * its inner `createAgentSession` resolves an empty faux response queue and
 * completes in ~400 ms (documented in `subagent-tick-throttle.spec.ts`), so
 * there is no window to kill it in. The SUBAGENT half of the heal is therefore
 * asserted at L1 against the real server + browser gateway
 * (`packages/server/src/__tests__/session-end-orphan-heal.test.ts` #X1); what
 * only a browser can prove — the card converging and surviving a cold
 * re-hydration — is what this spec asserts.
 *
 * F7 (cold): after `POST /api/restart` the in-memory store no longer holds the
 * session, so reopening it re-hydrates from the pi JSONL transcript. The parser
 * closes the orphaned call with the SAME error shape — live and replay agree.
 *
 * The kill is a RAW `kill -9` on the session's pid inside the harness container.
 * That matters for F7: `force_kill` SIGTERMs first, which lets pi abort the run
 * and persist a `toolResult`, so the transcript is no longer orphaned and the
 * cold-hydration half of the scenario evaporates. SIGKILL leaves the transcript
 * exactly as a real death does. The gateway's `finalize-on-close` path ends the
 * session as soon as the bridge socket drops, so no heartbeat grace is needed.
 *
 * Exemplars: `tests/e2e/superseded-heal.spec.ts` (heal convergence in the DOM),
 * `tests/e2e/ended-session-endedat.spec.ts` (restart + harness introspection).
 * Port comes from `.pi-test-harness.json` via `lifecycle.ts` — never hardcoded.
 *
 * See change: heal-orphaned-tool-cards-on-session-end (test-plan #F6, #F7).
 */

const HEAL_TEXT = "parent session ended";

interface HealFrame {
  eventType: string;
  sessionId: string;
  healedBy?: string;
  isError?: boolean;
  result?: string;
  agentId?: string;
}

/** Every healed frame the BROWSER received, in arrival order. */
function collectHealFrames(page: import("@playwright/test").Page): HealFrame[] {
  const out: HealFrame[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (!payload.includes("session_ended")) return;
      let parsed: any;
      try {
        parsed = JSON.parse(payload);
      } catch {
        return;
      }
      const events: any[] = parsed?.event
        ? [parsed.event]
        : Array.isArray(parsed?.events)
          ? parsed.events.map((e: any) => e?.event).filter(Boolean)
          : [];
      for (const ev of events) {
        if (ev?.data?.healedBy !== "session_ended") continue;
        out.push({
          eventType: String(ev.eventType ?? ""),
          sessionId: String(parsed?.sessionId ?? ""),
          healedBy: ev.data.healedBy,
          isError: ev.data.isError,
          result: ev.data.result ?? ev.data.error,
          agentId: ev.data?.details?.agentId ?? ev.data?.id,
        });
      }
    });
  });
  return out;
}

/** Every session id the server knows, live or ended. */
async function sessionIds(page: import("@playwright/test").Page): Promise<string[]> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as Array<{ id: string }>).map((s) => s.id);
}

/** The live session record, read through the API the dashboard itself serves. */
async function readSession(page: import("@playwright/test").Page, sessionId: string): Promise<any> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as any[]).find((s) => s.id === sessionId);
}

async function restartDashboard(): Promise<void> {
  await fetch(`http://localhost:${DASHBOARD_PORT}/api/restart`, { method: "POST" }).catch(
    () => undefined, // the connection dies with the daemon; that is the point
  );
  const deadline = Date.now() + 120_000;
  await new Promise((r) => setTimeout(r, 2_000));
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${DASHBOARD_PORT}/api/health`);
      if (res.ok) return;
    } catch {
      // still down
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error("dashboard did not come back after POST /api/restart");
}

/**
 * Spawn into FIXTURE_GIT and open its transcript.
 *
 * Explicit rather than `spawnFreshGitSession`: that helper clicks the FIRST
 * sidebar folder's button, and the seeded harness carries 100+ fixture folders
 * — the one it picks is not necessarily spawnable.
 */
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
  // Deep-link rather than hunting the card in a 100-folder sidebar.
  await page.goto(`/session/${sessionId}`);
  await page.keyboard.press("Escape").catch(() => {});
  return sessionId;
}

/** Run the open-tool scenario and wait until its card is genuinely running. */
async function openALongToolCall(page: import("@playwright/test").Page) {
  await sendPrompt(page, "[[faux:session-death-open-tool]] go");
  const burst = page.getByTestId("tool-burst-group").first();
  await expect(burst).toBeVisible({ timeout: 60_000 });
  await expect(burst).toHaveAttribute("data-running", "true");
  return burst;
}

test.describe("session-end orphan heal (L3)", () => {
  test("#F6 a dying session's open tool card converges to error, live", async ({ page }) => {
    test.setTimeout(240_000);

    const heals = collectHealFrames(page);
    const sessionId = await spawnAndOpen(page);
    const burst = await openALongToolCall(page);

    // Kill the process. `force_kill` SIGTERMs then SIGKILLs the pid the server
    // recorded; either way the bridge dies holding an open call, which is the
    // premise. (A raw `kill -9` is used by #F7, where the TRANSCRIPT must also
    // stay orphaned.)
    await page.evaluate(
      ([id]) => {
        const ws = new WebSocket(`ws://${location.host}/ws`);
        ws.onopen = () => ws.send(JSON.stringify({ type: "force_kill", sessionId: id }));
      },
      [sessionId],
    );

    // The synthesized heal reaches the browser.
    await expect
      .poll(() => heals.filter((h) => h.sessionId === sessionId).map((h) => h.eventType), {
        timeout: 60_000,
      })
      .toEqual(expect.arrayContaining(["tool_execution_end"]));

    const toolHeal = heals.find(
      (h) => h.sessionId === sessionId && h.eventType === "tool_execution_end",
    )!;
    expect(toolHeal.isError).toBe(true);
    expect(toolHeal.result).toBe(HEAL_TEXT);

    // …and the session itself is ended.
    await expect
      .poll(async () => (await readSession(page, sessionId))?.status, { timeout: 30_000 })
      .toBe("ended");

    // The card converges in the DOM: the burst is no longer running.
    await expect(burst).toHaveAttribute("data-running", "false", { timeout: 30_000 });
  });

  test("#F7 the same call is STILL an error card after a cold re-hydration", async ({ page }) => {
    test.setTimeout(300_000);

    const sessionId = await spawnAndOpen(page);
    await openALongToolCall(page);

    // RAW SIGKILL, not `force_kill`: the latter SIGTERMs first, which lets pi
    // abort the run and persist a `toolResult` — the transcript would no longer
    // be orphaned and this scenario would evaporate.
    const pid = (await readSession(page, sessionId))?.pid;
    expect(pid, "the session must expose its pid").toBeTruthy();
    inContainer(`kill -9 ${pid}`);

    // Restarting drops the in-memory store, so reopening the session can only
    // rebuild it by parsing the pi JSONL transcript.
    await restartDashboard();
    await gotoDashboard(page);
    // An ended card sits behind the per-folder toggle, collapsed by default.
    const endedToggle = page.getByTestId(`folder-ended-toggle-${FIXTURE_GIT}`);
    await expect(endedToggle).toBeVisible({ timeout: 60_000 });
    if ((await endedToggle.getAttribute("aria-label"))?.startsWith("Show")) {
      await endedToggle.click();
    }
    const endedCard = page.locator(`[data-session-id="${sessionId}"]`).first();
    await expect(endedCard).toBeVisible({ timeout: 30_000 });
    await endedCard.click();
    await page.keyboard.press("Escape").catch(() => {});

    // The transcript-sourced replay renders the killed call as an ERROR — before
    // this change the parser closed it `{result:"", isError:false}` and the same
    // card rendered as a silent, bodyless SUCCESS (green check, no failure).
    const rebuilt = page.getByRole("button", { name: /sleep 120/ }).first();
    await expect(rebuilt).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/1 failed/i).first()).toBeVisible({ timeout: 30_000 });

    // Open the member row and read the body the parser wrote.
    await rebuilt.click();
    await page.getByRole("button", { name: /sleep 120/ }).last().click().catch(() => {});
    await expect(page.getByText(new RegExp(HEAL_TEXT, "i")).first()).toBeVisible({
      timeout: 30_000,
    });
  });
});
