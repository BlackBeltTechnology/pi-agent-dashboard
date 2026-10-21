/**
 * On-tap loopback probe shared by the server confirm chip and an active
 * `canvas` tool card (change: improve-canvas-html-and-url-ux, D8 / auto-canvas
 * Decision 4). Nothing is fetched until the human gesture that calls this.
 *
 * Registers an in-memory PRESET target for `127.0.0.1:<port>` (never persisted,
 * never the agent-announced host), mints a restricted capability, and fetches
 * the capability root with a hard 3000 ms timeout. The `/live/` namespace needs
 * a capability for any browser-originated request, so the probe cannot use the
 * bare `/live/<id>/` path.
 */
import { getApiBase } from "../api/api-context.js";
import { classifyServerProbe, type ServerProbeOutcome } from "./canvas-gate.js";

/** Client timeout for the on-tap probe (S31 threshold). */
const PROBE_TIMEOUT_MS = 3000;

export async function probeLoopbackServer(port: number, sessionId?: string): Promise<ServerProbeOutcome> {
  // On-tap only: the live-server API module stays off the cold landing.
  const { mintLiveCapability, startLiveServer } = await import("../api/live-server-api.js");
  const started = await startLiveServer({ host: "127.0.0.1", port, addedBy: "preset", sessionId });
  if (!started.ok) return "not-running";
  const cap = await mintLiveCapability(started.target.id, { policy: { egress: "restricted", scripts: false } });
  if (!cap.ok) return "not-running";
  let aborted = false;
  let ok = false;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    aborted = true;
    controller.abort();
  }, PROBE_TIMEOUT_MS);
  try {
    const res = await fetch(`${getApiBase()}${cap.path}`, { signal: controller.signal });
    ok = res.ok;
  } catch {
    // AbortError (timeout) or a network error (refused) — classified below.
  } finally {
    clearTimeout(timer);
  }
  return classifyServerProbe({ aborted, ok });
}
