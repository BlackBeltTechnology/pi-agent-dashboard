/**
 * Trusted Types policies are registered before the first render
 * (change: harden-client-sinks, test-plan #E26).
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/i18n/i18n.js", () => ({
  detectInitialLanguage: () => "en",
  loadCatalog: () => Promise.resolve(),
  t: (_k: string, _v: unknown, fallback?: string) => fallback ?? _k,
}));

import { bootClient } from "../lib/boot/client-boot.js";
import { __resetTrustedTypesForTests } from "../lib/security/trusted-types.js";

afterEach(() => {
  __resetTrustedTypesForTests();
  document.head.querySelector('meta[name="pi-trusted-types"]')?.remove();
  vi.unstubAllGlobals();
});

describe("client boot order (#E26)", () => {
  it("named policies and exactly one default exist before render", async () => {
    const meta = document.createElement("meta");
    meta.setAttribute("name", "pi-trusted-types");
    meta.setAttribute("content", "report");
    document.head.append(meta);
    const order: string[] = [];
    vi.stubGlobal("trustedTypes", {
      createPolicy: (name: string, rules: Record<string, (s: string) => unknown>) => {
        order.push(`policy:${name}`);
        return {
          createHTML: (s: string) => rules.createHTML?.(s),
          createScriptURL: (s: string) => rules.createScriptURL?.(s),
        };
      },
    });
    await bootClient(() => order.push("render"));
    const renderAt = order.indexOf("render");
    expect(renderAt).toBe(order.length - 1);
    const before = order.slice(0, renderAt);
    expect(before).toEqual(expect.arrayContaining(["policy:pi-sanitized-html", "policy:pi-worker-url"]));
    expect(before.filter((p) => p === "policy:default")).toHaveLength(1);
  });

  /** @structural-pin main.tsx renders on import; its wiring is checked in its text */
  it("main.tsx installs Trusted Types first and mounts through bootClient", () => {
    const main = fs.readFileSync(path.resolve(__dirname, "../main.tsx"), "utf-8");
    const install = main.indexOf("installTrustedTypes();");
    expect(install).toBeGreaterThan(-1);
    expect(install).toBeLessThan(main.indexOf("installFetchWrappers();"));
    expect(main).toMatch(/bootClient\(\(\) => \{\s*ReactDOM\.createRoot/);
    expect(main).not.toMatch(/serviceWorker\.register\("\/sw\.js"\)/);
  });
});
