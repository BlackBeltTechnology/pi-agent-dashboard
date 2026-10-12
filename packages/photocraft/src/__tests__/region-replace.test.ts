import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { main } from "../bin/photocraft.js";
import type { ProvisionReport } from "../provision.js";
import {
  buildCompositeArgs,
  clipRect,
  commitOutputs,
  computeCrop,
  computeMask,
  fromCorners,
  fromXywh,
  makeGenerator,
  parseReplaceArgs,
  type ReplaceDeps,
  type ReplaceOptions,
  replaceRegion,
  resolveNanoBananaLauncher,
  toCorners,
} from "../region-replace.js";
import { cleanupTmp, tmpDir } from "./helpers/fixtures.js";

afterEach(cleanupTmp);

const report: ProvisionReport = { version: "0.7.0", source: "override", asset: null, cacheHit: false, binary: "/bin/pc", durationMs: 0 };

describe("argument validation", () => {
  const dir = () => {
    const d = tmpDir();
    fs.writeFileSync(path.join(d, "in.png"), "x");
    return d;
  };
  const base = (d: string, extra: string[]) => [path.join(d, "in.png"), "--prompt", "p", "--out", path.join(d, "out.png"), ...extra];

  it("E24 invalid invocations exit 1 before provisioning", async () => {
    const d = dir();
    fs.symlinkSync(path.join(d, "in.png"), path.join(d, "link.png"));
    const invalid: string[][] = [
      ["--rect", "0,0,10,10", "--select", "subject"],
      [],
      ["--rect", "0,0,10,10", "--pad", "23", "--feather", "8"],
      ["--rect", "0,0,10,10", "--pad", "-1"],
      ["--rect", "0,0,10,10", "--min-crop", "0"],
      ["--rect", "0,0,0,10"],
      ["--rect", "1.5,0,10,10"],
      ["--rect", "0,0,10,10", "--mask", "weird"],
      ["--select", "object:1,2,3"],
    ];
    for (const extra of invalid) {
      let called = 0;
      const err: string[] = [];
      const code = await main(["replace-region", ...base(d, extra)], {
        provision: async () => {
          called++;
          return report;
        },
        stdout: () => {},
        stderr: (t) => err.push(t),
      });
      expect(code, extra.join(" ")).toBe(1);
      expect(called).toBe(0);
    }
    // --out resolving to the input (via a symlink) is refused
    let called = 0;
    const code = await main(["replace-region", path.join(d, "in.png"), "--prompt", "p", "--out", path.join(d, "link.png"), "--rect", "0,0,10,10"], {
      provision: async () => {
        called++;
        return report;
      },
      stderr: () => {},
    });
    expect(code).toBe(1);
    expect(called).toBe(0);
    // --layered must differ from the input and from --out
    expect(parseReplaceArgs([...base(d, ["--rect", "0,0,1,1"]), "--layered", path.join(d, "in.png")]).ok).toBe(false);
    expect(parseReplaceArgs([...base(d, ["--rect", "0,0,1,1"]), "--layered", path.join(d, "out.png")]).ok).toBe(false);
  });

  it("E24b --out / --layered that are hard links to the input are refused (identity, not path strings)", () => {
    const d = dir();
    fs.linkSync(path.join(d, "in.png"), path.join(d, "hard.png"));
    const viaOut = parseReplaceArgs([path.join(d, "in.png"), "--prompt", "p", "--out", path.join(d, "hard.png"), "--rect", "0,0,1,1"]);
    expect(viaOut.ok === false && viaOut.error).toMatch(/--out resolves to the input/);
    const viaLayered = parseReplaceArgs([...base(d, ["--rect", "0,0,1,1"]), "--layered", path.join(d, "hard.png")]);
    expect(viaLayered.ok === false && viaLayered.error).toMatch(/--layered resolves to the input/);
  });

  it("E24 the pad message states the 3 × feather rule; boundary values are accepted", () => {
    const d = dir();
    const bad = parseReplaceArgs(base(d, ["--rect", "0,0,10,10", "--pad", "16", "--feather", "8"]));
    expect(bad.ok === false && bad.error).toMatch(/3 × --feather \(24\)/);
    expect(parseReplaceArgs(base(d, ["--rect", "0,0,10,10", "--pad", "24", "--feather", "8"])).ok).toBe(true);
    expect(parseReplaceArgs(base(d, ["--rect", "-5,-5,10,10"])).ok).toBe(true);
  });

  it("parses selectors, mask and generator options", () => {
    const d = dir();
    const r = parseReplaceArgs(base(d, ["--select", "object:100,50,120,100", "--mask", "selection", "--model", "m", "--flash", "--backend", "pi", "--keep-temp", "--layered", path.join(d, "o.psd")]));
    expect(r.ok && r.options).toMatchObject({
      selector: { kind: "object", hint: { x: 100, y: 50, w: 120, h: 100 } },
      mask: "selection",
      model: "m",
      flash: true,
      backend: "pi",
      keepTemp: true,
      pad: 32,
      feather: 8,
      minCrop: 256,
    });
  });
});

describe("geometry", () => {
  const img = (w: number, h: number) => ({ w, h });

  it("E25 crop: pad, min-crop growth, clipping, whole-image fallback", () => {
    expect(computeCrop({ x: 100, y: 50, w: 120, h: 100 }, img(320, 200), 24, 1)).toEqual({ x: 76, y: 26, w: 168, h: 148 });
    const grown = computeCrop({ x: 1000, y: 900, w: 42, h: 8 }, img(2000, 2000), 32, 256);
    expect(grown.w).toBeGreaterThanOrEqual(256);
    expect(grown.h).toBeGreaterThanOrEqual(256);
    expect(grown.x).toBeLessThanOrEqual(1000 - 32);
    expect(grown.x + grown.w).toBeGreaterThanOrEqual(1000 + 42 + 32);
    expect(grown.y).toBeLessThanOrEqual(900 - 32);
    expect(grown.y + grown.h).toBeGreaterThanOrEqual(900 + 8 + 32);
    const clipped = computeCrop({ x: 0, y: 0, w: 20, h: 20 }, img(2000, 2000), 32, 1);
    expect(clipped).toMatchObject({ x: 0, y: 0 });
    expect(clipped.w).toBeGreaterThanOrEqual(20);
    expect(computeCrop({ x: 50, y: 40, w: 20, h: 20 }, img(200, 150), 32, 256)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
    // growth lost at the corner moves to the open side; the region stays inside the crop
    expect(computeCrop({ x: 0, y: 0, w: 20, h: 20 }, img(2000, 2000), 32, 256)).toEqual({ x: 0, y: 0, w: 256, h: 256 });
    expect(computeCrop({ x: 1990, y: 1990, w: 10, h: 10 }, img(2000, 2000), 32, 256)).toEqual({ x: 1744, y: 1744, w: 256, h: 256 });
  });

  it("E26 bounds normalisation for both shapes round-trips", () => {
    expect(fromCorners([84, 34, 236, 166])).toEqual({ x: 84, y: 34, w: 152, h: 132 });
    expect(fromXywh([139, 96, 42, 8])).toEqual({ x: 139, y: 96, w: 42, h: 8 });
    expect(toCorners(fromCorners([84, 34, 236, 166]))).toEqual([84, 34, 236, 166]);
    expect(clipRect({ x: 400, y: 300, w: 10, h: 10 }, img(320, 200))).toBeNull();
    expect(clipRect({ x: -5, y: -5, w: 10, h: 10 }, img(320, 200))).toEqual({ x: 0, y: 0, w: 5, h: 5 });
  });

  it("E38 crop-mask inset is pad − feather, 0 on image-clipped sides", () => {
    expect(computeMask({ x: 517, y: 537, w: 256, h: 256 }, img(1024, 1024), 32, 8)).toEqual({ x: 541, y: 561, w: 208, h: 208 });
    expect(computeMask({ x: 0, y: 0, w: 200, h: 200 }, img(1024, 1024), 32, 8)).toEqual({ x: 0, y: 0, w: 176, h: 176 });
    expect(computeMask({ x: 0, y: 0, w: 200, h: 150 }, img(200, 150), 32, 8)).toEqual({ x: 0, y: 0, w: 200, h: 150 });
  });
});

// ── pipeline with injected runner + generator ───────────────────────────────

interface Harness {
  calls: string[][];
  out: string[];
  err: string[];
  deps: Partial<ReplaceDeps>;
  tmpRoot: string;
  input: string;
  gen: { requests: Parameters<ReplaceDeps["generate"]>[0][] };
}

function harness(over: { image?: [number, number]; selectOut?: string; failOn?: string; generate?: ReplaceDeps["generate"]; provisionError?: boolean } = {}): Harness {
  const [W, H] = over.image ?? [320, 200];
  const dir = tmpDir();
  const tmpRoot = path.join(dir, "tmp");
  fs.mkdirSync(tmpRoot);
  const input = path.join(dir, "in.png");
  fs.writeFileSync(input, "INPUT");
  const calls: string[][] = [];
  const out: string[] = [];
  const err: string[] = [];
  const gen: Harness["gen"] = { requests: [] };
  const touchOut = (args: string[]) => {
    const i = args.lastIndexOf("--out");
    if (i >= 0) fs.writeFileSync(args[i + 1], "IMG");
    if (args[0] === "convert") fs.writeFileSync(args[2], "FLAT");
  };
  const deps: Partial<ReplaceDeps> = {
    provision: async () => {
      if (over.provisionError) throw new Error("offline");
      return report;
    },
    run: async (_bin, args) => {
      calls.push(args);
      if (over.failOn && args.some((a) => a === over.failOn)) throw Object.assign(new Error("x"), { stderr: `error: ${over.failOn} exploded` });
      if (args[0] === "info") return { stdout: JSON.stringify({ width: W, height: H }), stderr: "" };
      touchOut(args);
      if (args.includes("select.object") || args.includes("select.sky") || args.includes("select.subject")) {
        if (!args.includes("select.saveSelection")) return { stdout: over.selectOut ?? `{"command":"select.object","result":{"bounds":[139,96,42,8],"changed":true,"selected":true}}\n`, stderr: "" };
      }
      return { stdout: "", stderr: "" };
    },
    generate:
      over.generate ??
      (async (req) => {
        gen.requests.push(req);
        fs.writeFileSync(req.output, "GEN");
        return { ok: true, model: null };
      }),
    tmpdir: () => tmpRoot,
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t),
    env: {},
  };
  return { calls, out, err, deps, tmpRoot, input, gen };
}

const opts = (h: Harness, extra: Partial<ReplaceOptions> = {}): ReplaceOptions => ({
  input: h.input,
  prompt: "make it orange",
  out: path.join(path.dirname(h.input), "out.png"),
  selector: { kind: "rect", rect: { x: 100, y: 50, w: 120, h: 100 } },
  mask: "crop",
  pad: 24,
  feather: 8,
  minCrop: 1,
  keepTemp: false,
  flash: false,
  ...extra,
});

const cmdIds = (args: string[]) => args.flatMap((a, i) => (args[i - 1] === "--cmd" ? [a] : []));
const paramsOf = (args: string[], id: string) => {
  const i = args.indexOf(id);
  return args[i + 1] === "--params" ? JSON.parse(args[i + 2]) : undefined;
};
const compositeCall = (h: Harness) => h.calls.find((c) => c.includes("file.placeEmbedded")) as string[];

describe("composite command list", () => {
  it("E27 default crop mask: rect and semantic selectors place at the crop and mask with the inset rect", async () => {
    for (const selector of [
      { kind: "rect", rect: { x: 100, y: 50, w: 120, h: 100 } },
      { kind: "object", hint: { x: 100, y: 50, w: 120, h: 100 } },
    ] as const) {
      const h = harness({ selectOut: `{"command":"select.object","result":{"bounds":[100,50,120,100],"changed":true,"selected":true}}\n` });
      expect(await replaceRegion(opts(h, { selector }), h.deps)).toBe(0);
      const c = compositeCall(h);
      // crop 76,26,168,148 (pad 24); inset = pad − feather = 16
      expect(paramsOf(c, "file.placeEmbedded")).toMatchObject({ fit: false, scale: 100, center: [160, 100] });
      expect(paramsOf(c, "select.rect")).toEqual({ x: 92, y: 42, width: 136, height: 116, feather: 8 });
      expect(cmdIds(c)).toContain("layer.layerMask.revealSelection");
      expect(cmdIds(c)).not.toContain("select.saveSelection");
      const resize = h.calls.find((a) => a.includes("image.imageSize")) as string[];
      expect(paramsOf(resize, "image.imageSize")).toMatchObject({ width: 168, height: 148 });
    }
  });

  it("E27 selection mask: object selector saves, deselects, loads and feathers; rect uses select.rect on the region", async () => {
    const h = harness({ selectOut: `{"command":"select.object","result":{"bounds":[100,50,120,100],"changed":true,"selected":true}}\n` });
    await replaceRegion(opts(h, { selector: { kind: "object", hint: { x: 100, y: 50, w: 120, h: 100 } }, mask: "selection" }), h.deps);
    const c = compositeCall(h);
    expect(cmdIds(c)).toEqual([
      "select.object",
      "select.saveSelection",
      "select.deselect",
      "file.placeEmbedded",
      "select.loadSelection",
      "select.modify.feather",
      "layer.layerMask.revealSelection",
    ]);
    expect(paramsOf(c, "select.saveSelection")).toEqual({ name: "pc_region" });
    expect(paramsOf(c, "select.loadSelection")).toEqual({ channel: "pc_region" });
    expect(paramsOf(c, "select.modify.feather")).toEqual({ radius: 8 });

    const h2 = harness();
    await replaceRegion(opts(h2, { mask: "selection" }), h2.deps);
    const c2 = compositeCall(h2);
    expect(paramsOf(c2, "select.rect")).toEqual({ x: 100, y: 50, width: 120, height: 100, feather: 8 });
    expect(cmdIds(c2)).not.toContain("select.saveSelection");
  });

  it("buildCompositeArgs omits select.modify.feather when feather is 0", () => {
    const args = buildCompositeArgs({
      input: "/i.png",
      patch: "/p.png",
      out: "/o.psd",
      crop: { x: 0, y: 0, w: 10, h: 10 },
      region: { x: 1, y: 1, w: 5, h: 5 },
      image: { w: 100, h: 100 },
      options: { selector: { kind: "subject" }, mask: "selection", pad: 0, feather: 0 },
    });
    expect(cmdIds(args)).not.toContain("select.modify.feather");
  });
});

describe("report + temp lifecycle", () => {
  it("E28 one JSON object with the documented keys; temp removed by default, kept with --keep-temp", async () => {
    const h = harness();
    expect(await replaceRegion(opts(h), h.deps)).toBe(0);
    expect(h.out).toHaveLength(1);
    const rep = JSON.parse(h.out[0]);
    expect(Object.keys(rep).sort()).toEqual(["backend", "crop", "layered", "model", "out", "region", "timings"].sort());
    expect(rep).toMatchObject({ model: null, layered: null, backend: "gemini", region: { x: 100, y: 50, w: 120, h: 100 }, crop: { x: 76, y: 26, w: 168, h: 148 } });
    expect(fs.readdirSync(h.tmpRoot)).toEqual([]);
    expect(fs.readFileSync(path.join(path.dirname(h.input), "out.png"), "utf8")).toBe("FLAT");

    const h2 = harness();
    await replaceRegion(opts(h2, { keepTemp: true }), h2.deps);
    expect(fs.readdirSync(h2.tmpRoot)).toHaveLength(1);
    expect(h2.err.join("")).toContain("kept intermediates");
  });

  it("--layered writes the unflattened composite beside --out", async () => {
    const h = harness();
    const layered = path.join(path.dirname(h.input), "out.psd");
    await replaceRegion(opts(h, { layered }), h.deps);
    expect(fs.existsSync(layered)).toBe(true);
    expect(JSON.parse(h.out[0]).layered).toBe(layered);
  });

  it("reports the model the generator printed, or the --model passed", async () => {
    const h = harness({ generate: async (r) => (fs.writeFileSync(r.output, "G"), { ok: true, model: "gem-x" }) });
    await replaceRegion(opts(h), h.deps);
    expect(JSON.parse(h.out[0]).model).toBe("gem-x");
    const h2 = harness();
    await replaceRegion(opts(h2, { model: "mine", backend: "pi" }), h2.deps);
    expect(JSON.parse(h2.out[0])).toMatchObject({ model: "mine", backend: "pi" });
  });
});

describe("generator subprocess", () => {
  it("E42 argv, and a failing subprocess is reported under the generate step", async () => {
    const dir = tmpDir();
    const output = path.join(dir, "gen.png");
    const spy: { file: string; args: string[] }[] = [];
    const exec = async (file: string, args: string[]) => {
      spy.push({ file, args });
      fs.writeFileSync(output, "G");
      return { stdout: "✓ image generated: x (pi · google/gemini-x) · ~$0.04 est.\n", stderr: "" };
    };
    const generate = makeGenerator(exec as never, () => "/pkg/pi-dashboard-nano-banana/bin/pi-nano-banana");
    const res = await generate({ prompt: "P", file: "/c.png", output, model: "gemini-3-pro-image", flash: true, backend: "pi" });
    expect(spy[0].file).toBe(process.execPath);
    expect(spy[0].args).toEqual(["/pkg/pi-dashboard-nano-banana/bin/pi-nano-banana", "P", "--file", "/c.png", "--output", output, "--model", "gemini-3-pro-image", "--flash", "--backend", "pi"]);
    expect(res).toEqual({ ok: true, model: "google/gemini-x" });

    const failing = makeGenerator((async () => {
      throw Object.assign(new Error("Command failed"), { stderr: "✗ no key\n" });
    }) as never, () => "/l");
    const h = harness({ generate: failing });
    expect(await replaceRegion(opts(h), h.deps)).toBe(1);
    expect(h.err.join("")).toMatch(/generate step failed.*no key/s);
  });

  it("generator exiting 0 without an image is a failure", async () => {
    const generate = makeGenerator((async () => ({ stdout: "", stderr: "" })) as never, () => "/l");
    expect(await generate({ prompt: "p", file: "/c", output: path.join(tmpDir(), "nope.png"), flash: false })).toMatchObject({ ok: false });
  });

  it("E47 launcher resolution: installed layout, checkout, missing package", () => {
    const root = tmpDir();
    const nm = path.join(root, "node_modules/@blackbelt-technology");
    const dist = path.join(nm, "pi-dashboard-photocraft/dist");
    fs.mkdirSync(dist, { recursive: true });
    fs.writeFileSync(path.join(dist, "photocraft.js"), "");
    fs.mkdirSync(path.join(nm, "pi-dashboard-nano-banana"), { recursive: true });
    fs.writeFileSync(path.join(nm, "pi-dashboard-nano-banana/package.json"), JSON.stringify({ name: "x", bin: { "pi-nano-banana": "bin/pi-nano-banana" } }));
    expect(resolveNanoBananaLauncher(`file://${path.join(dist, "photocraft.js")}`)).toBe(path.join(nm, "pi-dashboard-nano-banana/bin/pi-nano-banana"));

    const checkout = resolveNanoBananaLauncher(import.meta.url.replace("__tests__/region-replace.test.ts", "region-replace.ts"));
    expect(checkout).toMatch(/packages[\\/]nano-banana[\\/]bin[\\/]pi-nano-banana$/);
    expect(fs.existsSync(checkout)).toBe(true);

    const lonely = path.join(tmpDir(), "a.js");
    fs.writeFileSync(lonely, "");
    expect(() => resolveNanoBananaLauncher(`file://${lonely}`)).toThrow(/pi-dashboard-nano-banana/);
  });
});

describe("dual-output commit", () => {
  it("X15b a --layered destination that is a directory fails before anything is replaced", async () => {
    const h = harness();
    const out = path.join(path.dirname(h.input), "out.png");
    const layered = path.join(path.dirname(h.input), "layers.psd");
    fs.writeFileSync(out, "OLD");
    fs.mkdirSync(layered);
    const before = fs.readdirSync(path.dirname(h.input)).sort();
    expect(await replaceRegion(opts(h, { layered }), h.deps)).toBe(1);
    expect(h.err.join("")).toMatch(/write step failed/);
    expect(fs.readFileSync(out, "utf8")).toBe("OLD");
    expect(fs.readdirSync(path.dirname(h.input)).sort()).toEqual(before);
  });

  it("X15c a failing second rename restores a pre-existing first output and removes new ones", () => {
    const dir = tmpDir();
    const [srcA, srcB] = [path.join(dir, "a.src"), path.join(dir, "b.src")];
    fs.writeFileSync(srcA, "NEW-A");
    fs.writeFileSync(srcB, "NEW-B");
    const [destA, destB] = [path.join(dir, "out.png"), path.join(dir, "out.psd")];
    fs.writeFileSync(destA, "OLD-A"); // pre-existing; destB is new
    let stageRenames = 0;
    const flaky: typeof fs.renameSync = (from, to) => {
      if (String(from).includes(".pcr-t.tmp") && ++stageRenames === 2) throw new Error("disk says no");
      fs.renameSync(from, to);
    };
    const staged: string[] = [];
    expect(() => commitOutputs([[srcA, destA], [srcB, destB]], staged, "t", flaky)).toThrow("disk says no");
    expect(fs.readFileSync(destA, "utf8")).toBe("OLD-A");
    expect(fs.existsSync(destB)).toBe(false);
    for (const s of staged) fs.rmSync(s, { force: true });
    expect(fs.readdirSync(dir).sort()).toEqual(["a.src", "b.src", "out.png"]);
  });

  it("a successful commit replaces both outputs and leaves no backup or stage files", () => {
    const dir = tmpDir();
    fs.writeFileSync(path.join(dir, "a.src"), "NEW-A");
    fs.writeFileSync(path.join(dir, "b.src"), "NEW-B");
    fs.writeFileSync(path.join(dir, "out.png"), "OLD-A");
    const staged: string[] = [];
    commitOutputs([[path.join(dir, "a.src"), path.join(dir, "out.png")], [path.join(dir, "b.src"), path.join(dir, "out.psd")]], staged, "t");
    expect(fs.readFileSync(path.join(dir, "out.png"), "utf8")).toBe("NEW-A");
    expect(fs.readFileSync(path.join(dir, "out.psd"), "utf8")).toBe("NEW-B");
    expect(fs.readdirSync(dir).sort()).toEqual(["a.src", "b.src", "out.png", "out.psd"]);
    expect(staged).toEqual([]);
  });
});

describe("failure semantics", () => {
  it("X12 rect outside the image: exit 1 naming rect and size, generator uncalled; provisioning failure exits 69", async () => {
    const h = harness();
    const code = await replaceRegion(opts(h, { selector: { kind: "rect", rect: { x: 400, y: 300, w: 10, h: 10 } } }), h.deps);
    expect(code).toBe(1);
    expect(h.err.join("")).toMatch(/400,300,10,10.*320×200/);
    expect(h.gen.requests).toHaveLength(0);
    const h2 = harness({ provisionError: true });
    expect(await replaceRegion(opts(h2), h2.deps)).toBe(69);
    expect(h2.gen.requests).toHaveLength(0);
  });

  it("X13 empty selection (not selected / zero coverage / zero-area bounds) never reaches the generator", async () => {
    for (const result of [
      `{"command":"select.sky","result":{"selected":false,"coverage":0,"changed":false}}`,
      `{"command":"select.sky","result":{"selected":true,"coverage":0,"bounds":[0,0,5,5]}}`,
      `{"command":"select.sky","result":{"selected":true,"coverage":0.1,"bounds":[0,0,0,0]}}`,
    ]) {
      const h = harness({ selectOut: `${result}\n` });
      expect(await replaceRegion(opts(h, { selector: { kind: "sky" } }), h.deps)).toBe(1);
      expect(h.err.join("")).toMatch(/nothing was selected/);
      expect(h.gen.requests).toHaveLength(0);
    }
  });

  it("X14 generator failure leaves a pre-existing --out and the input untouched", async () => {
    const h = harness({ generate: async () => ({ ok: false, error: "no key" }) });
    const out = path.join(path.dirname(h.input), "out.png");
    fs.writeFileSync(out, "OLD");
    const before = fs.readdirSync(path.dirname(h.input)).sort();
    expect(await replaceRegion(opts(h), h.deps)).toBe(1);
    expect(h.err.join("")).toContain("generate step failed");
    expect(fs.readFileSync(out, "utf8")).toBe("OLD");
    expect(fs.readFileSync(h.input, "utf8")).toBe("INPUT");
    expect(fs.readdirSync(path.dirname(h.input)).sort()).toEqual(before);
  });

  it("X15 late composite failure creates neither --out nor --layered and removes the temp dir", async () => {
    const h = harness({ failOn: "file.placeEmbedded" });
    const layered = path.join(path.dirname(h.input), "out.psd");
    expect(await replaceRegion(opts(h, { layered }), h.deps)).toBe(1);
    expect(h.err.join("")).toMatch(/composite step failed/);
    expect(fs.existsSync(path.join(path.dirname(h.input), "out.png"))).toBe(false);
    expect(fs.existsSync(layered)).toBe(false);
    expect(fs.readdirSync(h.tmpRoot)).toEqual([]);
    expect(os.tmpdir()).toBeTruthy();
  });
});
