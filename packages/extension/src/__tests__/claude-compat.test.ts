/**
 * Claude subscription compat — docs-section + payload rewrite (shared module,
 * registered by the dashboard extension on every pi).
 * See change: retire-anthropic-messages-bridge (test-plan #E1 #E2 #E3 #E4
 * #E17 #X3), seed-claude-compat-on-upgrade (#P1 #P2 #P3).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  claudeCompatExtension,
  rewriteDocsSection,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/claude-compat.js";

// pi 1.4.0 `docs` section body (system-prompt.js:88-95), paths shortened.
const DOCS_BODY = [
  "Pi documentation (read only when the user asks about pi itself, its SDK, extensions, themes, skills, or TUI):",
  "- Main documentation: /pi/README.md",
  "- Additional docs: /pi/docs",
  "- Examples: /pi/examples (extensions, custom tools, SDK)",
  "- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
  "- When asked about: extensions (docs/extensions.md, examples/extensions/), themes (docs/themes.md), adding models (docs/models.md), pi packages (docs/packages.md), MCP servers (docs/mcp.md)",
  "- When working on pi topics, read the docs and examples, and follow .md cross-references before implementing",
  "- Always read pi .md files completely and follow links to related docs (e.g., tui.md for TUI API details)",
].join("\n");

/** Render like pi: preamble bare, other sections `<name>\n…\n</name>`, joined by a blank line. */
function render(sections: Record<string, string>): string {
  return Object.entries(sections)
    .map(([name, body]) => (name === "preamble" ? body : `<${name}>\n${body}\n</${name}>`))
    .join("\n\n");
}

const DEFAULT_PROMPT = render({
  preamble: "You are an expert coding assistant operating inside pi, a coding agent harness.",
  tools: "- read: Read file contents",
  rules: "- Use read to examine files",
  docs: DOCS_BODY,
  project_context: "Project instructions",
  cwd: "/repo",
});

type Ctx = { model?: { provider: string } };
type Opts = Record<string, unknown> & { sections?: Record<string, string>; customPrompt?: string; forceSystemPrompt?: string };

function fakePi() {
  let handler: ((event: unknown, ctx: unknown) => unknown) | undefined;
  return {
    on: (name: string, h: (event: unknown, ctx: unknown) => unknown) => {
      if (name === "before_agent_start") handler = h;
    },
    fire(systemPrompt: string, opts: Opts, ctx: Ctx) {
      return handler?.({ type: "before_agent_start", systemPrompt, systemPromptOptions: opts }, ctx);
    },
  };
}

const anthropic: Ctx = { model: { provider: "anthropic" } };

let logs: string[];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => { logs.push(a.join(" ")); });
});
afterEach(() => vi.restoreAllMocks());

describe("rewriteDocsSection", () => {
  it("replaces both flagged phrases and nothing else", () => {
    const r = rewriteDocsSection(DOCS_BODY);
    expect(r.replaced).toBe(2);
    expect(r.text).toContain("the cli itself");
    expect(r.text).toContain("cli packages");
    expect(r.text).not.toContain("pi itself");
    expect(r.text).not.toContain("pi packages");
    expect(r.text.replace("the cli itself", "pi itself").replace("cli packages", "pi packages")).toBe(DOCS_BODY);
  });

  it("E3: is idempotent", () => {
    const once = rewriteDocsSection(DOCS_BODY).text;
    const a = rewriteDocsSection(once);
    const b = rewriteDocsSection(a.text);
    expect(a).toEqual({ text: once, replaced: 0 });
    expect(b).toEqual({ text: once, replaced: 0 });
  });
});

describe("claudeCompatExtension — guards (E1)", () => {
  const combos: Array<[boolean, Ctx, boolean]> = [];
  for (const sw of [true, false])
    for (const ctx of [anthropic, { model: { provider: "openai" } }, {}] as Ctx[])
      for (const custom of [false, true]) combos.push([sw, ctx, custom]);

  it.each(combos)("switch=%s ctx=%j customPrompt=%s", (sw, ctx, custom) => {
    const pi = fakePi();
    claudeCompatExtension(() => sw)(pi);
    const opts: Opts = custom ? { customPrompt: "my SYSTEM.md" } : {};
    const ret = pi.fire(DEFAULT_PROMPT, opts, ctx);
    expect(ret).toBeUndefined();
    const shouldApply = sw && ctx.model?.provider === "anthropic" && !custom;
    if (shouldApply) {
      expect(opts.sections?.docs).toContain("the cli itself");
      expect(opts.sections?.docs).toContain("cli packages");
      expect(opts.sections?.docs).not.toContain("pi itself");
      expect(opts.sections?.docs).not.toContain("pi packages");
    } else {
      expect(opts.sections?.docs).toBeUndefined();
    }
  });
});

describe("claudeCompatExtension — anchored match (E2)", () => {
  function run(systemPrompt: string) {
    const pi = fakePi();
    claudeCompatExtension(() => true)(pi);
    const opts: Opts = {};
    pi.fire(systemPrompt, opts, anthropic);
    return opts;
  }

  it("exactly one anchored block → rewritten, rest byte-identical", () => {
    const opts = run(DEFAULT_PROMPT);
    expect(opts.sections?.docs).toBe(rewriteDocsSection(DOCS_BODY).text);
  });

  it("zero anchored blocks → no rewrite", () => {
    expect(run(render({ preamble: "p", rules: "r" })).sections?.docs).toBeUndefined();
  });

  it("two anchored blocks → no rewrite", () => {
    const twice = `${DEFAULT_PROMPT}\n\n<docs>\n${DOCS_BODY}\n</docs>`;
    expect(run(twice).sections?.docs).toBeUndefined();
  });

  it("a <docs> tag only inside project_context → no rewrite", () => {
    const prompt = render({
      preamble: "p",
      project_context: "See <docs>\nour docs mention pi itself and pi packages\n</docs> for details",
    });
    expect(run(prompt).sections?.docs).toBeUndefined();
  });
});

describe("claudeCompatExtension — preserves other contributions (E4)", () => {
  it("leaves other sections, guidelines and tool names untouched and returns undefined", () => {
    const pi = fakePi();
    claudeCompatExtension(() => true)(pi);
    const opts: Opts = {
      sections: { dashboard_session: "ctx fragment" },
      toolGuidelines: { Agent: ["use roles"] },
      selectedTools: ["read", "ask_user", "kb_search", "Agent"],
    };
    const ret = pi.fire(DEFAULT_PROMPT, opts, anthropic);
    expect(ret).toBeUndefined();
    expect(opts.sections?.dashboard_session).toBe("ctx fragment");
    expect(opts.toolGuidelines).toEqual({ Agent: ["use roles"] });
    expect(opts.selectedTools).toEqual(["read", "ask_user", "kb_search", "Agent"]);
    expect(opts.sections?.docs).toBeDefined();
  });
});

describe("claudeCompatExtension — forced prompt (X3)", () => {
  it("no-ops and logs custom/forced once when the prompt is forced", () => {
    const pi = fakePi();
    claudeCompatExtension(() => true)(pi);
    const opts: Opts = { forceSystemPrompt: "forced text" };
    const ret = pi.fire("forced text", opts, anthropic);
    expect(ret).toBeUndefined();
    expect(opts.sections?.docs).toBeUndefined();
    expect(logs.filter((l) => l.includes("custom-or-forced"))).toHaveLength(1);
  });
});

describe("state log (E17)", () => {
  it("logs applied, matched-nothing and off once each, never prompt text", () => {
    let sw = true;
    const pi = fakePi();
    claudeCompatExtension(() => sw)(pi);
    const noPhrases = render({ preamble: "p", docs: "Pi documentation (read only when asked):\n- Main documentation: /pi/README.md" });
    pi.fire(DEFAULT_PROMPT, {}, anthropic);
    pi.fire(DEFAULT_PROMPT, {}, anthropic);
    pi.fire(noPhrases, {}, anthropic);
    pi.fire(noPhrases, {}, anthropic);
    sw = false;
    pi.fire(DEFAULT_PROMPT, {}, anthropic);

    expect(logs.filter((l) => l.includes("state=applied"))).toHaveLength(1);
    expect(logs.filter((l) => l.includes("state=no-match"))).toHaveLength(1);
    expect(logs.filter((l) => l.includes("state=off"))).toHaveLength(1);
    expect(logs).toHaveLength(3);
    for (const l of logs) {
      expect(l).not.toContain("Main documentation");
      expect(l).not.toContain("Pi documentation");
    }
  });
});

// pi 1.4 sends a session's FIRST system message as Anthropic's `system` field
// for the session's whole life; a later `before_agent_start` rewrite only
// reaches the wire as a mid-conversation patch. The payload hook rewrites the
// outgoing `system` text so sessions started before the switch are covered.
// See change: seed-claude-compat-on-upgrade (test-plan #P1 #P2).
describe("claudeCompatExtension — provider payload (P1, P2)", () => {
  function payloadPi() {
    let handler: ((event: unknown, ctx: unknown) => unknown) | undefined;
    return {
      on: (name: string, h: (event: unknown, ctx: unknown) => unknown) => {
        if (name === "before_provider_request") handler = h;
      },
      fire(payload: unknown, ctx: Ctx) {
        return handler?.({ type: "before_provider_request", payload }, ctx);
      },
    };
  }
  const OAUTH_BLOCK = { type: "text", text: "You are Claude Code, Anthropic's official CLI for Claude." };
  const arrayPayload = () => ({
    model: "claude-opus-5-5",
    system: [OAUTH_BLOCK, { type: "text", text: DEFAULT_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: "pi itself" }],
  });

  it("P1: rewrites the docs block in an array `system`, keeps other blocks, cache_control and messages", () => {
    const pi = payloadPi();
    claudeCompatExtension(() => true)(pi);
    const input = arrayPayload();
    const out = pi.fire(input, anthropic) as ReturnType<typeof arrayPayload>;
    expect(out).toBeDefined();
    expect(out.system[0]).toEqual(OAUTH_BLOCK);
    expect(out.system[1]!.text).toBe(DEFAULT_PROMPT.replace("pi itself", "the cli itself").replace("pi packages", "cli packages"));
    expect((out.system[1] as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    expect(out.messages).toBe(input.messages);
    expect(input.system[1]!.text).toBe(DEFAULT_PROMPT);
  });

  it("P1: rewrites a string `system`", () => {
    const pi = payloadPi();
    claudeCompatExtension(() => true)(pi);
    const out = pi.fire({ system: DEFAULT_PROMPT, messages: [] }, anthropic) as { system: string };
    expect(out.system).toContain("the cli itself");
    expect(out.system).not.toContain("pi itself");
    expect(out.system).not.toContain("pi packages");
  });

  it.each([
    ["switch off", false, anthropic, () => arrayPayload()],
    ["not anthropic", true, { model: { provider: "openai" } } as Ctx, () => arrayPayload()],
    ["no model", true, {} as Ctx, () => arrayPayload()],
    ["no anchored block", true, anthropic, () => ({ system: "custom SYSTEM.md prompt about pi itself", messages: [] })],
    ["two anchored blocks", true, anthropic, () => ({ system: `${DEFAULT_PROMPT}\n\n${DEFAULT_PROMPT}`, messages: [] })],
    ["already rewritten", true, anthropic, () => ({ system: DEFAULT_PROMPT.replace("pi itself", "the cli itself").replace("pi packages", "cli packages"), messages: [] })],
    ["no system field", true, anthropic, () => ({ messages: [] })],
    ["non-object payload", true, anthropic, () => "raw"],
  ])("P2: %s → payload left as is (returns undefined)", (_name, sw, ctx, make) => {
    const pi = payloadPi();
    claudeCompatExtension(() => sw as boolean)(pi);
    expect(pi.fire(make(), ctx as Ctx)).toBeUndefined();
  });
});
