/**
 * Repo-lint — guards Phase 3.0.a/3.0.b of change:
 * eliminate-electron-runtime-install.
 *
 * Under R3, `packages/server/src/cli.ts::runForeground` MUST NOT reach into
 * any of the deleted bootstrap modules. The tool-registry resolve is the
 * sole point at which startup verifies pi is reachable; failure throws a
 * hard error citing a corrupted node_modules/ tree (no degraded mode).
 *
 * This test asserts the cli.ts source text contains:
 *   1. ZERO references to the deleted module names (`bootstrap-install`,
 *      `bootstrap-install-from-list`, `installable-list`, `bootstrap-state`,
 *      `bootstrap-queue`, `managed-workspace-materialize`,
 *      `defaultInstallableList`, `writeInstallableList`,
 *      `updateBootstrapCompatibility`, `BootstrapStateStore`).
 *   2. The `[bootstrap] ready` log line, proving the tool-registry
 *      resolve path is in place.
 *   3. The hard-throw branch citing a "corrupted node_modules" message.
 *
 * If you intentionally rename / move the resolve step, update this lint
 * to match — but reaching back into any of the forbidden symbols means
 * runtime install has crept back into the standalone arm.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_PATH = path.resolve(HERE, "..", "cli.ts");

const FORBIDDEN_SYMBOLS = [
  "bootstrap-install",
  "bootstrap-install-from-list",
  "installable-list",
  "bootstrap-state",
  "bootstrap-queue",
  "managed-workspace-materialize",
  "defaultInstallableList",
  "writeInstallableList",
  "updateBootstrapCompatibility",
  "BootstrapStateStore",
  "bootstrapInstall",
  "bootstrapInstallFromList",
  "runDegradedModeBootstrap",
  "maybeSeedDefaultInstallableList",
];

describe("cli.ts has no bootstrap-install references (Phase 3.0.b)", () => {
  it("does not reference any deleted bootstrap modules or symbols", () => {
    const src = fs.readFileSync(CLI_PATH, "utf-8");
    const offenders = FORBIDDEN_SYMBOLS.filter((sym) => src.includes(sym));
    expect(
      offenders,
      `cli.ts must not reference deleted bootstrap symbols under R3:\n  ${offenders.join(", ")}\n\nSee change: eliminate-electron-runtime-install (Phase 3.0).`,
    ).toEqual([]);
  });

  it("contains the [bootstrap] ready log line proving tool-registry resolve is wired", () => {
    const src = fs.readFileSync(CLI_PATH, "utf-8");
    expect(src).toContain("[bootstrap] ready (pi resolved via");
  });

  it("throws hard on pi resolution failure (no degraded mode)", () => {
    const src = fs.readFileSync(CLI_PATH, "utf-8");
    // The hard-throw branch in runForeground cites "corrupted node_modules".
    expect(src).toMatch(/corrupted node_modules/i);
  });
});
