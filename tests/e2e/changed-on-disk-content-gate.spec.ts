import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { expect, type Page, test } from "./fixtures.js";
import { resolveContainer } from "./helpers/container-proc.js";
import { FIXTURE_GIT, spawnFreshGitSession } from "./helpers/index.js";

// Browser E2E — the changed-on-disk banner fires on a real CONTENT difference
// only (change: gate-changed-on-disk-by-content; test-plan F16, F17, F18).
//
// The fixture repo lives INSIDE the harness container, so every "external
// writer" is a `docker exec` shell command: that is the only way to produce the
// raw `touch` / identical rewrite / tmp+rename events the watcher sees in real
// life (a REST write is itself an atomic rename the pane would treat as ours).
// Each spec creates its own uniquely-named files and removes them in
// `afterEach`, because all specs share one container and one fixture repo.
// Exemplars: apply-fix-to-file.spec.ts (session + editor deep link),
// container-proc.ts (docker exec), tool-created-files.spec.ts (pane glue).

const TOKEN = randomBytes(4).toString("hex");
const created: string[] = [];
let container = "";

const sh = (script: string): string =>
  execFileSync("docker", ["exec", container, "sh", "-c", script], { encoding: "utf8" }).trim();
const abs = (rel: string): string => `${FIXTURE_GIT}/${rel}`;
/** Write `content` (printf-escaped) to a fixture file, optionally via tmp + rename. */
const put = (rel: string, content: string, atomic = false): void => {
  const target = abs(rel);
  if (atomic) sh(`printf '%s' '${content}' > '${target}.tmp' && mv '${target}.tmp' '${target}'`);
  else sh(`printf '%s' '${content}' > '${target}'`);
};

const banner = (page: Page) => page.getByTestId("changed-on-disk-banner");
/** Let the watcher event + 150 ms settle + digest round-trip finish before asserting absence. */
const settle = (page: Page) => page.waitForTimeout(1800);

test.describe("changed-on-disk banner gates on content", () => {
  test.beforeEach(() => {
    container = resolveContainer();
  });

  test.afterEach(async ({ page }) => {
    // Restore the default limit and drop every file this spec created.
    await page.request.put("/api/config", { data: { editor: { largeFileLimitMb: 10 } } }).catch(() => {});
    for (const rel of created.splice(0)) {
      try {
        sh(`rm -f '${abs(rel)}' '${abs(rel)}.tmp'`);
      } catch {
        /* container gone */
      }
    }
  });

  async function openInPane(page: Page, rel: string): Promise<void> {
    const card = await spawnFreshGitSession(page);
    const sessionId = await card.getAttribute("data-session-id");
    await card.click();
    await page.goto(`/session/${sessionId}/editor?file=${encodeURIComponent(rel)}`);
  }

  test("F16: touch, identical rewrite and identical tmp+rename never banner; a different write does", async ({ page }) => {
    test.setTimeout(120_000);
    const rel = `gcd-${TOKEN}.ts`;
    created.push(rel);
    put(rel, "const a = 1;\n");
    await openInPane(page, rel);
    await expect(page.locator(".monaco-editor").first()).toBeVisible({ timeout: 30_000 });
    await settle(page); // baseline captured, watch armed, mount catch-up done

    sh(`touch '${abs(rel)}'`);
    await settle(page);
    await expect(banner(page)).toHaveCount(0);

    put(rel, "const a = 1;\n"); // identical content, in place
    await settle(page);
    await expect(banner(page)).toHaveCount(0);

    put(rel, "const a = 1;\n", true); // identical content, atomic replace
    await settle(page);
    await expect(banner(page)).toHaveCount(0);

    put(rel, "const a = 2;\n"); // a real change, in place after the rename
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
  });

  test("F17: the pane's own Save never banners; a later external write does", async ({ page }) => {
    test.setTimeout(120_000);
    const rel = `gcd-${TOKEN}.md`;
    created.push(rel);
    put(rel, "# gate\n\nfirst\n");
    await openInPane(page, rel);
    await expect(page.getByTestId("md-edit-toggle")).toBeVisible({ timeout: 30_000 });
    await settle(page);

    await page.getByTestId("md-edit-toggle").click();
    const editor = page.locator(".monaco-editor").first();
    await expect(editor).toBeVisible({ timeout: 30_000 });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.type("\nedited in the pane\n");
    await page.getByTestId("md-save-btn").click();
    await expect(page.getByTestId("md-dirty-dot")).toHaveCount(0, { timeout: 15_000 });
    await settle(page);
    await expect(banner(page)).toHaveCount(0); // our own atomic replace is not a change

    put(rel, "# gate\n\nwritten by someone else\n");
    await expect(banner(page)).toBeVisible({ timeout: 15_000 });
  });

  test("F18: a raised editor limit renders a big markdown file richly without a reload", async ({ page }) => {
    test.setTimeout(180_000);
    const rel = `gcd-big-${TOKEN}.md`;
    created.push(rel);
    // ~30 MiB, one line: well above the 10 MiB default, below the raised 64 MiB.
    sh(`head -c 31457280 /dev/zero | tr '\\0' 'a' > '${abs(rel)}'`);
    await openInPane(page, rel);

    // Default limit: the too-large fallback names it.
    const notice = page.getByTestId("too-large-preview");
    await expect(notice).toBeVisible({ timeout: 60_000 });
    await expect(notice).toContainText("limit 10 MB");

    // Raise the limit through the config write path; the open page re-gates live.
    const put64 = await page.request.put("/api/config", { data: { editor: { largeFileLimitMb: 64 } } });
    expect(put64.ok()).toBeTruthy();
    expect((await put64.json()).restartRequired).toBeFalsy();

    await expect(page.getByTestId("md-edit-toggle")).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("too-large-preview")).toHaveCount(0);
  });
});
