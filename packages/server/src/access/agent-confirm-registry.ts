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

/**
 * `confirm` entries are redeemable by a `path_grant_request`; `select` entries
 * (the gate's select prompt) only by a `path_gate_refusal`. Never cross-kind.
 * See change: yolo-covers-agent-path-gate.
 */
export type RegistryKind = "select" | "confirm";

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
  const bySession = new Map<string, Record<RegistryKind, Map<string, Entry>>>();
  const find = (sessionId: string, promptId: string, kind?: RegistryKind): Entry | undefined => {
    const m = bySession.get(sessionId);
    if (!m) return undefined;
    return kind ? m[kind].get(promptId) : (m.confirm.get(promptId) ?? m.select.get(promptId));
  };

  return {
    /** Record a forwarded confirm prompt. A replay of a known promptId is ignored. */
    observe(sessionId: string, promptId: string, info: { path: string; subject: string }, kind: RegistryKind = "confirm"): void {
      let all = bySession.get(sessionId);
      if (!all) {
        all = { select: new Map(), confirm: new Map() };
        bySession.set(sessionId, all);
      }
      const m = all[kind];
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
      for (const kind of ["select", "confirm"] as const) {
        const e = find(sessionId, promptId, kind);
        if (e) e.state = "cancelled";
      }
    },
    /** `prompt_dismiss` (emitted on every settlement): redeemable for a short window. */
    settle(sessionId: string, promptId: string): void {
      for (const kind of ["select", "confirm"] as const) {
        const e = find(sessionId, promptId, kind);
        if (e && e.state === "pending") {
          e.state = "settled";
          e.settledAt = now();
        }
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
      kind: RegistryKind = "confirm",
    ): ConsumeResult {
      const e = find(sessionId, promptId, kind);
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
