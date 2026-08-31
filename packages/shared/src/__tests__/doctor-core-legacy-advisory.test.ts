/**
 * Legacy `~/.pi-dashboard/` advisory — the orphan-test decision table
 * (test-plan E8 / task 9.8) exercised END-TO-END: real tmp-dir HOME
 * fixtures, the real `detectLegacyManagedDir` detector, and the Doctor row
 * emitted by `runSharedChecks(...)`.
 *
 * Contract (spec doctor-diagnostic, "Legacy `~/.pi-dashboard/` advisory
 * only when the directory exists"):
 *   - genuinely orphaned dir  → exactly ONE warning row: path + "Safe to
 *     delete manually" + total size in MB + manual-deletion suggestion
 *   - dir with ANY live content (node/ runtime, wizard state, non-empty
 *     node_modules/, doctor.log/server.log) → row names the consumers and
 *     NO row anywhere in the report suggests deletion
 *   - absent dir → no "Legacy install directory" row AND no "Managed
 *     install (~/.pi-dashboard)" row (obsolete name stays gone)
 *
 * See change: unify-pi-runtime-identity (task 6.2 / test-plan E8).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type DoctorCheck,
  runSharedChecks,
  type SharedChecksDeps,
} from "../doctor-core.js";
import { detectLegacyManagedDir } from "../legacy-managed-dir.js";

const ROW = "Legacy install directory";
const STALE_ROW = "Managed install (~/.pi-dashboard)";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "doctor-legacy-advisory-"));
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

function baseDeps(overrides: Partial<SharedChecksDeps> = {}): SharedChecksDeps {
  return {
    managedDir: os.tmpdir(),
    detectSystemNode: () => ({ found: true, path: "/usr/bin/node" }),
    detectPi: () => ({ found: true, path: "/usr/bin/pi", source: "system" }),
    detectOpenSpec: () => ({ found: true, path: "/usr/bin/openspec", source: "system" }),
    dnsLookup: async () => undefined,
    // Real detector against the ephemeral HOME — exercises both the
    // detector's orphan test and the row mapping in one pass.
    detectLegacyManagedDir: () => detectLegacyManagedDir({ homedir: tmpHome }),
    ...overrides,
  };
}

function legacyDir(): string {
  return path.join(tmpHome, ".pi-dashboard");
}

function rows(checks: DoctorCheck[], name: string): DoctorCheck[] {
  return checks.filter((c) => c.name === name);
}

/** No row anywhere in the report suggests deleting the legacy dir. */
function noDeleteAdvice(checks: DoctorCheck[]): void {
  for (const c of checks) {
    expect(`${c.message}\n${c.detail ?? ""}\n${c.suggestion ?? ""}`, `row ${c.name}`).not.toContain(
      "Safe to delete",
    );
    expect(`${c.message}\n${c.detail ?? ""}\n${c.suggestion ?? ""}`, `row ${c.name}`).not.toMatch(
      /delete .*\.pi-dashboard|rm -rf/i,
    );
  }
}

describe("legacy ~/.pi-dashboard orphan decision table (test-plan E8)", () => {
  it("genuinely orphaned dir → exactly one warning row with delete advice + size", async () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "stale.bin"), Buffer.alloc(1024 * 1024));

    const checks = await runSharedChecks(baseDeps());
    const found = rows(checks, ROW);
    expect(found).toHaveLength(1);
    const row = found[0]!;
    expect(row.status).toBe("warning");
    expect(row.section).toBe("diagnostics");
    expect(row.message).toContain(legacyDir());
    expect(row.message).toContain("Safe to delete manually");
    expect(row.detail).toContain("MB");
    expect(row.suggestion).toContain("Delete it manually");
    expect(row.suggestion).toContain(`rm -rf ${legacyDir()}`);
  });

  it("logs-only dir → row names logs, never suggests deletion", async () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "doctor.log"), "{}\n");
    fs.writeFileSync(path.join(legacyDir(), "server.log"), "line\n");

    const checks = await runSharedChecks(baseDeps());
    const found = rows(checks, ROW);
    expect(found).toHaveLength(1);
    expect(found[0]!.status).toBe("ok");
    expect(found[0]!.detail).toContain("doctor.log");
    expect(found[0]!.detail).toContain("server.log");
    noDeleteAdvice(checks);
  });

  it("wizard-state-only dir → row names wizard state, never suggests deletion", async () => {
    fs.mkdirSync(legacyDir(), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "dashboard-settings.json"), "{}");
    fs.writeFileSync(path.join(legacyDir(), "recommended.json"), "{}");

    const checks = await runSharedChecks(baseDeps());
    const found = rows(checks, ROW);
    expect(found).toHaveLength(1);
    expect(found[0]!.status).toBe("ok");
    expect(found[0]!.detail).toContain("wizard state");
    noDeleteAdvice(checks);
  });

  it("node/-only dir → row names the managed runtime, never suggests deletion", async () => {
    fs.mkdirSync(path.join(legacyDir(), "node", "bin"), { recursive: true });
    fs.writeFileSync(path.join(legacyDir(), "node", "bin", "node"), "binary");

    const checks = await runSharedChecks(baseDeps());
    const found = rows(checks, ROW);
    expect(found).toHaveLength(1);
    expect(found[0]!.status).toBe("ok");
    expect(found[0]!.detail).toContain("managed Node runtime");
    noDeleteAdvice(checks);
  });

  it("node_modules-only dir → row names node_modules, never suggests deletion", async () => {
    fs.mkdirSync(path.join(legacyDir(), "node_modules", "pi"), { recursive: true });

    const checks = await runSharedChecks(baseDeps());
    const found = rows(checks, ROW);
    expect(found).toHaveLength(1);
    expect(found[0]!.status).toBe("ok");
    expect(found[0]!.detail).toContain("node_modules");
    noDeleteAdvice(checks);
  });

  it("absent dir → no legacy row and no obsolete Managed install row", async () => {
    const checks = await runSharedChecks(baseDeps());
    expect(rows(checks, ROW)).toHaveLength(0);
    // Sanity: the deleted stale row stays gone (clean installs see no
    // ~/.pi-dashboard reference at all).
    expect(rows(checks, STALE_ROW)).toHaveLength(0);
    for (const c of checks) {
      expect(`${c.name} ${c.message}`).not.toContain(".pi-dashboard");
    }
  });
});
