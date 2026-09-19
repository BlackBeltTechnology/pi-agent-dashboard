/**
 * Shared glue for the folder-collapse L3 specs.
 *
 * Two capabilities the generic helpers do not cover:
 *
 *   1. SERVER-SIDE setup/teardown of the state under test. Collapse now lives in
 *      `preferences.json`, so it OUTLIVES the page, the context, and the spec
 *      file — every spec that collapses a folder must put it back, or the next
 *      spec in the shared container inherits a collapsed sidebar. Driving it
 *      over the browser bus (`set_folder_collapsed`, `pin_directory`) is
 *      idempotent, unlike the pin DIALOG, whose commit button is disabled for an
 *      already-pinned path.
 *   2. An "was it EVER rendered expanded" probe. The change's whole point is
 *      that a reload must not paint a collapsed folder expanded and then correct
 *      it, and a post-hoc DOM read cannot see a frame that has already been
 *      replaced. `armExpandedFrameWatch` installs a MutationObserver BEFORE any
 *      page script runs and counts every mount of `folder-body-<cwd>`, including
 *      one mounted and unmounted inside a single task.
 *
 * See change: persist-folder-collapse-server-side.
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { BrowserToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { connectBus, expect, type Page } from "../fixtures.js";
import { DASHBOARD_PORT } from "../lifecycle.js";

/** Send browser→server commands over the bus and close. */
export async function busSend(msgs: BrowserToServerMessage[]): Promise<void> {
  const client = await connectBus();
  try {
    for (const msg of msgs) client.send(msg);
    // The bus has no ack for these verbs; give the server a beat to apply them
    // before the socket closes. Callers still poll the observable they care
    // about, so this is a settle, not a synchronization point.
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    client.close();
  }
}

/** Set one folder's persisted collapse state without touching the UI. */
export async function setFolderCollapsedViaBus(path: string, collapsed: boolean): Promise<void> {
  await busSend([{ type: "set_folder_collapsed", path, collapsed }]);
}

/** Pin (idempotent) — the dialog is not, its commit is disabled when re-picking. */
export async function pinViaBus(path: string): Promise<void> {
  await busSend([{ type: "pin_directory", path }]);
}

export async function unpinViaBus(path: string): Promise<void> {
  await busSend([{ type: "unpin_directory", path }]);
}

/** 1 when `cwd`'s folder body is mounted (expanded), 0 when collapsed/absent. */
export async function folderBodyCount(page: Page, cwd: string): Promise<number> {
  return page.getByTestId(`folder-body-${cwd}`).count();
}

/** Click `cwd`'s header chevron and wait for the server echo to collapse it. */
export async function collapseFolderViaUi(page: Page, cwd: string): Promise<void> {
  await expect
    .poll(() => folderBodyCount(page, cwd), { timeout: 15_000, message: `${cwd} never rendered expanded` })
    .toBe(1);
  await page
    .locator('[data-testid="sortable-workspace-folder"], [data-testid="sortable-pinned-group"]')
    .filter({ has: page.getByTestId(`folder-home-row-${cwd}`) })
    .first()
    .getByTestId("folder-toggle-btn")
    .first()
    .click();
  // No optimistic mirror: the flip only happens once `collapsed_folders_updated`
  // lands, so this wait IS the round-trip assertion.
  await expect
    .poll(() => folderBodyCount(page, cwd), { timeout: 15_000, message: `${cwd} never collapsed after the toggle` })
    .toBe(0);
}

/**
 * Count every mount of `folder-body-<cwd>` from the very first frame of the next
 * navigation. Must be called BEFORE `goto`/`reload`.
 */
export async function armExpandedFrameWatch(page: Page, cwd: string): Promise<void> {
  await page.addInitScript((sel: string) => {
    const w = window as unknown as { __expandedFrames: number };
    w.__expandedFrames = 0;
    const hits = (n: Node): boolean =>
      n.nodeType === 1 &&
      (((n as Element).matches?.(sel) ?? false) || Boolean((n as Element).querySelector?.(sel)));
    // Records, not a post-hoc querySelector: a body mounted and unmounted inside
    // one task is exactly the "expanded-then-corrected" frame under test, and a
    // querySelector in the observer callback would already have missed it.
    new MutationObserver((records) => {
      for (const r of records) {
        for (const n of Array.from(r.addedNodes)) {
          if (hits(n)) {
            w.__expandedFrames++;
            return;
          }
        }
      }
    }).observe(document, { childList: true, subtree: true });
  }, `[data-testid="folder-body-${cwd}"]`);
}

/** How many times the watched folder body mounted since the last navigation. */
export async function expandedFrameCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __expandedFrames?: number }).__expandedFrames ?? -1);
}

/** The harness container, resolved by the dashboard port it publishes. */
export function harnessContainer(): string {
  // The port comes from PW_E2E_PORT (set by globalSetup) via lifecycle's
  // DASHBOARD_PORT. Reading `.pi-test-harness.json` from process.cwd() made
  // every folder-collapse test die with ENOENT on CI, where the state file
  // lives in the throwaway workspace, not the checkout.
  const name = execFileSync(
    "docker",
    ["ps", "--filter", `publish=${DASHBOARD_PORT}`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  )
    .split("\n")
    .map((s) => s.trim())
    .find(Boolean);
  if (!name) throw new Error(`no container publishing port ${DASHBOARD_PORT}`);
  return name;
}

/** Run a shell command INSIDE the harness container. */
export function inContainer(script: string): string {
  return execFileSync("docker", ["exec", harnessContainer(), "sh", "-c", script], { encoding: "utf8" });
}
