/**
 * Local credential verifier + edge stamp.
 *
 * Verifies the `X-Pi-Local-Proof` header (endpoint-bound HMAC proof of possession,
 * see `shared/local-credential-proof.ts`) — or, while `acceptLegacyToken` is on,
 * the deprecated raw `X-Pi-Local-Token` — exactly ONCE per request, at the
 * listener edge, and stamps the verdict on the request's own `headers` object
 * under a module-private Symbol key. Every exemption site then reads the verdict
 * through `hasLocalCredential(headers)`; an unstamped request counts as `absent`
 * (fail closed). Fastify's `request.headers` returns that same object or an
 * `Object.assign` copy (which keeps enumerable Symbol keys); JSON,
 * `Object.entries` and header forwarding ignore Symbol keys, and a client cannot
 * set one over the wire (in-process code can read it — no new boundary).
 *
 * Order per proof: bounds → window ±30 s → listener bind-time floor → binding vs
 * the connection's OWN local address/port → constant-time MAC → replay cache
 * (insert only after the MAC verifies). The clock, the cache and the log are
 * injected so the decision logic stays pure.
 *
 * See change: loopback-credential-proof (D3, D4, D9).
 */
import {
  BRIDGE_PURPOSE,
  canonicalBinding,
  deriveKey,
  httpPurpose,
  LOCAL_PROOF_HEADER,
  PROOF_WINDOW_MS,
  parseProof,
  serverCounterProof,
  verifyProofMac,
} from "@blackbelt-technology/pi-dashboard-shared/local-credential-proof.js";
import { verifyLocalToken } from "./local-token.js";

type InvalidCause =
  | "malformed"
  | "stale"
  | "before-start"
  | "binding-mismatch"
  | "bad-mac"
  | "replayed"
  | "replay-cache-full";

export type LocalCredentialVerdict =
  | { kind: "proof"; binding: string; nonce: string; mac: string }
  | { kind: "legacy" }
  | { kind: "absent" }
  | { kind: "invalid"; cause: InvalidCause };

/** Which edge received the request. Fixes the proof purpose. */
export interface CredentialListener {
  kind: "bridge" | "http";
  /** ms epoch taken immediately BEFORE the bind call that succeeded. */
  boundAt: number;
  /** The listener's configured port (diagnostics only). */
  port?: number;
}

export interface StampableRequest {
  headers: Record<string, unknown>;
  method?: string;
  url?: string;
  socket: { localAddress?: string; localPort?: number };
}

export interface LocalCredentialVerifierOptions {
  token: string;
  now?: () => number;
  acceptLegacyToken: boolean;
  log?: (line: string) => void;
  maxNonces?: number;
}

export interface LocalCredentialVerifier {
  stamp(req: StampableRequest, listener: CredentialListener): LocalCredentialVerdict;
  /** `X-Pi-Local-Proof-Server` value answering a `proof` verdict (D5). */
  counterProof(verdict: { binding: string; nonce: string; mac: string }): string;
}

const STAMP = Symbol("local-credential");
const REPLAY_TTL_MS = 61_000;
const DEFAULT_MAX_NONCES = 10_000;
const LOG_INTERVAL_MS = 60_000;

/** The verdict stamped on these headers, or `absent` when never stamped. */
export function credentialVerdict(headers: unknown): LocalCredentialVerdict {
  if (headers && typeof headers === "object") {
    const v = (headers as Record<symbol, unknown>)[STAMP];
    if (v && typeof v === "object") return v as LocalCredentialVerdict;
  }
  return { kind: "absent" };
}

/** True for a verified proof or an accepted legacy raw token. */
export function hasLocalCredential(headers: unknown): boolean {
  const k = credentialVerdict(headers).kind;
  return k === "proof" || k === "legacy";
}

function firstString(raw: unknown): string | undefined {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/** Diagnostic-only candidates for what the caller may have dialled. */
function diagnosticBindings(req: StampableRequest, listener: CredentialListener, expected: string): string[] {
  const ports = new Set<number>();
  if (typeof req.socket.localPort === "number") ports.add(req.socket.localPort);
  if (typeof listener.port === "number") ports.add(listener.port);
  const host = firstString(req.headers.host);
  const m = host ? /:(\d{1,5})$/.exec(host) : null;
  if (m) ports.add(Number(m[1]));
  const out = new Set<string>();
  for (const port of ports) {
    for (const addr of ["127.0.0.1", "::1"]) {
      try {
        out.add(canonicalBinding(addr, port));
      } catch {
        /* unreachable for literals */
      }
    }
  }
  out.delete(expected);
  return [...out];
}

export function createLocalCredentialVerifier(opts: LocalCredentialVerifierOptions): LocalCredentialVerifier {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((l: string) => console.warn(l));
  const maxNonces = opts.maxNonces ?? DEFAULT_MAX_NONCES;
  const key = deriveKey(opts.token);
  const replay = new Map<string, number>(); // nonce → expiresAt, insertion order ≈ expiry order
  const limiter = new Map<string, { last: number; suppressed: number }>();

  /** At most one line per key per 60 s; the next line carries the suppressed count. */
  const limited = (limitKey: string, line: string): void => {
    const t = now();
    const s = limiter.get(limitKey);
    if (!s) {
      limiter.set(limitKey, { last: t, suppressed: 0 });
      log(line);
      return;
    }
    if (t - s.last < LOG_INTERVAL_MS) {
      s.suppressed += 1;
      return;
    }
    const suppressed = s.suppressed;
    s.last = t;
    s.suppressed = 0;
    log(suppressed > 0 ? `${line} suppressed=${suppressed}` : line);
  };

  const sweep = (t: number): void => {
    for (const [nonce, exp] of replay) {
      if (exp > t) break;
      replay.delete(nonce);
    }
  };

  const invalid = (cause: InvalidCause, listener: CredentialListener): LocalCredentialVerdict => {
    limited(`invalid:${listener.kind}:${cause}`, `[local-credential] ${listener.kind} proof rejected: ${cause}`);
    return { kind: "invalid", cause };
  };

  const verifyProof = (
    headerValue: string,
    req: StampableRequest,
    listener: CredentialListener,
  ): LocalCredentialVerdict => {
    const parsed = parseProof(headerValue);
    if (!parsed) return invalid("malformed", listener);
    const t = now();
    const ts = Number(parsed.ts);
    if (Math.abs(t - ts) > PROOF_WINDOW_MS) return invalid("stale", listener);
    if (ts < listener.boundAt) return invalid("before-start", listener);

    const { localAddress, localPort } = req.socket;
    let binding: string;
    try {
      if (localAddress === undefined || localPort === undefined) throw new Error("no local address");
      binding = canonicalBinding(localAddress, localPort);
    } catch {
      return invalid("binding-mismatch", listener);
    }
    const purpose =
      listener.kind === "bridge" ? BRIDGE_PURPOSE : httpPurpose(req.method ?? "GET", req.url ?? "/");
    if (!verifyProofMac(key, parsed, binding, purpose)) {
      // Distinguish a relayed/mis-bound proof from a forged one — for the log only.
      const relayed = diagnosticBindings(req, listener, binding).some((b) =>
        verifyProofMac(key, parsed, b, purpose),
      );
      return invalid(relayed ? "binding-mismatch" : "bad-mac", listener);
    }

    sweep(t);
    if (replay.has(parsed.nonce)) return invalid("replayed", listener);
    if (replay.size >= maxNonces) {
      limited("replay-cache-full", "[local-credential] replay cache full; refusing proofs");
      return { kind: "invalid", cause: "replay-cache-full" };
    }
    replay.set(parsed.nonce, t + REPLAY_TTL_MS);
    return { kind: "proof", binding, nonce: parsed.nonce, mac: parsed.mac };
  };

  return {
    counterProof: (v) => serverCounterProof({ token: opts.token, binding: v.binding, nonce: v.nonce, mac: v.mac }),
    stamp(req, listener) {
      const existing = (req.headers as Record<symbol, unknown>)[STAMP];
      if (existing && typeof existing === "object") return existing as LocalCredentialVerdict;

      let verdict: LocalCredentialVerdict;
      const proofValue = firstString(req.headers[LOCAL_PROOF_HEADER.toLowerCase()]);
      if (proofValue !== undefined) {
        // A request carrying both headers is judged on the proof alone.
        verdict = verifyProof(proofValue, req, listener);
      } else {
        if (opts.acceptLegacyToken && verifyLocalToken(req.headers, opts.token)) {
          verdict = { kind: "legacy" };
          limited(
            `legacy:${listener.kind}`,
            `[local-credential] DEPRECATED raw X-Pi-Local-Token accepted from a ${listener.kind} caller (send X-Pi-Local-Proof)`,
          );
        } else {
          verdict = { kind: "absent" };
        }
      }
      Object.defineProperty(req.headers, STAMP, {
        value: verdict,
        enumerable: true,
        // Immutable: no later code may redefine or overwrite a recorded verdict.
        // See change: harden-credential-proof-binding.
        configurable: false,
        writable: false,
      });
      return verdict;
    },
  };
}

/**
 * Take the listener's proof floor AFTER the application is ready and immediately
 * before the bind. `listen()` itself awaits `ready()` (plugin boot, possibly
 * seconds); a floor taken before it would let a proof captured by the previous
 * port holder during that window pass `before-start`. A failing `ready()` sets no
 * floor and never listens. See change: harden-credential-proof-binding.
 */
export async function listenWithProofFloor(
  app: { ready(): PromiseLike<unknown>; listen(opts: { port: number; host: string }): PromiseLike<unknown> },
  setFloor: (boundAt: number) => void,
  listenOpts: { port: number; host: string },
  now: () => number = Date.now,
): Promise<void> {
  await app.ready();
  setFloor(now());
  await app.listen(listenOpts);
}
