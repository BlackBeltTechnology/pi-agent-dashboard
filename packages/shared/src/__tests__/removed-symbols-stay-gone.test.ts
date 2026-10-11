/**
 * "Stays gone" guards for deleted protocol types and jiti/loader resolver
 * symbols (test-plan #E12, #E13).
 *
 * See change: cleanup-post-r3-spec-drift.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");

/** `git grep` stdout; exit 1 means "no match" and yields "". */
function gitGrep(args: string[]): string {
  try {
    return execFileSync("git", ["grep", ...args], { cwd: REPO_ROOT, encoding: "utf8" });
  } catch (err) {
    if ((err as { status?: number }).status === 1) return "";
    throw err;
  }
}

const EXCLUDES = [":!packages/**/dist/**", ":!packages/**/out/**", ":!packages/electron/resources/**"];

describe("removed protocol types stay gone (E13)", () => {
  it("browser-protocol.ts has no bootstrap_* messages or BootstrapStateSnapshot", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "packages", "shared", "src", "browser-protocol.ts"), "utf8");
    expect(src).not.toContain("bootstrap_status_update");
    expect(src).not.toContain("bootstrap_ticket_complete");
    expect(src).not.toContain("BootstrapStateSnapshot");
  });
});

describe("removed jiti resolver symbols stay gone (E12)", () => {
  it("no call-shaped mention of the deleted resolve-jiti functions", () => {
    const out = gitGrep([
      "-nwE",
      "(resolveJitiImport|resolveJitiFromAnchor|resolveJitiFromPi|pickJitiRegisterUrl|pickJitiFromAnchor|buildJitiRegisterUrl)[[:space:]]*\\(",
      "--",
      "packages/",
      ...EXCLUDES,
      // this guard names the symbols in its own pattern
      ":!packages/shared/src/__tests__/removed-symbols-stay-gone.test.ts",
    ]);
    expect(out).toBe("");
  });

  it("no ts-loader-resolver reference in packages/**/*.ts", () => {
    const out = gitGrep([
      "-n",
      "ts-loader-resolver",
      "--",
      "packages/**/*.ts",
      ...EXCLUDES,
      ":!packages/shared/src/__tests__/removed-symbols-stay-gone.test.ts",
    ]);
    expect(out).toBe("");
  });
});
