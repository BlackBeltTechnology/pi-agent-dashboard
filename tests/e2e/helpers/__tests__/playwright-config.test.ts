/**
 * Playwright config contract (change: stabilize-browser-e2e, task 1.1; issue #450).
 *
 * The browser-E2E suite is the strongest gate on the ship-it path, but a full
 * run could not produce a verdict under a committed wall-clock budget: the old
 * `globalTimeout: 15 * 60_000` died long before 168 specs finished, so a full
 * `npm run test:e2e` reported a timeout rather than a result. A wall-clock
 * budget belongs to the CI job (`timeout-minutes`), not the committed config —
 * per-test `timeout`, `expect.timeout` and the harness-down short-circuit
 * (3 consecutive probe failures → remaining specs skipped) already bound a
 * pathological run.
 *
 * Also locks the CI blob reporter: the sharded CI workflow joins per-shard
 * `blob` reports into one HTML artifact, so it must switch on under CI — and
 * must NOT leak into a local run, where `list` + `html` are the point.
 *
 * See openspec/changes/stabilize-browser-e2e/design.md D1, D2.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

// Repo root is four levels up from tests/e2e/helpers/__tests__/. The config
// lives OUTSIDE this vitest project's root (`tests/`), so it is addressed by
// absolute file URL — a relative specifier escapes the project root and
// mis-resolves.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");
const CONFIG_URL = pathToFileURL(path.join(REPO_ROOT, "playwright.config.ts")).href;

/**
 * Re-execute playwright.config.ts under the CURRENT env. The config reads
 * `process.env.CI` at module top level, so a plain import is cached after the
 * first load — `resetModules` is what makes the CI/non-CI legs independent.
 */
async function loadConfig(): Promise<Record<string, unknown>> {
  vi.resetModules();
  const mod = await import(/* @vite-ignore */ CONFIG_URL);
  return mod.default as Record<string, unknown>;
}

/** Reporter entries are either a bare name or a [name, options] tuple. */
function reporterNames(reporter: unknown): string[] {
  if (!Array.isArray(reporter)) return [];
  return reporter.map((entry) => (Array.isArray(entry) ? String(entry[0]) : String(entry)));
}

describe("playwright.config.ts — no committed wall-clock budget (#450)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("carries no globalTimeout (Playwright default 0 = unbounded)", async () => {
    const config = await loadConfig();
    // `undefined` (key deleted) and `0` (explicit unbounded) are both correct;
    // any positive value re-introduces the budget that made a full run
    // unverifiable.
    expect(config.globalTimeout ?? 0).toBe(0);
  });

  it("keeps a per-test timeout bound (unbounded run still terminates per test)", async () => {
    const config = await loadConfig();
    expect(Number(config.timeout)).toBeGreaterThan(0);
  });

  it("still tears the harness down via globalTeardown", async () => {
    const config = await loadConfig();
    expect(config.globalTeardown).toBe("./tests/e2e/global-teardown.ts");
  });
});

describe("playwright.config.ts — blob reporter for sharded CI (#433 part 2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds the blob reporter when CI is set", async () => {
    vi.stubEnv("CI", "1");
    const config = await loadConfig();
    expect(reporterNames(config.reporter)).toContain("blob");
  });

  it("keeps list + html locally and does not emit blob", async () => {
    vi.stubEnv("CI", "");
    const config = await loadConfig();
    const names = reporterNames(config.reporter);
    expect(names).toContain("list");
    expect(names).toContain("html");
    expect(names).not.toContain("blob");
  });
});
