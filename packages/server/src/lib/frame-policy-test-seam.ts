/**
 * Test-only frame-policy verdict seam (change: rich-chat-links, task 9.12; design "Harness verdict seam").
 *
 * Lets the docker E2E harness mark fixture hosts as `allowed` / `refused` for
 * `POST /api/web/frame-policy` WITHOUT contacting the internet, so rendered isolation
 * specs (test-plan F10) can run. It replaces only the probe's DNS + transport seams
 * (`ProbeDeps.lookup` / `.request`); every SSRF vetting step in `probeFramePolicy`
 * (https, port 443, own-origin refusal, public-unicast address) still runs on the stub.
 *
 *   PI_E2E_FRAME_POLICY_VERDICTS="host.test=allowed,other.test=refused"
 *
 * Honoured ONLY with `PI_E2E_SEED=1` AND `NODE_ENV !== "production"`, and only for
 * hosts under `.test` (reserved TLD, never resolvable on the internet). Anything else
 * is logged and ignored: default off, and a production build refuses the seam outright.
 */
import dns from "node:dns";
import { EventEmitter } from "node:events";
import type http from "node:http";
import https from "node:https";
import type { ProbeDeps, ProbeRequestFn, ResolvedAddress } from "./frame-policy-probe.js";

/** Public unicast documentation-adjacent address the stub "resolves" seam hosts to (never connected). */
const STUB_ADDRESS: ResolvedAddress = { address: "93.184.216.34", family: 4 };

type SeamVerdict = "allowed" | "refused";
type SeamProbe = Pick<ProbeDeps, "lookup" | "request">;

const hostAllowed = (host: string): boolean => host.endsWith(".test") && host.length > ".test".length;

/** Headers that make `computeFrameVerdict` answer the requested verdict for a 2xx HEAD. */
const HEADERS: Record<SeamVerdict, Record<string, string>> = {
  allowed: {},
  refused: { "x-frame-options": "DENY" },
};

function parseVerdicts(raw: string, log: { warn(msg: string): void }): Map<string, SeamVerdict> {
  const out = new Map<string, SeamVerdict>();
  for (const part of raw.split(",")) {
    const entry = part.trim();
    if (!entry) continue;
    const [host, verdict, ...rest] = entry.split("=").map((s) => s.trim().toLowerCase());
    if (rest.length || !host || !hostAllowed(host) || (verdict !== "allowed" && verdict !== "refused")) {
      log.warn(`PI_E2E_FRAME_POLICY_VERDICTS entry refused: expected <host>.test=allowed|refused`);
      continue;
    }
    out.set(host, verdict);
  }
  return out;
}

/** A HEAD "request" that answers 200 with the seam verdict's headers, never opening a socket. */
function stubRequest(verdicts: ReadonlyMap<string, SeamVerdict>): ProbeRequestFn {
  return (options, onResponse): http.ClientRequest => {
    const host = String(options.host ?? "").toLowerCase();
    const verdict = verdicts.get(host);
    if (!verdict) return https.request(options, onResponse);
    const req = new EventEmitter() as unknown as http.ClientRequest;
    const res = { statusCode: 200, headers: { ...HEADERS[verdict] }, destroy() {} } as unknown as http.IncomingMessage;
    Object.assign(req, {
      end() {
        queueMicrotask(() => onResponse(res));
        return req;
      },
      destroy() {
        return req;
      },
    });
    return req;
  };
}

/**
 * The probe seams for the current environment, or `undefined` (seam off → production transport).
 * Pure over `env`/`log` so a unit test can assert the production refusal.
 */
export function resolveFramePolicyTestSeam(
  env: NodeJS.ProcessEnv,
  log: { warn(msg: string): void },
): SeamProbe | undefined {
  const raw = env.PI_E2E_FRAME_POLICY_VERDICTS?.trim();
  if (!raw) return undefined;
  if (env.PI_E2E_SEED !== "1") return undefined; // seam inactive: silently ignored
  if (env.NODE_ENV === "production") {
    log.warn("PI_E2E_FRAME_POLICY_VERDICTS refused: the frame-policy verdict seam is not available in production builds");
    return undefined;
  }
  const verdicts = parseVerdicts(raw, log);
  if (verdicts.size === 0) return undefined;
  return {
    lookup: async (hostname: string): Promise<ResolvedAddress[]> =>
      verdicts.has(hostname.toLowerCase())
        ? [STUB_ADDRESS]
        : (await dns.promises.lookup(hostname, { all: true, verbatim: true })).map((a) => ({
            address: a.address,
            family: a.family,
          })),
    request: stubRequest(verdicts),
  };
}
