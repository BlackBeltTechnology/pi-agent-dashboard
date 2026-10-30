/**
 * A packaged bundle's synthetic `package.json#workspaces` (kept as `[]`) is the marker
 * `findMonorepoRoot` stops at. Without it the walk escapes `resources/server` and adopts
 * whatever checkout the packaged app happens to sit in (CI e2e runs the app from
 * `<checkout>/packages/electron/out/...`; a dev build does too) as the plugin workspace —
 * extra `demo` / `fixture-policy` plugins, and workspace copies shadowing the bundled ones.
 *
 * See change: slim-windows-install-file-count (design D2).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findMonorepoRoot } from "../loader.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** `<checkout>/packages/electron/out/app/resources/server` with a loader dir under node_modules. */
function packagedAppInsideCheckout(serverPkg: Record<string, unknown>): { checkout: string; server: string; loaderDir: string } {
  const checkout = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "monorepo-root-")));
  dirs.push(checkout);
  fs.writeFileSync(path.join(checkout, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  const server = path.join(checkout, "packages", "electron", "out", "app", "resources", "server");
  const loaderDir = path.join(server, "node_modules", "@blackbelt-technology", "pi-dashboard-dashboard-plugin-runtime", "src", "server");
  fs.mkdirSync(loaderDir, { recursive: true });
  fs.writeFileSync(path.join(server, "package.json"), JSON.stringify(serverPkg));
  return { checkout, server, loaderDir };
}

describe("findMonorepoRoot — bundled root marker", () => {
  it("stops at a bundle whose package.json carries `workspaces: []`, even inside a checkout", () => {
    const { server, loaderDir } = packagedAppInsideCheckout({ name: "pi-dashboard-bundled-server", workspaces: [] });
    expect(findMonorepoRoot(loaderDir)).toBe(server);
  });

  it("without the marker the walk escapes into the surrounding checkout (why the field is kept)", () => {
    const { checkout, loaderDir } = packagedAppInsideCheckout({ name: "pi-dashboard-bundled-server" });
    expect(findMonorepoRoot(loaderDir)).toBe(checkout);
  });
});
