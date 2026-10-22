/**
 * Test-plan #E10 — the documented `encodedCwd` shell one-liner produces exactly
 * what the client's `encodeFolderPath` does (base64url, UTF-8, no padding).
 * See change: add-session-ui-deep-links-for-agents.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REFERENCE = path.join(REPO_ROOT, "packages/extension/.pi/skills/pi-dashboard/references/api-reference.md");
const ONELINER = `printf %s "$CWD" | base64 | tr '+/' '-_' | tr -d '=\\n'`;

/** Same algorithm as packages/client/src/lib/util/folder-encoding.ts. */
function encodeFolderPath(cwd) {
  return Buffer.from(cwd, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("encodedCwd one-liner (E10)", () => {
  it("the reference documents exactly this one-liner", () => {
    expect(fs.readFileSync(REFERENCE, "utf8")).toContain(ONELINER);
  });

  it.each(["/Users/me/proj", "/home/münchen", "/a?>~", "/ab", "/abc"])("matches encodeFolderPath for %s", (cwd) => {
    const out = execFileSync("sh", ["-c", ONELINER], { env: { ...process.env, CWD: cwd }, encoding: "utf8" });
    expect(out).toBe(encodeFolderPath(cwd));
    expect(out).not.toMatch(/[=+/\n]/);
  });
});
