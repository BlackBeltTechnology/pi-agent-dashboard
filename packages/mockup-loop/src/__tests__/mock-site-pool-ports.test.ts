/**
 * The mock site never takes a tier-3 preview pool port (D5): `serve_mock_site` reads `liveServer.previewOrigins.portPool`
 * from the dashboard config and refuses every port of the pool like any other reserved port; nothing starts.
 * The server half of #E70 (target registration and the reserve-path API refuse pool ports) lives in the server package.
 * See change: serve-live-previews-on-capability-origin (D5; test-plan #E70).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import frontendMockupLoop from "../extension.js";
import { children } from "../mock-site-serve.js";
import { makeFakeLauncherProject, portRefused } from "./mock-site-fake-launcher";

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
function serveTool(): Tool {
  const tools = new Map<string, Tool>();
  frontendMockupLoop({ registerTool: (t: Tool) => tools.set(t.name, t), registerCommand() {}, on() {} } as never);
  return tools.get("serve_mock_site")!;
}

let home: string;
let origHome: string | undefined;
const roots: string[] = [];
const writeDashboardConfig = (cfg: object) => {
  const f = path.join(home, ".pi", "dashboard", "config.json");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(cfg));
};
beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pool-ports-"));
  origHome = process.env.HOME;
  process.env.HOME = home;
});
afterEach(() => {
  process.env.HOME = origHome;
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  for (const r of [home, ...roots.splice(0)]) fs.rmSync(r, { recursive: true, force: true });
});

describe("T.E70 — pool ports are forbidden to the mock site", () => {
  it("every pool port (both edges and the middle, 8150 included) is refused as reserved; the ports just outside are not; nothing is started", async () => {
    writeDashboardConfig({ liveServer: { previewOrigins: { portPool: "8100-8199" } } });
    const { root } = makeFakeLauncherProject();
    roots.push(root);
    const tool = serveTool();
    for (const port of [8100, 8150, 8199]) {
      const r = (await tool.execute("t", { dir: root, port })).content[0].text;
      expect(r, `port ${port}`).toContain(`port ${port} is reserved`);
      expect(r).toContain("pick another port");
      expect(children.size).toBe(0);
    }
    // the same refusal as any other reserved port (8000), so a pool port is indistinguishable from the dashboard's own
    const own = (await tool.execute("t", { dir: root, port: 8000 })).content[0].text;
    expect(own).toBe((await tool.execute("t", { dir: root, port: 8150 })).content[0].text.replace("8150", "8000"));
    // just outside the pool the port check passes (a launch is attempted and fails for another reason, or starts)
    for (const port of [8099, 8200]) {
      const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pool-bare-")));
      roots.push(bare);
      const r = (await tool.execute("t", { dir: bare, port })).content[0].text;
      expect(r, `port ${port}`).not.toContain("is reserved");
      expect(r).toContain("no app build config found"); // got past the port gate
    }
    expect(children.size).toBe(0);
    expect(await portRefused(8150)).toBe(true);
  });

  it("no pool configured, or an invalid / oversized one (101+ ports, not a range) → no range is reserved; a valid ≤100-port range is, and the config is re-read at every start", async () => {
    const { root } = makeFakeLauncherProject();
    roots.push(root);
    const tool = serveTool();
    const probePort = async (port: number) => {
      const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pool-bare-")));
      roots.push(bare);
      return (await tool.execute("t", { dir: bare, port })).content[0].text;
    };
    writeDashboardConfig({});
    expect(await probePort(8150)).not.toContain("is reserved");
    writeDashboardConfig({ liveServer: { previewOrigins: { portPool: "8100-8300" } } }); // 201 ports: invalid, tier 3 off, so nothing is reserved
    expect(await probePort(8150)).not.toContain("is reserved");
    writeDashboardConfig({ liveServer: { previewOrigins: { portPool: "abc" } } });
    expect(await probePort(8150)).not.toContain("is reserved");
    writeDashboardConfig({ liveServer: { previewOrigins: { portPool: "8100-8199" } } }); // config is re-read on every start: live
    expect(await probePort(8150)).toContain("port 8150 is reserved");
    writeDashboardConfig({ liveServer: { previewOrigins: { portPool: "8100-8200" } } }); // 101 ports: the parser rejects it, so nothing is reserved
    expect(await probePort(8150)).not.toContain("is reserved");
  });
});
