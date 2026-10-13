import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { assertHitAreas, gotoDashboard, pinDirectory } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

/**
 * L3 — per-project overrides of Pi-global MCP servers on the folder page
 * (change: mcp-client-project-overrides; test-plan F13, F14, F15).
 *
 * Browser-real against the docker harness with REAL files: each test seeds a
 * unique folder under /fixtures (pinned + trusted in pi's trust store) and the
 * container's Pi-global `mcp.json`, drives the folder page, and reads the files
 * back. The global file is restored afterwards.
 */

function container(): string {
  const id = execFileSync("docker", ["ps", "-q", "--filter", `label=com.docker.compose.project=${harnessProject()}`], {
    encoding: "utf8",
    timeout: 30_000,
  })
    .trim()
    .split("\n")[0];
  if (!id) throw new Error("no running harness container");
  return id;
}

function inContainer(script: string): string {
  return execFileSync("docker", ["exec", container(), "sh", "-c", script], { encoding: "utf8", timeout: 90_000 }).trim();
}

const TOKEN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const DOCS = { command: "node", args: ["-e", "setInterval(() => {}, 1000)"], description: "e2e docs" };

let agentDir = "";
let originalGlobal: string | null = null;

function seed(cwd: string, folderServers: Record<string, unknown> | null): void {
  const global = JSON.stringify({ mcpServers: { docs: DOCS } });
  const folder = folderServers ? JSON.stringify({ mcpServers: folderServers }) : "";
  inContainer(
    [
      `mkdir -p '${cwd}/.pi' '${agentDir}'`,
      // admission is git-aware: a plain directory is not an admissible folder cwd
      `(cd '${cwd}' && { [ -d .git ] || git init -q; })`,
      `printf '%s' '${global}' > '${agentDir}/mcp.json'`,
      folderServers ? `printf '%s' '${folder}' > '${cwd}/.pi/mcp.json'` : `rm -f '${cwd}/.pi/mcp.json'`,
      `node -e 'const fs=require("fs");const p=process.argv[1];let d={};try{d=JSON.parse(fs.readFileSync(p,"utf8"))}catch{}d[process.argv[2]]=true;fs.writeFileSync(p,JSON.stringify(d))' '${agentDir}/trust.json' '${cwd}'`,
    ].join(" && "),
  );
}

async function openFolderPage(page: Page, cwd: string): Promise<void> {
  await gotoDashboard(page);
  await pinDirectory(page, cwd);
  await page.goto(`/folder/${encodeURIComponent(cwd)}/mcp`);
  await expect(page.getByTestId("mcp-folder-page")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId("mcp-folder-row-pi-global:docs")).toBeVisible({ timeout: 30_000 });
}

/** Runs in the page: buttons, selects and radio labels under 44x44. */
function undersizedActions(root: Element): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll("button, select, label"))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (el.tagName === "LABEL" && !el.querySelector("input")) continue;
    if (r.width < 44 || r.height < 44) out.push(`${el.tagName}:${Math.round(r.width)}x${Math.round(r.height)}`);
  }
  return out;
}

test.describe("mcp-client project overrides (L3)", () => {
  test.beforeAll(() => {
    agentDir = inContainer('echo "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"');
    originalGlobal = inContainer(`[ -f '${agentDir}/mcp.json' ] && cat '${agentDir}/mcp.json' || echo __none__`);
  });

  test.afterAll(() => {
    if (originalGlobal === null) return;
    inContainer(originalGlobal === "__none__" ? `rm -f '${agentDir}/mcp.json'` : `printf '%s' '${originalGlobal.replace(/'/g, `'\\''`)}' > '${agentDir}/mcp.json'`);
  });

  test("F13: the Enabled radiogroup moves with the arrow keys", async ({ page }) => {
    const cwd = `/fixtures/e2e-mcp-radio-${TOKEN}`;
    seed(cwd, { docs: { exposure: "direct" } });
    await openFolderPage(page, cwd);

    await page.getByTestId("mcp-folder-menu-pi-global:docs").click();
    await page.getByTestId("mcp-folder-project-settings-pi-global:docs").click();
    const panel = page.getByTestId("mcp-folder-project-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });

    const group = panel.getByRole("radiogroup", { name: "Enabled in this folder" });
    const inherit = group.getByRole("radio", { name: /^Inherit/ });
    await expect(inherit).toBeChecked();
    await inherit.focus();
    await page.keyboard.press("ArrowRight");
    const on = group.getByRole("radio", { name: "On", exact: true });
    await expect(on).toBeChecked();
    await expect(on).toBeFocused();
  });

  test("F14: mobile — bottom sheet, display-only badges, 44px actions", async ({ page }) => {
    const cwd = `/fixtures/e2e-mcp-mobile-${TOKEN}`;
    seed(cwd, { docs: { enabled: false } });
    await page.setViewportSize({ width: 390, height: 844 });
    await openFolderPage(page, cwd);

    // Badge is text only; Reset and Project settings live in the row's sheet.
    const badge = page.getByTestId("mcp-override-badge-pi-global:docs-enabled");
    await expect(badge).toHaveText("Off in this folder");
    await expect(badge.locator("button")).toHaveCount(0);
    await expect(page.getByTestId("mcp-folder-reset-pi-global:docs")).toHaveCount(0);

    await page.getByTestId("mcp-folder-menu-pi-global:docs").click();
    await expect(page.getByTestId("mcp-folder-reset-pi-global:docs")).toBeVisible();
    await expect(page.getByTestId("mcp-folder-project-settings-pi-global:docs")).toBeVisible();
    await assertHitAreas(page, '[data-testid="mcp-folder-page"]');

    await page.getByTestId("mcp-folder-project-settings-pi-global:docs").click();
    const panel = page.getByTestId("mcp-folder-project-panel");
    await expect(panel).toBeVisible({ timeout: 15_000 });
    await expect(panel).toHaveAttribute("data-sheet", "bottom");
    const box = await panel.boundingBox();
    expect(box).not.toBeNull();
    // Anchored to the bottom edge of the folder overlay (which is inset by a few px from the viewport).
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeGreaterThanOrEqual(844 - 16);

    // Every action keeps a 44px hit area (a radio's hit target is its label).
    const small = await panel.evaluate(undersizedActions);
    expect(small).toEqual([]);
  });

  test("F15: switching off in the folder writes only the override; pi lists docs disabled", async ({ page }) => {
    const cwd = `/fixtures/e2e-mcp-roundtrip-${TOKEN}`;
    seed(cwd, null);
    const globalBefore = inContainer(`cat '${agentDir}/mcp.json'`);
    await openFolderPage(page, cwd);

    const sw = page.getByTestId("mcp-server-toggle-pi-global:docs");
    await expect(sw).toBeChecked();
    await sw.click();
    await expect(page.getByTestId("mcp-override-badge-pi-global:docs-enabled")).toHaveText("Off in this folder", { timeout: 20_000 });

    expect(JSON.parse(inContainer(`cat '${cwd}/.pi/mcp.json'`))).toEqual({ mcpServers: { docs: { enabled: false } } });
    expect(inContainer(`cat '${agentDir}/mcp.json'`)).toBe(globalBefore);

    const listed = JSON.parse(inContainer(`cd '${cwd}' && pi mcp list --json`)) as { servers?: Array<{ name: string; state: string }> };
    const docs = listed.servers?.find((s) => s.name === "docs");
    expect(docs?.state).toBe("disabled");
  });
});
