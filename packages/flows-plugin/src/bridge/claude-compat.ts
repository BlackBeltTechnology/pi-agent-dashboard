/**
 * Claude subscription compat — rewrites pi's built-in `docs` prompt section.
 *
 * Anthropic bills a Claude subscription request as "extra usage" when pi's
 * default `docs` section carries the lines "pi itself" and "pi packages".
 * When the dashboard compat switch is on and the run's model provider is
 * `anthropic`, this handler replaces exactly those two phrases inside that one
 * section. It never forces the whole prompt, never touches other sections, and
 * never renames tools.
 *
 * Mechanics (pi 1.4.0): `before_agent_start` receives a fresh
 * `systemPromptOptions` per run; an extension-supplied `sections.docs` replaces
 * the built-in section in place. The current body is read from the rendered
 * `event.systemPrompt`, anchored on pi's own first docs line, and rewritten
 * only when exactly one such block exists.
 *
 * See change: retire-anthropic-messages-bridge (design D1, D2, D5, D6b).
 */
import {
  CLAUDE_COMPAT_PROBE_CHANNEL,
  type ClaudeCompatProbe,
} from "@blackbelt-technology/pi-dashboard-shared/dashboard-plugin/claude-compat.js";

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

interface EventsLike {
  emit(channel: string, data: unknown): unknown;
}

/** Live getter over the dashboard extension's probe; unanswered or throwing → false. */
export function readSwitchFromEvents(events: EventsLike | undefined): () => boolean {
  return () => {
    if (!events || typeof events.emit !== "function") return false;
    const probe: ClaudeCompatProbe = {};
    try {
      events.emit(CLAUDE_COMPAT_PROBE_CHANNEL, probe);
    } catch {
      return false;
    }
    return probe.claudeSubscriptionCompat === true;
  };
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

/**
 * Extension factory. `readSwitch` must be bound to the PARENT session's probe:
 * flow agents run in an isolated runtime where the dashboard listener is
 * absent. One factory instance per pi instance keeps its own log state, so
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
          const line = `[flows-plugin] claude-compat: state=${state}`;
          if (state === "no-match") console.warn(`${line} (switch on, but pi's docs wording did not match; requests may be billed as extra usage)`);
          else console.log(line);
        }
      } catch {
        /* compat is best-effort; never block a run */
      }
      return undefined;
    });
  };
}
