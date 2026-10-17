import { execFileSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";
import { harnessProject } from "./lifecycle.js";

/**
 * L3 — dashboard trust mirrored into pi (change: mirror-dashboard-trust-to-pi;
 * test-plan F5, F6).
 *
 * Browser-real against the docker harness with REAL files: a unique `/fixtures`
 * folder with a `.pi/mcp.json` stdio server, pinned through the UI while pi's
 * `trust.json` records nothing for it. Proves the folder is trusted BY THE
 * DASHBOARD (folder MCP page + Settings → Access effective list + the snapshot the
 * bridge decides from), and that unpinning withdraws it everywhere.
 *
 * Scope note: the spawned-session tool-list assertion of test-plan F5/F6 is the
 * bridge decision itself, which the L1 suite proves branch by branch
 * (`packages/extension/src/__tests__/project-trust.test.ts`, incl. the
 * snapshot-without-server case); this spec proves the SERVER half — the durable
 * entry reaching the snapshot, the pages, and its withdrawal — against the real
 * container.
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
const CWD = `/fixtures/pi-trust-mirror-${TOKEN}`;
const ECHO = { command: "node", args: ["-e", "setInterval(() => {}, 1000)"], description: "e2e trust mirror" };

function snapshotKeys(): string[] {
  const raw = inContainer('cat "$HOME/.pi/dashboard/pi-trust-mirror.json" 2>/dev/null || echo "{}"');
  const parsed = JSON.parse(raw) as { entries?: Array<{ key: string }> };
  return (parsed.entries ?? []).map((e) => e.key);
}

test.describe("pi trust mirror (L3)", () => {
  test.beforeAll(() => {
    inContainer(
      [
        `mkdir -p '${CWD}/.pi'`,
        `(cd '${CWD}' && { [ -d .git ] || git init -q; })`,
        `printf '%s' '${JSON.stringify({ mcpServers: { echo: ECHO } })}' > '${CWD}/.pi/mcp.json'`,
      ].join(" && "),
    );
  });

  test.afterAll(() => {
    inContainer(`rm -rf '${CWD}'`);
  });

  test("F5: a pinned folder is trusted by the dashboard (page, Access list, snapshot)", async ({ page }) => {
    await gotoDashboard(page);
    await pinDirectory(page, CWD);

    await page.goto(`/folder/${encodeURIComponent(CWD)}/mcp`);
    const banner = page.getByTestId("mcp-folder-trusted-dashboard");
    await expect(banner).toBeVisible({ timeout: 30_000 });
    await expect(banner).toContainText("trusted by the dashboard");
    await expect(banner).toContainText("pinned folder");
    await expect(page.getByTestId("mcp-folder-untrusted")).toHaveCount(0);

    await expect.poll(snapshotKeys, { timeout: 30_000 }).toContain(CWD);

    await page.goto("/settings/access");
    const effective = page.getByTestId("pi-trust-effective");
    await expect(effective).toContainText(CWD, { timeout: 30_000 });
    await expect(effective).toContainText("pinned folder");
  });

  test("F6: unpinning withdraws the dashboard trust", async ({ page }) => {
    await gotoDashboard(page);
    await page.request.delete("/api/access/pinned-directory", { data: { subject: CWD } });

    await expect.poll(snapshotKeys, { timeout: 30_000 }).not.toContain(CWD);

    await page.goto("/settings/access");
    await expect(page.getByTestId("pi-trust-effective")).not.toContainText(CWD, { timeout: 30_000 });

    await page.goto(`/folder/${encodeURIComponent(CWD)}/mcp`);
    await expect(page.getByTestId("mcp-folder-trusted-dashboard")).toHaveCount(0);
  });
});
