/**
 * Per-turn system-prompt injector exposing the dashboard session context
 * (sessionId, cwd, attached OpenSpec change) to the pi agent.
 *
 * Registers a `before_agent_start` handler that writes the marked context
 * fragment into the STRUCTURED prompt options as the custom section
 * `dashboard_session` (pi renders it as `<dashboard_session>` after `<cwd>`).
 * It never returns `{ systemPrompt }`: that would set pi's `forceSystemPrompt`
 * to a mid-chain snapshot and silently drop every later structured
 * contribution (roles plugin Agent guideline, `mcp_servers`, …).
 *
 * The sessionId comes from the bridge (`bc.sessionId`); pi exposes no
 * `pi.sessionId`. State is read live via a getter so attach/detach and
 * fork/resume sessionId changes are reflected on the very next turn.
 *
 * See change: inject-session-context-into-agent,
 * fix-forced-system-prompt-drops-tool-guidelines.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BridgeContext } from "./bridge-context.js";

/** Structured system-prompt section name (pi custom-section regex `^[a-z][a-z0-9_-]*$`). */
export const SECTION_NAME = "dashboard_session";

/** The slice of pi's `BuildSystemPromptOptions` this injector reads/writes. */
type PromptOptionsLike = { cwd?: unknown; sections?: Record<string, string> };

/** Opening delimiter of the injected fragment. */
export const CONTEXT_DELIMITER = "── pi-dashboard session context ──";

/**
 * Build the context fragment (no leading/trailing blank line; caller controls
 * separators). Always includes the delimiter + `You are pi session …` line.
 * Includes the `Attached OpenSpec change: …` line only when `attachedChange`
 * is a non-empty string.
 */
export function buildContextFragment(
  sessionId: string,
  cwd: string,
  attachedChange: string | null | undefined,
): string {
  const lines = [
    CONTEXT_DELIMITER,
    `You are pi session \`${sessionId}\` running in \`${cwd}\`.`,
  ];
  const change = sanitizeChangeName(attachedChange);
  if (change) {
    lines.push(
      `Attached OpenSpec change: \`${change}\`. See \`openspec/changes/${change}/{proposal,design,tasks}.md\`.`,
    );
  }
  return lines.join("\n");
}

/**
 * Reduce an attached change name to a single safe token before it is
 * interpolated verbatim into the privileged system prompt. Strips newlines,
 * backticks, and control chars so a malformed value cannot break out of the
 * metadata line and inject extra instructions. Returns "" when the value is
 * absent or sanitizes to empty (caller then omits the line).
 */
export function sanitizeChangeName(attachedChange: string | null | undefined): string {
  if (typeof attachedChange !== "string") return "";
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the intent.
  return attachedChange.replace(/[`\r\n\u0000-\u001f\u007f]/g, "").trim();
}

/**
 * Register the `before_agent_start` injector. `getBc` returns the live
 * BridgeContext (bridge.ts `syncBc`) so sessionId/attachedChange are read
 * fresh each turn. cwd source: `event.systemPromptOptions?.cwd ?? process.cwd()`.
 *
 * Mutates `event.systemPromptOptions.sections[SECTION_NAME]` and returns
 * `undefined` (pi shares one options object across all handlers). Keyed
 * assignment is idempotent, so a stacked handler cannot duplicate the fragment;
 * `isActive` still lets a stale `/reload` generation opt out, mirroring the
 * `isActive()` guard on every other `pi.on(...)` handler in `bridge.ts`.
 *
 * NOTE: signature deviates from the proposal's `(pi, bc)` because `bridge.ts`
 * reconstitutes `BridgeContext` from closure-locals via `syncBc()` each turn;
 * a frozen `bc` snapshot would miss attach/detach and fork sessionId changes.
 */
export function registerDashboardContextInjector(
  pi: ExtensionAPI,
  getBc: () => Pick<BridgeContext, "sessionId" | "attachedChange">,
  isActive: () => boolean,
): void {
  pi.on("before_agent_start", (event: unknown) => {
    if (!isActive()) return undefined;
    // Guard the hook payload: a malformed/changed shape must not throw and
    // abort agent startup.
    const opts = (event as { systemPromptOptions?: PromptOptionsLike } | undefined)?.systemPromptOptions;
    if (!opts || typeof opts !== "object") {
      console.warn("[dashboard] before_agent_start: systemPromptOptions missing; skipping context injection");
      return undefined;
    }
    const bc = getBc();
    const cwd = typeof opts.cwd === "string" ? opts.cwd : process.cwd();
    opts.sections ??= {};
    opts.sections[SECTION_NAME] = buildContextFragment(bc.sessionId, cwd, bc.attachedChange);
    return undefined;
  });
}
