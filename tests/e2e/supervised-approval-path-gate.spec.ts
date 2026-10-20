/**
 * L3 — Supervised mode × the agent path gate (one prompt per out-of-root edit),
 * change: add-supervised-tool-approval (design D14, D15). test-plan: #F15–#F18.
 *
 * WHAT ONLY THIS LEVEL CAN PROVE
 * ------------------------------
 * The L1 suites pin the hand-off set, the enrichment accessor and the chain order. Only the
 * live chain (real pi `tool_call` dispatch → fan-out → path gate → supervised gate, real
 * bridge, real server grant store, real YOLO) proves the operator sees exactly ONE card per
 * out-of-root edit that already shows what will change, that Always allow / Deny / YOLO
 * compose the way the design says, and that the diff cap holds in the rendered DOM.
 *
 * Faux scenarios: `tool-edit-outside` and `tool-edit-outside-big` re-seed
 * `/srv/fixtures-outside/edit-target.txt` before each edit (qa/fixtures/faux-scenarios.ts).
 * Exemplar: `agent-path-gate.spec.ts`.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { gotoDashboard } from "./helpers/index.js";
import {
  approvalCard,
  clearAgentRefusals,
  enableToolSurfaces,
  endYolo,
  expectPendingCard,
  openSupervisedSession,
  revealToolBodies,
  revokeFixtureGrants,
  runScenario,
  startUnscopedYolo,
  transcript,
} from "./helpers/supervised.js";

const GATE_TITLE = /outside its workspace/i;
const EDIT_TARGET = "/srv/fixtures-outside/edit-target.txt";
const EDIT_TAIL = "supervised edit done";
const MARKER = "… (truncated)";
const CAP = 16384;

const allowOnce = (page: Page) => page.getByRole("button", { name: /^Allow once/i }).first();
const deny = (page: Page) => page.getByRole("button", { name: /^Deny/i }).first();
const always = (page: Page) => page.getByRole("button", { name: /^Always allow/i }).first();

/** The path-gate card: the select card whose title names the out-of-workspace target. */
const pathCard = (page: Page) => page.getByText(GATE_TITLE).first();

/** Contents of the out-of-root target, read from inside the container. */
function targetContents(): string {
  return execFileSync("docker", ["exec", resolveContainer(), "cat", EDIT_TARGET], { encoding: "utf8" });
}

async function raise(page: Page, scenario: string, cardTimeout = 30_000): Promise<void> {
  await openSupervisedSession(page);
  await runScenario(page, scenario);
  await expect(pathCard(page)).toBeVisible({ timeout: cardTimeout });
}

test.describe("supervised × agent path gate (L3)", () => {
  test.beforeEach(async ({ page }) => {
    await gotoDashboard(page);
    await enableToolSurfaces(page);
    await endYolo(page);
    await revokeFixtureGrants(page);
    await clearAgentRefusals(page);
  });
  test.afterEach(async ({ page }) => {
    await endYolo(page);
    await clearAgentRefusals(page).catch(() => undefined);
    await revokeFixtureGrants(page).catch(() => undefined);
  });

  test("#F15 one prompt per out-of-root edit; the path card shows what will change", async ({ page }) => {
    await raise(page, "tool-edit-outside");
    // ONE card: the path-gate card, carrying path + `+N −M` + the diff. No supervised card yet.
    await expect(page.getByText(EDIT_TARGET).first()).toBeVisible();
    await expect(page.getByText(/\+1\s+[−-]1/).first()).toBeVisible();
    await expect(page.getByText("EDITED-LINE").first()).toBeVisible();
    await expect(approvalCard(page)).toHaveCount(0);

    await allowOnce(page).click();

    // Edit applied, and NO second (supervised) card ever appears: the turn reaches its end.
    await expect(page.getByText(EDIT_TAIL)).toBeVisible({ timeout: 30_000 });
    await expect(approvalCard(page)).toHaveCount(0);
    expect(targetContents()).toContain("EDITED-LINE");
    await expect(page.getByText(/\d+ failed/i)).toHaveCount(0);
  });

  test("#F15 (20 KiB variant) the rendered diff is capped at 16384 bytes and ends `… (truncated)`", async ({ page }) => {
    // The faux provider streams the ~17 KiB tool-call input at 50 tokens/s (≈ 85 s) before the gate sees it.
    test.setTimeout(240_000);
    await raise(page, "tool-edit-outside-big", 150_000);
    // The diff is a fenced block inside the path card: take the largest rendered `pre`.
    const block = page.locator("pre").filter({ hasText: "added-line-000" }).last();
    await expect(block).toBeVisible({ timeout: 15_000 });
    const text = (await block.innerText()).replace(/\s+$/u, "");
    expect(text.endsWith(MARKER), "diff ends with the truncation marker").toBe(true);
    const body = text.slice(0, -MARKER.length);
    expect(Buffer.byteLength(body, "utf8")).toBeLessThanOrEqual(CAP);
    // …and it really was cut: the last generated line never made it into the DOM.
    expect(text).not.toContain("added-line-219");

    await deny(page).click();
    await expect(page.getByText(EDIT_TAIL)).toBeVisible({ timeout: 30_000 });
  });

  test("#F16 Always allow on the enriched path prompt still asks the supervised gate", async ({ page }) => {
    await raise(page, "tool-edit-outside");
    await always(page).click();
    await page.getByRole("button", { name: /^(Yes|Confirm|Allow)/i }).first().click();

    // The durable grant is not consent to THIS content: the supervised card follows.
    const card = await expectPendingCard(page, 30_000);
    await expect(card.getByTestId("tool-approval-tool")).toHaveText("edit");
    await expect(card.getByTestId("tool-approval-path")).toHaveText(EDIT_TARGET);

    await page.getByTestId("tool-approval-deny").click();
    await expect(page.getByText(EDIT_TAIL)).toBeVisible({ timeout: 30_000 });
  });

  test("#F17 a path-gate Deny suppresses the supervised prompt; the tool is blocked", async ({ page }) => {
    await raise(page, "tool-edit-outside");
    await deny(page).click();

    await expect(page.getByText(EDIT_TAIL)).toBeVisible({ timeout: 30_000 });
    await expect(approvalCard(page)).toHaveCount(0);
    await revealToolBodies(page); // the tool row (with the block reason) is collapsed by default
    await expect(transcript(page).getByText(/path-gate:/).first()).toBeVisible({ timeout: 15_000 });
    expect(targetContents()).not.toContain("EDITED-LINE");
  });

  test("#F18 YOLO does not answer a supervised approval", async ({ page }) => {
    expect((await startUnscopedYolo(page)).ok()).toBe(true);
    await openSupervisedSession(page);
    await runScenario(page, "tool-edit-outside");

    // The path gate is auto-allowed by YOLO (no path card)…
    const card = await expectPendingCard(page, 30_000);
    await expect(page.getByText(GATE_TITLE)).toHaveCount(0);
    // …but the supervised gate still asks.
    await expect(card.getByTestId("tool-approval-tool")).toHaveText("edit");
    await expect(card.getByTestId("tool-approval-path")).toHaveText(EDIT_TARGET);
    expect(targetContents()).not.toContain("EDITED-LINE");

    await page.getByTestId("tool-approval-deny").click();
    await expect(page.getByText(EDIT_TAIL)).toBeVisible({ timeout: 30_000 });
  });
});
