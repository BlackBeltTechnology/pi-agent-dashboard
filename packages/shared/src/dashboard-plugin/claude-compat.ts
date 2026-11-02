/**
 * Claude subscription compat — rewrites pi's built-in `docs` prompt section.
 *
 * Anthropic bills a Claude subscription request as "extra usage" when pi's
 * default `docs` section carries the lines "pi itself" and "pi packages".
 * When the dashboard compat switch is on and the model provider is
 * `anthropic`, the handlers replace exactly those two phrases inside that one
 * section. They never force the whole prompt, never touch other sections, and
 * never rename tools.
 *
 * `before_agent_start` (pi 1.4.0): an extension-supplied `sections.docs`
 * replaces the built-in section; the body is read from the rendered
 * `event.systemPrompt`, anchored on pi's first docs line, rewritten only when
 * exactly one such block exists.
 *
 * `before_provider_request`: pi 1.4 sends a session's FIRST system message as
 * Anthropic's `system` field for the session's whole life (pi-ai
 * `anthropic-messages.js` buildParams); a later section change reaches the
 * wire only as a mid-conversation patch. So the outgoing `system` text is
 * rewritten too, covering sessions started before the switch was on.
 *
 * The dashboard extension registers `claudeCompatExtension` on EVERY pi it
 * loads into (main sessions, subagent children, any session built from the
 * settings packages), so no plugin or package must opt in.
 *
 * See change: retire-anthropic-messages-bridge (design D1, D2, D6b),
 * seed-claude-compat-on-upgrade.
 */

const DOCS_BLOCK_RE = /<docs>\n(Pi documentation \([\s\S]*?)\n<\/docs>/g;
const REPLACEMENTS: ReadonlyArray<readonly [string, string]> = [
  ["pi itself", "the cli itself"],
  ["pi packages", "cli packages"],
];

type CompatState = "applied" | "off" | "not-anthropic" | "custom-or-forced" | "no-match";

/** Replace the flagged phrases. Idempotent: rewritten text has none left. */
export function rewriteDocsSection(text: string): { text: string; replaced: number } {
  let out = text;
  let replaced = 0;
  for (const [from, to] of REPLACEMENTS) {
    const parts = out.split(from);
    replaced += parts.length - 1;
    out = parts.join(to);
  }
  return { text: out, replaced };
}

/** Body of pi's built-in docs section when the prompt holds exactly one anchored block. */
function extractDocsBody(systemPrompt: string): { body: string } | { count: number } {
  const matches = [...systemPrompt.matchAll(DOCS_BLOCK_RE)];
  if (matches.length !== 1) return { count: matches.length };
  return { body: matches[0]![1]! };
}

interface PromptOptionsLike {
  sections?: Record<string, string>;
  customPrompt?: string;
  forceSystemPrompt?: string;
}

interface BeforeAgentStartLike {
  systemPrompt?: string;
  systemPromptOptions?: PromptOptionsLike;
}

interface PiLike {
  on(name: string, handler: (event: unknown, ctx: unknown) => unknown): unknown;
}

function decide(event: BeforeAgentStartLike, ctx: unknown, switchOn: boolean): { state: CompatState; docs?: string } {
  if (!switchOn) return { state: "off" };
  const provider = (ctx as { model?: { provider?: unknown } } | undefined)?.model?.provider;
  if (provider !== "anthropic") return { state: "not-anthropic" };
  const opts = event.systemPromptOptions;
  if (!opts || typeof opts !== "object") return { state: "custom-or-forced" };
  if (opts.customPrompt || opts.forceSystemPrompt !== undefined) return { state: "custom-or-forced" };
  const found = extractDocsBody(typeof event.systemPrompt === "string" ? event.systemPrompt : "");
  if ("count" in found) return { state: found.count === 0 ? "custom-or-forced" : "no-match" };
  const { text, replaced } = rewriteDocsSection(found.body);
  if (replaced === 0) return { state: "no-match" };
  return { state: "applied", docs: text };
}

type SystemBlock = { type?: unknown; text?: unknown };

/**
 * Rewrite the one anchored docs block in an Anthropic payload's `system`
 * (string or text-block array). Returns a new payload, or `undefined` when
 * there is nothing to change: no `system`, zero or several anchored blocks
 * across all system text, or no flagged phrase left.
 */
export function rewritePayloadSystem(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const system = (payload as { system?: unknown }).system;
  const texts: string[] =
    typeof system === "string"
      ? [system]
      : Array.isArray(system)
        ? system.map((b: SystemBlock) => (b && b.type === "text" && typeof b.text === "string" ? b.text : ""))
        : [];
  const blockCounts = texts.map((t) => [...t.matchAll(DOCS_BLOCK_RE)].length);
  if (blockCounts.reduce((a, b) => a + b, 0) !== 1) return undefined;
  const idx = blockCounts.indexOf(1);
  let replaced = 0;
  const newText = texts[idx]!.replace(DOCS_BLOCK_RE, (_whole, body: string) => {
    const r = rewriteDocsSection(body);
    replaced = r.replaced;
    return `<docs>\n${r.text}\n</docs>`;
  });
  if (replaced === 0) return undefined;
  const newSystem =
    typeof system === "string"
      ? newText
      : (system as SystemBlock[]).map((b, i) => (i === idx ? { ...b, text: newText } : b));
  return { ...(payload as object), system: newSystem };
}

/**
 * Extension factory. `readSwitch` returns the live switch value. One factory
 * call per pi instance keeps its own log state, so
 * each session or agent logs its state once and again only on change.
 */
export function claudeCompatExtension(readSwitch: () => boolean): (pi: PiLike) => void {
  return (pi: PiLike) => {
    if (!pi || typeof pi.on !== "function") return;
    let lastState: CompatState | undefined;
    pi.on("before_agent_start", (event: unknown, ctx: unknown) => {
      try {
        const e = (event ?? {}) as BeforeAgentStartLike;
        const { state, docs } = decide(e, ctx, readSwitch());
        if (docs !== undefined && e.systemPromptOptions) {
          e.systemPromptOptions.sections ??= {};
          e.systemPromptOptions.sections.docs = docs;
        }
        if (state !== lastState) {
          lastState = state;
          const line = `[dashboard] claude-compat: state=${state}`;
          if (state === "no-match") console.warn(`${line} (switch on, but pi's docs wording did not match; requests may be billed as extra usage)`);
          else console.log(line);
        }
      } catch {
        /* compat is best-effort; never block a run */
      }
      return undefined;
    });
    pi.on("before_provider_request", (event: unknown, ctx: unknown) => {
      try {
        if (!readSwitch()) return undefined;
        const provider = (ctx as { model?: { provider?: unknown } } | undefined)?.model?.provider;
        if (provider !== "anthropic") return undefined;
        return rewritePayloadSystem((event as { payload?: unknown } | undefined)?.payload);
      } catch {
        return undefined; /* best-effort; never block a request */
      }
    });
  };
}
