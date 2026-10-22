/**
 * Client half of signed navigation intents (change: harden-client-sinks, D10).
 *
 * `mintNavIntent` — called ONLY from an operator action that produces a
 * route-backed overlay URL (Expand on an operator-provenance preview card).
 * Failure or a 2 s timeout yields `null`: the caller navigates without `ni`.
 *
 * `useNavIntentVerdict` — a route-backed overlay's provenance. No `ni` →
 * `agent` at once. Otherwise `pending` until the server verifies (≤ 2 s), then
 * `operator` only on `{ ok: true }`; abort, error or timeout → `agent`. The
 * verdict is fixed for the mount (no mid-render upgrade).
 */
import {
  type NavIntentRequest,
  navIntentRequestFor,
} from "@blackbelt-technology/pi-dashboard-shared/nav-intent.js";
import type { ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useEffect, useState } from "react";

const NAV_INTENT_TIMEOUT_MS = 2000;

async function postJson(url: string, body: unknown): Promise<unknown> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), NAV_INTENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Mint an intent for `view`; `null` on any failure. Never throws. */
export async function mintNavIntent(view: ViewTarget): Promise<string | null> {
  try {
    const body = (await postJson("/api/nav-intent", navIntentRequestFor(view))) as { ni?: unknown } | null;
    return typeof body?.ni === "string" ? body.ni : null;
  } catch {
    return null;
  }
}

/** `url` with `ni=<intent>` appended. */
export function withNavIntent(url: string, ni: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}ni=${encodeURIComponent(ni)}`;
}

/** Server verdict for `ni` + `view`; `false` on any failure or after 2 s. Never throws. */
async function verifyNavIntent(ni: string, view: ViewTarget): Promise<boolean> {
  try {
    const req: NavIntentRequest & { ni: string } = { ni, ...navIntentRequestFor(view) };
    const body = (await postJson("/api/nav-intent/verify", req)) as { ok?: unknown } | null;
    return body?.ok === true;
  } catch {
    return false;
  }
}

export type NavIntentVerdict = "pending" | "operator" | "agent";

/** Provenance verdict for a route-backed overlay carrying `ni` (or not). */
export function useNavIntentVerdict(ni: string | null, view: ViewTarget): NavIntentVerdict {
  const key = view.kind === "file" ? `f\u0000${view.cwd}\u0000${view.path}` : `u\u0000${view.url}`;
  const [state, setState] = useState<{ for: string; verdict: NavIntentVerdict }>({ for: "", verdict: "pending" });
  const forKey = `${ni ?? ""}\u0001${key}`;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `forKey` captures ni + target; `view` is re-derived from it.
  useEffect(() => {
    if (!ni) return;
    let live = true;
    void verifyNavIntent(ni, view).then((ok) => {
      if (live) setState({ for: forKey, verdict: ok ? "operator" : "agent" });
    });
    return () => {
      live = false;
    };
  }, [forKey]);
  if (!ni) return "agent";
  return state.for === forKey ? state.verdict : "pending";
}
