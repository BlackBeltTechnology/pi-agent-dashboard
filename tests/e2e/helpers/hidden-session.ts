/**
 * A REAL, live, HIDDEN pi session in the harness container.
 *
 * Why: the pending-question stack routes a question by its session's
 * visibility — a hidden session (an unattended automation run is one) opens the
 * answer dialog instead of navigating to the chat. The harness cannot produce a
 * live hidden session any other way:
 *  - the automation engine's init fails in the harness (`Fastify instance is
 *    already listening … addHook`, issue #683 — see
 *    `archive-service-sessions-on-end.spec.ts`), so a fired run never starts;
 *  - the hide/unhide browser verbs were removed (`archive-sessions-lazy-load`);
 *  - dashboard spawns are never auto-hidden (`source:"dashboard"`).
 * The remaining lever is the bridge's own explicit visibility intent
 * (`PI_DASHBOARD_HIDDEN`, `visibilityIntent:"hidden"` on `session_register`),
 * which is exactly how a headless worker declares itself hidden. This launches
 * one the same way the harness entrypoint launches its independent TUI session
 * (`docker/test-entrypoint.sh`, `PI_E2E_INDEPENDENT_SESSION`): `pi --mode rpc`
 * fed by a never-writing `tail`, pointed at the running gateway.
 *
 * The session is a REAL pi with the seeded faux model, so a prompt carrying a
 * `[[faux:<scenario>]]` sentinel (delivered over `POST /api/session/:id/prompt`)
 * drives it like any other session.
 *
 * Cleanup is the caller's `stopHiddenPiSession` (the `tail` feeder is a tiny
 * orphan that dies with the container).
 *
 * See change: add-pending-question-stack (test-plan F2, F7).
 */
import { execFileSync } from "node:child_process";
import type { APIRequestContext } from "@playwright/test";
import { resolveContainer } from "./container-proc.js";

/** Dedicated cwd: its own folder group would otherwise perturb other specs (it is hidden, so it never shows). */
export const HIDDEN_SESSION_CWD = "/tmp/e2e-hidden-question-session";

interface SessionRow {
  id: string;
  cwd?: string;
  hidden?: boolean;
  pid?: number;
}

async function listSessions(request: APIRequestContext): Promise<SessionRow[]> {
  const res = await request.get("/api/sessions");
  if (!res.ok()) return [];
  return ((await res.json()) as { data: SessionRow[] }).data;
}

/**
 * Launch a hidden pi in the harness container and resolve once it has
 * registered. Returns its session id. Throws if it never registers hidden.
 */
export async function startHiddenPiSession(
  request: APIRequestContext,
  cwd: string = HIDDEN_SESSION_CWD,
): Promise<{ id: string; pid?: number }> {
  if (!/^[\w./-]+$/.test(cwd)) throw new Error(`unsafe hidden-session cwd: ${cwd}`);
  const before = new Set((await listSessions(request)).map((s) => s.id));

  // `${PI_GATEWAY_PORT:-18999}` expands INSIDE the container (docker exec
  // inherits its env), same expression as the entrypoint's independent session.
  const script =
    `mkdir -p '${cwd}' && cd '${cwd}' && ` +
    `PI_DASHBOARD_URL="ws://localhost:\${PI_GATEWAY_PORT:-18999}" PI_DASHBOARD_HIDDEN=1 ` +
    `setsid sh -c 'tail -f /dev/null | pi --mode rpc' >> /tmp/e2e-hidden-session.log 2>&1 &`;
  execFileSync("docker", ["exec", "-d", resolveContainer(), "sh", "-c", script], { timeout: 30_000 });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    const fresh = (await listSessions(request)).find((s) => s.cwd === cwd && !before.has(s.id));
    if (fresh) {
      if (fresh.hidden !== true) {
        throw new Error(`session ${fresh.id} registered visible — PI_DASHBOARD_HIDDEN was not honoured`);
      }
      return { id: fresh.id, pid: fresh.pid };
    }
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`hidden pi session did not register within 90 s (log: /tmp/e2e-hidden-session.log in the container)`);
}

/** Best-effort: SIGTERM the hidden session's pi so it neither lingers nor re-registers. */
export async function stopHiddenPiSession(request: APIRequestContext, id: string): Promise<void> {
  const row = (await listSessions(request)).find((s) => s.id === id);
  if (!row?.pid || !Number.isInteger(row.pid)) return;
  try {
    execFileSync("docker", ["exec", resolveContainer(), "kill", String(row.pid)], { timeout: 15_000 });
  } catch {
    // already gone
  }
}
