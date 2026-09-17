import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { byTestId, FIXTURE_GIT, gotoDashboard, sendPrompt } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

/**
 * L3 — subagent fan-out admission, rendered-UI behaviour.
 *
 * Driver: the `[[faux:subagent-fanout-refused]]` scenario emits a THREE-wide
 * `Agent` fan-out in ONE assistant message. Siblings preflight sequentially, so
 * with admission active at the default cap (2) the first two are admitted and
 * the third is REFUSED with a real errored tool result. That refusal is the
 * surface these scenarios assert:
 *
 * - #F1 the refused call's card converges to a TERMINAL error state, never a
 *       spinner (the damage the capability exists to prevent).
 * - #F2 the refusal is still terminal after a cold reload — replay parity.
 * - #F3 the gate does NOT short-circuit the bridge's own `tool_call` forwarder:
 *       the dashboard must still receive the refused call's `tool_call`, or live
 *       view and transcript disagree (guards `emitToolCall` first-`block`-wins).
 * - #F4 the durable `subagent-admission-refused` entry renders through the
 *       existing generic custom-entry path without breaking the transcript.
 * - #X4 (L2) the refusal survives an unclean process death: every refusal is a
 *       durable session entry with a distinguishable cause.
 *
 * Harness note: `dashboardPort` comes from `.pi-test-harness.json` via
 * `lifecycle.ts`; the container is resolved from the compose project recorded
 * there — never hardcoded. Needs PI_E2E_SEED=1.
 *
 * See change: bound-subagent-fanout-under-host-pressure (test-plan #F1-#F4, #X4).
 */

const REFUSAL_TEXT = /Refused by host admission/i;
const CUSTOM_TYPE = "subagent-admission-refused";

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

interface ToolFrame {
  eventType: string;
  toolName?: string;
  toolCallId?: string;
}

/** Every `tool_call` / `tool_execution_end` frame the BROWSER received. */
function collectToolFrames(page: import("@playwright/test").Page): ToolFrame[] {
  const out: ToolFrame[] = [];
  page.on("websocket", (ws) => {
    ws.on("framereceived", (frame) => {
      const payload = typeof frame.payload === "string" ? frame.payload : "";
      if (!payload.includes("tool_call") && !payload.includes("tool_execution_end")) return;
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
        if (ev?.eventType !== "tool_call" && ev?.eventType !== "tool_execution_end") continue;
        out.push({
          eventType: String(ev.eventType),
          toolName: ev.data?.toolName,
          toolCallId: ev.data?.toolCallId,
        });
      }
    });
  });
  return out;
}

/** The live session record, read through the API the dashboard itself serves. */
async function readSession(page: import("@playwright/test").Page, sessionId: string): Promise<any> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as any[]).find((s) => s.id === sessionId);
}

/** Every session id the server knows, live or ended. */
async function sessionIds(page: import("@playwright/test").Page): Promise<string[]> {
  const res = await page.request.get("/api/sessions?status=all");
  const body = await res.json();
  return (body.data as Array<{ id: string }>).map((s) => s.id);
}

/**
 * Spawn into FIXTURE_GIT and open its transcript.
 *
 * Explicit rather than `spawnFreshGitSession`: that helper clicks the FIRST
 * sidebar folder's button, and the seeded harness carries 100+ fixture folders
 * — the one it picks is not necessarily spawnable. Mirrors
 * `session-ended-orphan-heal.spec.ts`.
 */
async function spawnAndOpen(page: import("@playwright/test").Page) {
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
  return { sessionId };
}

test.describe("subagent fan-out admission (L3)", () => {
  test("#F1/#F3/#F4 refusal is terminal, forwarded, and renders durably", async ({ page }) => {
    test.setTimeout(240_000);

    const frames = collectToolFrames(page);
    await spawnAndOpen(page);
    await sendPrompt(page, "[[faux:subagent-fanout-refused]] go");

    // The turn settled: all three calls terminated.
    await expect(page.getByText(/fanout refused scenario complete/i).first()).toBeVisible({
      timeout: 120_000,
    });

    // #F1 — a terminal error state, never a spinner. The burst group carries no
    // running member, and the refusal reason reached the transcript.
    await expect(page.locator('[data-testid="tool-burst-group"][data-running="true"]')).toHaveCount(0, {
      timeout: 30_000,
    });
    await expect(page.locator("body")).toContainText(REFUSAL_TEXT);

    // #F3 — the forwarder saw ALL THREE Agent tool_calls AND all three ends. A
    // gate registered BEFORE the forwarder would have short-circuited the
    // refused call's tool_call, so live view (2 calls) and transcript (3 ends)
    // would disagree.
    await expect
      .poll(
        () => frames.filter((f) => f.eventType === "tool_call" && f.toolName === "Agent").length,
        { timeout: 30_000 },
      )
      .toBe(3);
    await expect
      .poll(() => frames.filter((f) => f.eventType === "tool_execution_end").length, {
        timeout: 30_000,
      })
      .toBe(3);

    // #F4 — the durable refusal entry renders through the generic custom-entry
    // path, transcript intact.
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: CUSTOM_TYPE }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("#F2 the refusal is still terminal after a cold reload", async ({ page }) => {
    test.setTimeout(240_000);

    const { sessionId } = await spawnAndOpen(page);
    await sendPrompt(page, "[[faux:subagent-fanout-refused]] go");
    await expect(page.getByText(/fanout refused scenario complete/i).first()).toBeVisible({
      timeout: 120_000,
    });
    await expect(page.locator("body")).toContainText(REFUSAL_TEXT);

    // Cold reload — the chat is rebuilt from the JSONL transcript.
    await page.reload();
    await byTestId(page, "headerAppBar").waitFor({ state: "visible" });
    await page.goto(`/session/${sessionId}`);

    await expect(page.locator("body")).toContainText(REFUSAL_TEXT, { timeout: 60_000 });
    await expect(page.locator('[data-testid="tool-burst-group"][data-running="true"]')).toHaveCount(0, {
      timeout: 30_000,
    });
    // The durable entry replays too.
    await expect(
      page.locator('[data-testid="custom-entry-card"]', { hasText: CUSTOM_TYPE }).first(),
    ).toBeVisible({ timeout: 30_000 });
  });

  test("#X4 refusals survive an unclean process death", async ({ page }) => {
    test.setTimeout(240_000);

    const { sessionId } = await spawnAndOpen(page);
    await sendPrompt(page, "[[faux:subagent-fanout-refused]] go");
    // Wait for the refusal to be admitted + recorded, then kill the session.
    await expect(page.locator("body")).toContainText(REFUSAL_TEXT, { timeout: 120_000 });

    const pid = (await readSession(page, sessionId))?.pid;
    expect(pid, "the session must expose its pid").toBeTruthy();
    inContainer(`kill -9 ${pid}`);

    // The durable record is on disk — scoped to THIS session's transcript. A
    // recursive grep over the shared sessions dir could pass on a stale record
    // from an earlier run even if this session lost its refusal during kill -9.
    let record = "";
    await expect
      .poll(
        () => {
          const file = inContainer(
            `ls /home/pi/.pi/agent/sessions/*/*${sessionId}*.jsonl 2>/dev/null | head -1`,
          );
          if (!file) {
            record = "";
            return false;
          }
          record = inContainer(
            `grep -h 'subagent-admission-refused' '${file}' 2>/dev/null | head -1`,
          );
          return record.length > 0;
        },
        { timeout: 30_000 },
      )
      .toBe(true);

    expect(record).toContain(CUSTOM_TYPE);
    // The cause is part of the durable payload, so saturation vs static-cap is
    // distinguishable after death.
    expect(record).toMatch(/"cause":"(cap|saturation)"/);
  });
});
