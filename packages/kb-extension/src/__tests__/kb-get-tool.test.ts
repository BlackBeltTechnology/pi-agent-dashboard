// kb_get tool over a multi-root KB, the CLI parity contract, and the guard's
// indexed-read wiring. Folded from openspec/changes/fix-kb-get-roots-and-guard/
// test-plan.md (E3, E9 at the tool surface; task 5.2 hook wiring).
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import kbExtension from "../extension.js";

type Result = { content: { type: string; text: string }[]; details: Record<string, unknown> };
type Tool = { name: string; execute: (id: string, params: Record<string, unknown>, signal: undefined, onUpdate: undefined, ctx: { cwd: string }) => Promise<Result> };
type Handler = (event: Record<string, unknown>, ctx?: { cwd: string }) => Promise<unknown>;

function load(): { tools: Map<string, Tool>; handlers: Map<string, Handler[]> } {
  const tools = new Map<string, Tool>();
  const handlers = new Map<string, Handler[]>();
  const pi = {
    registerTool: (t: Tool) => tools.set(t.name, t),
    on: (ev: string, h: Handler) => handlers.set(ev, [...(handlers.get(ev) ?? []), h]),
  } as unknown as Parameters<typeof kbExtension>[0];
  kbExtension(pi);
  return { tools, handlers };
}

const pad = (s: string) => `# ${s}\n${s} — a body long enough to stay its own chunk after the minimum-size merge pass of the markdown chunker.\n`;

function setupProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "kb-get-"));
  mkdirSync(join(dir, ".pi", "dashboard", "kb"), { recursive: true });
  writeFileSync(
    join(dir, ".pi", "dashboard", "knowledge_base.json"),
    JSON.stringify({
      sources: [{ ref: "docs" }, { ref: "packages/a" }, { ref: "packages/b" }],
      dbPath: ".pi/dashboard/kb/index.db",
    }),
  );
  for (const [rel, body] of [
    ["docs/guide.md", pad("Guide")],
    ["packages/a/AGENTS.md", pad("Agents A")],
    ["packages/b/AGENTS.md", pad("Agents B")],
  ]) {
    mkdirSync(join(dir, rel, ".."), { recursive: true });
    writeFileSync(join(dir, rel), body);
  }
  return dir;
}

const kbCli = fileURLToPath(new URL("../../../kb/src/cli.ts", import.meta.url));
const cliGet = (cwd: string, path: string) =>
  spawnSync(process.execPath, ["--import", "tsx", kbCli, "get", path, "--cwd", cwd], {
    encoding: "utf8",
    env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-sqlite"].filter(Boolean).join(" ") },
  }).stdout.trimEnd();

describe("kb_get across every indexed root", () => {
  let dir: string;
  let kbGet: Tool;
  let handlers: Map<string, Handler[]>;
  beforeAll(() => {
    dir = setupProject();
    const l = load();
    kbGet = l.tools.get("kb_get")!;
    handlers = l.handlers;
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const get = (params: Record<string, unknown>) => kbGet.execute("id", params, undefined, undefined, { cwd: dir });

  it("a path in a non-first source resolves through the tool", async () => {
    const r = await get({ path: "guide.md" });
    expect(r.content[0].text).toContain("Guide —");
    expect(r.details.found).toBe(true);
  });

  it("E9 a colliding path lists candidates with found:false and candidates:2 — no body", async () => {
    const r = await get({ path: "AGENTS.md" });
    const text = r.content[0].text;
    expect(text).toContain("packages/a:AGENTS.md");
    expect(text).toContain("packages/b:AGENTS.md");
    expect(text).not.toContain("Agents A —");
    expect(r.details).toMatchObject({ found: false, candidates: 2 });
    const back = await get({ path: "packages/b/AGENTS.md" });
    expect(back.content[0].text).toContain("Agents B —");
  });

  it("E3 the kb get CLI and the kb_get tool return the same hit / candidates / not-found", async () => {
    await get({ path: "guide.md" }); // tool populates the index first
    for (const p of ["guide.md", "AGENTS.md", "packages/a:AGENTS.md", "nope.md"]) {
      const tool = (await get({ path: p })).content[0].text;
      expect(cliGet(dir, p), p).toBe(tool);
    }
  }, 60_000);

  it("task 5.2: the guard hook counts `cat` of an indexed file (per-cwd predicate) but not an unindexed one", async () => {
    await get({ path: "guide.md" }); // index ready
    const [toolCall] = [...(handlers.get("tool_call") ?? [])].slice(-1);
    const toolResult = handlers.get("tool_result")![0]; // the guard-warning prepender (registered first)
    // unindexed reads never fire
    for (let i = 0; i < 3; i++) await toolCall({ toolName: "bash", toolCallId: `u${i}`, input: { command: "cat package.json" } }, { cwd: dir });
    const quiet = (await toolResult({ toolCallId: "u2", content: [{ type: "text", text: "out" }] }, { cwd: dir })) as { content?: unknown } | undefined;
    expect(quiet?.content).toBeUndefined();
    // indexed reads fire on the third
    for (let i = 0; i < 3; i++) await toolCall({ toolName: "bash", toolCallId: `r${i}`, input: { command: "cat docs/guide.md" } }, { cwd: dir });
    const fired = (await toolResult({ toolCallId: "r2", content: [{ type: "text", text: "out" }] }, { cwd: dir })) as { content: { text: string }[] };
    expect(fired.content[0].text).toMatch(/^\[kb\]/);
  });
});
