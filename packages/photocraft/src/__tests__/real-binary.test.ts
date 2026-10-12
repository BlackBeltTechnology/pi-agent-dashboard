/**
 * L1-real: the real photocraft-cli (PHOTOCRAFT_BIN) with a stub generator.
 * Gated by PHOTOCRAFT_E2E — no Gemini call is ever made. E35 also downloads the
 * latest release for the host, so it additionally needs network access.
 *
 *   PHOTOCRAFT_E2E=1 PHOTOCRAFT_BIN=/path/to/photocraft-cli vitest run real-binary
 */
import { spawn, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { provision } from "../provision.js";
import { parseReplaceArgs, type ReplaceDeps, replaceRegion } from "../region-replace.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";
import { CLI, TSX } from "./helpers/paths.js";
import { decodePng, diff, encodePng, type Image, pixel, scene } from "./helpers/png.js";

const enabled = !!process.env.PHOTOCRAFT_E2E;
const BIN = process.env.PHOTOCRAFT_BIN as string;

afterEach(cleanupTmp);

const pc = (args: string[]) => {
  const r = spawnSync(BIN, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`photocraft-cli ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
};

const write = (dir: string, name: string, img: Image): string => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, encodePng(img));
  return p;
};
const read = (p: string) => decodePng(fs.readFileSync(p));

interface RunResult {
  code: number;
  report?: { region: { x: number; y: number; w: number; h: number }; crop: { x: number; y: number; w: number; h: number } };
  err: string;
}

/** Run replace-region in-process against the real binary with a stub generator. */
async function replace(argv: string[], generate: ReplaceDeps["generate"]): Promise<RunResult> {
  const parsed = parseReplaceArgs(argv);
  if (!parsed.ok) throw new Error(parsed.error);
  const out: string[] = [];
  const err: string[] = [];
  const code = await replaceRegion(parsed.options, { generate, stdout: (t) => out.push(t), stderr: (t) => err.push(t) });
  return { code, report: out.length ? JSON.parse(out[0]) : undefined, err: err.join("") };
}

/** Generator stub: writes `make(crop)` to the requested output. */
const stub =
  (make: (crop: Image) => Image): ReplaceDeps["generate"] =>
  async (req) => {
    fs.writeFileSync(req.output, encodePng(make(read(req.file))));
    return { ok: true, model: null };
  };

const invert = (img: Image): Image => ({ ...img, data: img.data.map((v, i) => (i % 4 === 3 ? v : 255 - v)) });

/** Noise with channel values kept away from 127/128 so inversion always changes a pixel. */
const noisy = (w: number, h: number): Image => {
  const img = scene(w, h, [40, 90, 200], [], 60);
  img.data = img.data.map((v, i) => (i % 4 === 3 ? v : v > 110 && v < 146 ? 60 : v));
  return img;
};

function countDiffs(a: Image, b: Image, inside: (x: number, y: number) => boolean, want: boolean, tolerance = 0): number {
  let n = 0;
  for (let y = 0; y < a.h; y++) for (let x = 0; x < a.w; x++) if (inside(x, y) === want && diff(pixel(a, x, y), pixel(b, x, y)) > tolerance) n++;
  return n;
}

describe.skipIf(!enabled)("replace-region against the real binary", () => {
  it("E29 pixels outside the crop box are identical; the region changes", async () => {
    const dir = tmpDir();
    const input = write(dir, "in.png", noisy(320, 200));
    const out = path.join(dir, "out.png");
    const r = await replace([input, "--prompt", "x", "--rect", "100,50,120,100", "--pad", "32", "--feather", "8", "--min-crop", "1", "--out", out], stub(invert));
    expect(r.code, r.err).toBe(0);
    const { crop } = r.report as NonNullable<RunResult["report"]>;
    const a = read(input);
    const b = read(out);
    const inCrop = (x: number, y: number) => x >= crop.x && x < crop.x + crop.w && y >= crop.y && y < crop.y + crop.h;
    expect(countDiffs(a, b, inCrop, false)).toBe(0);
    const inRect = (x: number, y: number) => x >= 100 && x < 220 && y >= 50 && y < 150;
    expect(countDiffs(a, b, inRect, true) / (120 * 100)).toBeGreaterThan(0.95);
  }, 60_000);

  it("E30/E31 generator size is normalised to the crop; layered output has patch + mask and flattens to --out", async () => {
    const dir = tmpDir();
    const input = write(dir, "in.png", noisy(320, 200));
    const out = path.join(dir, "out.png");
    const layered = path.join(dir, "out.psd");
    const double = (c: Image): Image => {
      const w = c.w * 2;
      const h = c.h * 2;
      const data = new Uint8Array(w * h * 4);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set(c.data.subarray(((y >> 1) * c.w + (x >> 1)) * 4, ((y >> 1) * c.w + (x >> 1)) * 4 + 4), (y * w + x) * 4);
      return { w, h, data };
    };
    const r = await replace([input, "--prompt", "x", "--rect", "100,50,120,100", "--pad", "16", "--feather", "5", "--min-crop", "1", "--out", out, "--layered", layered], stub(double));
    expect(r.code, r.err).toBe(0);
    expect(r.report?.crop).toEqual({ x: 84, y: 34, w: 152, h: 132 });
    const info = JSON.parse(pc(["info", layered, "--compact"])) as { layers: { hasMask: boolean; bounds: number[] }[] };
    expect(info.layers).toHaveLength(2);
    const patch = info.layers.find((l) => l.hasMask);
    // `info` reports [x, y, w, h]; the same box in corner form is [84,34,236,166]
    expect(patch?.bounds).toEqual([84, 34, 152, 132]);
    const flat = path.join(dir, "flat.png");
    pc(["convert", layered, flat]);
    expect(countDiffs(read(out), read(flat), () => true, true)).toBe(0);
  }, 60_000);

  it("E32 semantic selector: region is the probe's bounds and nothing outside the crop changes", async () => {
    const dir = tmpDir();
    const input = write(dir, "in.png", scene(400, 300, [235, 235, 235], [{ cx: 200, cy: 150, r: 40, colour: [200, 30, 30] }]));
    const hint = [150, 100, 100, 100];
    const probe = JSON.parse(pc(["run", input, "--cmd", "select.object", "--params", JSON.stringify({ rect: hint }), "--out", path.join(dir, "probe.png")]).trim().split("\n")[0]) as { result: { bounds: number[] } };
    const out = path.join(dir, "out.png");
    const r = await replace([input, "--prompt", "x", "--select", `object:${hint.join(",")}`, "--out", out, "--min-crop", "1"], stub(invert));
    expect(r.code, r.err).toBe(0);
    const [bx, by, bw, bh] = probe.result.bounds;
    expect(r.report?.region).toEqual({ x: bx, y: by, w: bw, h: bh });
    const crop = r.report?.crop as { x: number; y: number; w: number; h: number };
    const inCrop = (x: number, y: number) => x >= crop.x && x < crop.x + crop.w && y >= crop.y && y < crop.y + crop.h;
    expect(countDiffs(read(input), read(out), inCrop, false)).toBe(0);
  }, 60_000);

  const disc = (cx: number, cy: number, r: number) => ({ cx, cy, r });
  const ORIGINAL: [number, number, number] = [60, 160, 60];

  it("E39 a differently shaped, larger replacement is shown whole with the default crop mask", async () => {
    const dir = tmpDir();
    const input = write(dir, "in.png", scene(1024, 1024, [230, 225, 215], [{ ...disc(645, 665, 91), colour: ORIGINAL }]));
    const out = path.join(dir, "out.png");
    const NEW: [number, number, number] = [240, 130, 20];
    const patches: Image[] = [];
    const bigger = (c: Image): Image => {
      const p = scene(c.w, c.h, [0, 0, 0]);
      const bg = scene(c.w, c.h, [230, 225, 215], [{ ...disc(c.w / 2, c.h / 2, 120), colour: NEW }]);
      p.data = bg.data;
      patches.push(p);
      return p;
    };
    const r = await replace([input, "--prompt", "x", "--select", "object:540,560,210,210", "--out", out], stub(bigger));
    expect(r.code, r.err).toBe(0);
    expect(r.report?.crop).toEqual({ x: 517, y: 537, w: 256, h: 256 });
    const a = read(input);
    const b = read(out);
    const patch = patches[0];
    // inset rect 541,561,208,208 eroded by 3×feather → 565,585,160,160: equals the patch
    let mismatches = 0;
    for (let y = 585; y < 745; y++) for (let x = 565; x < 725; x++) if (diff(pixel(b, x, y), pixel(patch, x - 517, y - 537)) > 1) mismatches++;
    expect(mismatches).toBe(0);
    // no original-colour pixel survives inside the inset rect
    let remnants = 0;
    for (let y = 561; y < 769; y++) for (let x = 541; x < 749; x++) if (diff(pixel(b, x, y), ORIGINAL) <= 2) remnants++;
    expect(remnants).toBe(0);
    const inCrop = (x: number, y: number) => x >= 517 && x < 773 && y >= 537 && y < 793;
    expect(countDiffs(a, b, inCrop, false)).toBe(0);
  }, 60_000);

  it("E40 --mask selection only replaces inside the original object's feathered outline", async () => {
    const dir = tmpDir();
    const input = write(dir, "in.png", scene(1024, 1024, [230, 225, 215], [{ ...disc(645, 665, 91), colour: ORIGINAL }]));
    const out = path.join(dir, "out.png");
    const RECOLOUR: [number, number, number] = [30, 60, 220];
    const recolour = (c: Image): Image => {
      const p = { ...c, data: new Uint8Array(c.data) };
      for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) if (diff(pixel(c, x, y), ORIGINAL) <= 4) p.data.set([...RECOLOUR, 255], (y * c.w + x) * 4);
      return p;
    };
    const r = await replace([input, "--prompt", "x", "--select", "object:540,560,210,210", "--mask", "selection", "--out", out], stub(recolour));
    expect(r.code, r.err).toBe(0);
    const a = read(input);
    const b = read(out);
    const dist = (x: number, y: number) => Math.hypot(x + 0.5 - 645, y + 0.5 - 665);
    const inCrop = (x: number, y: number) => x >= 517 && x < 773 && y >= 537 && y < 793;
    // outside the selection and more than 3×feather from its outline: untouched
    let changedFar = 0;
    for (let y = 537; y < 793; y++) for (let x = 517; x < 773; x++) if (inCrop(x, y) && dist(x, y) > 91 + 24 && diff(pixel(a, x, y), pixel(b, x, y)) > 0) changedFar++;
    expect(changedFar).toBe(0);
    // deep inside the disc: recoloured
    let unchangedDeep = 0;
    for (let y = 537; y < 793; y++) for (let x = 517; x < 773; x++) if (dist(x, y) < 91 - 24 && diff(pixel(b, x, y), RECOLOUR) > 2) unchangedDeep++;
    expect(unchangedDeep).toBe(0);
  }, 60_000);
});

// ── MCP through the wrapper ─────────────────────────────────────────────────

interface McpSession {
  send: (m: object) => void;
  next: (id: number) => Promise<{ result?: { content?: { text: string }[]; isError?: boolean; serverInfo?: { name: string }; tools?: { name: string }[] } }>;
  close: () => void;
}

function startMcp(root: string): McpSession {
  const child = spawn(process.execPath, ["--import", TSX, CLI, "mcp", "--root", root], {
    env: { ...process.env, NODE_OPTIONS: "" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const waiting = new Map<number, (m: unknown) => void>();
  const seen = new Map<number, unknown>();
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      const m = JSON.parse(line);
      const w = waiting.get(m.id);
      if (w) w(m);
      else seen.set(m.id, m);
    }
  });
  return {
    send: (m) => child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...m })}\n`),
    next: (id) => new Promise((resolve) => (seen.has(id) ? resolve(seen.get(id) as never) : waiting.set(id, resolve as (m: unknown) => void))),
    close: () => {
      child.stdin.end();
      child.kill();
    },
  };
}

const initialize = async (s: McpSession) => {
  s.send({ id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  const init = await s.next(1);
  s.send({ method: "notifications/initialized" });
  return init;
};
const call = (s: McpSession, id: number, name: string, args: object) => s.send({ id, method: "tools/call", params: { name, arguments: args } });

describe.skipIf(!enabled)("mcp through the wrapper (real server)", () => {
  it("E33 handshake: server name and the core tools", async () => {
    const root = tmpDir();
    const s = startMcp(root);
    try {
      expect((await initialize(s)).result?.serverInfo?.name).toBe("photocraft");
      s.send({ id: 2, method: "tools/list" });
      const names = ((await s.next(2)).result?.tools ?? []).map((t) => t.name);
      expect(names).toEqual(expect.arrayContaining(["doc_open", "command_run", "doc_save"]));
    } finally {
      s.close();
    }
  }, 30_000);

  it("E34 --root confines paths: inside opens, outside is a tool error mentioning the path", async () => {
    const root = tmpDir();
    const outside = tmpDir();
    const inside = write(root, "in.png", scene(32, 32, [1, 2, 3]));
    const away = write(outside, "away.png", scene(32, 32, [1, 2, 3]));
    const s = startMcp(root);
    try {
      await initialize(s);
      call(s, 10, "doc_open", { path: inside });
      expect((await s.next(10)).result?.isError).toBe(false);
      call(s, 11, "doc_open", { path: away });
      const rejected = await s.next(11);
      expect(rejected.result?.isError).toBe(true);
      expect(rejected.result?.content?.[0].text).toContain(away);
    } finally {
      s.close();
    }
  }, 30_000);

  it("F2 pipelined doc_open + command_run succeed (no 'no document open' race)", async () => {
    const root = tmpDir();
    const file = write(root, "in.png", scene(320, 200, [10, 20, 30]));
    const s = startMcp(root);
    try {
      await initialize(s);
      call(s, 20, "doc_open", { path: file });
      call(s, 21, "command_run", { id: "image.adjustments.invert", params: {} });
      expect((await s.next(20)).result?.isError).toBe(false);
      const run = await s.next(21);
      expect(run.result?.isError, JSON.stringify(run)).toBe(false);
    } finally {
      s.close();
    }
  }, 30_000);
});

describe.skipIf(!enabled)("provisioning against the real release", () => {
  it("E35 a genuine archive passes the guard, installs, and the binary runs", async () => {
    const home = tmpDir();
    const report = await provision({ env: { PHOTOCRAFT_HOME: home }, probeVersion: false });
    expect(report.cacheHit).toBe(false);
    expect(report.source).toBe("latest");
    const v = spawnSync(report.binary, ["--version"], { encoding: "utf8" });
    expect(v.status).toBe(0);
    expect(v.stdout).toMatch(/^photocraft-cli /);
    const again = await provision({ env: { PHOTOCRAFT_HOME: home } });
    expect(again.cacheHit).toBe(true);
    expect(fs.readdirSync(home).filter((n) => n.startsWith(".staging-"))).toEqual([]);
  }, 300_000);
});
