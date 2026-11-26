/**
 * A launcher adapter that cannot apply a base (D11 (8)): an explicit `base` is refused up front with the missing base support
 * and the way forward; nothing starts and no probe is emitted; the same project with no `base` starts at the root.
 * Only the Vite adapter ships today (and it maps a base onto `--base`), so the adapter descriptor `prepareMockSite` returns is
 * replaced by one without a base flag — everything after it (the guard, the spawn, the emitter) is the real code.
 * See change: serve-live-previews-on-capability-origin (D11; test-plan #X58).
 */
import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import frontendMockupLoop from "../extension.js";
import { children } from "../mock-site-serve.js";
import { freePort, launchLog, makeFakeLauncherProject, portRefused } from "./mock-site-fake-launcher";

const adapter = vi.hoisted(() => ({ launcher: "" as string, name: "" as string }));
vi.mock("../mock-site/env.mjs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../mock-site/env.mjs")>();
  return {
    ...actual,
    // Same shape as `prepareMockSite`'s success value, for an adapter with no base flag.
    prepareMockSite: async () => ({ ok: true, launcher: adapter.launcher, config: "app.config", generated: "generated.config", source: "declared", optionsFile: null, adapter: adapter.name, baseFlag: null }),
  };
});

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
function fakePi() {
  const tools = new Map<string, Tool>();
  const events = { emit: vi.fn() };
  const pi: any = { registerTool: (t: Tool) => tools.set(t.name, t), registerCommand() {}, on() {}, events };
  frontendMockupLoop(pi);
  return { tool: tools.get("serve_mock_site")!, events };
}
const roots: string[] = [];
afterEach(() => {
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  delete process.env.FAKE_LOG;
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("T.X58 — a launcher without `--base` support", () => {
  it("explicit base: error names the adapter and how to proceed; no child, no probe; the same project without base starts at the root, emitting nothing", async () => {
    const { root, launcher, log } = makeFakeLauncherProject();
    roots.push(root);
    process.env.FAKE_LOG = log;
    adapter.launcher = launcher;
    adapter.name = "webpack";
    const { tool, events } = fakePi();
    const port = await freePort();

    const refused = await tool.execute("t", { dir: root, port, base: "/some/prefix/" });
    const text = refused.content[0].text;
    expect(text).toContain("the webpack launcher adapter cannot apply a base path"); // names the missing base support
    expect(text).toContain("start without `base`"); // how to proceed
    expect(text).toContain("served at the root");
    expect(refused.details.local).toBeUndefined();
    expect(children.size).toBe(0); // no child
    expect(launchLog(log)).toEqual([]); // the launcher never ran
    expect(await portRefused(port)).toBe(true);
    expect(events.emit).not.toHaveBeenCalled(); // no probe either

    // The same project, no `base`: root start; the adapter has no base flag so the host is never asked for one.
    const ok = await tool.execute("t", { dir: root, port });
    expect(ok.details.local).toBe(`http://localhost:${port}`);
    expect(launchLog(log)).toHaveLength(1);
    expect(launchLog(log)[0].argv).not.toContain("--base");
    expect(events.emit).not.toHaveBeenCalled();
    // `/` as the explicit base also means "no base" and starts fine on this adapter
    await tool.execute("t", { stop: true, port });
    const slash = await tool.execute("t", { dir: root, port, base: "/" });
    expect(slash.details.local).toBe(`http://localhost:${port}`);
    expect(events.emit).not.toHaveBeenCalled();
  }, 60_000);
});
