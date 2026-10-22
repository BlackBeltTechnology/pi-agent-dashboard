/**
 * In-app "Pair with code": the main-process counterpart of the browser `/pair#<payload>`
 * landing, run for a server identified by its PINNED fingerprint.
 *
 *   code (user pastes the text in the app-owned Connecting window)
 *     → decode → payload fingerprint must equal the pin (else NO request at all)
 *     → prove the pin at the first payload `https` url that proves it (others are skipped)
 *     → POST /api/pair/redeem there → wait for the operator's approval (compare code shown)
 *     → bearer into the keyring (same `safeStorage` / memory-only rules as a knock)
 *     → payload urls + delivered `routes`: stored only after validation + a proving challenge
 *
 * The pasted text, the pairing code and the credential never reach the dashboard page,
 * a log line, or any state pushed to a window (the compare code goes to the Connecting window
 * only). Electron-free (ports injected) — unit-tested in `__tests__/pairing-code-client.test.ts`.
 *
 * See change: group-servers-by-identity (D8).
 */
import { knockRefusalCopy } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import { type KnockOutcome, type ProveFn, redeemPairingCode } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { originToRoute, validateDeliveredRoutes } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { recordDeliveredRoutes } from "./delivered-routes.js";
import type { ConnectingState, PairingPhaseName, PairingResult } from "./pairing-client.js";
import { isFingerprint, shortFingerprint } from "./server-discovery.js";
import { MAX_DELIVERED_STORED, type ServerKeyring } from "./server-keyring.js";

/** A pasted pairing text is a few hundred bytes; anything larger is not one. */
const MAX_TEXT_CHARS = 16_384;
const MAX_CODE_CHARS = 256;

export interface PairingPayloadText {
  id: string;
  code: string;
  urls: string[];
}

const PAYLOAD_PREFIX = "pi:pair:v1.";

/**
 * Decode the pasted text (deep link `https://…/pair#<payload>`, `pi:pair:v1.<b64url>`, bare
 * base64url or raw JSON); null when it is not a pairing payload. Never throws and never echoes the text.
 */
export function decodePairingText(raw: string): PairingPayloadText | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_TEXT_CHARS) return null;
  try {
    let s = raw.trim();
    if (/^https?:\/\//i.test(s)) {
      const hash = new URL(s).hash;
      s = decodeURIComponent(hash.startsWith("#") ? hash.slice(1) : hash).trim();
    }
    if (s.startsWith(PAYLOAD_PREFIX)) s = s.slice(PAYLOAD_PREFIX.length);
    const json = s.startsWith("{") ? s : Buffer.from(s, "base64url").toString("utf8");
    const o = JSON.parse(json) as { id?: unknown; code?: unknown; urls?: unknown };
    if (typeof o.id !== "string" || typeof o.code !== "string" || o.code.length === 0 || o.code.length > MAX_CODE_CHARS) return null;
    if (!Array.isArray(o.urls)) return null;
    return { id: o.id, code: o.code, urls: o.urls.filter((u): u is string => typeof u === "string") };
  } catch {
    return null;
  }
}

export interface CodePairingTarget {
  /** The pinned fingerprint (from the server list). */
  fingerprint: string;
  /** Sanitised display label. */
  label: string;
  deviceName: string;
}

export interface CodePairingDeps {
  prove: ProveFn;
  keyring: ServerKeyring;
  log: (line: string) => void;
  /** Push a state to the connecting window. */
  onState: (state: ConnectingState) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
}

export interface CodePairingSession {
  /** The pasted text from the Connecting window. Only the first call counts. */
  submitCode(text: string): void;
  /** Window closed / "Stop waiting". */
  stop(): void;
  /** Resolves on the terminal phase. */
  done: Promise<PairingResult>;
}

const NOT_A_CODE = "That text is not a pairing code. Copy the whole pairing text (or link) from the dashboard that shows the code and paste it here.";
const NO_ADDRESS = "This pairing code names no secure address this app can use. Ask for a new code on the server's dashboard.";
const UNREACHABLE = "Could not verify the server at any address in this pairing code (unreachable, or too old to prove who it is). The code was not used.";

export function startCodePairing(target: CodePairingTarget, deps: CodePairingDeps): CodePairingSession {
  const abort = new AbortController();
  let resolveText: ((text: string | null) => void) | null = null;
  let submitted = false;
  let stopped = false;
  let hostText = "pairing code";
  let shortFp: string | undefined;

  const base = (phase: PairingPhaseName, extra: Partial<ConnectingState> = {}): ConnectingState => ({
    mode: "code",
    label: target.label,
    host: hostText,
    // Redeem happens only at a TLS origin, so nothing here travels unencrypted.
    unencrypted: false,
    phase,
    deviceName: target.deviceName,
    ...(shortFp ? { shortFp } : {}),
    ...extra,
  });
  const emit = (s: ConnectingState) => deps.onState(s);
  const logLine = (outcome: string, extra = "") =>
    deps.log(`[server-windows] code-pairing ${outcome} fp=${shortFingerprint(target.fingerprint)}${extra}`);

  function refuse(message: string, outcome: string): PairingResult {
    logLine(outcome);
    emit(base("refused", { message }));
    return { status: "refused" };
  }

  function mismatch(other: string | undefined, stage: string): PairingResult {
    logLine("identity-mismatch", `${other ? ` other=${shortFingerprint(other)}` : ""} stage=${stage}`);
    emit(
      base("mismatch", {
        expectedShort: shortFingerprint(target.fingerprint),
        ...(other ? { provenShort: shortFingerprint(other) } : {}),
        message: `This pairing code is for a different server${other ? ` (${shortFingerprint(other)})` : ""} than ${target.label} (${shortFingerprint(target.fingerprint)}). Nothing was sent.`,
      }),
    );
    return { status: "mismatch" };
  }

  function awaitText(): Promise<string | null> {
    return new Promise((resolve) => {
      if (abort.signal.aborted) return resolve(null);
      resolveText = resolve;
      abort.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
  }

  /** One origin's challenge: the pinned identity (with its key), another identity, or nothing usable. */
  async function proveOne(origin: string): Promise<{ publicKey?: string } | { other: string } | null> {
    try {
      const r = await deps.prove(origin);
      if (!("proven" in r)) return null;
      return r.proven === target.fingerprint ? { ...(r.publicKey ? { publicKey: r.publicKey } : {}) } : { other: r.proven };
    } catch {
      return null; // unreachable — the caller tries the next
    }
  }

  /** First payload origin that proves the pinned fingerprint; otherwise the other identity seen, if any. */
  async function proveFirst(origins: string[]): Promise<{ origin: string; publicKey?: string } | { other?: string }> {
    let other: string | undefined;
    for (const origin of origins) {
      if (abort.signal.aborted) break;
      const r = await proveOne(origin);
      if (r && !("other" in r)) return { origin, ...r };
      if (r) other ??= r.other;
    }
    return other ? { other } : {};
  }

  function redeemRefusal(outcome: Extract<KnockOutcome, { status: "refused" }>): PairingResult {
    const message =
      outcome.httpStatus === 429
        ? "Too many attempts. Wait a minute, then ask for a new pairing code."
        : outcome.reason !== "unknown"
          ? knockRefusalCopy(outcome.reason).fallback.replace("{time}", "a moment")
          : "The server did not accept this pairing code. It may have expired or been used. Ask for a new pairing code on the server's dashboard.";
    logLine(`refused http=${outcome.httpStatus}`);
    emit(base("refused", { message }));
    return { status: "refused" };
  }

  async function finishApproved(
    outcome: Extract<KnockOutcome, { status: "approved" }>,
    proof: { origin: string; publicKey?: string },
    others: string[],
  ): Promise<PairingResult> {
    const route = originToRoute(proof.origin);
    try {
      deps.keyring.savePaired({
        fingerprint: target.fingerprint,
        label: target.label,
        ...(proof.publicKey ? { pinnedPubkey: proof.publicKey } : {}),
        host: { scheme: "https", host: route.host, port: route.port, source: "pairing" },
        bearer: outcome.token,
      });
    } catch {
      logLine("store-failed");
      emit(base("unreachable", { message: "Paired, but the credential could not be saved on this computer. Try again." }));
      return { status: "unreachable" };
    }
    logLine("approved", ` host=${hostText}`);
    emit(base("approved"));
    // Other payload urls and delivered routes: validated + proven before they are kept; the
    // redeemed origin already counts as one of the stored routes.
    try {
      await recordDeliveredRoutes(target.fingerprint, [...others, ...(outcome.routes ?? [])], deps, {
        limit: MAX_DELIVERED_STORED - 1,
        skip: [proof.origin],
      });
    } catch (e) {
      logLine("delivered-routes-failed", ` (${e instanceof Error ? e.message : "error"})`);
    }
    return { status: "approved", fingerprint: target.fingerprint };
  }

  function stoppedResult(): PairingResult {
    logLine("stopped");
    emit(base("stopped"));
    return { status: "stopped" };
  }

  /** Decode the pasted text and prove the pin at the first usable payload url; or the terminal result. */
  async function intake(text: string): Promise<{ payload: PairingPayloadText; origins: string[]; proof: { origin: string; publicKey?: string } } | { result: PairingResult }> {
    const payload = decodePairingText(text);
    if (!payload) return { result: refuse(NOT_A_CODE, "malformed") };
    // A payload for another server: nothing named in it is contacted.
    if (payload.id !== target.fingerprint) return { result: mismatch(isFingerprint(payload.id) ? payload.id : undefined, "payload") };
    const origins = validateDeliveredRoutes(payload.urls);
    if (origins.length === 0) return { result: refuse(NO_ADDRESS, "no-secure-url") };

    const proof = await proveFirst(origins);
    if (abort.signal.aborted) return { result: stoppedResult() };
    if ("origin" in proof) return { payload, origins, proof };
    if (proof.other) return { result: mismatch(proof.other, "challenge") };
    logLine("identity-unverifiable");
    emit(base("unreachable", { message: UNREACHABLE }));
    return { result: { status: "unreachable" } };
  }

  async function run(): Promise<PairingResult> {
    emit(base("code"));
    const text = await awaitText();
    if (text === null) return stoppedResult();
    emit(base("proving"));

    const got = await intake(text);
    if ("result" in got) return got.result;
    const { payload, origins, proof } = got;
    const route = originToRoute(proof.origin);
    hostText = `${route.host}:${route.port}`;
    shortFp = shortFingerprint(target.fingerprint);
    emit(base("proving"));

    let outcome: KnockOutcome;
    try {
      outcome = await redeemPairingCode(proof.origin, target.fingerprint, payload.code, {
        signal: abort.signal,
        redirect: "manual",
        ...(deps.now ? { now: deps.now } : {}),
        ...(deps.sleep ? { sleep: deps.sleep } : {}),
        ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}),
        // The redeem answer has no expiry, so no countdown is shown.
        onWaiting: (w) => emit(base("waiting", { confirmCode: w.confirmCode })),
      });
    } catch {
      logLine("unreachable", ` host=${hostText}`);
      emit(base("unreachable", { message: `Could not reach ${target.label} to redeem the pairing code. Check that it is running and try again.` }));
      return { status: "unreachable" };
    }
    return finish(outcome, proof, origins.filter((o) => o !== proof.origin));
  }

  function finish(outcome: KnockOutcome, proof: { origin: string; publicKey?: string }, others: string[]): Promise<PairingResult> | PairingResult {
    switch (outcome.status) {
      case "approved":
        return finishApproved(outcome, proof, others);
      case "refused":
        return redeemRefusal(outcome);
      case "rejected":
        logLine("rejected");
        emit(base("rejected", { message: `${target.label} rejected the request.` }));
        return { status: "rejected" };
      case "expired":
        logLine("expired");
        emit(base("expired", { message: "The request expired before it was approved. Ask for a new pairing code." }));
        return { status: "expired" };
      case "cancelled":
        logLine("stopped");
        emit(base("stopped", { message: `The request stays visible on ${target.label} until it expires.` }));
        return { status: "stopped" };
      case "identity_mismatch":
        return mismatch(outcome.proven ?? undefined, outcome.stage);
    }
  }

  const done = run();
  return {
    submitCode(text) {
      if (submitted || !resolveText) return;
      submitted = true;
      resolveText(text);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
    },
    done,
  };
}
