/**
 * Pin Defect 2's jiti version contract for `shouldUrlWrapEntry()`.
 *
 * The Windows-non-tsx arm in `platform/node-spawn.ts::shouldUrlWrapEntry`
 * assumes the jiti loader is from `@mariozechner/pi-coding-agent@0.70.x`
 * (jiti 2.x with the file:// URL handling fix). Newer pi versions ship
 * a different jiti that breaks this contract.
 *
 * This test ensures:
 *   1. The offline-cacache pin in `packages/electron/offline-packages.json`
 *      stays at `0.70.x` (the supported range). A bump elsewhere fires
 *      this test and forces the contributor to either:
 *        - re-verify the contract on Windows
 *        - add a per-jiti-version branch
 *        - switch the bundled loader to tsx
 *   2. The `shouldUrlWrapEntry` header comment documents the contract
 *      so future contributors discover the constraint at the call site.
 *
 * See change: fix-electron-windows-installer-and-server-bootstrap (Defect 2).
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const OFFLINE_PACKAGES_PATH = path.join(
  REPO_ROOT,
  "packages",
  "electron",
  "offline-packages.json",
);
const NODE_SPAWN_PATH = path.join(
  REPO_ROOT,
  "packages",
  "shared",
  "src",
  "platform",
  "node-spawn.ts",
);

describe("jiti version contract for shouldUrlWrapEntry", () => {
  it("offline-packages.json pins @mariozechner/pi-coding-agent at a 0.70.x version", () => {
    const raw = fs.readFileSync(OFFLINE_PACKAGES_PATH, "utf8");
    const manifest = JSON.parse(raw) as {
      packages: { name: string; version: string }[];
    };
    const piEntry = manifest.packages.find(
      (p) => p.name === "@mariozechner/pi-coding-agent",
    );
    if (!piEntry) {
      throw new Error(
        "@mariozechner/pi-coding-agent not found in offline-packages.json. " +
          "The offline cacache must include pi-coding-agent. " +
          "See change: fix-electron-windows-installer-and-server-bootstrap (Defect 2).",
      );
    }
    if (!piEntry.version.startsWith("0.70.")) {
      throw new Error(
        `pi-coding-agent pinned at ${piEntry.version}, but ` +
          `shouldUrlWrapEntry()'s Windows-non-tsx arm only supports 0.70.x. ` +
          `Newer jiti versions (e.g. 2.6.5 in pi 0.71.x) misnormalize ` +
          `file:/// URL entries on Windows. Either re-verify the contract, ` +
          `add a per-jiti-version branch in shouldUrlWrapEntry(), or switch ` +
          `the bundled loader to tsx. See change: ` +
          `fix-electron-windows-installer-and-server-bootstrap (Defect 2).`,
      );
    }
    expect(piEntry.version).toMatch(/^0\.70\./);
  });

  it("node-spawn.ts source contains the documented JITI VERSION CONTRACT block", () => {
    const source = fs.readFileSync(NODE_SPAWN_PATH, "utf8");

    // Contract block markers
    expect(source).toContain("JITI VERSION CONTRACT");
    expect(source).toContain("0.70.x");

    // Version drift markers (at least one of these identifies the broken jiti)
    const hasVersionDriftMarker =
      source.includes("0.71") || source.includes("2.6.5");
    if (!hasVersionDriftMarker) {
      throw new Error(
        "shouldUrlWrapEntry() docstring is missing the version-drift marker. " +
          "It must mention either '0.71' or '2.6.5' so contributors can " +
          "identify the known-broken jiti versions. See change: " +
          "fix-electron-windows-installer-and-server-bootstrap (Defect 2).",
      );
    }

    // Remediation guidance markers (at least one)
    const hasRemediationGuidance =
      /re-verify/i.test(source) ||
      /per-version branch/i.test(source) ||
      /per-jiti-version/i.test(source) ||
      /switch.*to tsx/i.test(source);
    if (!hasRemediationGuidance) {
      throw new Error(
        "shouldUrlWrapEntry() docstring is missing remediation guidance. " +
          "It must mention at least one of: re-verify, per-version branch, " +
          "or switch to tsx. See change: " +
          "fix-electron-windows-installer-and-server-bootstrap (Defect 2).",
      );
    }
  });
});
