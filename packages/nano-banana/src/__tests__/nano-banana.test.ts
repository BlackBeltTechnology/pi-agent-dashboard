import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { batchGenerate, buildArgs, generateImage, type NanoBananaRunner } from "../nano-banana.js";

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nb-"));
  tmpDirs.push(d);
  return d;
}

describe("buildArgs", () => {
  it("assembles prompt + flags in order", () => {
    expect(
      buildArgs({ prompt: "a cat", file: "in.png", output: "out.png", model: "m", flash: true }),
    ).toEqual(["a cat", "--file", "in.png", "--output", "out.png", "--model", "m", "--flash"]);
  });

  it("emits only the prompt when no options", () => {
    expect(buildArgs({ prompt: "just this" })).toEqual(["just this"]);
  });
});

describe("generateImage", () => {
  it("fails clearly when no key resolves", async () => {
    const res = await generateImage({ prompt: "x", env: {}, baseDir: tmp(), packageDir: tmp() });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("GEMINI_API_KEY");
  });

  it("writes output when the runner succeeds", async () => {
    const dir = tmp();
    const output = path.join(dir, "sub", "img.png");
    const runner: NanoBananaRunner = async (args, env) => {
      expect(env.GEMINI_API_KEY).toBe("k");
      expect(args).toContain("a cat");
      fs.writeFileSync(output, "png");
      return { code: 0, stderr: "" };
    };
    const res = await generateImage({ prompt: "a cat", output, cliKey: "k", runner });
    expect(res.ok).toBe(true);
    expect(res.output).toBe(output);
    expect(fs.existsSync(output)).toBe(true);
  });

  it("reports runner failure with stderr tail", async () => {
    const runner: NanoBananaRunner = async () => ({ code: 2, stderr: "boom safety filter" });
    const res = await generateImage({ prompt: "x", cliKey: "k", runner });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("boom");
  });
});

describe("batchGenerate", () => {
  it("skips existing outputs and generates the rest", async () => {
    const dir = tmp();
    const existing = path.join(dir, "a.png");
    fs.writeFileSync(existing, "x");
    const runner: NanoBananaRunner = async (args) => {
      const out = args[args.indexOf("--output") + 1];
      fs.writeFileSync(out, "png");
      return { code: 0, stderr: "" };
    };
    const results = await batchGenerate({
      jobs: [
        { name: "a", prompt: "pa", output: existing },
        { name: "b", prompt: "pb", output: path.join(dir, "b.png") },
      ],
      cliKey: "k",
      runner,
      concurrency: 2,
    });
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.a.skipped).toBe(true);
    expect(byName.b.ok).toBe(true);
    expect(byName.b.skipped).toBeUndefined();
  });
});

describe("backend selection (opt-in pi)", () => {
  const spyLoader = () => {
    const calls = { n: 0 };
    const loadPi = async () => {
      calls.n++;
      throw new Error("must not load pi");
    };
    return { calls, loadPi };
  };

  it("E1 defaults to gemini and never loads pi", async () => {
    const { calls, loadPi } = spyLoader();
    let ran = 0;
    const runner: NanoBananaRunner = async () => {
      ran++;
      return { code: 0, stderr: "" };
    };
    const res = await generateImage({ prompt: "x", env: { GEMINI_API_KEY: "k" }, runner, loadPi });
    expect(ran).toBe(1);
    expect(res.ok).toBe(true);
    expect(res.backend).toBe("gemini");
    expect(calls.n).toBe(0);
  });

  it("E2 no Gemini key does not fall back to pi", async () => {
    const { calls, loadPi } = spyLoader();
    const res = await generateImage({ prompt: "x", env: {}, baseDir: tmp(), packageDir: tmp(), loadPi });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("GEMINI_API_KEY");
    expect(res.error).toContain("--backend pi");
    expect(calls.n).toBe(0);
  });

  it("E3 NANO_BANANA_BACKEND does not switch library callers", async () => {
    const { calls, loadPi } = spyLoader();
    const prev = process.env.NANO_BANANA_BACKEND;
    process.env.NANO_BANANA_BACKEND = "pi";
    try {
      let ran = 0;
      const runner: NanoBananaRunner = async () => {
        ran++;
        return { code: 0, stderr: "" };
      };
      await generateImage({ prompt: "x", env: { GEMINI_API_KEY: "k" }, runner, loadPi });
      expect(ran).toBe(1);
      expect(calls.n).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.NANO_BANANA_BACKEND;
      else process.env.NANO_BANANA_BACKEND = prev;
    }
  });

  it("E4 invalid backend fails before mkdir or generation", async () => {
    const { calls, loadPi } = spyLoader();
    const dir = tmp();
    let ran = 0;
    const runner: NanoBananaRunner = async () => {
      ran++;
      return { code: 0, stderr: "" };
    };
    const res = await generateImage({
      prompt: "x",
      cliKey: "k",
      output: path.join(dir, "new-dir", "a.png"),
      backend: "openai" as never,
      runner,
      loadPi,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("gemini");
    expect(res.error).toContain("pi");
    expect(fs.existsSync(path.join(dir, "new-dir"))).toBe(false);
    expect(ran).toBe(0);
    expect(calls.n).toBe(0);
  });
});
