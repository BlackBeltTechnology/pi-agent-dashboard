/**
 * Claude subscription compat — docs-section rewrite (flows-plugin bridge).
 * See change: retire-anthropic-messages-bridge (test-plan #E1 #E2 #E3 #E4 #E6
 * #E7 #E17 #X3 #X4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLAUDE_COMPAT_PROBE_CHANNEL } from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/claude-compat.js";
import {
  claudeCompatExtension,
  readSwitchFromEvents,
  rewriteDocsSection,
} from "../claude-compat.js";
import activate, { getClaudeCompatAgentFactory } from "../index.js";

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

describe("readSwitchFromEvents (X4)", () => {
  it("unanswered probe → off: no rewrite, state logged off", () => {
    const events = { emit: (_c: string, _d: unknown) => {} };
    const read = readSwitchFromEvents(events);
    expect(read()).toBe(false);
    const pi = fakePi();
    claudeCompatExtension(read)(pi);
    const opts: Opts = {};
    pi.fire(DEFAULT_PROMPT, opts, anthropic);
    expect(opts.sections?.docs).toBeUndefined();
    expect(logs.filter((l) => l.includes("state=off"))).toHaveLength(1);
  });

  it("answered probe → live value; a throwing listener → off", () => {
    let value = true;
    const events = {
      emit: (c: string, d: Record<string, unknown>) => {
        if (c === CLAUDE_COMPAT_PROBE_CHANNEL) d.claudeSubscriptionCompat = value;
      },
    };
    const read = readSwitchFromEvents(events);
    expect(read()).toBe(true);
    value = false;
    expect(read()).toBe(false);
    const boom = readSwitchFromEvents({ emit: () => { throw new Error("x"); } });
    expect(boom()).toBe(false);
  });
});

function fakeParentPi(switchValue: () => boolean) {
  const emitted: Array<{ channel: string; data: unknown }> = [];
  const handlers = new Map<string, Array<(e: unknown, c: unknown) => unknown>>();
  return {
    emitted,
    events: {
      emit: (channel: string, data: Record<string, unknown>) => {
        emitted.push({ channel, data });
        if (channel === CLAUDE_COMPAT_PROBE_CHANNEL) data.claudeSubscriptionCompat = switchValue();
      },
      on: () => {},
    },
    on: (name: string, h: (e: unknown, c: unknown) => unknown) => {
      handlers.set(name, [...(handlers.get(name) ?? []), h]);
    },
    fire(name: string, event: unknown = {}, ctx: unknown = {}) {
      for (const h of handlers.get(name) ?? []) h(event, ctx);
    },
  };
}

describe("flows-plugin bridge wiring", () => {
  it("E6: agent factory reads the PARENT switch and the agent's own model; never emits on the agent bus", () => {
    for (const [parentOn, provider, expectRewrite] of [
      [true, "anthropic", true],
      [true, "openai", false],
      [false, "anthropic", false],
      [false, "openai", false],
    ] as const) {
      const parent = fakeParentPi(() => parentOn);
      activate(parent);
      const factory = getClaudeCompatAgentFactory();
      const agentEmit = vi.fn();
      let agentHandler: ((e: unknown, c: unknown) => unknown) | undefined;
      const agentPi = {
        events: { emit: agentEmit, on: () => {} },
        on: (name: string, h: (e: unknown, c: unknown) => unknown) => {
          if (name === "before_agent_start") agentHandler = h;
        },
      };
      factory(agentPi);
      const opts: Opts = {};
      agentHandler?.({ type: "before_agent_start", systemPrompt: DEFAULT_PROMPT, systemPromptOptions: opts }, { model: { provider } });
      if (expectRewrite) expect(opts.sections?.docs).toContain("the cli itself");
      else expect(opts.sections?.docs).toBeUndefined();
      expect(agentEmit).not.toHaveBeenCalled();
    }
  });

  it("E7: registers the same factory on activate and on every session_start", () => {
    const parent = fakeParentPi(() => true);
    activate(parent);
    parent.fire("session_start");
    parent.fire("session_start");
    parent.fire("session_start");
    const regs = parent.emitted.filter((e) => e.channel === "flow:register-agent-extension");
    expect(regs).toHaveLength(4);
    const factories = new Set(regs.map((r) => (r.data as { factory: unknown }).factory));
    expect(factories.size).toBe(1);
  });

  it("main session: activate registers the rewrite on the parent pi", () => {
    const parent = fakeParentPi(() => true);
    activate(parent);
    const opts: Opts = {};
    parent.fire("before_agent_start", { type: "before_agent_start", systemPrompt: DEFAULT_PROMPT, systemPromptOptions: opts }, anthropic);
    expect(opts.sections?.docs).toContain("cli packages");
  });
});
