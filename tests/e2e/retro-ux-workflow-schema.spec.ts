import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { buttonsWithoutFocusIndicator, contrastFailures, measureText, setThemeMode, sizeFailures } from "./helpers/computed-contrast.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";
import { RETRO_UX_THEMES } from "./helpers/ui-capture.js";
import { BASE_URL, DASHBOARD_PORT } from "./lifecycle.js";

/**
 * Settings → OpenSpec → Workflow Schema section against the UI contract:
 * computed contrast, interactive size floor and focus indicators over the
 * section and over an open Enable dialog, in base dark, base light and nord
 * dark, for six harness projects in the board's six overview states.
 *
 * Exemplar: `retro-ux-credential-vault.spec.ts` (computed-contrast probes across
 * themes). Fixtures are real projects inside the disposable docker harness,
 * driven through the real REST routes and `docker exec` (no stubs: the status
 * map arrives over the WebSocket snapshot).
 *
 * The six states (card pill text → recipe):
 *   Not enabled          init only
 *   Enabled              init + enable
 *   Disabled, files kept init + enable + disable
 *   Update available     init + enable + stamp `patch: 0`
 *   Not managed          `pi-spec-driven/` without a dashboard stamp
 *   1 change not pinned  init + enable + a file-less change
 *
 * See change: add-pi-spec-driven-schema (test-plan #U13).
 */

const RUN = Date.now().toString(36);

/** Resolve the harness container by its published dashboard port (never 8000). */
function harnessContainer(): string {
  const out = execFileSync("docker", ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"], {
    encoding: "utf8",
  }).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no harness container on port ${DASHBOARD_PORT}`);
  return name;
}

/** Run a shell snippet inside the harness container. */
function dsh(cmd: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", cmd], { encoding: "utf8" });
}

async function api(page: Page, path: string, init?: { method: string; body?: unknown }) {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p as string, {
        method: (i as { method: string } | null)?.method ?? "GET",
        headers: { "Content-Type": "application/json" },
        ...((i as { body?: unknown } | null)?.body !== undefined ? { body: JSON.stringify((i as { body: unknown }).body) } : {}),
      });
      return { status: res.status, body: (await res.json().catch(() => null)) as Record<string, unknown> | null };
    },
    [path, init ?? null] as const,
  );
}

interface Fixture {
  name: string;
  pill: string;
  /** Extra setup after `init`, as [workflow-schema action | shell command]. */
  steps: Array<{ action: "enable" | "disable" } | { sh: string }>;
}

const FIXTURES: Fixture[] = [
  { name: "none", pill: "Not enabled", steps: [] },
  { name: "enabled", pill: "Enabled", steps: [{ action: "enable" }] },
  { name: "kept", pill: "Disabled, files kept", steps: [{ action: "enable" }, { action: "disable" }] },
  {
    name: "outdated",
    pill: "Update available",
    steps: [{ action: "enable" }, { sh: "sed -i 's/patch: 1/patch: 0/' DIR/openspec/schemas/pi-spec-driven/schema.yaml" }],
  },
  {
    name: "unmanaged",
    pill: "Not managed",
    steps: [{ sh: "mkdir -p DIR/openspec/schemas/pi-spec-driven && printf 'name: pi-spec-driven\\nversion: 1\\n' > DIR/openspec/schemas/pi-spec-driven/schema.yaml" }],
  },
  {
    name: "unpinned",
    pill: "1 change not pinned",
    steps: [{ action: "enable" }, { sh: "mkdir -p DIR/openspec/changes/late && printf '## Why\\nlate\\n' > DIR/openspec/changes/late/proposal.md" }],
  },
];

const dirOf = (name: string) => `/fixtures/e2e-wsui-${RUN}-${name}`;

let pollSnapshot: number | null = null;

test.describe.configure({ mode: "serial" });

test.describe("retro-ux workflow schema section", () => {
  test.beforeAll(async () => {
    const res = await fetch(`${BASE_URL}/api/config`);
    const body = (await res.json()) as { data?: { openspec?: { pollIntervalSeconds?: number } } };
    pollSnapshot = body.data?.openspec?.pollIntervalSeconds ?? 60;
  });

  test.afterAll(async () => {
    for (const f of FIXTURES) dsh(`rm -rf ${dirOf(f.name)}`);
    if (pollSnapshot !== null) {
      await fetch(`${BASE_URL}/api/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openspec: { pollIntervalSeconds: pollSnapshot } }),
      });
    }
  });

  test("U13: contrast, size and focus probes are clean over the section and an open Enable dialog in every theme", async ({ page }) => {
    test.setTimeout(420_000);
    await gotoDashboard(page);
    // 5 s poll clamp so out-of-band mutations converge within one tick.
    const put = await api(page, "/api/config", { method: "PUT", body: { openspec: { pollIntervalSeconds: 5 } } });
    expect(put.body?.success, JSON.stringify(put.body)).toBe(true);

    for (const f of FIXTURES) {
      const dir = dirOf(f.name);
      dsh(`rm -rf ${dir} && mkdir -p ${dir}`);
      await pinDirectory(page, dir);
      const init = await api(page, "/api/openspec/init", { method: "POST", body: { cwd: dir } });
      expect(init.status, JSON.stringify(init.body)).toBe(200);
      for (const step of f.steps) {
        if ("action" in step) {
          const r = await api(page, "/api/openspec/workflow-schema", {
            method: "POST",
            body: { cwd: dir, action: step.action, ...(step.action === "disable" ? { confirm: true } : {}) },
          });
          expect(r.status, JSON.stringify(r.body)).toBe(200);
        } else {
          dsh(step.sh.replace(/DIR/g, dir));
        }
      }
    }

    const section = page.getByTestId("openspec-workflow-schema-settings");
    for (const { theme, mode } of RETRO_UX_THEMES) {
      await page.goto("/settings/openspec");
      await setThemeMode(page, mode, theme);
      await expect(section).toBeVisible({ timeout: 60_000 });
      // All six cards reached their state (the poll re-broadcasts the status).
      for (const f of FIXTURES) {
        await expect(page.getByTestId(`workflow-schema-status-${dirOf(f.name)}`)).toContainText(f.pill, { timeout: 60_000 });
      }

      const sectionMeasures = await measureText(section);
      expect(sectionMeasures.length, `${theme}-${mode} section measured text nodes`).toBeGreaterThan(0);
      expect(contrastFailures(sectionMeasures), `${theme}-${mode} section contrast`).toEqual([]);
      expect(sizeFailures(sectionMeasures), `${theme}-${mode} section size`).toEqual([]);
      expect(await buttonsWithoutFocusIndicator(page, section), `${theme}-${mode} section focus`).toEqual([]);

      // The open Enable dialog (the "Not enabled" card's recommended action).
      await page.getByTestId(`workflow-schema-enable-${dirOf("none")}`).click();
      const dialog = page.getByTestId("workflow-schema-confirm");
      await expect(dialog).toBeVisible();
      const dialogMeasures = await measureText(dialog);
      expect(dialogMeasures.length, `${theme}-${mode} dialog measured text nodes`).toBeGreaterThan(0);
      expect(contrastFailures(dialogMeasures), `${theme}-${mode} dialog contrast`).toEqual([]);
      expect(sizeFailures(dialogMeasures), `${theme}-${mode} dialog size`).toEqual([]);
      expect(await buttonsWithoutFocusIndicator(page, dialog), `${theme}-${mode} dialog focus`).toEqual([]);
      await page.getByTestId("workflow-schema-cancel").click();
      await expect(dialog).toBeHidden();
    }
  });
});
