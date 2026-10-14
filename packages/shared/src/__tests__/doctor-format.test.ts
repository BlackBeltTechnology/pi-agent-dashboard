/**
 * Doctor markdown formatter — section ordering, escaping, remediation list.
 * See change: doctor-rich-output (design.md Decision 8).
 */
import { describe, it, expect } from "vitest";
import {
  formatDoctorReportMarkdown,
  formatDoctorReportPlain,
  type DoctorReport,
  type DoctorCheck,
} from "../doctor-core.js";

function mkReport(checks: DoctorCheck[]): DoctorReport {
  const summary = {
    ok: checks.filter((c) => c.status === "ok").length,
    warnings: checks.filter((c) => c.status === "warning").length,
    errors: checks.filter((c) => c.status === "error").length,
  };
  return { checks, summary };
}

describe("formatDoctorReportMarkdown", () => {
  it("emits one table per non-empty section in fixed order", () => {
    const report = mkReport([
      { name: "API key", section: "setup", status: "ok", message: "Configured" },
      { name: "pi CLI", section: "pi-tooling", status: "ok", message: "v1" },
      { name: "Electron", section: "runtime", status: "ok", message: "v40" },
      { name: "zrok binary", section: "tunnel", status: "ok", message: "found" },
      {
        name: "Legacy install directory",
        section: "diagnostics",
        status: "ok",
        message: "fine",
      },
    ]);
    const md = formatDoctorReportMarkdown(report);
    const runtimeIdx = md.indexOf("## Runtime");
    const piIdx = md.indexOf("## PI Tooling");
    const tunnelIdx = md.indexOf("## Tunnel");
    const setupIdx = md.indexOf("## Setup");
    const diagIdx = md.indexOf("## Diagnostics");
    // Server section absent — skipped silently.
    expect(md.includes("## Server")).toBe(false);
    expect(runtimeIdx).toBeGreaterThan(0);
    expect(runtimeIdx).toBeLessThan(piIdx);
    expect(piIdx).toBeLessThan(tunnelIdx);
    expect(tunnelIdx).toBeLessThan(setupIdx);
    expect(setupIdx).toBeLessThan(diagIdx);
  });

  it("includes summary line", () => {
    const report = mkReport([
      { name: "Electron", section: "runtime", status: "ok", message: "v40" },
      { name: "pi CLI", section: "pi-tooling", status: "error", message: "missing", detail: "x" },
    ]);
    const md = formatDoctorReportMarkdown(report);
    expect(md).toMatch(/Summary:.*1 ok.*0 warning.*1 error/);
  });

  it("omits the Remediation section when all rows are ok", () => {
    const report = mkReport([{ name: "Electron", section: "runtime", status: "ok", message: "v40" }]);
    const md = formatDoctorReportMarkdown(report);
    expect(md.includes("## Remediation")).toBe(false);
  });

  it("renders Remediation bullets for non-ok rows with suggestions", () => {
    const report = mkReport([
      {
        name: "pi CLI",
        section: "pi-tooling",
        status: "error",
        message: "Not found",
        detail: "PATH searched",
        suggestion: "Run setup wizard.",
      },
    ]);
    const md = formatDoctorReportMarkdown(report);
    expect(md).toContain("## Remediation");
    expect(md).toContain("- **pi CLI** — Run setup wizard.");
  });

  it("escapes pipe / newline / backtick in detail so the table column count is preserved", () => {
    const detail = "line1 | with pipe\nline2 with `backtick`";
    const report = mkReport([
      {
        name: "Server launch test",
        section: "server",
        status: "error",
        message: "boom",
        detail,
      },
    ]);
    const md = formatDoctorReportMarkdown(report);
    // Find the row line in the output. Each row must have exactly 4 separators
    // outside the leading/trailing ones — i.e. the row should start with `| `
    // and contain exactly 5 `|` characters.
    const tableRow = md
      .split("\n")
      .find((l) => l.startsWith("| ") && l.includes("Server launch test"));
    expect(tableRow).toBeDefined();
    // A 4-column row has 5 unescaped pipes. Count unescaped pipes.
    const unescaped = tableRow!
      .split("")
      .reduce(
        (acc, ch, i, arr) =>
          ch === "|" && arr[i - 1] !== "\\" ? acc + 1 : acc,
        0,
      );
    expect(unescaped).toBe(5);
    // No literal newline inside the cell.
    expect(tableRow!.includes("\n")).toBe(false);
  });
});

describe("formatDoctorReportMarkdown: name and message cell escaping (fix-codeql-small-findings #E7)", () => {
  it("emits the fixture-D cells and keeps every row on one line", () => {
    const report = mkReport([
      { name: "c1", section: "runtime", status: "ok", message: "a\\|b" },
      { name: "c2", section: "runtime", status: "ok", message: "C:\\path\\" },
      { name: "ABI mismatch: a|b\\", section: "runtime", status: "ok", message: "m" },
      { name: "c4", section: "runtime", status: "ok", message: "line1\nline2" },
      { name: "c5", section: "runtime", status: "ok", message: "line1\rline2" },
    ]);
    const md = formatDoctorReportMarkdown(report);
    expect(md).not.toContain("\r");
    expect(md).toContain("| c1 | a\\\\\\|b |");
    expect(md).toContain("| c2 | C:\\\\path\\\\ |");
    expect(md).toContain("| ABI mismatch: a\\|b\\\\ | m |");
    expect(md).toContain("| c4 | line1 line2 |");
    expect(md).toContain("| c5 | line1 line2 |");
    const rows = md.split("\n").filter((l) => l.startsWith("| ") && !l.startsWith("| Status") && !l.startsWith("| ---"));
    expect(rows).toHaveLength(5);
  });
});

describe("formatDoctorReportPlain (legacy)", () => {
  it("contains the canonical header and summary footer", () => {
    const report = mkReport([
      { name: "Electron", section: "runtime", status: "ok", message: "v40" },
    ]);
    const out = formatDoctorReportPlain(report);
    expect(out).toContain("PI Dashboard Doctor");
    expect(out).toContain("1 passed, 0 warnings, 0 errors");
  });
});
