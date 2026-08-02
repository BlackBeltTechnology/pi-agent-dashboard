import { describe, expect, it } from "vitest";
import {
  checkWithLlm,
  extractJsonObject,
  googleToOpenAiCompat,
  type LlmModelRegistry,
  type LlmStreamFn,
  parseLlmResult,
} from "../server/backends/llm.js";
import { GrammarBackendError } from "../server/grammar-errors.js";

/** A registry stub that resolves any model + fixed creds. */
const okRegistry: LlmModelRegistry = {
  find: async (provider, id) => ({ provider, id }),
  getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }),
};

/** Build a streamSimple that emits a single `done` event carrying `text`. */
function doneStream(text: string): LlmStreamFn {
  return () =>
    (async function* () {
      yield { type: "done", message: { content: [{ type: "text", text }] } };
    })();
}

/** Like `doneStream`, but records the `system` prompt passed to streamSimple. */
function capturingStream(text: string): { fn: LlmStreamFn; captured: { system?: string } } {
  const captured: { system?: string } = {};
  const fn: LlmStreamFn = (opts: { system?: string }) => {
    captured.system = opts.system;
    return (async function* () {
      yield { type: "done", message: { content: [{ type: "text", text }] } };
    })();
  };
  return { fn, captured };
}

const EMPTY_RESULT = '{"correctedText":"x","suggestions":[],"summary":""}';

describe("extractJsonObject", () => {
  it("parses a bare JSON object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses a fenced ```json block", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });
  it("parses JSON embedded in prose", () => {
    expect(extractJsonObject('Here you go: {"a":1} done')).toEqual({ a: 1 });
  });
  it("throws backend_bad_response when there is no object", () => {
    try {
      extractJsonObject("no json here");
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(GrammarBackendError);
      expect((e as GrammarBackendError).code).toBe("backend_bad_response");
    }
  });
  it("throws backend_bad_response on malformed JSON", () => {
    expect(() => extractJsonObject("{ not valid }")).toThrow(GrammarBackendError);
  });
});

describe("parseLlmResult", () => {
  const text = "I has a apple";

  it("relocates offsets from `original`, ignoring model-supplied offsets", () => {
    const raw = {
      correctedText: "I have an apple",
      suggestions: [
        { original: "has", replacement: "have", kind: "grammar", message: "Agreement" },
        { original: "a apple", replacement: "an apple", kind: "grammar", message: "Article" },
      ],
      summary: "2 grammar",
    };
    const result = parseLlmResult(raw, text, "en-US");
    expect(result.backend).toBe("llm");
    expect(result.correctedText).toBe("I have an apple");
    expect(result.suggestions[0]).toMatchObject({ offset: 2, length: 3, original: "has" });
    expect(result.suggestions[1]).toMatchObject({ offset: 6, length: 7, original: "a apple" });
    expect(result.summary).toBe("2 grammar");
  });

  it("drops suggestions whose `original` is not in the text", () => {
    const raw = {
      correctedText: text,
      suggestions: [{ original: "zzz", replacement: "qqq", kind: "spelling" }],
    };
    expect(parseLlmResult(raw, text, "en-US").suggestions).toHaveLength(0);
  });

  it("drops suggestions where replacement equals original", () => {
    const raw = { suggestions: [{ original: "has", replacement: "has", kind: "grammar" }] };
    expect(parseLlmResult(raw, text, "en-US").suggestions).toHaveLength(0);
  });

  it("defaults an invalid kind to grammar", () => {
    const raw = { suggestions: [{ original: "has", replacement: "have", kind: "wizardry" }] };
    expect(parseLlmResult(raw, text, "en-US").suggestions[0].kind).toBe("grammar");
  });

  it("falls back to computed summary when the model omits one", () => {
    const raw = { suggestions: [{ original: "has", replacement: "have", kind: "grammar" }] };
    expect(parseLlmResult(raw, text, "en-US").summary).toBe("1 grammar");
  });

  it("falls back to the input as correctedText when the model omits it", () => {
    expect(parseLlmResult({ suggestions: [] }, text, "en-US").correctedText).toBe(text);
  });

  it("throws backend_bad_response when the payload is not an object", () => {
    expect(() => parseLlmResult(null, text, "en-US")).toThrow(GrammarBackendError);
  });
});

describe("checkWithLlm (registry + streamSimple)", () => {
  it("resolves creds via the registry and parses the model's JSON", async () => {
    const json = JSON.stringify({
      correctedText: "These are apples",
      suggestions: [{ original: "is", replacement: "are", kind: "grammar", message: "Agreement" }],
      summary: "1 grammar",
    });
    const res = await checkWithLlm("These is apples", {
      provider: "anthropic",
      model: "claude-x",
      language: "auto",
      registry: okRegistry,
      streamSimple: doneStream(json),
    });
    expect(res.backend).toBe("llm");
    expect(res.correctedText).toBe("These are apples");
    expect(res.suggestions).toHaveLength(1);
  });

  it("surfaces style suggestions (improve-writing) from the model", async () => {
    const json = JSON.stringify({
      correctedText: "Please review the report.",
      suggestions: [
        { original: "kindly take a look at", replacement: "review", kind: "style", message: "Concision" },
      ],
      summary: "1 style",
    });
    const res = await checkWithLlm("kindly take a look at the report", {
      provider: "anthropic",
      model: "claude-x",
      language: "auto",
      registry: okRegistry,
      streamSimple: doneStream(json),
    });
    expect(res.suggestions[0]?.kind).toBe("style");
  });

  it("suppresses sentence-start capitalization by default (prompt instruction)", async () => {
    const { fn, captured } = capturingStream(EMPTY_RESULT);
    await checkWithLlm("hello world", {
      provider: "anthropic",
      model: "claude-x",
      language: "en-US",
      registry: okRegistry,
      streamSimple: fn,
    });
    expect(captured.system).toContain("Do NOT change the capitalization");
  });

  it("tells the model that jargon-looking prose words are not code to preserve", async () => {
    // Regression: models cited the "preserve any code or URLs verbatim" clause to justify
    // keeping misspelled hyphenated jargon ("to preserve the exact spelling of
    // 'functional-specificatio'"), returning the draft unchanged with suggestions: [].
    const { fn, captured } = capturingStream(EMPTY_RESULT);
    await checkWithLlm("hello world", {
      provider: "anthropic",
      model: "claude-x",
      language: "en-US",
      registry: okRegistry,
      streamSimple: fn,
    });
    const sys = captured.system ?? "";
    expect(sys).toMatch(/is NOT code/i);
    expect(sys).toMatch(/never leave a misspelling/i);
  });

  it("scopes the capitalization exception so the model still corrects every mistake", async () => {
    // Regression: the old wording ("leave lowercase sentence starts exactly as
    // written") was over-generalized by weak models into "preserve the text as-is",
    // so a draft full of typos came back unchanged with suggestions: []. The clause
    // must stay narrow AND re-assert the correction mandate.
    const { fn, captured } = capturingStream(EMPTY_RESULT);
    await checkWithLlm("hello world", {
      provider: "anthropic",
      model: "claude-x",
      language: "en-US",
      registry: okRegistry,
      streamSimple: fn,
    });
    const sys = captured.system ?? "";
    expect(sys).toContain("Do NOT change the capitalization");
    expect(sys).not.toContain("exactly as written");
    expect(sys).toMatch(/MUST still correct every/i);
  });

  it("omits the capitalization instruction when capitalizeFirstWord is true", async () => {
    const { fn, captured } = capturingStream(EMPTY_RESULT);
    await checkWithLlm("hello world", {
      provider: "anthropic",
      model: "claude-x",
      language: "en-US",
      capitalizeFirstWord: true,
      registry: okRegistry,
      streamSimple: fn,
    });
    expect(captured.system).not.toContain("Do NOT change the capitalization");
  });

  it("throws backend_unconfigured when the model runtime is unavailable", async () => {
    await expect(
      checkWithLlm("x", {
        provider: "anthropic",
        model: "claude-x",
        language: "auto",
        registry: null,
        streamSimple: null,
      }),
    ).rejects.toMatchObject({ code: "backend_unconfigured" });
  });

  it("throws backend_unconfigured when the model is not in the registry", async () => {
    const noModel: LlmModelRegistry = {
      find: async () => null,
      getApiKeyAndHeaders: async () => ({ apiKey: "", headers: {} }),
    };
    await expect(
      checkWithLlm("x", {
        provider: "anthropic",
        model: "missing",
        language: "auto",
        registry: noModel,
        streamSimple: doneStream("{}"),
      }),
    ).rejects.toMatchObject({ code: "backend_unconfigured" });
  });

  it("maps a provider error event to backend_unreachable", async () => {
    const errStream: LlmStreamFn = () =>
      (async function* () {
        yield { type: "error", error: { errorMessage: "boom" } };
      })();
    await expect(
      checkWithLlm("x", {
        provider: "anthropic",
        model: "claude-x",
        language: "auto",
        registry: okRegistry,
        streamSimple: errStream,
      }),
    ).rejects.toMatchObject({ code: "backend_unreachable" });
  });
});

describe("googleToOpenAiCompat", () => {
  it("reroutes a google-generative-ai model to the OpenAI-compat endpoint", () => {
    const out = googleToOpenAiCompat({
      provider: "google",
      id: "gemini-flash-latest",
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    } as Record<string, unknown>);
    expect(out.api).toBe("openai-completions");
    expect(out.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(out.compat).toMatchObject({ supportsStore: false });
    // id + provider unchanged — same model, only transport rewritten
    expect(out.id).toBe("gemini-flash-latest");
    expect(out.provider).toBe("google");
  });

  it("preserves existing compat flags while forcing supportsStore:false", () => {
    const out = googleToOpenAiCompat({
      api: "google-generative-ai",
      compat: { supportsReasoningEffort: true },
    } as Record<string, unknown>);
    expect(out.compat).toMatchObject({ supportsReasoningEffort: true, supportsStore: false });
  });

  it("returns non-google models unchanged (same reference)", () => {
    const anthropic = { provider: "anthropic", id: "claude-haiku-4-5", api: "anthropic-messages" };
    expect(googleToOpenAiCompat(anthropic)).toBe(anthropic);
  });
});

describe("checkWithLlm google rerouting", () => {
  it("streams a resolved google model over the OpenAI-compat route (no native SDK)", async () => {
    let capturedModel: Record<string, unknown> | undefined;
    const registry: LlmModelRegistry = {
      find: async (provider, id) => ({
        provider,
        id,
        api: "google-generative-ai",
        baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      }),
      getApiKeyAndHeaders: async () => ({ apiKey: "k", headers: {} }),
    };
    const capturing: LlmStreamFn = (opts) => {
      capturedModel = opts.model as Record<string, unknown>;
      return (async function* () {
        yield {
          type: "done",
          message: {
            content: [
              { type: "text", text: '{"correctedText":"the cat","suggestions":[],"summary":"none"}' },
            ],
          },
        };
      })();
    };
    const result = await checkWithLlm("teh cat", {
      provider: "google",
      model: "gemini-flash-latest",
      language: "en",
      registry,
      streamSimple: capturing,
    });
    expect(result.backend).toBe("llm");
    expect(capturedModel?.api).toBe("openai-completions");
    expect(capturedModel?.baseUrl).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
    expect(capturedModel?.compat).toMatchObject({ supportsStore: false });
  });
});
