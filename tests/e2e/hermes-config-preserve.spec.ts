import { execSync } from "node:child_process";
import { expect, test } from "./fixtures.js";
import { gotoDashboard } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

/**
 * L3 (change: resync-hermes-memory-config-0-9, test-plan F1): a dashboard save
 * keeps hermes keys the plugin does not mirror and heals the 0.8.1-era pinned
 * `consolidationTimeoutMs: 60000` once.
 *
 * The hermes file is seeded and read OUT-OF-BAND via `docker exec -i … node`
 * (pattern: access-grants-revoke.spec.ts) — a PUT seed would itself go through
 * the compose step under test. The container-side path comes from the config
 * route's `filePath`. The original bytes (or absence) are restored in `finally`.
 */

const PLUGIN_PATH = "/settings/plugins/hermes-memory";
const CONFIG_ROUTE = "/api/plugins/hermes-memory/config";

/** All 23 keys the 0.8.1 write-all plugin pinned, at their 0.8.1 defaults. */
const LEGACY_FILE = {
  memoryMode: "policy-only",
  memoryPolicyStyle: "full",
  memoryCharLimit: 5000,
  userCharLimit: 5000,
  projectCharLimit: 5000,
  nudgeInterval: 10,
  reviewRecentMessages: 0,
  reviewEnabled: true,
  reviewTransport: "direct",
  flushOnCompact: true,
  flushOnShutdown: true,
  flushMinTurns: 6,
  flushRecentMessages: 0,
  memoryOverflowStrategy: "auto-consolidate",
  autoConsolidate: true,
  correctionDetection: true,
  failureInjectionEnabled: true,
  failureInjectionMaxAgeDays: 7,
  failureInjectionMaxEntries: 5,
  consolidationTimeoutMs: 60000,
  nudgeToolCalls: 15,
  projectsMemoryDir: "projects-memory",
  sessionSearch: { variant: "legacy" },
};

function containerName(): string {
  return execSync(`docker ps --filter publish=${DASHBOARD_PORT} --format '{{.Names}}'`, { encoding: "utf8" })
    .trim()
    .split("\n")[0];
}

/** Run a node script in the container; stdout is returned. */
function inContainer(script: string): string {
  return execSync(`docker exec -i ${containerName()} node`, { input: script, encoding: "utf8" });
}

/** Read the file's bytes (null when absent). */
function readFile(file: string): string | null {
  const out = inContainer(
    `const fs=require("fs");const f=${JSON.stringify(file)};process.stdout.write(JSON.stringify(fs.existsSync(f)?fs.readFileSync(f,"utf8"):null));`,
  );
  return JSON.parse(out) as string | null;
}

/** Write bytes (or delete when null). */
function writeFile(file: string, text: string | null): void {
  inContainer(
    `const fs=require("fs"),path=require("path");const f=${JSON.stringify(file)};const t=${JSON.stringify(text)};` +
      `if(t===null){fs.rmSync(f,{force:true});}else{fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,t);}`,
  );
}

test.describe("hermes config preserve + legacy heal (L3)", () => {
  test("F1: save keeps unknown keys, heals 60000, reload shows the 180000 default", async ({ page }) => {
    const { filePath } = (await (await page.request.get(CONFIG_ROUTE)).json()) as { filePath: string };
    const original = readFile(filePath);
    try {
      writeFile(filePath, JSON.stringify({ ...LEGACY_FILE, futureHermesKey: 42 }, null, 2));

      await gotoDashboard(page);
      await page.goto(PLUGIN_PATH);
      await expect(page.getByTestId("hermes-file-path")).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => {
        for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
      });

      const nudge = page.getByTestId("hermes-input-nudgeInterval");
      await nudge.scrollIntoViewIfNeeded();
      await nudge.fill("7");
      await expect(page.getByTestId("settings-save-bar")).toBeVisible();
      await page.getByTestId("save-btn").click();
      await expect(page.getByTestId("settings-save-bar")).toHaveCount(0, { timeout: 30_000 });

      const written = JSON.parse(readFile(filePath) ?? "{}") as Record<string, unknown>;
      expect(written.futureHermesKey).toBe(42);
      expect(written.nudgeInterval).toBe(7);
      expect(written.memoryOverflowStrategy).toBe("auto-consolidate");
      expect(Object.hasOwn(written, "consolidationTimeoutMs")).toBe(false);

      await page.reload();
      await expect(page.getByTestId("hermes-file-path")).toBeVisible({ timeout: 30_000 });
      await page.evaluate(() => {
        for (const d of Array.from(document.querySelectorAll("details"))) d.open = true;
      });
      await expect(page.getByTestId("hermes-input-consolidationTimeoutMs")).toHaveValue("180000");
      await expect(page.getByTestId("hermes-default-badge-consolidationTimeoutMs")).toBeVisible();
    } finally {
      writeFile(filePath, original);
    }
  });
});
