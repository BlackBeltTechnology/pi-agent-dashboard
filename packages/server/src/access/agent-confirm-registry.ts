/**
 * Confirm registry for the agent path gate (D3). The server records each
 * `agent-path-gate-confirm` `prompt_request` it forwards — FIRST SIGHT ONLY —
 * and a later `path_grant_request` is accepted only against an unexpired,
 * unused, uncancelled entry of the SAME session whose path/subject match.
 *
 * The server cannot observe how the confirm was answered (browser answers are
 * forwarded unrecorded; a TUI answer arrives as a value-less dismiss), so this
 * binds a grant to a *raised* confirmation, not to proof of operator presence.
 * See change: ask-agent-file-access-in-chat.
 */
const REDEEM_WINDOW_MS = 5_000;
const DEFAULT_TTL_MS = 120_000;
const CAP_PER_SESSION = 32;

type State = "pending" | "settled" | "used" | "cancelled";

interface Entry {
  path: string;
  subject: string;
  expiresAt: number;
  state: State;
  settledAt?: number;
}

export type ConsumeResult = { ok: true; subject: string } | { ok: false; error: string };

export interface AgentConfirmRegistryOptions {
  now?: () => number;
  /** TTL from first sight (the gate timeout). */
  getTtlMs?: () => number;
  redeemWindowMs?: number;
  capPerSession?: number;
}

export function createAgentConfirmRegistry(opts: AgentConfirmRegistryOptions = {}) {
  const now = opts.now ?? Date.now;
  const getTtl = opts.getTtlMs ?? (() => DEFAULT_TTL_MS);
  const redeem = opts.redeemWindowMs ?? REDEEM_WINDOW_MS;
  const cap = opts.capPerSession ?? CAP_PER_SESSION;
  const bySession = new Map<string, Map<string, Entry>>();

  return {
    /** Record a forwarded confirm prompt. A replay of a known promptId is ignored. */
    observe(sessionId: string, promptId: string, info: { path: string; subject: string }): void {
      let m = bySession.get(sessionId);
      if (!m) {
        m = new Map();
        bySession.set(sessionId, m);
      }
      if (m.has(promptId)) return; // first sight only — never extends expiresAt
      m.set(promptId, { path: info.path, subject: info.subject, expiresAt: now() + getTtl(), state: "pending" });
      while (m.size > cap) {
        const oldest = m.keys().next().value as string | undefined;
        if (oldest === undefined) break;
        m.delete(oldest);
      }
    },
    /** `prompt_cancel` (timeout / gate cancel): never redeemable again. */
    cancel(sessionId: string, promptId: string): void {
      const e = bySession.get(sessionId)?.get(promptId);
      if (e) e.state = "cancelled";
    },
    /** `prompt_dismiss` (emitted on every settlement): redeemable for a short window. */
    settle(sessionId: string, promptId: string): void {
      const e = bySession.get(sessionId)?.get(promptId);
      if (e && e.state === "pending") {
        e.state = "settled";
        e.settledAt = now();
      }
    },
    clearSession(sessionId: string): void {
      bySession.delete(sessionId);
    },
    /**
     * Validate + consume (single use). `sameSubject` is injected (canonical
     * compare) so the registry stays filesystem-free.
     */
    consume(
      sessionId: string,
      promptId: string,
      req: { path: string; subject: string },
      sameSubject: (a: string, b: string) => boolean,
    ): ConsumeResult {
      const e = bySession.get(sessionId)?.get(promptId);
      if (!e) return { ok: false, error: "unknown confirmation" };
      if (e.state === "used") return { ok: false, error: "confirmation already used" };
      if (e.state === "cancelled") return { ok: false, error: "confirmation was cancelled" };
      const t = now();
      if (t >= e.expiresAt) return { ok: false, error: "confirmation expired" };
      if (e.state === "settled" && t - (e.settledAt ?? 0) > redeem) {
        return { ok: false, error: "confirmation settled too long ago" };
      }
      if (req.path !== e.path && !sameSubject(req.path, e.path)) return { ok: false, error: "path mismatch" };
      if (req.subject !== e.subject && !sameSubject(req.subject, e.subject)) return { ok: false, error: "subject mismatch" };
      e.state = "used";
      return { ok: true, subject: e.subject };
    },
  };
}

export type AgentConfirmRegistry = ReturnType<typeof createAgentConfirmRegistry>;
