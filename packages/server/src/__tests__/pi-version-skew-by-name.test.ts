/**
 * E15 — the by-name pi version probe in `readCurrentPiVersion` is
 * earendil-only: a resolvable legacy fork is never asked for.
 * See change: drop-mariozechner-pi-fork (test-plan #E15).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ToolRegistry } from "@blackbelt-technology/pi-dashboard-shared/tool-registry/index.js";
import { describe, expect, it, vi } from "vitest";

const resolveCalls: string[] = [];
let forkManifest = "";

vi.mock("node:module", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:module")>();
  return {
    ...actual,
    createRequire: () => {
      const req = ((id: string) => {
        throw new Error(`unexpected require(${id})`);
      }) as unknown as NodeJS.Require;
      req.resolve = ((specifier: string) => {
        resolveCalls.push(specifier);
        if (specifier === "@mariozechner/pi-coding-agent/package.json") return forkManifest;
        throw Object.assign(new Error(`Cannot find module '${specifier}'`), { code: "MODULE_NOT_FOUND" });
      }) as NodeJS.RequireResolve;
      return req;
    },
  };
});

describe("readCurrentPiVersion by-name probe (E15)", () => {
  it("ignores a resolvable legacy fork and never requests an @mariozechner specifier", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skew-byname-"));
    forkManifest = path.join(dir, "package.json");
    fs.writeFileSync(forkManifest, JSON.stringify({ name: "@mariozechner/pi-coding-agent", version: "0.69.0" }));
    const registry = {
      resolve: (name: string) => ({ ok: false, name, tried: [], resolvedAt: Date.now() }),
    } as unknown as ToolRegistry;

    const { readCurrentPiVersion } = await import("../pi/pi-version-skew.js");
    expect(readCurrentPiVersion(registry)).toBeUndefined();
    expect(resolveCalls.some((s) => s.includes("@mariozechner"))).toBe(false);
  });
});
