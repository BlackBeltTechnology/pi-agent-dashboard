/**
 * Transport diagnostics that survive the default configuration.
 *
 * The endpoint decision (10.1) and every refusal to re-target (10.2) are the
 * two facts you need to answer "why is this session on that dashboard". Both
 * were `console.log` only, and pi's stdout is discarded whenever
 * `keeperLog.capturePiOutput` is false — which is the default. So they also
 * travel to the server, which writes its own stdout to `server.log`.
 *
 * Buffered, because endpoint resolution happens before a socket exists and
 * before a sessionId is known: reporting only when live would drop precisely
 * the diagnostic that explains a misrouted bridge. Bounded, because a bridge
 * that never registers must not accumulate them forever.
 *
 * See change: add-pi-gateway-transport-identity (tasks 10.1, 10.2, 10.5).
 */

// Subpath import, not the package barrel: the barrel does not resolve here
// (the same trap that yields "getDashboardConfigDir is not a function").
import type { BridgeDiagnosticEvent } from "@blackbelt-technology/pi-dashboard-shared/protocol.js";

interface TransportDiagnostic {
  event: BridgeDiagnosticEvent;
  detail: string;
}

interface DiagnosticsSink {
  send: (message: unknown) => void;
  /** Undefined until `session_register` has settled on an id. */
  getSessionId: () => string | undefined;
}

export interface TransportDiagnostics {
  record: (d: TransportDiagnostic) => void;
  attach: (sink: DiagnosticsSink) => void;
}

const DEFAULT_MAX_BUFFERED = 32;

export function createTransportDiagnostics(
  opts?: { maxBuffered?: number },
): TransportDiagnostics {
  const max = opts?.maxBuffered ?? DEFAULT_MAX_BUFFERED;
  const buffered: TransportDiagnostic[] = [];
  let sink: DiagnosticsSink | undefined;

  const flush = (): void => {
    if (!sink) return;
    const sessionId = sink.getSessionId();
    if (!sessionId) return;
    // Splice first: a throwing `send` must not replay what it already took,
    // and must not strand the entries behind it either.
    const pending = buffered.splice(0);
    for (let i = 0; i < pending.length; i++) {
      try {
        sink.send({ type: "bridge_diagnostic", sessionId, ...pending[i] });
      } catch {
        // Best-effort by contract, exactly like `inbound_drop_report`.
      }
    }
  };

  return {
    record(d) {
      buffered.push(d);
      // Drop the OLDEST on overflow — the newest refusals describe the state
      // the operator is actually looking at.
      while (buffered.length > max) buffered.shift();
      flush();
    },
    attach(next) {
      sink = next;
      flush();
    },
  };
}
