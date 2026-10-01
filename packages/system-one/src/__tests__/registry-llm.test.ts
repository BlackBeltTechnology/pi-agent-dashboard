/**
 * Consumer self-registration (3.10 / E10) and the `llm` backend: egress
 * (3.7 / E7) and the adapter-owned timeout with an uncooperative caller
 * (3.12 / X2). See change: add-system-one-registry.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { predict } from "../predict.js";
import type { LlmCaller, Questions } from "../types.js";
import { freshState, writeUserConfig } from "./helpers/config.js";

beforeEach(() => {
  freshState();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const NOUL: Questions = { n: { type: "noul", instructions: "i" } };
const consumersDir = () => join(homedir(), ".pi", "agent", "system-one", "consumers");
const fileFor = (id: string) => join(consumersDir(), `${createHash("sha256").update(id).digest("hex")}.json`);

describe("E10 self-registration (3.10)", () => {
  it("writes one 0600 file per id; unchanged repeat leaves it; a change rewrites", async () => {
    await predict({ consumer: { id: "ctx:is_lesson", failurePolicy: "fail-open" }, state: "s", questions: NOUL });
    const f = fileFor("ctx:is_lesson");
    const rec = JSON.parse(readFileSync(f, "utf8"));
    expect(rec).toMatchObject({ id: "ctx:is_lesson", failurePolicy: "fail-open", lastSeen: expect.any(String) });
    expect(statSync(f).mode & 0o777).toBe(0o600);
    const m1 = statSync(f).mtimeMs;

    await new Promise((r) => setTimeout(r, 20));
    await predict({ consumer: { id: "ctx:is_lesson", failurePolicy: "fail-open" }, state: "s", questions: NOUL });
    expect(statSync(f).mtimeMs).toBe(m1);

    await predict({ consumer: { id: "ctx:is_lesson", failurePolicy: "fail-closed" }, state: "s", questions: NOUL });
    expect(JSON.parse(readFileSync(f, "utf8")).failurePolicy).toBe("fail-closed");

    await predict({ consumer: { id: "other", failurePolicy: "deterministic" }, state: "s", questions: NOUL });
    expect(readdirSync(consumersDir()).filter((n) => n.endsWith(".json"))).toHaveLength(2);
  });
});

function stub(isLocal: () => boolean): LlmCaller & { call: ReturnType<typeof vi.fn> } {
  const call = vi.fn(async () => ({ model: "claude-x", answers: { n: { noul: 0.9 } } }));
  return { call, isLocal } as any;
}

describe("E7 llm egress (3.7)", () => {
  const locality: Record<string, () => boolean> = {
    local: () => true,
    remote: () => false,
    throws: () => {
      throw new Error("boom");
    },
  };
  for (const [name, isLocal] of Object.entries(locality))
    for (const sw of [false, true]) {
      it(`isLocal=${name} switch=${sw}`, async () => {
        writeUserConfig({ allowOffMachine: sw, backends: { llm: { kind: "llm", role: "@fast" } }, presets: { p: { chain: ["llm"] } } });
        const caller = stub(isLocal);
        const r = await predict({ consumer: { id: "c", failurePolicy: "fail-open" }, state: "s", questions: NOUL, llmCaller: caller });
        const allowed = name === "local" || sw;
        if (allowed) {
          expect(r).toMatchObject({ ok: true, backendId: "llm", model: "claude-x" });
          expect(caller.call).toHaveBeenCalledTimes(1);
        } else {
          expect(r).toMatchObject({ ok: false, reason: "off-machine" });
          expect(caller.call).not.toHaveBeenCalled();
        }
      });
    }

  it("an llm entry without an LlmCaller is no-backend", async () => {
    writeUserConfig({
      backends: { "laya-local": { kind: "http", url: "http://127.0.0.1:9/v1/systemone", model: "laya" }, llm: { kind: "llm", role: "@fast" } },
      presets: { p: { chain: ["laya-local", "llm"] } },
    });
    const r = await predict({ consumer: { id: "c", failurePolicy: "fail-open" }, state: "s", questions: NOUL });
    expect(r).toMatchObject({ ok: false, reason: "no-backend", policy: "fail-open" });
  });

  it("a picked option without probabilities gets 1.0", async () => {
    writeUserConfig({ backends: { llm: { kind: "llm", role: "@fast" } }, presets: { p: { chain: ["llm"] } } });
    const caller: LlmCaller = { isLocal: () => true, call: async () => ({ model: "m", answers: { ch: { choice: "b" } } }) };
    const r = await predict({
      consumer: { id: "c", failurePolicy: "fail-open" },
      state: "s",
      questions: { ch: { type: "choice", instructions: "i", criteria: { a: "", b: "" } } },
      llmCaller: caller,
    });
    expect(r.ok && r.answers.ch).toEqual({ choice: "b", probabilities: { a: 0, b: 1 }, confidence: 1 });
  });
});

describe("X2 llm timeout with an uncooperative caller (3.12)", () => {
  it("times out at 15,000 ms even when the caller ignores the signal", async () => {
    vi.useFakeTimers();
    writeUserConfig({ backends: { llm: { kind: "llm", role: "@fast" } }, presets: { p: { chain: ["llm"] } } });
    const caller: LlmCaller = { isLocal: () => true, call: () => new Promise(() => {}) };
    let settled: unknown = null;
    const p = predict({ consumer: { id: "c", failurePolicy: "fail-open" }, state: "s", questions: NOUL, llmCaller: caller }).then((r) => {
      settled = r;
    });
    await vi.advanceTimersByTimeAsync(14_999);
    expect(settled).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(settled).toMatchObject({ ok: false, reason: "timeout" });
  });
});
