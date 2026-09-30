import { expect, type Locator, type Page } from "../fixtures.js";
import { spawnFreshGitSession } from "./index.js";

/**
 * Shared e2e fixture for the flow card grid (change: consolidate-flow-agent-cards).
 *
 * Attaches a 6-step fixture flow (4 code/code-decision + 1 agent + 1 bare code)
 * through the SAME localStorage attachment the app writes
 * (`dashboard:flow-attached:<sid>`), with the flow file and the node-file report
 * served by `page.route`. No engine run, so the flow slot renders PENDING cards
 * — enough to measure grid geometry, the compact tile, the file-control hit
 * targets and the card→editor route.
 *
 * Extracted so `flow-card-grid-geometry`, `chat-pane-below-floor-allocation`
 * and `ui-token-alignment` share one fixture rather than three copies.
 *
 * Callers must be at a DESKTOP viewport (>= 768px) when they call
 * `openIdleGrid`: it spawns through the session list, which is the desktop
 * shell's — below the md breakpoint the mobile shell renders no
 * `session-card-desktop`, so the spawn poll times out. Apply a narrower
 * measurement viewport AFTER the panel is open.
 */

const FLOW_SOURCE = "/fixtures/sample-git/.pi/flows/flows/e2e/grid/flow.yaml";

/**
 * Name the attachment carries. MUST be a name the session's `flowsList`
 * contains: `resolveFlowSlot` renders the "no longer available" slot message
 * (NOT the idle panel) when an attached name is absent from a non-empty
 * flowsList (flow-idle-state.ts). The harness discovers flows from the baked
 * fixture dir, so the fixture borrows the baked `e2e:synthetic` identity and
 * serves its own 6-step YAML through the mocked `/api/plugins/flows/file`
 * route below (the file content, not the name, defines the grid).
 */
const ATTACHED_FLOW_NAME = "e2e:synthetic";

const GRID_YAML = `name: "e2e:grid"
description: card-grid e2e fixture
task_required: false
steps:
  - id: load-ticket
    type: code
  - id: transcribe
    type: code
    blockedBy: [load-ticket]
  - id: fill-form
    type: agent
    agent: e2e-alpha
    blockedBy: [transcribe]
  - id: check-form
    type: code-decision
    blockedBy: [fill-form]
  - id: assemble
    type: code
    blockedBy: [check-form]
  - id: bare
    type: code
    blockedBy: [assemble]
`;

const DIR = FLOW_SOURCE.replace("/flow.yaml", "");

/** Handlers for every code step EXCEPT `bare` (no codeTarget, no sourcePath). */
const NODE_FILES = {
  reported: true,
  agents: { "e2e-alpha": "/fixtures/sample-git/.pi/flows/agents/e2e-alpha.md" },
  handlers: {
    [ATTACHED_FLOW_NAME]: {
      "load-ticket": `${DIR}/load-ticket.ts`,
      transcribe: `${DIR}/transcribe.ts`,
      "check-form": `${DIR}/check-form.ts`,
      assemble: `${DIR}/assemble.ts`,
    },
  },
};

export interface IdleGrid {
  panel: Locator;
  card: Locator;
  sid: string;
}

/** Attach the e2e grid fixture to a fresh session and open the idle panel. */
export async function openIdleGrid(page: Page): Promise<IdleGrid> {
  const card = await spawnFreshGitSession(page);
  await card.click();
  const sid = (await card.getAttribute("data-session-id")) ?? "";
  expect(sid, "session id on the spawned card").not.toBe("");

  await page.route("**/api/plugins/flows/file?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: { content: GRID_YAML } }),
    }),
  );
  await page.route("**/api/plugins/flows/files?**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: NODE_FILES }),
    }),
  );

  // The store reads localStorage on mount, so write then reload (same page: no
  // cross-tab `storage` event fires).
  await page.evaluate(
    ([k, v]) => localStorage.setItem(k, v),
    [
      `dashboard:flow-attached:${sid}`,
      JSON.stringify({
        id: "e2e-grid-attach",
        name: ATTACHED_FLOW_NAME,
        source: FLOW_SOURCE,
        baselineStartedAt: 0,
      }),
    ],
  );
  await page.reload();

  const panel = page.getByTestId("flow-dashboard");
  await expect(panel).toHaveAttribute("data-flow-mode", "idle", { timeout: 30_000 });
  return { panel, card, sid };
}

/** The grid's cards. */
export const gridCards = (panel: Locator) => panel.locator("[data-step]");
/** The inner grid element (parent of the cards). */
export const gridOf = (panel: Locator) => gridCards(panel).first().locator("xpath=..");
/** The `@container` wrapper (parent of the grid) — its width is the PANE width. */
export const gridContainerOf = (panel: Locator) => gridOf(panel).locator("xpath=..");

/** Open the split editor and drag the divider so the chat pane is ~`width` px. */
export async function dragChatPaneTo(page: Page, width: number): Promise<Locator> {
  await page.getByTestId("layout-mode-split").click();
  await expect(page.getByTestId("split-editor-pane")).toBeVisible({ timeout: 15_000 });
  const divider = page.getByTestId("split-divider");
  const box = await divider.boundingBox();
  expect(box).not.toBeNull();
  const y = box!.y + box!.height / 2;
  await page.mouse.move(box!.x + box!.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(width + 4, y, { steps: 8 });
  await page.mouse.up();
  const pane = page.getByTestId("split-chat-pane");
  await expect(pane).toBeVisible();
  return pane;
}
