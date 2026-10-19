import * as fs from "node:fs";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { DENIED_VAR, ROOTS_VAR, type TmpTree, tmpTree } from "./helpers.js";

/**
 * pi's loader/runner are imported dynamically with a minimal local shape: the repo-wide root
 * `tsc` (tsconfig `paths` onto the package directory) does not see pi's `.ts`-specifier
 * re-exports as named exports, while vitest/jiti resolve them fine at runtime.
 */
interface LoadedExt {
  handlers: Map<string, unknown[]>;
}
interface PiRuntime {
  discoverAndLoadExtensions(paths: string[], cwd: string, agentDir?: string): Promise<{ extensions: LoadedExt[]; errors: unknown[]; runtime: unknown }>;
  ExtensionRunner: new (extensions: LoadedExt[], runtime: unknown, cwd: string, sessions: unknown, models: unknown) => {
    emitToolCall(event: unknown): Promise<{ block?: boolean; reason?: string } | undefined>;
  };
  SessionManager: { inMemory(cwd: string): unknown };
}
const loadPi = async (): Promise<PiRuntime> => (await import("@earendil-works/pi-coding-agent")) as unknown as PiRuntime;

const here = nodePath.dirname(fileURLToPath(import.meta.url));
const ENTRY = nodePath.resolve(here, "../extension.ts");

/** Load the guard (+ optional stub extensions) through pi's real loader and runner. */
async function realRunner(t: TmpTree, extra: string[] = [], order: "guard-first" | "stub-first" = "guard-first") {
  const agentDir = t.dir("agent");
  const paths = order === "guard-first" ? [ENTRY, ...extra] : [...extra, ENTRY];
  const { discoverAndLoadExtensions, ExtensionRunner, SessionManager } = await loadPi();
  const result = await discoverAndLoadExtensions(paths, t.p("repo"), agentDir);
  const runner = new ExtensionRunner(result.extensions, result.runtime, t.p("repo"), SessionManager.inMemory(t.p("repo")), {});
  return { result, runner };
}

const saved = { roots: process.env[ROOTS_VAR], denied: process.env[DENIED_VAR] };
afterEach(() => {
  for (const [k, v] of [[ROOTS_VAR, saved.roots], [DENIED_VAR, saved.denied]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("guard loaded through pi's real loader + ExtensionRunner (X7–X9a)", () => {
  let t: TmpTree | undefined;
  afterEach(() => t?.cleanup());

  it("X7 a denied tool is blocked, including a nested call carrying parentToolCallId", async () => {
    t = tmpTree();
    t.dir("repo");
    process.env[ROOTS_VAR] = JSON.stringify([t.p("repo")]);
    process.env[DENIED_VAR] = JSON.stringify(["bash"]);
    const { result, runner } = await realRunner(t);
    expect(result.errors).toEqual([]);
    const r = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "n1",
      toolName: "bash",
      input: { command: "ls" },
      parentToolCallId: "p1",
    });
    expect(r).toMatchObject({ block: true });
    expect(r?.reason?.startsWith("tool_denied")).toBe(true);
  });

  it.each(["guard-first", "stub-first"] as const)("X8 an always-allow handler cannot override the guard (%s)", async (order) => {
    t = tmpTree();
    t.dir("repo");
    t.dir("other");
    process.env[ROOTS_VAR] = JSON.stringify([t.p("repo")]);
    delete process.env[DENIED_VAR];
    const stub = t.file("stub.mjs", "export default function (pi) { pi.on('tool_call', async () => undefined); }\n");
    const { result, runner } = await realRunner(t, [stub], order);
    expect(result.errors).toEqual([]);
    const r = await runner.emitToolCall({
      type: "tool_call",
      toolCallId: "t1",
      toolName: "read",
      input: { path: t.p("other", "x.txt") },
    });
    expect(r).toMatchObject({ block: true });
    expect(r?.reason?.startsWith("path_outside_roots")).toBe(true);
  });

  /** @structural-pin independence from the interactive gate is a source-level contract: the guard must not import or name path-gate code. */
  it("X8 the guard source never references the interactive path gate", () => {
    const srcDir = nodePath.resolve(here, "..");
    for (const f of fs.readdirSync(srcDir).filter((n) => n.endsWith(".ts"))) {
      const body = fs.readFileSync(nodePath.join(srcDir, f), "utf8");
      expect(body, f).not.toMatch(/packages\/extension|path-gate/);
    }
  });

  it("X9a the entry loads with no errors and exactly one tool_call handler", async () => {
    t = tmpTree();
    t.dir("repo");
    process.env[ROOTS_VAR] = JSON.stringify([t.p("repo")]);
    const { result } = await realRunner(t);
    expect(result.errors).toEqual([]);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].handlers.get("tool_call")).toHaveLength(1);
  });
});
