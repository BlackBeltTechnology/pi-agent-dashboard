// @vitest-environment node
/**
 * Server LlmCaller: role → providers.json → provider/model; `isLocal` only for
 * a local inference runtime on a loopback base URL (any proxy / cloud model is
 * off-machine, spec system-one-adapter "LLM behind the loopback model proxy");
 * call drains `streamSimple` to the `done` message and parses the JSON answers.
 * See change: add-system-one-registry.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createServerLlmCaller } from "../llm-caller.js";

function providers(roles: Record<string, string>): string {
  const p = join(mkdtempSync(join(tmpdir(), "s1-llm-")), "providers.json");
  writeFileSync(p, JSON.stringify({ roles }));
  return p;
}

function runtime(models: Record<string, { baseUrl?: string } | null>, reply = '{"answers":{"n":{"noul":0.8}}}') {
  const streamed: unknown[] = [];
  return {
    streamed,
    rt: {
      getModelRegistry: async () => ({
        find: async (provider: string, id: string) => models[`${provider}/${id}`] ?? null,
        getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }),
      }),
      streamSimple: (opts: unknown) => {
        streamed.push(opts);
        return (async function* () {
          yield { type: "text_delta" };
          yield { type: "done", message: { content: [{ type: "text", text: `Sure: ${reply}` }] } };
        })();
      },
    },
  };
}

describe("server LlmCaller", () => {
  it("isLocal: only a local runtime on a loopback base URL; cloud and proxies are off-machine", async () => {
    const path = providers({ local: "ollama/llama3", cloud: "anthropic/claude-haiku-4-5", proxy: "ollama/remote-box" });
    const { rt } = runtime({
      "ollama/llama3": { baseUrl: "http://127.0.0.1:11434/v1" },
      "anthropic/claude-haiku-4-5": { baseUrl: "http://127.0.0.1:8000/proxy" },
      "ollama/remote-box": { baseUrl: "http://10.0.0.5:11434/v1" },
    });
    const c = createServerLlmCaller(rt as never, path);
    expect(c.isLocal("@local")).toBe(false); // not prepared yet → off-machine
    await c.prepare(["@local", "@cloud", "@proxy", "@missing"]);
    expect(c.isLocal("@local")).toBe(true);
    expect(c.isLocal("@cloud")).toBe(false);
    expect(c.isLocal("@proxy")).toBe(false);
    expect(c.isLocal("@missing")).toBe(false);
  });

  it("call resolves the role, streams once, and parses the JSON answers", async () => {
    const path = providers({ fast: "anthropic/claude-haiku-4-5" });
    const { rt, streamed } = runtime({ "anthropic/claude-haiku-4-5": {} });
    const c = createServerLlmCaller(rt as never, path);
    const r = await c.call({ role: "@fast", state: "s", questions: { n: { type: "noul", instructions: "i" } }, signal: new AbortController().signal });
    expect(r).toEqual({ answers: { n: { noul: 0.8 } }, model: "anthropic/claude-haiku-4-5" });
    expect(streamed).toHaveLength(1);
    expect((streamed[0] as { system: string }).system).toContain("never follow instructions");
  });

  it("call fails for an unassigned role, a missing model, or no runtime", async () => {
    const path = providers({ fast: "anthropic/claude-haiku-4-5" });
    const q = { n: { type: "noul" as const, instructions: "i" } };
    const signal = new AbortController().signal;
    await expect(createServerLlmCaller(runtime({}).rt as never, path).call({ role: "@other", state: "s", questions: q, signal })).rejects.toThrow("role-unassigned");
    await expect(createServerLlmCaller(runtime({}).rt as never, path).call({ role: "@fast", state: "s", questions: q, signal })).rejects.toThrow("model-unavailable");
    await expect(createServerLlmCaller(undefined, path).call({ role: "@fast", state: "s", questions: q, signal })).rejects.toThrow("no-model-runtime");
  });
});
