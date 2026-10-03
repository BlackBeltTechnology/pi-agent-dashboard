import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { formatResult, parseArgs, resolveBackend, USAGE } from "../bin/nano-banana.js";
import { batchGenerate, generateImage, type NanoBananaRunner } from "../nano-banana.js";

const BIN = fileURLToPath(new URL("../bin/nano-banana.ts", import.meta.url));
const PKG_DIR = fileURLToPath(new URL("../..", import.meta.url));

/** Run the bin through tsx (resolves the `.js` → `.ts` imports) as a subprocess. */
function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const base = { ...process.env };
  delete base.NANO_BANANA_BACKEND;
  return spawnSync(process.execPath, ["--import", "tsx", BIN, ...args], {
    cwd: PKG_DIR,
    encoding: "utf8",
    env: { ...base, ...env },
    timeout: 20_000,
  });
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
  tmpDirs.length = 0;
});
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "nb-cli-"));
  tmpDirs.push(d);
  return d;
}

describe("client: Gemini results carry backend", () => {
  it("E25 success and failure both report backend gemini", async () => {
    const okRunner: NanoBananaRunner = async () => ({ code: 0, stderr: "" });
    const failRunner: NanoBananaRunner = async () => ({ code: 1, stderr: "boom" });
    const ok = await generateImage({ prompt: "x", cliKey: "k", runner: okRunner });
    const fail = await generateImage({ prompt: "x", cliKey: "k", runner: failRunner });
    expect(ok.backend).toBe("gemini");
    expect(fail.backend).toBe("gemini");
    expect(fail.error).toBe("boom");
  });

  it("E26 batch: skipped job has no backend, generated job has gemini", async () => {
    const dir = tmp();
    const existing = path.join(dir, "a.png");
    fs.writeFileSync(existing, "x");
    const runner: NanoBananaRunner = async (args) => {
      fs.writeFileSync(args[args.indexOf("--output") + 1], "png");
      return { code: 0, stderr: "" };
    };
    const results = await batchGenerate({
      jobs: [
        { name: "a", prompt: "pa", output: existing },
        { name: "b", prompt: "pb", output: path.join(dir, "b.png") },
      ],
      cliKey: "k",
      runner,
    });
    const byName = Object.fromEntries(results.map((r) => [r.name, r]));
    expect(byName.a).not.toHaveProperty("backend");
    expect(byName.b.backend).toBe("gemini");
  });
});

describe("cli: parsing and backend resolution", () => {
  it("E27 parses --backend", () => {
    const parsed = parseArgs(["a fox", "--backend", "pi"]);
    expect(parsed.backend).toBe("pi");
    expect(parsed.prompt).toBe("a fox");
  });

  it("E29 resolves the backend from a trimmed, lower-cased env value", () => {
    expect(resolveBackend(undefined, { NANO_BANANA_BACKEND: " PI " })).toEqual({ ok: true, backend: "pi" });
  });

  it("resolves the flag before env and defaults to gemini", () => {
    expect(resolveBackend("gemini", { NANO_BANANA_BACKEND: "pi" })).toEqual({ ok: true, backend: "gemini" });
    expect(resolveBackend(undefined, {})).toEqual({ ok: true, backend: "gemini" });
  });
});

describe("cli: result formatting", () => {
  it("E31 pi success line with and without usage", () => {
    const base = { ok: true, backend: "pi" as const, output: "a.png", model: "openrouter/google/gemini-2.5-flash-image" };
    expect(formatResult({ ...base, usage: { input: 1, output: 1, cost: { total: 0.000412 } } })).toEqual({
      stream: "stdout",
      line: "\u2713 image generated: a.png (pi \u00b7 openrouter/google/gemini-2.5-flash-image) \u00b7 ~$0.00041 est.",
    });
    expect(formatResult(base).line).toBe(
      "\u2713 image generated: a.png (pi \u00b7 openrouter/google/gemini-2.5-flash-image)",
    );
  });

  it("E32 pi failure line", () => {
    expect(formatResult({ ok: false, backend: "pi", error: "insufficient credits" })).toEqual({
      stream: "stderr",
      line: "\u2717 generation failed (pi): insufficient credits",
    });
  });

  it("Gemini lines are unchanged", () => {
    expect(formatResult({ ok: true, backend: "gemini", output: "a.png" }).line).toBe("\u2713 image generated: a.png");
    expect(formatResult({ ok: false, backend: "gemini", error: "boom" }).line).toBe("\u2717 generation failed: boom");
  });
});

describe("cli: subprocess", () => {
  it.each([
    [["a fox", "--backend", "openai"]],
    [["a fox", "--backend"]],
  ])("E28 invalid/missing --backend value prints usage and exits 1 (%j)", (argv) => {
    const r = runCli(argv);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[--backend gemini|pi]");
    expect(r.stderr).toContain(USAGE);
  });

  it("E30 invalid NANO_BANANA_BACKEND exits 1 without generating", () => {
    const r = runCli(["x"], { NANO_BANANA_BACKEND: "openai" });
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe("\u2717 NANO_BANANA_BACKEND must be gemini or pi");
    expect(r.stdout).toBe("");
  });

  it("E33 missing prompt prints exactly the usage line", () => {
    const r = runCli([]);
    expect(r.status).toBe(1);
    expect(r.stderr.trim()).toBe(USAGE);
    expect(USAGE).toBe(
      'usage: pi-nano-banana "<prompt>" [--file in.png] [--output out.png] [--model id] [--flash] [--api-key KEY] [--backend gemini|pi]',
    );
  });
});
