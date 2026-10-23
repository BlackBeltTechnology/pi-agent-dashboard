import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  batchGenerate,
  buildArgs,
  createNpxRunner,
  generateImage,
  NANO_BANANA_PKG,
  type NanoBananaRunner,
} from "../nano-banana.js";

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
    ).toEqual(["--prompt", "a cat", "--file", "in.png", "--output", "out.png", "--model", "m", "--flash"]);
  });

  it("emits only the prompt when no options", () => {
    expect(buildArgs({ prompt: "just this" })).toEqual(["--prompt", "just this"]);
  });

  // BE31 — a dash-leading prompt is the value of --prompt, never a flag
  it.each([
    "--output /tmp/x.png a cat",
    "-a red logo",
    "--",
    "-",
    "",
    "a cat",
    "line1\nline2",
  ])("BE31 prompt %j is one unchanged --prompt value", (prompt) => {
    for (const extra of [
      {},
      { output: "/tmp/o.png" },
      { model: "m" },
      { flash: true },
      { file: "in.png" },
      { output: "/tmp/o.png", model: "m", flash: true, file: "in.png" },
    ]) {
      const args = buildArgs({ prompt, ...extra });
      expect(args[0]).toBe("--prompt");
      expect(args[1]).toBe(prompt);
      expect(args.filter((a) => a === "--prompt")).toHaveLength(1);
      expect(args.filter((a) => a === "--output")).toHaveLength("output" in extra ? 1 : 0);
      expect(args.includes("--model")).toBe("model" in extra);
      expect(args.includes("--flash")).toBe("flash" in extra);
      expect(args.includes("--file")).toBe("file" in extra);
    }
  });
});

describe("npx runner", () => {
  const execPath = "/opt/node/bin/node";
  const first = path.join("/opt/node/bin", "node_modules", "npm", "bin", "npx-cli.js");
  const second = path.join("/opt/node/bin", "..", "lib", "node_modules", "npm", "bin", "npx-cli.js");

  // BE32
  it.each(["linux", "darwin"] as const)("BE32 %s spawns npx -y with the exact pinned package", async (platform) => {
    const calls: Array<[string, string[], Record<string, unknown>]> = [];
    const exec = (async (f: string, a: string[], o: Record<string, unknown>) => {
      calls.push([f, a, o]);
      return { stdout: "", stderr: "" };
    }) as never;
    const res = await createNpxRunner({ platform, exec })(["--prompt", "x"], { GEMINI_API_KEY: "k" });
    expect(res.code).toBe(0);
    const [file, args, opts] = calls[0];
    expect(file).toBe("npx");
    expect(args.slice(0, 3)).toEqual(["-y", "@the-focus-ai/nano-banana@1.0.10", "--prompt"]);
    expect(args.join(" ")).not.toContain("@latest");
    expect(NANO_BANANA_PKG).toBe("@the-focus-ai/nano-banana@1.0.10");
    expect((opts.env as Record<string, string>).GEMINI_API_KEY).toBe("k");
    expect(opts.shell).toBe(false);
  });

  it("BE32 win32 with a resolvable entry also uses the pinned package", async () => {
    const calls: string[][] = [];
    const exec = (async (_f: string, a: string[]) => {
      calls.push(a);
      return { stdout: "", stderr: "" };
    }) as never;
    await createNpxRunner({ platform: "win32", execPath, exists: (p) => p === first, exec })([], {});
    expect(calls[0]).toContain("@the-focus-ai/nano-banana@1.0.10");
  });

  it("BE32 pi backend spawns nothing", async () => {
    let spawned = 0;
    const runner = createNpxRunner({
      exec: (async () => {
        spawned++;
        return { stdout: "", stderr: "" };
      }) as never,
    });
    const res = await generateImage({
      prompt: "x",
      backend: "pi",
      runner,
      loadPi: async () => {
        throw new Error("no pi");
      },
    });
    expect(spawned).toBe(0);
    expect(res.backend).toBe("pi");
  });

  // BE33
  it.each([
    ["node_modules only", (p: string) => p === first, first],
    ["lib/node_modules only", (p: string) => p === second, second],
    ["both exist (first wins)", () => true, first],
  ])("BE33 win32 runs process.execPath on the npx entry — %s", async (_n, exists, entry) => {
    const calls: Array<[string, string[]]> = [];
    const exec = (async (f: string, a: string[]) => {
      calls.push([f, a]);
      return { stdout: "", stderr: "" };
    }) as never;
    const nasty = ['a cat & dog | "logo"', "m&%!^ x", 'f&%!^"q" a.png', 'o&%!^ "z".png'];
    const res = await createNpxRunner({ platform: "win32", execPath, exists, exec })(
      ["--prompt", nasty[0], "--model", nasty[1], "--file", nasty[2], "--output", nasty[3]],
      {},
    );
    expect(res.code).toBe(0);
    expect(calls).toHaveLength(1);
    const [file, args] = calls[0];
    expect(file).toBe(execPath);
    expect(file).not.toMatch(/cmd/i);
    expect(args[0]).toBe(entry);
    expect(args.slice(1, 3)).toEqual(["-y", "@the-focus-ai/nano-banana@1.0.10"]);
    for (const v of nasty) expect(args.filter((a) => a === v)).toHaveLength(1);
    expect(args).not.toContain("/c");
  });

  // BX7
  it("BX7 win32 with no npx entry refuses and spawns nothing", async () => {
    let spawned = 0;
    const runner = createNpxRunner({
      platform: "win32",
      execPath,
      exists: () => false,
      exec: (async () => {
        spawned++;
        return { stdout: "", stderr: "" };
      }) as never,
    });
    const dir = tmp();
    const output = path.join(dir, "made", "x.png");
    const res = await generateImage({
      prompt: "a & b",
      model: "m&x",
      file: "in&.png",
      output,
      cliKey: "k",
      runner,
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/npx/);
    expect(res.error).toMatch(/Windows/);
    expect(spawned).toBe(0);
  });

  it("BX7 invalid backend is still validated first and creates no directory", async () => {
    const dir = tmp();
    const output = path.join(dir, "made", "x.png");
    const res = await generateImage({ prompt: "a & b", output, backend: "nope" as never, cliKey: "k" });
    expect(res.ok).toBe(false);
    expect(fs.existsSync(path.join(dir, "made"))).toBe(false);
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
