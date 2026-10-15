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
 * See change: add-electron-server-windows (D3, D11).
 */

import { knockRefusalCopy } from "@blackbelt-technology/pi-dashboard-shared/pairing-knock.js";
import {
  type KnockHooks,
  type KnockOutcome,
  type ProveFn,
  proveExpected,
  sendKnock,
} from "@blackbelt-technology/pi-dashboard-shared/pairing-knock-client.js";
import {
  type HostRef,
  resolveExpectedFingerprint,
  serverOrigin,
  shortFingerprint,
} from "./server-discovery.js";
import type { ServerKeyring } from "./server-keyring.js";

type PairingPhaseName =
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
  /** Keyring pin, when an entry exists. */
  pinnedFp?: string;
  /** Fingerprint advertised by discovery. */
  advertFp?: string;
  /** Prefilled device name (the computer's name). */
  deviceName: string;
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
}

export type PairingResult =
  | { status: "approved"; fingerprint: string }
  | { status: Exclude<PairingPhaseName, "approved" | "proving" | "confirm" | "waiting"> };

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
  const origin = serverOrigin(target.ref);
  const hostText = `${target.ref.host}:${target.ref.port}`;
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

  /** Expected identity known (pin and/or advert): the address must prove exactly that. */
  async function proveKnown(expectedFp: string): Promise<{ proof: ProvenIdentity } | { result: PairingResult }> {
    let checked: Awaited<ReturnType<typeof proveExpected>>;
    try {
      checked = await proveExpected(origin, expectedFp, deps.prove);
    } catch {
      return { result: reportUnverifiable(expectedFp) };
    }
    if (!("status" in checked)) return { proof: checked };
    // identity_mismatch: a refused challenge (proven null) is "unverifiable"; a different identity is a mismatch.
    if (checked.proven === null) return { result: reportUnverifiable(checked.expected) };
    return {
      result: reportMismatch({
        expected: checked.expected,
        other: checked.proven,
        otherLabel: "proven",
        stage: "challenge",
        message: `This address answered with a different identity (${shortFingerprint(checked.proven)}) than expected for ${target.label} (${shortFingerprint(checked.expected)}). No request was sent.`,
      }),
    };
  }

  /** Trust on first use: whatever the address proves is shown to the user to compare. */
  async function proveFirstUse(): Promise<{ proof: ProvenIdentity } | { result: PairingResult }> {
    try {
      const r = await deps.prove(origin);
      if ("refused" in r) return { result: reportUnverifiable(undefined) };
      return { proof: { fingerprint: r.proven, ...(r.publicKey ? { publicKey: r.publicKey } : {}) } };
    } catch {
      return { result: reportUnverifiable(undefined) };
    }
  }

  /** Prove the identity at the address; either a proof or the terminal result to return. */
  function proveIdentity(expected: ReturnType<typeof resolveExpectedFingerprint>): Promise<{ proof: ProvenIdentity } | { result: PairingResult }> {
    return expected.kind === "expected" ? proveKnown(expected.fingerprint) : proveFirstUse();
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
      return finish(await sendKnock(origin, p.fingerprint, name, hooks), p);
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
        host: target.ref,
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

  function finish(outcome: KnockOutcome, p: ProvenIdentity): PairingResult {
    switch (outcome.status) {
      case "approved":
        return storeApproval(p, outcome.token);
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
