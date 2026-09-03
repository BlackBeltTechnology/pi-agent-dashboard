/**
 * Repo-lint: dashboard plugins MUST NOT claim `command-route` for any
 * `/flows*` command. Flow operations in the dashboard are button-driven
 * (`SessionFlowActions`, `FlowDashboard` Abort, `FlowLaunchDialog`); the
 * pi-flows extension itself still registers the slash commands for TUI.
 *
 * See change: fix-pi-flows-end-to-end (Group 8, task 8.5).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// packages/shared/src/__tests__ → src → shared → packages.
// This was four levels (the repo root), whose only package.json carries no
// plugin manifest — so readPluginManifests() returned [] and this lint passed
// by checking nothing. See the non-vacuity test below.
const PACKAGES_DIR = path.resolve(__dirname, "..", "..", "..");

interface PluginClaim {
  slot?: string;
  command?: string;
  component?: string;
}

interface ManifestSlice {
  id?: string;
  claims?: PluginClaim[];
}

function readPluginManifests(): Array<{ pkg: string; manifest: ManifestSlice }> {
  const out: Array<{ pkg: string; manifest: ManifestSlice }> = [];
  for (const entry of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pkgJsonPath = path.join(PACKAGES_DIR, entry.name, "package.json");
    if (!fs.existsSync(pkgJsonPath)) continue;
    let raw: string;
    try {
      raw = fs.readFileSync(pkgJsonPath, "utf-8");
    } catch {
      continue;
    }
    let parsed: { "pi-dashboard-plugin"?: ManifestSlice };
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    const m = parsed["pi-dashboard-plugin"];
    if (m) out.push({ pkg: entry.name, manifest: m });
  }
  return out;
}

describe("repo-lint: no dashboard plugin claims command-route for /flows*", () => {
  it("actually discovers plugin manifests (guard is not vacuous)", () => {
    expect(readPluginManifests().length).toBeGreaterThan(5);
  });

  it("every monorepo plugin manifest is free of /flows* command-route claims", () => {
    const offenders: string[] = [];
    for (const { pkg, manifest } of readPluginManifests()) {
      for (const claim of manifest.claims ?? []) {
        if (claim.slot !== "command-route") continue;
        if (!claim.command || !claim.command.startsWith("/flows")) continue;
        offenders.push(`${pkg}: command "${claim.command}" → component "${claim.component ?? "?"}"`);
      }
    }
    if (offenders.length > 0) {
      throw new Error(
        `Found dashboard plugin command-route claims for /flows*:\n${offenders.map((o) => "  " + o).join("\n")}\n\n` +
          "Dashboard flow operations are button-driven (SessionFlowActions / FlowDashboard / FlowLaunchDialog). " +
          "pi-flows itself still registers /flows* commands for TUI use; the dashboard plugin manifest must not.",
      );
    }
    expect(offenders).toEqual([]);
  });
});
