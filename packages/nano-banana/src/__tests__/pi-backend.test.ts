import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { batchGenerate, generateImage } from "../nano-banana.js";
import type { PiImageResponse, PiImageRuntime, PiModule } from "../pi-backend.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nb-pi-"));
  tmpDirs.push(d);
  return d;
}

const PNG_BYTES = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
const PNG = PNG_BYTES.toString("base64");
const CATALOGUE = [
  "google/gemini-2.5-flash-image",
  "google/gemini-3.1-flash-lite-image",
  "google/gemini-3-pro-image",
  "black-forest-labs/flux.2-pro",
];

interface GenerateCall {
  model: { provider: string; id: string };
  input: unknown[];
  options: { signal?: AbortSignal; maxRetries?: number };
}

type Responder = (call: GenerateCall, index: number) => PiImageResponse | Promise<PiImageResponse>;

const images = (n = 1): PiImageResponse => ({
  stopReason: "stop",
  output: Array.from({ length: n }, () => ({ type: "image" as const, mimeType: "image/png", data: PNG })),
});

function fakeRuntime(respond: Responder = () => images(1), catalogue: string[] = CATALOGUE) {
  const generate: GenerateCall[] = [];
  const lookups: unknown[][] = [];
  const runtime: PiImageRuntime = {
    getModelsOfType: () => catalogue.map((id) => ({ provider: "openrouter", id })),
    getModelOfType: (type, provider, id) => {
      lookups.push([type, provider, id]);
      return catalogue.includes(id) ? { provider: "openrouter", id } : undefined;
    },
    generateImages: async (model, ctx, options) => {
      const call = { model, input: ctx.input, options: options ?? {} } as GenerateCall;
      generate.push(call);
      return respond(call, generate.length - 1);
    },
  };
  return { runtime, generate, lookups };
}

/** Loader returning a module whose `ModelRuntime.create` captures options. */
function fakeModule(version: string, created: unknown = fakeRuntime().runtime) {
  const createCalls: unknown[] = [];
  const mod: PiModule = {
    VERSION: version,
    ModelRuntime: {
      create: async (o: unknown) => {
        createCalls.push(o);
        return created;
      },
    },
  };
  return { loadPi: async () => mod, createCalls };
}

describe("pi runtime generation", () => {
  it("E5 sends the prompt as a text block with maxRetries 0 and a signal", async () => {
    const f = fakeRuntime();
    const dir = tmp();
    const res = await generateImage({
      prompt: "a red fox",
      backend: "pi",
      output: path.join(dir, "fox.png"),
      createPiRuntime: async () => f.runtime,
    });
    expect(res.ok).toBe(true);
    expect(res.backend).toBe("pi");
    expect(f.generate).toHaveLength(1);
    expect(f.generate[0].input).toEqual([{ type: "text", text: "a red fox" }]);
    expect(f.generate[0].options.maxRetries).toBe(0);
    expect(f.generate[0].options.signal).toBeInstanceOf(AbortSignal);
  });

  it("E6 creates the runtime without models.json or refresh", async () => {
    const { loadPi, createCalls } = fakeModule("1.0.0");
    const res = await generateImage({ prompt: "x", backend: "pi", output: path.join(tmp(), "a.png"), loadPi });
    expect(res.ok).toBe(true);
    expect(createCalls).toHaveLength(1);
    expect(createCalls[0]).toMatchObject({ modelsPath: null, refreshOnCreate: false });
  });

  it("E7 batch creates exactly one runtime for 5 jobs", async () => {
    const dir = tmp();
    let factoryCalls = 0;
    const f = fakeRuntime();
    const results = await batchGenerate({
      backend: "pi",
      jobs: Array.from({ length: 5 }, (_, i) => ({ name: `j${i}`, prompt: `p${i}`, output: path.join(dir, `${i}.png`) })),
      createPiRuntime: async () => {
        factoryCalls++;
        return f.runtime;
      },
    });
    expect(factoryCalls).toBe(1);
    expect(results).toHaveLength(5);
    expect(results.every((r) => r.ok && r.backend === "pi")).toBe(true);
  });

  it("E8 fully skipped batch never loads pi or creates a runtime", async () => {
    const dir = tmp();
    const jobs = [0, 1, 2].map((i) => {
      const output = path.join(dir, `${i}.png`);
      fs.writeFileSync(output, "x");
      return { name: `j${i}`, prompt: "p", output };
    });
    let factoryCalls = 0;
    let loaderCalls = 0;
    const results = await batchGenerate({
      backend: "pi",
      jobs,
      createPiRuntime: async () => {
        factoryCalls++;
        return fakeRuntime().runtime;
      },
      loadPi: async () => {
        loaderCalls++;
        throw new Error("no");
      },
    });
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.skipped).toBe(true);
      expect(r).not.toHaveProperty("backend");
    }
    expect(factoryCalls).toBe(0);
    expect(loaderCalls).toBe(0);
  });
});

describe("edit input validation", () => {
  it("E9 sends the edit image (case-insensitive ext) before the prompt", async () => {
    const dir = tmp();
    const file = path.join(dir, "in.PNG");
    fs.writeFileSync(file, PNG_BYTES);
    const f = fakeRuntime();
    const res = await generateImage({
      prompt: "make it night",
      file,
      backend: "pi",
      output: path.join(dir, "out.png"),
      createPiRuntime: async () => f.runtime,
    });
    expect(res.ok).toBe(true);
    expect(f.generate[0].input[0]).toEqual({ type: "image", mimeType: "image/png", data: PNG });
    expect(f.generate[0].input[1]).toEqual({ type: "text", text: "make it night" });
  });

  it("E10 rejects an unsupported input type without calling generateImages", async () => {
    const dir = tmp();
    const file = path.join(dir, "in.heic");
    fs.writeFileSync(file, "x");
    const f = fakeRuntime();
    const res = await generateImage({ prompt: "x", file, backend: "pi", createPiRuntime: async () => f.runtime });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(".heic");
    expect(f.generate).toHaveLength(0);
  });

  it("X8 reports a missing edit file naming the path", async () => {
    const f = fakeRuntime();
    const res = await generateImage({
      prompt: "x",
      file: "/nope/in.png",
      backend: "pi",
      createPiRuntime: async () => f.runtime,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("/nope/in.png");
    expect(f.generate).toHaveLength(0);
  });
});

describe("model mapping", () => {
  const run = async (opts: { model?: string; flash?: boolean }, catalogue?: string[]) => {
    const f = fakeRuntime(undefined, catalogue);
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      output: path.join(tmp(), "a.png"),
      createPiRuntime: async () => f.runtime,
      ...opts,
    });
    return { res, f };
  };

  it("E11 defaults to openrouter/google/gemini-2.5-flash-image", async () => {
    const { res, f } = await run({});
    expect(f.generate[0].model.id).toBe("google/gemini-2.5-flash-image");
    expect(res.model).toBe("openrouter/google/gemini-2.5-flash-image");
  });

  it("E12 flash selects google/gemini-3.1-flash-lite-image", async () => {
    const { res } = await run({ flash: true });
    expect(res.model).toContain("google/gemini-3.1-flash-lite-image");
  });

  it("E13 prefixes a bare id with google/", async () => {
    const { res, f } = await run({ model: "gemini-3-pro-image" });
    expect(f.lookups).toContainEqual(["image", "openrouter", "google/gemini-3-pro-image"]);
    expect(f.generate[0].model.id).toBe("google/gemini-3-pro-image");
    expect(res.ok).toBe(true);
  });

  it("E14 model beats flash", async () => {
    const { res } = await run({ model: "gemini-3-pro-image", flash: true });
    expect(res.model).toBe("openrouter/google/gemini-3-pro-image");
  });

  it("E15 unknown bare id lists google/ ids only", async () => {
    const { res, f } = await run({ model: "gemini-2.0-flash" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("google/gemini-2.5-flash-image");
    expect(res.error).not.toContain("black-forest-labs/");
    expect(f.generate).toHaveLength(0);
  });

  it("E16 unknown slash id lists all image ids", async () => {
    const { res } = await run({ model: "black-forest-labs/flux.2-pr" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("black-forest-labs/flux.2-pro");
  });

  it("E17 empty candidate list says pi has no matching image models", async () => {
    const { res } = await run({ model: "x" }, ["black-forest-labs/flux.2-pro"]);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no matching image models/);
  });
});

describe("outputs and usage", () => {
  it("E18 writes two images as a.png and a-2.png", async () => {
    const dir = tmp();
    const f = fakeRuntime(() => images(2));
    const output = path.join(dir, "out", "a.png");
    const res = await generateImage({ prompt: "x", backend: "pi", output, createPiRuntime: async () => f.runtime });
    expect(res.ok).toBe(true);
    expect(res.output).toBe(output);
    expect(fs.existsSync(output)).toBe(true);
    expect(fs.existsSync(path.join(dir, "out", "a-2.png"))).toBe(true);
    expect(res.outputs).toEqual([
      { path: output, mimeType: "image/png" },
      { path: path.join(dir, "out", "a-2.png"), mimeType: "image/png" },
    ]);
  });

  it("E19 extra image takes the lowest free suffix, never overwrites", async () => {
    const dir = tmp();
    fs.mkdirSync(path.join(dir, "out"));
    fs.writeFileSync(path.join(dir, "out", "a-2.png"), "OLD");
    const f = fakeRuntime(() => images(2));
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      output: path.join(dir, "out", "a.png"),
      createPiRuntime: async () => f.runtime,
    });
    expect(res.ok).toBe(true);
    expect(res.outputs?.[1]?.path).toBe(path.join(dir, "out", "a-3.png"));
    expect(fs.readFileSync(path.join(dir, "out", "a-2.png"), "utf8")).toBe("OLD");
  });

  it("E20 concurrent unnamed outputs in the same ms never collide", async () => {
    const dir = tmp();
    const cwd = process.cwd();
    process.chdir(dir);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 2, 3, 4, 5, 678));
    try {
      const f = fakeRuntime();
      const both = await Promise.all([
        generateImage({ prompt: "a", backend: "pi", createPiRuntime: async () => f.runtime }),
        generateImage({ prompt: "b", backend: "pi", createPiRuntime: async () => f.runtime }),
      ]);
      expect(both.every((r) => r.ok)).toBe(true);
      const files = fs.readdirSync(dir).filter((n) => /^nano-banana-.*\.png$/.test(n));
      expect(files).toHaveLength(2);
      for (const n of files) expect(fs.statSync(path.join(dir, n)).size).toBeGreaterThan(0);
    } finally {
      vi.useRealTimers();
      process.chdir(cwd);
    }
  });

  it("E21 surfaces usage", async () => {
    const f = fakeRuntime(() => ({
      ...images(1),
      usage: { input: 10, output: 20, cost: { total: 0.039 } },
    }));
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      output: path.join(tmp(), "a.png"),
      createPiRuntime: async () => f.runtime,
    });
    expect(res.usage?.cost.total).toBe(0.039);
  });

  it("X9 unwritable output resolves ok:false naming the path", async () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "ro"), "file, not dir");
    const output = path.join(dir, "ro", "a.png");
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      output,
      createPiRuntime: async () => fakeRuntime().runtime,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain(output);
  });

  it("X10 text-only response fails with the text and writes nothing", async () => {
    const dir = tmp();
    const f = fakeRuntime(() => ({ stopReason: "stop", output: [{ type: "text", text: "cannot draw that" }] }));
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      output: path.join(dir, "a.png"),
      createPiRuntime: async () => f.runtime,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("cannot draw that");
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it("X11 empty response fails with 'no image returned'", async () => {
    const f = fakeRuntime(() => ({ stopReason: "stop", output: [] }));
    const res = await generateImage({ prompt: "x", backend: "pi", createPiRuntime: async () => f.runtime });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("no image returned");
  });
});

describe("availability guard", () => {
  it("E22 older pi fails naming both versions without creating a runtime", async () => {
    const { loadPi, createCalls } = fakeModule("0.86.1");
    const res = await generateImage({ prompt: "x", backend: "pi", loadPi });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("0.86.1");
    expect(res.error).toContain("1.0.0");
    expect(createCalls).toHaveLength(0);
  });

  it("E23 a prerelease of the floor counts as below", async () => {
    const { loadPi } = fakeModule("1.0.0-rc.1");
    const res = await generateImage({ prompt: "x", backend: "pi", loadPi });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("1.0.0-rc.1");
  });

  it.each(["1.0.0", "1.0.1"])("E24 accepts VERSION %s", async (v) => {
    const { loadPi } = fakeModule(v);
    const res = await generateImage({ prompt: "x", backend: "pi", output: path.join(tmp(), "a.png"), loadPi });
    expect(res.ok).toBe(true);
  });

  it("X1 import failure names the package and floor", async () => {
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      loadPi: async () => {
        throw new Error("Cannot find module '@earendil-works/pi-coding-agent'");
      },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("@earendil-works/pi-coding-agent");
    expect(res.error).toContain(">= 1.0.0");
  });

  it("X2 create rejection becomes a result", async () => {
    const loadPi = async (): Promise<PiModule> => ({
      VERSION: "1.0.0",
      ModelRuntime: {
        create: async () => {
          throw new Error("auth.json unreadable");
        },
      },
    });
    const res = await generateImage({ prompt: "x", backend: "pi", loadPi });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("auth.json unreadable");
  });

  it("X3 a runtime lacking the image methods fails naming the package and floor", async () => {
    const { loadPi } = fakeModule("1.0.0", {});
    const res = await generateImage({ prompt: "x", backend: "pi", loadPi });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("@earendil-works/pi-coding-agent");
    expect(res.error).toContain("1.0.0");
  });
});

describe("provider errors and timeout", () => {
  it("X4 provider error is reported verbatim", async () => {
    const f = fakeRuntime(() => ({ stopReason: "error", output: [], errorMessage: "insufficient credits" }));
    const res = await generateImage({ prompt: "x", backend: "pi", createPiRuntime: async () => f.runtime });
    expect(res.ok).toBe(false);
    expect(res.error).toBe("insufficient credits");
  });

  it("X5 not-configured error gets a login hint", async () => {
    const f = fakeRuntime(() => ({
      stopReason: "error",
      output: [],
      errorMessage: "Provider is not configured: openrouter",
    }));
    const res = await generateImage({ prompt: "x", backend: "pi", createPiRuntime: async () => f.runtime });
    expect(res.error).toContain("Provider is not configured: openrouter");
    expect(res.error).toContain("/login openrouter");
    expect(res.error).toContain("OPENROUTER_API_KEY");
  });

  const abortingRuntime = (errorMessage?: string) =>
    fakeRuntime(
      (call) =>
        new Promise<PiImageResponse>((resolve) => {
          call.options.signal?.addEventListener("abort", () =>
            resolve({ stopReason: "aborted", output: [], ...(errorMessage ? { errorMessage } : {}) }),
          );
        }),
    );

  it("X6 timeout is reported and bounded", async () => {
    const f = abortingRuntime();
    const t0 = Date.now();
    const res = await generateImage({ prompt: "x", backend: "pi", timeoutMs: 50, createPiRuntime: async () => f.runtime });
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.ok).toBe(false);
    expect(res.error).toBe("timed out after 50 ms");
  });

  it("X7 a late provider error is appended to the timeout", async () => {
    const f = abortingRuntime("HTTP 500");
    const res = await generateImage({ prompt: "x", backend: "pi", timeoutMs: 50, createPiRuntime: async () => f.runtime });
    expect(res.error).toBe("timed out after 50 ms: HTTP 500");
  });
});

describe("batch on the pi backend", () => {
  it("X12 one failing job does not reject the batch", async () => {
    const dir = tmp();
    const f = fakeRuntime((call) =>
      (call.input.at(-1) as { text: string }).text === "p1"
        ? { stopReason: "error", output: [], errorMessage: "boom" }
        : images(1),
    );
    const results = await batchGenerate({
      backend: "pi",
      jobs: [0, 1, 2].map((i) => ({ name: `j${i}`, prompt: `p${i}`, output: path.join(dir, `${i}.png`) })),
      createPiRuntime: async () => f.runtime,
    });
    expect(results).toHaveLength(3);
    expect(results.filter((r) => !r.ok)).toHaveLength(1);
  });

  it("X13 guard failure fails every non-skipped job", async () => {
    const dir = tmp();
    const existing = path.join(dir, "0.png");
    fs.writeFileSync(existing, "x");
    const results = await batchGenerate({
      backend: "pi",
      jobs: [0, 1, 2].map((i) => ({ name: `j${i}`, prompt: "p", output: path.join(dir, `${i}.png`) })),
      loadPi: async () => {
        throw new Error("Cannot find module");
      },
    });
    expect(results.filter((r) => r.skipped)).toHaveLength(1);
    const failed = results.filter((r) => !r.ok);
    expect(failed).toHaveLength(2);
    for (const r of failed) expect(r.error).toContain("@earendil-works/pi-coding-agent");
  });
});
