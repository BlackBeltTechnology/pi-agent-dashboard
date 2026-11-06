/**
 * L1 — serve_mock_site tool: real launcher child against a fixture project.
 * See change: add-live-component-mock-site (test-plan E18, E19, X1, X2, X3, X8, P2) and
 * add-mock-site-exact-env (test-plan E5, E17, P1, X1-X4, X10; task 1.6).
 *
 * @structural-pin no-vite-import: X8 scans mock-site-serve.ts + plugin.mjs for a static `vite` import; absence of text is the contract (a pi session without Vite must still load the extension)
 */

import * as fs from "node:fs";
import * as http from "node:http";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, onTestFinished } from "vitest";
import frontendMockupLoop from "../extension.js";
import { children } from "../mock-site-serve.js";
import { makeServableFixture } from "./mock-site-fixture";

type Tool = { name: string; execute: (id: string, p: any) => Promise<{ content: { text: string }[]; details: any }> };
function fakePi() {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, () => Promise<void>>();
  const pi: any = { registerTool: (t: Tool) => tools.set(t.name, t), registerCommand() {}, on: (e: string, h: () => Promise<void>) => handlers.set(e, h) };
  frontendMockupLoop(pi);
  return { tools, handlers };
}
const freePort = () => new Promise<number>((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = (s.address() as net.AddressInfo).port; s.close(() => r(p)); }); });
function lanIp(): string | null {
  for (const list of Object.values(os.networkInterfaces())) for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) return a.address;
  return null;
}
const reachable = (host: string, port: number) => new Promise<boolean>((r) => { const s = net.connect(port, host); s.setTimeout(1500, () => { s.destroy(); r(false); }); s.on("connect", () => { s.destroy(); r(true); }); s.on("error", () => r(false)); });
const refused = (port: number) => new Promise<boolean>((r) => { const s = net.connect(port, "127.0.0.1"); s.on("connect", () => { s.destroy(); r(false); }); s.on("error", () => r(true)); });
const roots: string[] = [];
afterEach(async () => {
  for (const c of children.values()) c.kill("SIGKILL");
  children.clear();
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("serve_mock_site", () => {
  it("registers alongside the existing tools without importing vite (X8)", () => {
    const { tools } = fakePi();
    for (const n of ["serve_mockup", "score_mockup", "init_ui_contract", "list_design_systems", "validate_mockup", "serve_mock_site"]) expect(tools.has(n), n).toBe(true);
    const src = fs.readFileSync(path.resolve(__dirname, "../mock-site-serve.ts"), "utf8") + fs.readFileSync(path.resolve(__dirname, "../mock-site/plugin.mjs"), "utf8");
    expect(src).not.toMatch(/from\s+["']vite["']/);
  });

  it("refuses reserved ports, no app config, missing vite; nothing started (E18, X2 add-mock-site-exact-env)", async () => {
    const { tools } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const root = makeServableFixture(); roots.push(root);
    const p8000 = (await t.execute("t", { dir: root, port: 8000 })).content[0].text;
    expect(p8000).toMatch(/port 8000 is reserved/);
    expect(p8000).not.toMatch(/dashboard/i);
    process.env.PI_DASHBOARD_PORT = "5310";
    try { expect((await t.execute("t", { dir: root, port: 5310 })).content[0].text).toMatch(/reserved/); } finally { delete process.env.PI_DASHBOARD_PORT; }
    const bare = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ms-bare-"))); roots.push(bare);
    const none = (await t.execute("t", { dir: bare })).content[0].text;
    expect(none).toContain(`no app build config found in ${bare}`);
    expect(none).toContain('"mockSite"');
    fs.writeFileSync(path.join(bare, "vite.config.mjs"), "export default {}");
    expect((await t.execute("t", { dir: bare })).content[0].text).toMatch(/vite not found/);
    expect(children.size).toBe(0);
  });

  it("options with build plugins, or that throw, are refused naming the file; nothing started (E5, X10)", async () => {
    const { tools } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const root = makeServableFixture(); roots.push(root);
    const opts = path.join(root, "mockups/mock-site.config.ts");
    fs.writeFileSync(opts, "export default { plugins: [] };\n");
    const a = (await t.execute("t", { dir: root, port: await freePort() })).content[0].text;
    expect(a).toContain(`mock options are not a build config: ${opts}`);
    fs.writeFileSync(opts, "throw new Error('boom options');\n");
    const b = (await t.execute("t", { dir: root, port: await freePort() })).content[0].text;
    expect(b).toContain(opts);
    expect(b).toContain("boom options");
    expect(children.size).toBe(0);
  });

  it("declared launcher missing: actionable error naming it; nothing started (X3)", async () => {
    const { tools } = fakePi();
    const root = makeServableFixture(); roots.push(root);
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ mockSite: { launcher: "scripts/missing.mjs", config: "vite.config.mjs" } }));
    const r = (await tools.get("serve_mock_site")!.execute("t", { dir: root, port: await freePort() })).content[0].text;
    expect(r).toContain(`declared launcher not found: ${path.join(root, "scripts/missing.mjs")}`);
    expect(children.size).toBe(0);
  });

  it("result names launcher + config, says show the URL, decisions via CLI; binds loopback unless lan (1.6, E17, X4)", async () => {
    const { tools } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const root = makeServableFixture(); roots.push(root);
    const port = await freePort();
    const r = await t.execute("t", { dir: root, port });
    const text = r.content[0].text;
    expect(text).toMatch(/launcher: \S+[/\\]node_modules[/\\]vite[/\\]bin[/\\]vite\.js\n/); // detected Vite bin (real path)
    expect(text).toContain(`app config: ${path.join(root, "vite.config.mjs")}`);
    expect(text).toContain("Show the URL to the user");
    expect(text).toContain("mock-decide accept|reject");
    expect(text.split("\n").at(-1)).not.toMatch(/canvas\(|dashboard/i); // guidance line (paths may name the repo)
    const ip = lanIp();
    if (ip) expect(await reachable(ip, port)).toBe(false);
    await t.execute("t", { stop: true, port });
    if (ip) {
      const lan = await t.execute("t", { dir: root, port, lan: true });
      expect(lan.content[0].text).toContain(`LAN:   http://${ip}:${port}`);
      expect(await reachable(ip, port)).toBe(true);
      await t.execute("t", { stop: true, port });
    }
    const desc = (tools.get("serve_mock_site") as unknown as { description: string }).description;
    expect(desc).toContain("Show the returned URL to the user");
    expect(desc).not.toMatch(/canvas\(|dashboard|Accept\/Reject/i);
  }, 90_000);

  it("starts on THIS repo within the budget: p95 of 5 cold starts < 10 s (P1)", async () => {
    const { tools } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const repo = path.resolve(__dirname, "../../../..");
    // The inherited client config regenerates this tracked file on start (as `npm run dev` does): put it back.
    const generated = path.join(repo, "packages/client/src/generated/plugin-registry.tsx");
    const before = fs.existsSync(generated) ? fs.readFileSync(generated, "utf8") : null;
    onTestFinished(() => { if (before !== null && fs.readFileSync(generated, "utf8") !== before) fs.writeFileSync(generated, before); });
    const times: number[] = [];
    for (let i = 0; i < 5; i++) {
      const port = await freePort();
      const t0 = Date.now();
      const r = await t.execute("t", { dir: repo, port });
      expect(r.details.local, r.content[0].text).toBe(`http://localhost:${port}`);
      times.push(Date.now() - t0);
      await t.execute("t", { stop: true, port });
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(0.95 * times.length) - 1]).toBeLessThan(10_000);
  }, 120_000);

  it("starts within 30s, LAN text only with lan, stops and frees the port (E19, P2, X3)", async () => {
    const { tools, handlers } = fakePi();
    const t = tools.get("serve_mock_site")!;
    const root = makeServableFixture(); roots.push(root);
    const port = await freePort();
    const t0 = Date.now();
    const a = await t.execute("t", { dir: root, port });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(a.content[0].text).toContain(`http://localhost:${port}`);
    expect(a.content[0].text).not.toMatch(/LAN:/);
    await t.execute("t", { stop: true, port });
    expect(await refused(port)).toBe(true);
    const b = await t.execute("t", { dir: root, port, lan: true });
    expect(b.content[0].text).toMatch(/LAN:/);
    expect(b.content[0].text).toMatch(/view-only/);
    expect(b.content[0].text).toMatch(/readable on the LAN/);
    const child = children.get(port)!;
    await handlers.get("session_shutdown")!();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(await refused(port)).toBe(true);
  }, 90_000);

  it("busy port: error, foreign server untouched, no child (X1)", async () => {
    const { tools } = fakePi();
    const root = makeServableFixture(); roots.push(root);
    const foreign = http.createServer((_q, s) => s.end("hi"));
    const port = await new Promise<number>((r) => foreign.listen(0, "127.0.0.1", () => r((foreign.address() as net.AddressInfo).port)));
    try {
      const res = await tools.get("serve_mock_site")!.execute("t", { dir: root, port });
      expect(res.content[0].text).toMatch(new RegExp(`port ${port}`));
      expect(res.details.local).toBeUndefined();
      expect(children.size).toBe(0);
      const body = await new Promise<string>((r) => http.get({ host: "127.0.0.1", port, agent: false }, (s) => { let b = ""; s.on("data", (c) => (b += c)); s.on("end", () => r(b)); }));
      expect(body).toBe("hi");
    } finally { foreign.close(); }
  }, 60_000);

  it("child crash during start fails fast (X2)", async () => {
    const { tools } = fakePi();
    const root = makeServableFixture(); roots.push(root);
    fs.writeFileSync(path.join(root, "vite.config.mjs"), "throw new Error('boom config');\n");
    const t0 = Date.now();
    const res = await tools.get("serve_mock_site")!.execute("t", { dir: root, port: await freePort() });
    expect(Date.now() - t0).toBeLessThan(30_000);
    expect(res.content[0].text).toMatch(/exited during start/);
    expect(children.size).toBe(0);
  }, 60_000);
});
