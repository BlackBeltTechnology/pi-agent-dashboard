/**
 * L1-real: genuine ArtCraft release binaries. Opt-in (downloads up to ~60 MB, spawns the apps):
 *
 *   CRAFT_E2E=1 [CRAFT_HOME=/path/to/warm/cache] vitest run real-apps
 *
 * Without CRAFT_HOME the cache lives in a tmp dir and every app is downloaded fresh.
 * See change: add-craft-apps-core (tasks 4.4, 5, 8).
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provision } from "../provision.js";
import { runVerify } from "../verify.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { CRAFT_CLI, TSX } from "./helpers/paths.js";

const enabled = !!process.env.CRAFT_E2E;
afterEach(cleanupTmp);

const home = () => process.env.CRAFT_HOME ?? tmpDir("craft-real-");

/** Drive `pi-craft <app> mcp …` over stdio: initialize + tools/list; resolves the tool names. */
function mcpToolList(args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<{ tools: string[]; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", TSX, CRAFT_CLI, ...args], { cwd, env: { ...process.env, NODE_OPTIONS: "", ...env }, stdio: ["pipe", "pipe", "pipe"] });
    let buf = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mcp tools/list timed out; stderr: ${stderr}`));
    }, 60_000);
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    child.stdout.on("data", (d) => {
      buf += d;
      for (const line of buf.split("\n")) {
        try {
          const m = JSON.parse(line);
          if (m.id === 2) {
            clearTimeout(timer);
            child.kill();
            resolve({ tools: m.result.tools.map((t: { name: string }) => t.name), stderr });
          }
        } catch {
          /* partial line / non-JSON */
        }
      }
    });
    const send = (o: unknown) => child.stdin.write(`${JSON.stringify(o)}\n`);
    send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "0" } } });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  });
}

describe.skipIf(!enabled)("real release binaries", () => {
  it("provisions a genuine archive (GridCraft, smallest), runs --version, then hits the cache", async () => {
    const h = home();
    const env = { CRAFT_HOME: h } as NodeJS.ProcessEnv;
    const first = await provision("gridcraft", { env });
    expect(first.app).toBe("gridcraft");
    const v = spawnSync(first.binary, ["--version"], { encoding: "utf8" });
    expect(v.status).toBe(0);
    expect(v.stdout).toMatch(/gridcraft-cli \d+\.\d+\.\d+/);
    const again = await provision("gridcraft", { env });
    expect(again.cacheHit).toBe(true);
    expect(fs.readdirSync(path.join(h, "gridcraft")).filter((n) => n.startsWith(".staging-"))).toEqual([]);
  }, 300_000);

  it("MCP through the proxy: a confined app (PhotoCraft) lists its tools, rooted at the cwd", async () => {
    const cwd = tmpDir("craft-mcp-");
    await provision("photocraft", { env: { CRAFT_HOME: home() } });
    const r = await mcpToolList(["photocraft", "mcp"], cwd, { CRAFT_HOME: home() });
    expect(r.tools.length).toBeGreaterThan(10);
    expect(r.stderr).toContain(`mcp root: ${cwd}`);
  }, 300_000);

  it("MCP through the proxy: an unconfined app (GridCraft) refuses, then lists tools with --allow-unconfined", async () => {
    const cwd = tmpDir("craft-mcp-");
    const refused = spawnSync(process.execPath, ["--import", TSX, CRAFT_CLI, "gridcraft", "mcp"], { cwd, encoding: "utf8", env: { ...process.env, NODE_OPTIONS: "", CRAFT_HOME: home() } });
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain("--allow-unconfined");
    const r = await mcpToolList(["gridcraft", "mcp", "--allow-unconfined"], cwd, { CRAFT_HOME: home() });
    expect(r.tools.length).toBeGreaterThan(10);
    expect(r.stderr).toMatch(/unconfined/);
  }, 300_000);

  it("MCP through the proxy: PdfCraft --compact lists far fewer tools than its 163 and is root-confined", async () => {
    const cwd = tmpDir("craft-mcp-");
    await provision("pdfcraft", { env: { CRAFT_HOME: home() } });
    const compact = await mcpToolList(["pdfcraft", "mcp", "--compact"], cwd, { CRAFT_HOME: home() });
    expect(compact.tools.length).toBeLessThan(40);
    expect(compact.tools).toContain("tool_call");
  }, 300_000);

  it("verify --pages against a real PdfCraft", async () => {
    const dir = tmpDir("craft-pdf-");
    const f = path.join(dir, "two.pdf");
    fs.writeFileSync(f, TWO_PAGE_PDF());
    const out: string[] = [];
    const prev = process.env.CRAFT_HOME;
    process.env.CRAFT_HOME = home();
    try {
      const code = await runVerify([f, "--pages", "2", "--text-contains", "Second page", "--json"], { stdout: (t) => out.push(t), stderr: () => {} });
      expect(code, out.join("")).toBe(0);
      expect(await runVerify([f, "--pages", "3"], { stdout: () => {}, stderr: () => {} })).toBe(1);
    } finally {
      if (prev === undefined) delete process.env.CRAFT_HOME;
      else process.env.CRAFT_HOME = prev;
    }
  }, 300_000);
});

/** Minimal two-page PDF ("Hello pi-craft" / "Second page"). */
function TWO_PAGE_PDF(): Buffer {
  const objs: Buffer[] = [];
  const stream = (t: string) => Buffer.from(`<< /Length ${t.length} >>\nstream\n${t}\nendstream`);
  objs.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objs.push(Buffer.from("<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>"));
  objs.push(Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R /Resources << /Font << /F1 7 0 R >> >> >>"));
  objs.push(stream("BT /F1 24 Tf 20 100 Td (Hello pi-craft) Tj ET"));
  objs.push(Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 6 0 R /Resources << /Font << /F1 7 0 R >> >> >>"));
  objs.push(stream("BT /F1 24 Tf 20 100 Td (Second page) Tj ET"));
  objs.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"));
  let out = Buffer.from("%PDF-1.4\n");
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(out.length);
    out = Buffer.concat([out, Buffer.from(`${i + 1} 0 obj\n`), o, Buffer.from("\nendobj\n")]);
  });
  const x = out.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const o of offs) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
  return Buffer.concat([out, Buffer.from(`${xref}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`)]);
}
