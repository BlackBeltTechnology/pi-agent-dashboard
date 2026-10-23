/**
 * Prove a CANDIDATE server's identity before the bridge drops its established
 * connection for it.
 *
 * A healthy `/api/health` answer is something any process on a loopback port
 * can fake; only a holder of the local token can return a valid counter-proof.
 * So the guarded migration performs the same upgrade handshake a real dial
 * would — with this HOME's proof header — verifies the counter-proof on the
 * upgrade response, and tears the probe socket down BEFORE `open`: no frame is
 * ever sent, the bridge never registers, and the incumbent is untouched.
 *
 * Nothing to prove (remote endpoint, unix socket, no token, or the explicit
 * opt-out) → ok. Refusal causes follow the dial path: no proof / wrong status →
 * `server-proof-missing`; bad MAC or a stalled response → `server-proof-invalid`.
 *
 * See change: harden-bridge-inbound-and-discovery (D19).
 */
import { WebSocket as WsWebSocket } from "ws";
import type { DialPlan, ServerProofFailure } from "./connection.js";
import { probeEndpointReachability } from "./instance-verification.js";
import { localCredentialPlan, proofFailureLogCause } from "./local-token-header.js";

export type ServerProofResult = { ok: true } | { ok: false; cause: ServerProofFailure };

export interface ServerProofProbeDeps {
  /** Dial plan for the candidate (default: the real loopback plan). */
  plan?: (endpoint: string) => Promise<DialPlan | undefined>;
  /** `ws` client (injectable for tests). */
  WebSocketImpl?: new (url: string, opts?: Record<string, unknown>) => any;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 3000;

export async function probeServerProof(candidateUrl: string, deps: ServerProofProbeDeps = {}): Promise<ServerProofResult> {
  let plan: DialPlan | undefined;
  try {
    plan = await (deps.plan ?? ((u: string) => localCredentialPlan(u)))(candidateUrl);
  } catch {
    // Could not even open the proof-bound socket: nothing proved anything.
    return { ok: false, cause: "server-proof-missing" };
  }
  if (!plan) return { ok: true };
  const verify = plan.verifyUpgrade;
  if (!verify) {
    plan.dispose?.();
    return { ok: true };
  }

  const WS = deps.WebSocketImpl ?? WsWebSocket;
  return new Promise<ServerProofResult>((resolve) => {
    let ws: any;
    let settled = false;
    const finish = (result: ServerProofResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.on?.("error", () => {}); // terminate() mid-handshake emits `error`
        ws?.terminate?.();
      } catch {
        /* already torn down */
      }
      plan?.dispose?.();
      resolve(result);
    };
    const timer = setTimeout(() => finish({ ok: false, cause: "server-proof-invalid" }), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    timer.unref?.();
    try {
      const opts: Record<string, unknown> = {};
      if (plan?.headers) opts.headers = plan.headers;
      if (plan?.createConnection) opts.createConnection = plan.createConnection;
      ws = new WS(candidateUrl, opts);
      ws.on("upgrade", (res: { headers: Record<string, string | string[] | undefined> }) => {
        let verdict: ReturnType<typeof verify>;
        try {
          verdict = verify(res);
        } catch {
          verdict = { ok: false, cause: "server-proof-invalid" };
        }
        finish(verdict);
      });
      // Anything that ends the handshake without a verified upgrade is a refusal.
      ws.on("unexpected-response", () => finish({ ok: false, cause: "server-proof-missing" }));
      ws.on("error", () => finish({ ok: false, cause: "server-proof-missing" }));
      ws.on("close", () => finish({ ok: false, cause: "server-proof-missing" }));
    } catch {
      finish({ ok: false, cause: "server-proof-missing" });
    }
  });
}

/**
 * The guarded migration's admission probe for a discovered candidate:
 * reachable (`GET /api/health` → `{ok:true}`) AND able to prove its identity.
 * A healthy answer alone never suffices. A refusal is logged with its named
 * cause (`server_proof_missing` / `server_proof_invalid`) and keeps the
 * established connection.
 */
export async function verifyDiscoveredCandidate(input: {
  healthUrl: string;
  candidateUrl: string;
  reachable?: (healthUrl: string) => Promise<boolean>;
  probe?: ServerProofProbeDeps;
  log?: (line: string) => void;
}): Promise<boolean> {
  const reachable = input.reachable ?? ((healthUrl: string) => probeEndpointReachability({ healthUrl }));
  if (!(await reachable(input.healthUrl))) return false;
  const proof = await probeServerProof(input.candidateUrl, input.probe);
  if (!proof.ok) {
    (input.log ?? ((line: string) => console.error(line)))(
      `[dashboard] server identity check failed (${proofFailureLogCause(proof.cause)}) at ${input.candidateUrl}`,
    );
    return false;
  }
  return true;
}
