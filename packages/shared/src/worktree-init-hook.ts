/**
 * Pure worktree-init hook shape + canonical hash — shared by the server (trust
 * store, hook engine) and the bridge (snapshot hook re-check). I/O-free.
 *
 * `normalizeHook` validates the raw `worktreeInit` value; `hookDefHash` is the
 * sha256 over its canonical (key-sorted) serialisation — the trust-key component.
 *
 * See change: generalize-worktree-init-hook, mirror-dashboard-trust-to-pi.
 */
import { createHash } from "node:crypto";

export interface ScriptRun {
  type: "script";
  command: string;
}

export interface AgentRun {
  type: "agent";
  prompt: string;
  model?: string;
  settings?: unknown;
}

export type InitRun = ScriptRun | AgentRun;

export interface WorktreeInitHook {
  gate: string;
  run: InitRun;
}

function normalizeRun(raw: unknown): InitRun | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const run = raw as { type?: unknown; command?: unknown; prompt?: unknown; model?: unknown; settings?: unknown };
  if (run.type === "script") {
    if (typeof run.command !== "string" || run.command.length === 0) return null;
    return { type: "script", command: run.command };
  }
  if (run.type === "agent") {
    if (typeof run.prompt !== "string" || run.prompt.length === 0) return null;
    const agent: AgentRun = { type: "agent", prompt: run.prompt };
    if (typeof run.model === "string") agent.model = run.model;
    if (run.settings !== undefined) agent.settings = run.settings;
    return agent;
  }
  return null;
}

/** Validate the raw `worktreeInit` value into a typed hook, else `null`. */
export function normalizeHook(hook: unknown): WorktreeInitHook | null {
  if (!hook || typeof hook !== "object" || Array.isArray(hook)) return null;
  const h = hook as { gate?: unknown; run?: unknown };
  if (typeof h.gate !== "string" || h.gate.length === 0) return null;
  const run = normalizeRun(h.run);
  return run ? { gate: h.gate, run } : null;
}

/** Deterministic JSON with recursively sorted object keys. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

/** sha256 over a canonical (key-sorted) serialization of the hook. */
export function hookDefHash(hook: WorktreeInitHook): string {
  return createHash("sha256").update(canonicalize(hook)).digest("hex");
}
