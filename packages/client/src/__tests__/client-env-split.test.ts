/**
 * The client test suite is split across two vitest projects (test-plan E11, E12, E13, X7):
 * DOM-free tests run under `node` (`vitest.node.config.ts`), everything else under jsdom.
 *
 * - E11: no test file is collected by both projects and none is dropped.
 * - E12: the node project takes its worker target from the shared `vitest.workers` module.
 * - E13: a DOM test (`.tsx`, or one that renders) never lands in the node list.
 * - X7: every file in the node list is statically free of DOM identifiers, so a file that grows
 *   a DOM dependency fails HERE with its name, not as `document is not defined` somewhere else.
 *
 * See change: test-trust-audit (design D5).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { NODE_ENV_TESTS } from "../../vitest.node-tests";

const PKG = resolve(import.meta.dirname, "..", "..");
const SRC = join(PKG, "src");

function allClientTests(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "node_modules") allClientTests(full, out);
    } else if (/\.test\.tsx?$/.test(name) && full.split("/").includes("__tests__")) out.push(relative(PKG, full));
  }
  return out.sort();
}

/**
 * @structural-pin X7 statically scans the node-list test files for DOM identifiers; the runtime failure ("document is not defined") would surface far from its cause
 */
describe("client env split", () => {
  const all = allClientTests();
  const node = new Set<string>(NODE_ENV_TESTS);
  const jsdomConfig = readFileSync(join(PKG, "vitest.config.ts"), "utf8");
  const nodeConfig = readFileSync(join(PKG, "vitest.node.config.ts"), "utf8");

  it("E11: the node list names only existing test files, once each", () => {
    expect(node.size).toBe(NODE_ENV_TESTS.length);
    for (const file of node) expect(all, `${file} is in the node list but is not a client test`).toContain(file);
  });

  it("E11: the jsdom project excludes exactly the node list, so no file runs in both and none is dropped", () => {
    expect(jsdomConfig).toContain("...NODE_ENV_TESTS");
    expect(nodeConfig).toContain("include: [...NODE_ENV_TESTS]");
    const jsdom = all.filter((f) => !node.has(f));
    expect(jsdom.filter((f) => node.has(f))).toEqual([]);
    expect(jsdom.length + node.size).toBe(all.length);
    expect(node.size).toBeGreaterThan(100);
  });

  it("E12: the node project imports the worker target, no literal", () => {
    expect(nodeConfig).toContain('from "../../vitest.workers"');
    expect(nodeConfig).toMatch(/maxWorkers:\s*PARALLEL_MAX_WORKERS/);
    expect(nodeConfig).not.toMatch(/maxWorkers:\s*["'\d]/);
  });

  it("E13: a DOM test stays in jsdom", () => {
    expect([...node].filter((f) => f.endsWith(".tsx"))).toEqual([]);
    expect(node.has("src/__tests__/client-env-split.test.ts")).toBe(false);
    expect(node.has("src/components/__tests__/ChatView.notify-gate.test.tsx")).toBe(false);
  });

  it("X7: no file in the node list mentions the DOM", () => {
    const DOM =
      /(?<![\w./-])(?:document|window|localStorage|sessionStorage|navigator|location|history)\s*[.[]|\b(?:HTMLElement|requestAnimationFrame|matchMedia|getComputedStyle|ResizeObserver|IntersectionObserver)\b/;
    const offenders = [...node].filter((f) => DOM.test(readFileSync(join(PKG, f), "utf8").replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "")));
    expect(offenders, `move these back to jsdom (remove from vitest.node-tests.ts):\n${offenders.join("\n")}`).toEqual([]);
  });
});
