/**
 * Browser E2E — submodule config-root fix (change:
 * `apply-checkout-root-to-worktree-ops`, test-plan #F6 / task 3.5).
 *
 * BEFORE: `resolveConfigRoot` gated on `isGitRepo`, which is FALSE inside a
 * bare repo and unreliable for submodule cwd resolution — a submodule
 * checkout carrying `.pi/settings.json` could fall into the setup rung and
 * render the "Not a pi project yet — Set up" banner.
 *
 * AFTER: the config root is `checkoutRoots()?.mainCheckout` — for a
 * submodule cwd that is the SUBMODULE WORKING TREE, where `.pi/settings.json`
 * actually lives. The declared hook is reported; the setup banner is absent.
 *
 * Fixture: a superproject with a real submodule, built OUT-OF-BAND in the
 * disposable docker harness container (`docker exec` git). The declared hook
 * is UNTRUSTED (TOFU — never executed), so the surface reports the hook via
 * the re-trust rung rather than running anything.
 *
 * Setup drives the filesystem + REST API (deterministic); assertions drive
 * the DOM.
 */
import { execFileSync } from "node:child_process";
import { expect, type Page, test } from "./fixtures.js";
import { gotoDashboard, pinDirectory } from "./helpers/index.js";
import { DASHBOARD_PORT } from "./lifecycle.js";

const RUN = Date.now().toString(36);

/** Resolve the harness container by the dashboard port it publishes. */
function harnessContainer(): string {
  const out = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  const name = out.split("\n").filter(Boolean)[0];
  if (!name) throw new Error(`no harness container on port ${DASHBOARD_PORT}`);
  return name;
}

/** Run a shell snippet inside the harness container (out-of-band mutation). */
function dsh(cmd: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", cmd], {
    encoding: "utf8",
  });
}

const SUPER = `/fixtures/subsuper-${RUN}`;
const SUB = `${SUPER}/models/sub`;

test.beforeAll(() => {
  dsh(`
    set -e
    mkdir -p /fixtures
    rm -rf '${SUPER}'
    mkdir -p '${SUPER}'
    cd '${SUPER}'
    git -c init.defaultBranch=main init -q super
    cd super
    git config user.email qa@test.com
    git config user.name QA
    echo super > super.txt
    git add . && git commit -qm super-seed
    git -c protocol.file.allow=always submodule add -q /fixtures/sample-git models/sub
    git commit -qm "add submodule"
    mkdir -p '${SUB}/.pi'
    cat > '${SUB}/.pi/settings.json' <<'EOF'
{ "worktreeInit": { "gate": "file-exists README.md", "run": { "type": "script", "command": ":" } } }
EOF
  `);
});

test.afterAll(() => {
  dsh(`rm -rf '${SUPER}' || true`);
});

interface InitStatus {
  success?: boolean;
  data?: { hasHook?: boolean; trusted?: boolean; needsInit?: boolean };
}

async function initStatus(page: Page, cwd: string): Promise<InitStatus> {
  return page.evaluate(async (c) => {
    const res = await fetch(`/api/git/worktree/init-status?cwd=${encodeURIComponent(c)}`);
    return res.json();
  }, cwd);
}

test("F6: a submodule checkout with a declared hook reports the hook — never the setup banner", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoDashboard(page);
  await pinDirectory(page, SUB);

  // API: the config root resolves to the SUBMODULE tree — the declared hook
  // is found (and TOFU-untrusted, never executed).
  const status = await initStatus(page, SUB);
  expect(status.success).toBe(true);
  expect(status.data?.hasHook).toBe(true);
  expect(status.data?.trusted).toBe(false);

  // DOM: the "Not a pi project yet — Set up" banner is ABSENT for the
  // submodule, and the declared hook is reported via the re-trust rung.
  await expect(page.locator(`[data-testid^="folder-banner-setup-"]`)).toHaveCount(0);
  await expect(page.locator(`[data-testid="folder-banner-retrust-${SUB}"]`)).toBeVisible();
});
