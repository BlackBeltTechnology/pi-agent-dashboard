/**
 * Template listing cost (test-plan P4): 200 templates of 1-64 KiB, cold vs warm cache over 50 listings; an
 * untrusted project with 10 000 files lists stems without reading a single body.
 * See change: add-agent-teams-templates-hooks.
 */
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listTemplates, templateCache } from "../templates.js";
import { createTemplateEnv, md } from "./template-env.js";

afterEach(() => {
  templateCache.invalidate();
  vi.restoreAllMocks();
});

const p95 = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.ceil(xs.length * 0.95) - 1] as number;
const time = (fn: () => void): number => {
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
};

/** A valid template of ~`bytes` bytes; the padding is a YAML comment so the body stays within the playbook cap. */
function sized(name: string, bytes: number): string {
  const base = `---\nname: ${name}\nmembers:\n  - { name: a, prompt: "p" }\n# `;
  const tail = "\n---\nPlaybook body.\n";
  return `${base}${"x".repeat(Math.max(0, bytes - Buffer.byteLength(base) - Buffer.byteLength(tail)))}${tail}`;
}

/** The loop is 50 cold listings of 200 templates: the 5 s default starves on a loaded shard (the p95 gates stay). */
const PERF_TEST_TIMEOUT_MS = 60_000;

describe("listing cost (P4)", () => {
  it("200 templates: cold p95 ≤ 300 ms, warm p95 ≤ 20 ms over 50 listings", () => {
    const env = createTemplateEnv();
    for (let i = 0; i < 200; i++) {
      const name = `t${String(i).padStart(3, "0")}`;
      env.tpl("user", name, sized(name, 1024 + Math.floor((i / 199) * (64 * 1024 - 1024))));
    }
    const run = () => listTemplates({ cwd: env.cwd, deps: env.deps });
    expect(run().templates).toHaveLength(200);
    const cold: number[] = [];
    const warm: number[] = [];
    for (let i = 0; i < 50; i++) {
      templateCache.invalidate();
      cold.push(time(run));
    }
    run();
    for (let i = 0; i < 50; i++) warm.push(time(run));
    expect(p95(cold)).toBeLessThanOrEqual(300);
    expect(p95(warm)).toBeLessThanOrEqual(20);
    expect(run().templates.every((t) => t.valid)).toBe(true);
  }, PERF_TEST_TIMEOUT_MS);

  it("an untrusted project with 10 000 files lists stems only and reads 0 bodies", () => {
    const env = createTemplateEnv();
    env.setTrusted(false);
    const dir = env.dir("project", "teams");
    fs.mkdirSync(dir, { recursive: true });
    for (let i = 0; i < 10_000; i++) fs.writeFileSync(path.join(dir, `s${String(i).padStart(5, "0")}.md`), "x");
    env.tpl("user", "u", md({ name: "u" }));
    const reads = vi.spyOn(fs, "readFileSync");
    const opens = vi.spyOn(fs, "openSync");
    let result: ReturnType<typeof listTemplates> | undefined;
    const ms = time(() => {
      result = listTemplates({ cwd: env.cwd, deps: env.deps });
    });
    expect(result?.templates).toHaveLength(200);
    expect(result?.warnings.join("|")).toMatch(/200/);
    expect(reads.mock.calls.filter((c) => String(c[0]).endsWith(".md"))).toEqual([]);
    expect(opens.mock.calls.filter((c) => String(c[0]).endsWith(".md"))).toEqual([]);
    expect(ms).toBeLessThan(300);
  }, PERF_TEST_TIMEOUT_MS);
});
