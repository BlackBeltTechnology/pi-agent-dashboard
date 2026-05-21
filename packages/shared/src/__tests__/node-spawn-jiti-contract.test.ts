/**
 * Pin the jiti behavioural contract for `shouldUrlWrapEntry()`.
 *
 * History
 * -------
 * Earlier versions of this contract attempted to pin a "verified-good"
 * jiti version that correctly normalised `file:///` triple-slash URL
 * entries on Windows. Live testing on Windows 11 + Node 22.18.0 + jiti
 * 2.7.0 (shipped under `@earendil-works/pi-coding-agent@0.74.x`) showed
 * that jiti still misnormalises those URLs:
 *
 *     Error: Cannot find module
 *       'file:///C:/pi-dash-app/file:/C:/pi-dash-app/.../cli.ts'
 *
 * The triple-slash entry is rewritten to single-slash and then resolved
 * against cwd as if it were a relative specifier. Rather than chase
 * jiti versions, the contract now requires raw entry paths whenever
 * the loader is jiti, on every OS. Node's drive-letter heuristic
 * accepts raw `C:\…` argv entries directly, which covers the common
 * standalone-install layout where pi + the dashboard sit under
 * `C:\Users\<u>\.pi-dashboard\…`.
 *
 * This test ensures:
 *   1. `shouldUrlWrapEntry` returns `false` for jiti loaders on every
 *      platform (POSIX + win32). Locks the behavioural rule against
 *      regression.
 *   2. The `shouldUrlWrapEntry` source comment still documents the
 *      Windows breakage so future contributors discover the constraint.
 *
 * See change: fix-windows-standalone-spawn.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { shouldUrlWrapEntry, isJitiLoader } from "../platform/node-spawn.js";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const NODE_SPAWN_PATH = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "src",
  "platform",
  "node-spawn.ts",
);

describe("jiti behavioural contract for shouldUrlWrapEntry", () => {
  it("jiti loader → entry passed RAW on every platform", () => {
    const jitiLoader =
      "file:///C:/Users/x/.pi-dashboard/node_modules/@earendil-works/pi-coding-agent/node_modules/jiti/lib/jiti-register.mjs";
    expect(isJitiLoader(jitiLoader)).toBe(true);
    expect(shouldUrlWrapEntry(jitiLoader, "win32")).toBe(false);
    expect(shouldUrlWrapEntry(jitiLoader, "linux")).toBe(false);
    expect(shouldUrlWrapEntry(jitiLoader, "darwin")).toBe(false);
  });

  it("tsx loader → entry passed RAW on every platform (unchanged)", () => {
    const tsxLoader = "file:///home/u/node_modules/tsx/dist/esm/index.mjs";
    expect(shouldUrlWrapEntry(tsxLoader, "win32")).toBe(false);
    expect(shouldUrlWrapEntry(tsxLoader, "linux")).toBe(false);
  });

  it("node-spawn.ts source documents the Windows jiti breakage", () => {
    const source = fs.readFileSync(NODE_SPAWN_PATH, "utf8");

    expect(source).toContain("JITI VERSION CONTRACT");
    // Documented Windows-breakage marker. The original error signature
    // (single-slash file:/<cwd>/file:/…) is the cheapest fingerprint
    // for a contributor matching a new repro to this contract.
    const hasBreakageMarker =
      /file:\/{1,3}.*file:\//.test(source) ||
      /misnormali[sz]e/i.test(source);
    if (!hasBreakageMarker) {
      throw new Error(
        "shouldUrlWrapEntry() docstring is missing the Windows-breakage marker. " +
          "It must mention either the `file:/<cwd>/file:/…` error signature " +
          "or the word 'misnormalise'. See change: fix-windows-standalone-spawn.",
      );
    }

    // Remediation guidance markers (at least one).
    const hasRemediationGuidance =
      /re-verify/i.test(source) ||
      /per-version branch/i.test(source) ||
      /per-jiti-version/i.test(source);
    if (!hasRemediationGuidance) {
      throw new Error(
        "shouldUrlWrapEntry() docstring is missing remediation guidance. " +
          "It must mention at least one of: re-verify, per-version branch. " +
          "See change: fix-windows-standalone-spawn.",
      );
    }
  });
});
