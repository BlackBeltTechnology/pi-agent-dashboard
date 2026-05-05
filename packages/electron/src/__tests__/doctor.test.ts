/**
 * Lock the legacy plain-text formatter signature + bytes so downstream
 * scripted callers (none in-tree today) keep working.
 * See change: doctor-rich-output (task 2.7).
 */
import { describe, it, expect } from "vitest";
import { formatDoctorReport } from "../lib/doctor.js";
import type { DoctorReport } from "@blackbelt-technology/pi-dashboard-shared/doctor-core.js";

describe("formatDoctorReport (plain-text)", () => {
  it("matches the legacy snapshot for a representative mixed report", () => {
    const report: DoctorReport = {
      checks: [
        { name: "Electron", section: "runtime", status: "ok", message: "v40 (Chromium 130)" },
        {
          name: "pi CLI",
          section: "pi-tooling",
          status: "error",
          message: "Not found — required to run agent sessions",
          detail: "Searched system PATH and managed install",
          fixable: true,
        },
        {
          name: "openspec CLI",
          section: "pi-tooling",
          status: "warning",
          message: "Not found — optional, needed for OpenSpec workflows",
        },
      ],
      summary: { ok: 1, warnings: 1, errors: 1 },
    };
    expect(formatDoctorReport(report)).toMatchInlineSnapshot(`
      "PI Dashboard Doctor
      ══════════════════════════════════════════════════

        ✓ Electron
          v40 (Chromium 130)
        ✗ pi CLI [fixable]
          Not found — required to run agent sessions
          Searched system PATH and managed install
        ⚠ openspec CLI
          Not found — optional, needed for OpenSpec workflows

      ──────────────────────────────────────────────────
        1 passed, 1 warnings, 1 errors

        1 error(s) can be fixed automatically.
        Run setup wizard to install missing components."
    `);
  });
});
