/**
 * Main-process pairing client: drives the shared knock client with
 * `proveServerIdentity` and reports phases to the connecting window.
 *
 *   proving → confirm → waiting → approved
 *                  ↘ rejected | expired | refused | mismatch | unverifiable | unreachable | stopped
 *
 * - Identity is proven BEFORE any knock (D3). Pin ≠ advert ⇒ `mismatch`
 *   without any network call. Proven ≠ expected ⇒ `mismatch`. A target that
 *   cannot answer the challenge ⇒ `unverifiable` (distinct wording).
 * - The request is sent only after the user chooses "Send request"
 *   (`session.send(name)`); with no pin and no advert the window shows the full
 *   proven fingerprint (TOFU) and the pin is stored only on approval.
 * - The bearer + pin are stored in the keyring ONLY on approval. The
 *   confirmation code goes to the connecting window's state ONLY and is never
 *   logged; the bearer is never put in any state or log.
 *
 * Electron-free (ports injected) — unit-tested in `__tests__/pairing-client.test.ts`.
 *
 * Delivered routes: an approval's `routes` are stored only after validation and a
 * proving challenge (`delivered-routes.ts`); `done` resolves after that bounded step.
 *
 * See change: add-electron-server-windows (D3, D11), group-servers-by-identity (D7).
 */

import { knockRefusalCopy } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import {
  type KnockHooks,
  type KnockOutcome,
  type ProveFn,
  sendKnock,
} from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import { classifyProof } from "@blackbelt-technology/pi-dashboard-shared/server-pinning.js";
import type { RouteSource } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { recordDeliveredRoutes } from "./delivered-routes.js";
import {
  expandRef,
  type HostRef,
  type LookupFn,
  resolveExpectedFingerprint,
  serverOrigin,
  shortFingerprint,
} from "./server-discovery.js";
import type { ServerKeyring } from "./server-keyring.js";

/** `code` is only used by the in-app code redeem (`pairing-code-client.ts`). */
export type PairingPhaseName =
  | "code"
  | "proving"
  | "confirm"
  | "waiting"
  | "approved"
  | "rejected"
  | "expired"
  | "refused"
  | "mismatch"
  | "unverifiable"
  | "unreachable"
  | "stopped";

/** State pushed to the connecting window (never contains a bearer). */
export interface ConnectingState {
  /** `code` ⇒ the in-app "Pair with code" window (asks for the pasted text first). */
  mode?: "code";
  label: string;
  host: string;
  /** `http` ⇒ the request and resulting access travel unencrypted on this network. */
  unencrypted: boolean;
  phase: PairingPhaseName;
  /** Short proven fingerprint (when known). */
  shortFp?: string;
  /** Full proven fingerprint — shown ONLY for trust-on-first-use (compare prompt). */
  fullFp?: string;
  tofu?: boolean;
  deviceName: string;
  /** 8-digit code — only the connecting window ever sees it. */
  confirmCode?: string;
  expiresAt?: number;
  /** Plain-language reason for refused / mismatch / unverifiable / unreachable. */
  message?: string;
  /** Short fingerprints for a mismatch report. */
  expectedShort?: string;
  provenShort?: string;
  retryAfter?: number;
  /** No retry offered (knock_not_lan, knock_pending). */
  noRetry?: boolean;
}

export interface PairingTarget {
  /** Sanitised display label. */
  label: string;
  ref: HostRef;
  /**
   * The same server's other address literals (≤ 8, locality order). Each is proven in turn; an address
   * that proves this machine's own dashboard is skipped (a wrong address), a foreign one is a mismatch.
   */
  alternatives?: HostRef[];
  /** Keyring pin, when an entry exists. */
  pinnedFp?: string;
  /** Fingerprint advertised by discovery. */
  advertFp?: string;
  /** Prefilled device name (the computer's name). */
  deviceName: string;
  /** How `ref` was learned (recorded on the keyring host when pairing is approved). */
  source?: RouteSource;
}

export interface PairingClientDeps {
  prove: ProveFn;
  keyring: ServerKeyring;
  log: (line: string) => void;
  /** Push a state to the connecting window. */
  onState: (state: ConnectingState) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pollIntervalMs?: number;
  /** Resolve an `http` hostname to address literals; the proving literal is used for knock, poll and the saved host. */
  lookup?: LookupFn;
  /** This machine's own fingerprint (`"none"` = no local server, `undefined` = not yet known). Default: none. */
  localFp?: () => string | "none" | undefined;
}

export type PairingResult =
  | { status: "approved"; fingerprint: string }
  | { status: Exclude<PairingPhaseName, "approved" | "code" | "proving" | "confirm" | "waiting"> };

export interface PairingSession {
  /** User chose "Send request" with this device name. Idempotent while a request is in flight. */
  send(deviceName: string): void;
  /** User chose "Stop waiting" / closed the window. */
  stop(): void;
  /** Resolves on the terminal phase. */
  done: Promise<PairingResult>;
}

/** Seconds → `m:ss` text for a retry hint. */
function retryText(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** The fingerprint (and key) the address proved. */
interface ProvenIdentity {
  fingerprint: string;
  publicKey?: string;
}

export function startPairing(target: PairingTarget, deps: PairingClientDeps): PairingSession {
  // The address literal that proved the identity replaces these once proving succeeds (knock, poll and
  // the saved host all use it — a `.local` name could re-resolve to another machine in between).
  let ref = target.ref;
  let origin = serverOrigin(ref);
  let hostText = `${ref.host}:${ref.port}`;
  const unencrypted = target.ref.scheme === "http";
  const abort = new AbortController();
  let proven: ProvenIdentity | null = null;
  let resolveSend: ((name: string) => void) | null = null;
  let sent = false;
  let stopped = false;

  const base = (phase: PairingPhaseName, extra: Partial<ConnectingState> = {}): ConnectingState => ({
    label: target.label,
    host: hostText,
    unencrypted,
    phase,
    deviceName: target.deviceName,
    ...(proven ? { shortFp: shortFingerprint(proven.fingerprint) } : {}),
    ...extra,
  });
  const emit = (s: ConnectingState) => deps.onState(s);
  const logLine = (outcome: string, fp: string | undefined, extra = "") =>
    deps.log(`[server-windows] pairing ${outcome}${fp ? ` fp=${shortFingerprint(fp)}` : ""} host=${hostText}${extra}`);

  const UNVERIFIABLE_MESSAGE =
    "Cannot verify this dashboard's identity. It may be unreachable, or too old to prove who it is. No request was sent.";

  /** An identity that is not the expected one: nothing is knocked, nothing is stored. */
  function reportMismatch(m: {
    expected: string;
    other: string | null | undefined;
    otherLabel: "advert" | "proven";
    stage: string;
    message: string;
  }): PairingResult {
    const otherShort = m.other ? shortFingerprint(m.other) : "none";
    logLine("identity-mismatch", m.expected, ` expected=${shortFingerprint(m.expected)} ${m.otherLabel}=${otherShort} stage=${m.stage}`);
    emit(
      base("mismatch", {
        expectedShort: shortFingerprint(m.expected),
        ...(m.other ? { provenShort: shortFingerprint(m.other) } : {}),
        message: m.message,
      }),
    );
    return { status: "mismatch" };
  }

  function reportUnverifiable(fp: string | undefined): PairingResult {
    logLine("identity-unverifiable", fp);
    emit(base("unverifiable", { message: UNVERIFIABLE_MESSAGE }));
    return { status: "unverifiable" };
  }

  /** The refs to prove, in order: the primary, then its alternatives; `http` hostnames become address literals. */
  async function attemptRefs(): Promise<HostRef[]> {
    const out: HostRef[] = [];
    for (const r of [target.ref, ...(target.alternatives ?? [])]) {
      for (const lit of await expandRef(r, deps.lookup)) {
        if (!out.some((o) => o.scheme === lit.scheme && o.host === lit.host && o.port === lit.port)) out.push(lit);
      }
    }
    return out;
  }

  /** Bind the pairing to the literal that proved the identity. */
  function bind(r: HostRef): void {
    ref = r;
    origin = serverOrigin(r);
    hostText = `${r.host}:${r.port}`;
  }

  const skipLine = (r: HostRef, fp: string) =>
    deps.log(`[server-windows] candidate skipped host=${r.host}:${r.port} fp=${shortFingerprint(fp)} reason=self`);

  /** The address answered with another identity than the expected one. */
  const mismatchAt = (pin: string, proven: string): PairingResult =>
    reportMismatch({
      expected: pin,
      other: proven,
      otherLabel: "proven",
      stage: "challenge",
      message: `This address answered with a different identity (${shortFingerprint(proven)}) than expected for ${target.label} (${shortFingerprint(pin)}). No request was sent.`,
    });

  type Step =
    | { kind: "proof"; proof: ProvenIdentity }
    | { kind: "result"; result: PairingResult }
    /** Not this address: unreachable, unverifiable, or `self` (this machine's own dashboard). */
    | { kind: "skip"; self: boolean };

  /** The identity an address proved, or `null` (unreachable, refused or invalid: try the next address). */
  async function proveAt(r: HostRef): Promise<Extract<Awaited<ReturnType<ProveFn>>, { proven: string }> | null> {
    try {
      const proof = await deps.prove(serverOrigin(r));
      return "proven" in proof ? proof : null;
    } catch {
      return null;
    }
  }

  /** With a pin the shared classification; on first use anything but this machine's own dashboard is acceptable. */
  function classifyAt(pin: string | undefined, proof: { proven: string }, own: string | "none" | undefined): "ok" | "self" | "foreign" | "unverified" {
    if (pin) return classifyProof(proof, { pin, localFp: own });
    return proof.proven === own ? "self" : "ok";
  }

  /** Prove one address against the pin (when there is one) or, on first use, accept any identity but this machine's. */
  async function proveRef(r: HostRef, pin: string | undefined): Promise<Step> {
    const proof = await proveAt(r);
    if (!proof) return { kind: "skip", self: false };
    const cls = classifyAt(pin, proof, deps.localFp ? deps.localFp() : "none");
    switch (cls) {
      case "ok":
        bind(r);
        return { kind: "proof", proof: { fingerprint: proof.proven, ...(proof.publicKey ? { publicKey: proof.publicKey } : {}) } };
      case "foreign":
        bind(r);
        return { kind: "result", result: mismatchAt(pin ?? "", proof.proven) };
      case "self":
        skipLine(r, proof.proven);
        return { kind: "skip", self: true };
      default:
        return { kind: "skip", self: false }; // unverified while the own fingerprint is unknown
    }
  }

  /**
   * Prove each address in order. With an expected identity: the pin proves ⇒ bound; this machine's own
   * dashboard ⇒ skipped (wrong address); any other identity ⇒ a mismatch; nothing proven ⇒ unverifiable
   * (or unreachable once an address turned out to be this machine). Without one (trust on first use):
   * the first address that proves anything but this machine.
   */
  async function proveIdentity(
    expected: ReturnType<typeof resolveExpectedFingerprint>,
  ): Promise<{ proof: ProvenIdentity } | { result: PairingResult }> {
    const pin = expected.kind === "expected" ? expected.fingerprint : undefined;
    let sawSelf = false;
    for (const r of await attemptRefs()) {
      const step = await proveRef(r, pin);
      if (step.kind === "proof") return { proof: step.proof };
      if (step.kind === "result") return { result: step.result };
      sawSelf ||= step.self;
    }
    if (sawSelf) {
      logLine("unreachable", pin);
      emit(base("unreachable", { message: `No address of ${target.label} could be reached: the addresses tried belong to this computer. No request was sent.` }));
      return { result: { status: "unreachable" } };
    }
    return { result: reportUnverifiable(pin) };
  }

  /** The user chooses "Send request" (resolves the device name) or stops (resolves null). */
  function awaitSend(): Promise<string | null> {
    return new Promise<string | null>((resolve) => {
      // Stopped while still proving (window closed): an already-aborted signal never fires "abort" again.
      if (abort.signal.aborted) return resolve(null);
      resolveSend = (n) => resolve(n);
      abort.signal.addEventListener("abort", () => resolve(null), { once: true });
    });
  }

  async function run(): Promise<PairingResult> {
    emit(base("proving"));
    const expected = resolveExpectedFingerprint(target.pinnedFp, target.advertFp);
    if (expected.kind === "mismatch") {
      return reportMismatch({
        expected: expected.pin,
        other: expected.advert,
        otherLabel: "advert",
        stage: "pre",
        message: `This is not the dashboard you paired with: the address advertises a different identity (${shortFingerprint(expected.advert)}) than the one pinned for ${target.label} (${shortFingerprint(expected.pin)}). No request was sent.`,
      });
    }

    // 1. PROVE — never knock an address that cannot prove the expected identity.
    const checked = await proveIdentity(expected);
    if ("result" in checked) return checked.result;
    proven = checked.proof;
    if (abort.signal.aborted) {
      // Stopped (window closed) while proving: nothing to confirm, and `done` must still resolve.
      logLine("stopped", proven.fingerprint);
      emit(base("stopped"));
      return { status: "stopped" };
    }
    const tofu = expected.kind === "tofu";

    // 2. CONFIRM — the user sends the request (and reviews the fingerprint on TOFU).
    emit(base("confirm", { tofu, ...(tofu ? { fullFp: proven.fingerprint } : {}) }));
    const name = await awaitSend();
    if (name === null) {
      logLine("stopped", proven.fingerprint);
      emit(base("stopped"));
      return { status: "stopped" };
    }

    return knockAndFinish(proven, name);
  }

  /** KNOCK + POLL, then the terminal outcome. */
  async function knockAndFinish(p: ProvenIdentity, name: string): Promise<PairingResult> {
    const hooks: KnockHooks = {
      signal: abort.signal,
      redirect: "manual",
      ...(deps.now ? { now: deps.now } : {}),
      ...(deps.sleep ? { sleep: deps.sleep } : {}),
      ...(deps.pollIntervalMs !== undefined ? { pollIntervalMs: deps.pollIntervalMs } : {}),
      onWaiting: (w) => emit(base("waiting", { confirmCode: w.confirmCode, expiresAt: w.expiresAt })),
    };
    try {
      return await finish(await sendKnock(origin, p.fingerprint, name, hooks), p);
    } catch {
      logLine("unreachable", p.fingerprint);
      emit(base("unreachable", { message: `Could not reach ${target.label} to send the request. Check that it is running and try again.` }));
      return { status: "unreachable" };
    }
  }

  /** Store the bearer + pin (approval only). */
  function storeApproval(p: ProvenIdentity, token: string): PairingResult {
    try {
      deps.keyring.savePaired({
        fingerprint: p.fingerprint,
        label: target.label,
        ...(p.publicKey ? { pinnedPubkey: p.publicKey } : {}),
        host: { ...ref, ...(target.source ? { source: target.source } : {}) },
        bearer: token,
      });
    } catch {
      logLine("store-failed", p.fingerprint);
      emit(base("unreachable", { message: "Paired, but the credential could not be saved on this computer. Try again." }));
      return { status: "unreachable" };
    }
    logLine("approved", p.fingerprint);
    emit(base("approved"));
    return { status: "approved", fingerprint: p.fingerprint };
  }

  /** A server refusal: the shared wording, plus whether a retry can help. */
  function reportRefusal(outcome: Extract<KnockOutcome, { status: "refused" }>, fp: string): PairingResult {
    const message = knockRefusalCopy(outcome.reason).fallback.replace("{time}", retryText(outcome.retryAfter ?? 0));
    logLine(`refused code=${outcome.reason}`, fp);
    emit(
      base("refused", {
        message,
        ...(outcome.retryAfter !== undefined ? { retryAfter: outcome.retryAfter } : {}),
        noRetry: outcome.reason === "knock_not_lan" || outcome.reason === "knock_pending",
      }),
    );
    return { status: "refused" };
  }

  /** A plain terminal phase with a fixed message. */
  function endWith(phase: "rejected" | "expired" | "stopped", fp: string, message: string): PairingResult {
    logLine(phase, fp);
    emit(base(phase, { message }));
    return { status: phase };
  }

  /** Approval: store the credential, then (bounded) the delivered routes that prove the pin. */
  async function finishApproved(outcome: Extract<KnockOutcome, { status: "approved" }>, p: ProvenIdentity): Promise<PairingResult> {
    const result = storeApproval(p, outcome.token);
    if (result.status !== "approved" || !outcome.routes) return result;
    try {
      await recordDeliveredRoutes(p.fingerprint, outcome.routes, deps);
    } catch (e) {
      logLine("delivered-routes-failed", p.fingerprint, ` (${e instanceof Error ? e.message : "error"})`);
    }
    return result;
  }

  function finish(outcome: KnockOutcome, p: ProvenIdentity): PairingResult | Promise<PairingResult> {
    switch (outcome.status) {
      case "approved":
        return finishApproved(outcome, p);
      case "rejected":
        return endWith("rejected", p.fingerprint, `${target.label} rejected the request.`);
      case "expired":
        return endWith("expired", p.fingerprint, "The request expired before it was approved.");
      case "cancelled":
        return endWith("stopped", p.fingerprint, `The request stays visible on ${target.label} until it expires.`);
      case "identity_mismatch":
        return reportMismatch({
          expected: outcome.expected,
          other: outcome.proven,
          otherLabel: "proven",
          stage: outcome.stage,
          message: `${target.label} answered the request with a different identity. Nothing was stored.`,
        });
      case "refused":
        return reportRefusal(outcome, p.fingerprint);
    }
  }

  const done = run();
  return {
    send(deviceName) {
      if (sent || !resolveSend) return;
      sent = true;
      resolveSend(deviceName);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      abort.abort();
    },
    done,
  };
}
