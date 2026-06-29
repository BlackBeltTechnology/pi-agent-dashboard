/**
 * Per-turn system-prompt injector exposing the dashboard session context
 * (sessionId, cwd, attached OpenSpec change) to the pi agent.
 *
 * Registers a `before_agent_start` handler that splice-replaces the trailing
 * `Current working directory: <cwd>` line of `event.systemPrompt` with a
 * marked context fragment. Coexists with the pass-through `before_agent_start`
 * forwarder already registered in `bridge.ts` — pi chains `{ systemPrompt }`
 * results, the forwarder returns nothing.
 *
 * The sessionId comes from the bridge (`bc.sessionId`); pi exposes no
 * `pi.sessionId`. State is read live via a getter so attach/detach and
 * fork/resume sessionId changes are reflected on the very next turn.
 *
 * See change: inject-session-context-into-agent.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { BridgeContext } from "./bridge-context.js";

/** Literal anchor pi appends to every system prompt (dist/core/system-prompt.js). */
export const CWD_ANCHOR = "\nCurrent working directory: ";

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
 * Splice-replace the LAST `Current working directory: ` line of `sp` with the
 * context fragment (which carries `cwd`, so nothing is lost). Content before
 * the anchor is preserved verbatim. When the anchor is absent, fall back to
 * appending the fragment after a `\n\n` separator. Pure.
 */
export function spliceContextFragment(
  sp: string,
  sessionId: string,
  cwd: string,
  attachedChange: string | null | undefined,
): string {
  const base = typeof sp === "string" ? sp : "";
  const fragment = buildContextFragment(sessionId, cwd, attachedChange);
  const anchorIndex = base.lastIndexOf(CWD_ANCHOR);
  if (anchorIndex === -1) {
    return `${base}\n\n${fragment}`;
  }
  return `${base.slice(0, anchorIndex)}\n${fragment}`;
}

/**
 * Register the `before_agent_start` injector. `getBc` returns the live
 * BridgeContext (bridge.ts `syncBc`) so sessionId/attachedChange are read
 * fresh each turn. cwd source: `event.systemPromptOptions?.cwd ?? process.cwd()`.
 *
 * `isActive` guards against `/reload` stacking a second handler on the same
 * `pi` instance — a stale-generation handler returns `undefined` (no SP
 * contribution) so only the current generation splices, mirroring the
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
  pi.on("before_agent_start", (event: any) => {
    if (!isActive()) return undefined;
    // Guard the hook payload: a malformed/changed shape must not throw and
    // abort agent startup. Bail cleanly (no SP contribution) when systemPrompt
    // is not a string.
    if (typeof event?.systemPrompt !== "string") {
      console.warn("[dashboard] before_agent_start: systemPrompt missing/non-string; skipping context injection");
      return undefined;
    }
    const bc = getBc();
    const optsCwd = event?.systemPromptOptions?.cwd;
    const cwd = typeof optsCwd === "string" ? optsCwd : process.cwd();
    return {
      systemPrompt: spliceContextFragment(
        event.systemPrompt,
        bc.sessionId,
        cwd,
        bc.attachedChange,
      ),
    };
  });
}
