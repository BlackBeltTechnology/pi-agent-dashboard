/**
 * Shared extension-slash-command dispatch branch used by both bridge.ts
 * (sessionPrompt callback) and command-handler.ts (slash else-arm fallback).
 *
 * Routing-step 9 from `command-routing` spec — ONE in-process call:
 *   gate pi >= 0.84.2 → `pi.sendUserMessage(text, {expandPromptTemplates: true,
 *   deliverAs})`. pi's own `prompt()` runs `_tryExecuteExtensionCommand` BEFORE
 *   the compaction guard and BEFORE `streamingBehavior` is consulted, so the
 *   handler executes immediately in every session shape (dashboard headless,
 *   tmux, Windows Terminal).
 *
 * Verified on pi 0.86.1 (the version `packages/server/package.json` pins as both
 * `minimum` and `recommended`) at these exact refs — re-verify after a pi bump:
 *   - `dist/core/agent-session.js` L938 `expandPromptTemplates ?? true` and
 *     L945 `_tryExecuteExtensionCommand` FIRST (handler impl at L1062), AHEAD of
 *     the compaction guard at L953 — so compaction can never block a dispatched
 *     extension command.
 *   - `dist/core/agent-session.js` L1273 `sendUserMessage()` → `prompt(text,
 *     {expandPromptTemplates: options?.expandPromptTemplates ?? false,
 *     streamingBehavior: options?.deliverAs, source:"extension"})` — that
 *     `false` default (L1296) is why this helper MUST pass the flag explicitly.
 *   - `dist/core/extensions/loader.js` L284-287 — `ExtensionAPI.sendUserMessage`
 *     is `assertActive()` + a void call: a stale ctx throws synchronously, while
 *     every failure INSIDE `prompt()` becomes a swallowed rejection routed to
 *     `runner.emitError` (unobservable from the bridge). Handler outcome is
 *     therefore not surfaced — an accepted trade-off, uniform across session
 *     kinds and identical in kind to the retired Path C's optimistic
 *     `completed`.
 *
 * Version gate: below 0.84.2 the flag is unavailable, so the raw slash would
 * become an LLM turn while the bridge reported `completed` — a silent
 * regression where the retired Path D was a loud error. The reader is
 * argv-anchored AND realpath-ed (`readRunningPiVersion`) so it never reads a
 * hoisted newer copy and never misses the manifest behind a bin symlink. A
 * pre-release of the floor (`0.84.2-beta.1`) counts as BELOW it (SemVer).
 *
 * Retired surface: Path B (`pi.dispatchCommand`, never shipped upstream), Path C
 * (`dispatch_extension_command` → server → keeper UDS → pi stdin), Path D
 * (tmux / Windows Terminal error feedback), plus the `connection` parameter and
 * the `DispatchConnection` type.
 *
 * Feedback contract: EXACTLY ONE `started` event AND EXACTLY ONE terminal event
 * (`completed` xor `error`) per dispatch. `started` precedes the version read so
 * the old-pi branch still reports a terminal; the read and the call both sit
 * inside the try, so no throw can escape between them. The existing
 * `emitFeedback` no-ops when `sink` is undefined.
 *
 * Non-extension text returns `false` so the caller can fall through to its
 * existing template-expansion / `sendUserMessage` path.
 *
 * See change: fix-extension-slash-commands-in-dashboard,
 *             add-rpc-stdin-dispatch-with-keeper-sidecar,
 *             fix-slash-dispatch-delivery,
 *             retire-slash-dispatch-via-expand-prompt-templates.
 */
import type { ExtensionToServerMessage } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";
import { isExtensionSlashCommand } from "./bridge-context.js";
import { readRunningPiVersion } from "./model-tracker.js";

export type FeedbackSink = (msg: ExtensionToServerMessage) => void;

/** Minimum pi whose `sendUserMessage` honors `expandPromptTemplates`. */
const MIN_DISPATCH_PI_VERSION: readonly [number, number, number] = [0, 84, 2];

const OLD_PI_ERROR =
  `Extension slash commands from the dashboard require pi ${MIN_DISPATCH_PI_VERSION.join(".")}+`;

/**
 * Accepted version shapes: `major.minor.patch`, optionally `-prerelease` and/or
 * `+build` metadata. Anchored at both ends on purpose — a loose prefix match
 * (`0.84.2garbage`, `v0.84.2`, `dev`) must fall into the UNPARSEABLE branch
 * (warn + assume new), not be silently read as a clean triplet.
 */
const VERSION_RE = /^\s*(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Compare a version against `target`. Returns `-1` / `0` / `1`, or `undefined`
 * when the string is not a version at all (e.g. `"dev"`, `"v0.84.2"`,
 * `"0.84.2garbage"`, `""`).
 *
 * A PRE-RELEASE of the floor (`0.84.2-beta.1`) compares BELOW the floor —
 * SemVer orders it under the final release, and the feature may only have
 * landed in that final release. Treating it as equal would wave an unsupported
 * build through the gate, which is the silent-regression direction.
 *
 * Deliberately local, NOT `node-version.ts`: that predicate is the canonical
 * **Node** comparison and returns `false` for unparseable input, which would
 * misclassify a weird pi version as "too old" and hard-fail a working setup.
 */
function compareTriplet(version: string, target: readonly number[]): number | undefined {
  const m = VERSION_RE.exec(version);
  if (!m) return undefined;
  const parts = [Number(m[1]), Number(m[2]), Number(m[3])];
  let cmp = 0;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== target[i]) {
      cmp = parts[i] < target[i] ? -1 : 1;
      break;
    }
  }
  if (cmp === 0 && m[4] !== undefined) return -1;
  return cmp;
}

/**
 * Warn at most once per process per reason. Dispatch runs per slash command, so
 * an undetectable version would otherwise warn on every single one.
 */
const warnedReasons = new Set<string>();

function warnOnce(reason: string, message: string): void {
  if (warnedReasons.has(reason)) return;
  warnedReasons.add(reason);
  console.warn(message);
}

/** Test-only: clear the warn-once cache. */
export function _resetDispatchWarnings(): void {
  warnedReasons.clear();
}

function emitFeedback(
  sink: FeedbackSink | undefined,
  sessionId: string,
  command: string,
  status: "started" | "completed" | "error",
  message?: string,
): void {
  if (!sink) return;
  sink({
    type: "event_forward",
    sessionId,
    event: {
      eventType: "command_feedback",
      timestamp: Date.now(),
      data: message === undefined ? { command, status } : { command, status, message },
    },
  });
}

/**
 * Try to dispatch a slash command as an extension command.
 *
 * @returns `true` if the helper handled the text (extension command detected;
 *          dispatch attempted, or a version-gate / throw error reported). The
 *          caller MUST NOT fall through to template expansion or
 *          `sendUserMessage`.
 * @returns `false` if `text` is not an extension slash command, or if
 *          `getCommands()` threw on a stale ctx. The caller SHOULD continue
 *          with its existing fallback path.
 *
 * @param readVersion injectable for tests; defaults to the argv-anchored reader.
 */
export async function tryDispatchExtensionCommand(
  pi: unknown,
  text: string,
  sessionId: string,
  sink: FeedbackSink | undefined,
  delivery?: "steer" | "followUp",
  readVersion: () => string | undefined = readRunningPiVersion,
): Promise<boolean> {
  // Detection stays inside this helper so a stale ctx during dispose returns
  // false and the caller falls through — callers never evaluate detection.
  let commands: Array<{ name: string; source?: string }> = [];
  try {
    const got = (pi as any)?.getCommands?.();
    if (Array.isArray(got)) commands = got;
  } catch (err) {
    console.warn("[dashboard] getCommands stale on slash-dispatch", err);
    return false;
  }

  if (!isExtensionSlashCommand(text, commands)) return false;

  emitFeedback(sink, sessionId, text, "started");
  try {
    let version: string | undefined;
    try {
      version = readVersion();
    } catch (err) {
      // A throwing reader degrades to `undefined` ("assume new") rather than
      // becoming an unhandled rejection or a stuck pill.
      console.warn("[dashboard] pi version read failed on slash-dispatch", err);
      version = undefined;
    }

    if (version === undefined) {
      warnOnce(
        "missing",
        "[dashboard] could not determine the running pi version on slash-dispatch; assuming expandPromptTemplates support",
      );
    } else {
      const cmp = compareTriplet(version, MIN_DISPATCH_PI_VERSION);
      if (cmp === undefined) {
        warnOnce(
          "unparseable",
          `[dashboard] unrecognized pi version "${version}" on slash-dispatch; assuming expandPromptTemplates support`,
        );
      } else if (cmp < 0) {
        emitFeedback(sink, sessionId, text, "error", OLD_PI_ERROR);
        return true;
      }
    }

    // pi consults `streamingBehavior` only AFTER `_tryExecuteExtensionCommand`,
    // so for an extension command `deliverAs` is inert — forwarded for
    // uniformity with the other sendUserMessage sites.
    await (pi as any).sendUserMessage(text, {
      expandPromptTemplates: true,
      deliverAs: delivery ?? "followUp",
    });
    emitFeedback(sink, sessionId, text, "completed");
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    emitFeedback(sink, sessionId, text, "error", message);
  }
  return true;
}
