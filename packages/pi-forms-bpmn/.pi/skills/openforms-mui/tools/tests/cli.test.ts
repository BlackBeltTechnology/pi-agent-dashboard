import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const cli = join(root, "preview", "cli.ts");
const tsx = join(root, "node_modules", ".bin", "tsx");
const fixture = join(here, "fixtures", "all-field-types.json");

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(tsx, [cli, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { status: err.status ?? 1, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("CLI diagnose (task 8.1)", () => {
  it("reports no error findings for a clean fixture and exits 0", () => {
    const { status, stdout } = runCli(["diagnose", fixture]);
    expect(status).toBe(0);
    expect(stdout).not.toContain("[ERROR]");
  });

  it("exits non-zero when a schema has an error finding (duplicate key)", () => {
    const dir = mkdtempSync(join(tmpdir(), "ofm-"));
    const bad = join(dir, "bad.json");
    writeFileSync(
      bad,
      JSON.stringify({
        pages: [{ sections: [{ rows: [{ columns: [{ fields: [{ type: "text", key: "d" }, { type: "text", key: "d" }] }] }] }] }],
      }),
    );
    const { status, stdout } = runCli(["diagnose", bad]);
    expect(status).toBe(1);
    expect(stdout).toContain("duplicate-key");
  });

  it("reports invalid input clearly without a stack trace", () => {
    const dir = mkdtempSync(join(tmpdir(), "ofm-"));
    const bad = join(dir, "notjson.json");
    writeFileSync(bad, "{ not valid json");
    const { status, stderr } = runCli(["diagnose", bad]);
    expect(status).toBe(1);
    expect(stderr).toContain("not valid JSON");
    expect(stderr).not.toContain("at Object.");
  });
});

describe("reference renderer is excluded from the library (task 8.4)", () => {
  it("no src/ file loads the upstream renderer CDN", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(ts|tsx)$/.test(entry.name)) {
          const code = readFileSync(full, "utf8");
          // The provenance constant may NAME the CDN base; but no src file may
          // actually load renderer.js or reference the vanilla globals.
          if (/renderer\.js/.test(code) || /OpenFormRenderer/.test(code)) offenders.push(full);
        }
      }
    };
    walk(join(root, "src"));
    expect(offenders, offenders.join("\n")).toEqual([]);
  });
});
