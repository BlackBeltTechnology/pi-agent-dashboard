/**
 * Starting under a base costs no more than starting without one (D11): STARTS cold starts of the REAL launcher on this repo under
 * `base=/some/prefix/` against STARTS without, interleaved A/B/B/A in the same run so cache warm-up and machine load hit both alike.
 * The row asks for 5; a start here is sub-second, where 5 samples swing the median ratio by ±30 % on pure noise (observed 0.96-1.33),
 * so 15 are taken (ratios 0.96-1.02 over repeated runs).
 * The comparison is a same-run RATIO of medians (Q48); the absolute 30 s `READY_TIMEOUT_MS` is deliberately not asserted for the
 * base start (a loaded machine may legitimately exceed it, which is what #X55 covers).
 * See change: serve-live-previews-on-capability-origin (D11; test-plan #P21).
 *
 * @structural-pin reads the tracked generated plugin registry only to put it back after the real launcher regenerates it; asserts nothing on its text
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it, onTestFinished } from "vitest";
import frontendMockupLoop from "../extension.js";
import { freePort, httpGet } from "./mock-site-fake-launcher";

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
const STARTS = 15;
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const BASE = "/some/prefix/";

/** One start of the real launcher: ms until the marker answers, observed with a 20 ms poll (the tool's own 200 ms tick is not part of the figure). */
async function timedStart(tool: Tool, dir: string, base: string | undefined): Promise<number> {
  const port = await freePort();
  const at = base ?? "/";
  const t0 = performance.now();
  const started = tool.execute("t", { dir, port, ...(base ? { base } : {}) });
  let ms = 0;
  for (let ready = false; !ready; ) {
    ready = (await httpGet(port, `${at}__mock/decisions`)).body.includes("mockSite");
    ms = performance.now() - t0;
    if (!ready) await new Promise((r) => setTimeout(r, 20));
    if (ms > 120_000) throw new Error(`no start within 120 s (base ${base})`);
  }
  const r = await started;
  expect(r.details.local, r.content[0].text).toBe(`http://localhost:${port}${base ?? ""}`);
  await tool.execute("t", { stop: true, port });
  return Math.round(ms);
}

/** The inherited client config regenerates this tracked file on start (as `npm run dev` does): put it back. */
function restoreGeneratedAfter(repo: string): void {
  const generated = path.join(repo, "packages/client/src/generated/plugin-registry.tsx");
  const before = fs.existsSync(generated) ? fs.readFileSync(generated, "utf8") : null;
  onTestFinished(() => {
    if (before !== null && fs.existsSync(generated) && fs.readFileSync(generated, "utf8") !== before) fs.writeFileSync(generated, before);
  });
}

describe("T.P21 — serve_mock_site start time under a base", () => {
  it("cold starts with base `/some/prefix/` take ≤ 1.2× the median of those without (same run, 15 each)", async () => {
    const tools = new Map<string, Tool>();
    frontendMockupLoop({ registerTool: (t: Tool) => tools.set(t.name, t), registerCommand() {}, on() {} } as never);
    const tool = tools.get("serve_mock_site")!;
    const repo = path.resolve(__dirname, "../../../..");
    restoreGeneratedAfter(repo);

    const times: Record<"base" | "none", number[]> = { base: [], none: [] };
    for (let i = 0; i < STARTS * 2; i++) {
      const kind = i % 4 === 0 || i % 4 === 3 ? "none" : "base"; // A B B A A B B A …
      times[kind].push(await timedStart(tool, repo, kind === "base" ? BASE : undefined));
    }
    expect(times.base).toHaveLength(STARTS);
    expect(times.none).toHaveLength(STARTS);
    const [mb, mn] = [median(times.base), median(times.none)];
    console.info(`[P21] no-base ms=${times.none.join(",")} (median ${mn}); base ms=${times.base.join(",")} (median ${mb}); ratio ${(mb / mn).toFixed(2)}`);
    expect(mb).toBeLessThanOrEqual(1.2 * mn);
  }, 600_000);
});
