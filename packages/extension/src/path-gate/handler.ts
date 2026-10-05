/**
 * Agent path gate `tool_call` handler (D1/D4/D5/D7/D8).
 *
 * Gated tools: `read` / `write` / `edit` only. In-root calls return immediately
 * (no round-trip). Out-of-root calls ask in the session's own conversation via
 * PromptBus (dashboard card or TUI), under ONE time budget, per-session mutex,
 * repeat suppression and a fail-closed settlement table. Any internal error
 * blocks — this handler is deliberately NOT wrapped in the fail-open `safe()`.
 *
 * Not OS confinement: `bash` and custom/MCP tools are out of scope.
 * See change: ask-agent-file-access-in-chat.
 */
import type { AgentPathGateConfig } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import {
  buildOptions,
  type Decision,
  decidePathAccess,
  type GateRoots,
  OPT_ALLOW_ONCE,
  OPT_DENY,
  type PathAccess,
} from "./decide.js";
import { defaultResolveEnv, type ResolveEnv } from "./resolve.js";
import { Suppression } from "./suppression.js";

export type GateOutcome =
  | "asked"
  | "allowed-once"
  | "allowed-always"
  | "denied"
  | "recently-denied"
  | "timeout"
  | "no-ui"
  | "error";

export type GateResult = { block: true; reason: string } | undefined;

const GATED_TOOLS = ["read", "write", "edit"] as const;
const KIND_SELECT = "agent-path-gate";
const KIND_CONFIRM = "agent-path-gate-confirm";

export interface GatePrompter {
  select(args: { id: string; title: string; options: string[]; metadata: Record<string, unknown> }): Promise<string | undefined>;
  confirm(args: { id: string; title: string; message: string; metadata: Record<string, unknown> }): Promise<boolean>;
  cancel(id: string): void;
}

export interface PathGateDeps {
  /** Resolved (env override applied) config; read fresh on every call. */
  getConfig: () => AgentPathGateConfig;
  getRoots: (grants: readonly string[], needsCheckout: boolean, cwd: string) => Promise<GateRoots>;
  getGrants: () => readonly string[];
  getSensitiveDirs: () => readonly string[];
  isUngrantable: (subject: string) => boolean;
  prompter: GatePrompter;
  /** Server announced a grant-store id equal to the local token file. */
  grantStoreMatch: () => boolean;
  requestGrant: (req: { promptId: string; path: string; subject: string }) => Promise<{ ok: boolean; error?: string }>;
  notify?: (message: string) => void;
  log: (line: string) => void;
  counters?: { inRoot: number; asked: number; blocked: number };
  sessionId: () => string;
  env?: ResolveEnv;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
  newId?: () => string;
  suppression?: Suppression;
}

export interface GateCtx {
  hasUI: boolean;
  cwd: string;
}

function block(code: string, detail?: string): GateResult {
  return { block: true, reason: `path-gate: ${code}${detail ? ` — ${detail}` : ""}` };
}

export function createPathGateHandler(deps: PathGateDeps) {
  const env = deps.env ?? defaultResolveEnv();
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const suppression = deps.suppression ?? new Suppression(now);
  const chains = new Map<string, Promise<unknown>>();

  // Every dynamic field of an audit line is agent- or error-controlled: strip control
  // characters from the WHOLE line at the single emission point so no site can forge a record.
  const emit = (line: string): void => deps.log(line.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "?"));
  const log = (outcome: GateOutcome, tool: string, access: PathAccess, canonical: string, sensitive: boolean, sid: string): void => {
    emit(
      `[path-gate] ${outcome} tool=${tool} access=${access === "read" ? "r" : "w"} path=${canonical} session=${sid} sensitive=${sensitive}`,
    );
  };

  async function ask(
    tool: string,
    access: PathAccess,
    d: Extract<Decision, { verdict: "ask" }>,
    input: Record<string, unknown>,
    toolCallId: string | undefined,
    cwd: string,
    sid: string,
  ): Promise<GateResult> {
    // Suppression is scoped to the session that was ASKED (captured at call start): an
    // outstanding prompt of session S that settles after T started still denies under S.
    const supKey = `${sid}\u0000${d.suppressionKey}`;
    // Re-check inside the mutex: an earlier sibling may have been denied meanwhile.
    if (suppression.isSuppressed(supKey)) {
      log("recently-denied", tool, access, d.canonical, d.sensitive, sid);
      return block("recently-denied", `access under ${d.suppressionKey} was denied moments ago`);
    }
    const timeoutMs = Math.max(1, deps.getConfig().timeoutSeconds) * 1000;
    let openId: string | null = null;
    let expired = false;
    let onExpire: () => void = () => {};
    const expiry = new Promise<"expired">((resolve) => {
      onExpire = () => resolve("expired");
    });
    const timer = setTimer(() => {
      expired = true;
      if (openId) deps.prompter.cancel(openId);
      onExpire();
    }, timeoutMs);
    const settleDeny = (): GateResult => {
      suppression.deny(supKey);
      log("denied", tool, access, d.canonical, d.sensitive, sid);
      return block("denied", `operator declined ${access} access to ${d.canonical}`);
    };
    const settleTimeout = (): GateResult => {
      suppression.deny(supKey);
      log("timeout", tool, access, d.canonical, d.sensitive, sid);
      return block("timeout", `no answer within ${Math.round(timeoutMs / 1000)}s`);
    };
    try {
      const offer = buildOptions({
        grantable: d.grantable,
        sensitive: d.sensitive,
        storeMatch: deps.grantStoreMatch(),
        subject: d.subject,
      });
      const detail =
        access === "write" && tool === "edit"
          ? `${Array.isArray(input.edits) ? input.edits.length : 0} edit(s)`
          : access === "write" && typeof input.content === "string"
            ? `${Buffer.byteLength(input.content)} bytes`
            : undefined;
      const message = [
        `Path: \`${d.canonical}\``,
        `Tool: ${tool}${detail ? ` (${detail})` : ""}`,
        `Session cwd: \`${cwd}\``,
        d.sensitive ? "⚠ **Sensitive location** (credentials or the agent's own control plane)." : "",
        offer.note ?? "",
      ]
        .filter(Boolean)
        .join("\n\n");
      // Plain-text twin of `message` for a terminal (no markdown) — see tui-prompt-adapter.
      const plainMessage = [
        `Path: ${d.canonical}`,
        `Tool: ${tool}${detail ? ` (${detail})` : ""}`,
        `Session cwd: ${cwd}`,
        d.sensitive ? "⚠ Sensitive location (credentials or the agent's own control plane)." : "",
        offer.note ?? "",
      ]
        .filter(Boolean)
        .join("\n")
        .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u2028\u2029]/g, "?");
      const id1 = newId();
      openId = id1;
      deps.counters && deps.counters.asked++;
      log("asked", tool, access, d.canonical, d.sensitive, sid);
      const answer = await Promise.race([
        deps.prompter.select({
          id: id1,
          // The TUI shows only title + options (metadata is dashboard-card detail),
          // so the title itself names the target and flags a sensitive location.
          title: `Agent wants to ${tool} outside its workspace: ${d.canonical.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, "?")}${d.sensitive ? "  ⚠ sensitive location" : ""}`,
          options: offer.options,
          metadata: {
            kind: KIND_SELECT,
            path: d.canonical,
            access,
            sensitive: d.sensitive,
            tool,
            message,
            plainMessage,
            ...(offer.note ? { note: offer.note } : {}),
            ...(toolCallId ? { toolCallId } : {}),
          },
        }),
        expiry,
      ]);
      openId = null;
      if (answer === "expired" || expired) return settleTimeout();
      if (answer === undefined || answer === OPT_DENY) return settleDeny();
      if (answer === OPT_ALLOW_ONCE) {
        log("allowed-once", tool, access, d.canonical, d.sensitive, sid);
        return undefined;
      }
      if (answer !== offer.alwaysLabel) return settleDeny(); // unknown answer fails closed
      // Always allow → confirm naming the exact directory.
      const id2 = newId();
      openId = id2;
      const confirmed = await Promise.race([
        deps.prompter.confirm({
          id: id2,
          title: `Always allow the agent to access ${d.subject}?`,
          message: `This persists for the directory ${d.subject} (and everything inside it). Revoke it any time in Settings ▸ Access.`,
          metadata: { kind: KIND_CONFIRM, path: d.canonical, subject: d.subject, message: `Directory: ${d.subject}`, ...(toolCallId ? { toolCallId } : {}) },
        }),
        expiry,
      ]);
      const confirmId = id2;
      openId = null;
      if (confirmed === "expired" || expired) return settleTimeout();
      if (confirmed !== true) return settleDeny();
      let result: { ok: boolean; error?: string };
      try {
        result = await Promise.race([
          deps.requestGrant({ promptId: confirmId, path: d.canonical, subject: d.subject }),
          expiry.then(() => ({ ok: false, error: "timeout" })),
        ]);
      } catch (err) {
        result = { ok: false, error: err instanceof Error ? err.message : "error" };
      }
      log("allowed-always", tool, access, d.canonical, d.sensitive, sid);
      if (!result.ok) {
        emit(`[path-gate] grant-not-saved error=${result.error ?? "unknown"} path=${d.canonical}`);
        deps.notify?.(`Path access allowed once — not saved: ${result.error ?? "unknown error"}`);
      }
      return undefined; // operator approved this call either way
    } finally {
      clearTimer(timer);
    }
  }

  return async function onToolCall(
    event: { toolName?: string; toolCallId?: string; input?: unknown },
    ctx: GateCtx,
  ): Promise<GateResult> {
    // Cheapest checks first: no fs / no cwd access when disabled or non-gated.
    const tool = event?.toolName;
    if (!tool || !(GATED_TOOLS as readonly string[]).includes(tool)) return undefined;
    let cfg: AgentPathGateConfig;
    try {
      cfg = deps.getConfig();
    } catch {
      cfg = { enabled: true, timeoutSeconds: 120 };
    }
    if (!cfg.enabled) return undefined;
    try {
      const input = (event.input ?? {}) as Record<string, unknown>;
      const rawPath = input.path;
      if (typeof rawPath !== "string" || rawPath === "") return undefined; // pi rejects it itself
      const access: PathAccess = tool === "read" ? "read" : "write";
      const cwd = ctx.cwd;
      const grants = deps.getGrants();
      const sensitiveDirs = deps.getSensitiveDirs();
      const decide = (roots: GateRoots): Decision =>
        decidePathAccess({ access, rawPath, cwd, roots, sensitiveDirs, isUngrantable: deps.isUngrantable, env });
      let decision = decide(await deps.getRoots(grants, false, cwd));
      if (decision.verdict === "ask") decision = decide(await deps.getRoots(grants, true, cwd));
      if (decision.verdict === "in-root") {
        if (deps.counters) deps.counters.inRoot++;
        return undefined;
      }
      const d = decision;
      const sid = deps.sessionId();
      if (!ctx.hasUI) {
        log("no-ui", tool, access, d.canonical, d.sensitive, sid);
        if (deps.counters) deps.counters.blocked++;
        return block("no-ui", "no interactive UI is attached to approve out-of-workspace access");
      }
      if (suppression.isSuppressed(`${sid}\u0000${d.suppressionKey}`)) {
        log("recently-denied", tool, access, d.canonical, d.sensitive, sid);
        if (deps.counters) deps.counters.blocked++;
        return block("recently-denied", `access under ${d.suppressionKey} was denied moments ago`);
      }
      // Per-session mutex: at most one gate prompt open per session; another session of
      // the same pi process is never queued behind it.
      const prior = chains.get(sid) ?? Promise.resolve();
      const run = prior.then(() => ask(tool, access, d, input, event.toolCallId, cwd, sid));
      const tail = run.catch(() => undefined);
      chains.set(sid, tail);
      void tail.catch(() => undefined).then(() => {
        if (chains.get(sid) === tail) chains.delete(sid);
      });
      const result = await run;
      if (result && deps.counters) deps.counters.blocked++;
      return result;
    } catch (err) {
      emit(`[path-gate] error tool=${tool} session=${safeSession(deps)} ${err instanceof Error ? err.message : String(err)}`);
      if (deps.counters) deps.counters.blocked++;
      return block("error", "the path gate failed and fails closed");
    }
  };
}

function safeSession(deps: PathGateDeps): string {
  try {
    return deps.sessionId();
  } catch {
    return "unknown";
  }
}
