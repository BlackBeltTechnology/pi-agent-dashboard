/**
 * Regression test: the local `registry.rescan(...)` call in
 * `packages/server/src/cli.ts` was removed and ownership of the
 * post-install rescan moved to the centralized
 * `bootstrapState.subscribe` hook in `server.ts`.
 *
 * This test reads `cli.ts` as text and asserts no direct rescan call
 * remains, plus a forwarding comment is present.
 *
 * See change: fix-openspec-buttons-after-bootstrap-install.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.resolve(here, "..", "cli.ts");

describe("cli.ts post-install rescan ownership", () => {
  const source = readFileSync(cliPath, "utf8");

  it("does not contain a direct registry.rescan(...) call", () => {
    // Allow comments mentioning rescan, but disallow real call expressions.
    // Strip line comments and block comments first.
    const stripped = source
      .replace(/\/\/[^\n]*/g, "")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    expect(stripped).not.toMatch(/\.rescan\s*\(/);
    expect(stripped).not.toMatch(/\bRescannable\b/);
  });

  it("contains a comment forwarding to the centralized server.ts hook", () => {
    expect(source).toMatch(/fix-openspec-buttons-after-bootstrap-install/);
  });
});
