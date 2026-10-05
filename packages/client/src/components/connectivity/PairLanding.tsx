/**
 * Browser pairing landing served at `/pair` — the phone-camera counterpart of
 * the Electron shell's `PairView`. A phone scans the pairing QR
 * (`https://<tls-endpoint>/pair#pi:pair:v1.<payload>`); the camera opens this
 * page; we decode the payload from `location.hash` and run the IDENTICAL
 * handshake:
 *
 *   challenge (verify fingerprint == payload.id, refuse on mismatch)
 *     → redeem → show confirm code ON THIS PHONE
 *     → poll until the desktop operator types+approves → store bearer → dashboard
 *
 * The keyring sink of the Electron flow becomes a browser bearer store
 * (`device-auth.ts`); D12 typed desktop approval is unchanged (a scan alone
 * cannot self-approve).
 *
 * See change: make-pairing-qr-camera-scannable.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { finishDevicePairing } from "../../lib/pairing/device-auth.js";
import { t, useI18n } from "../../lib/i18n/i18n.js";
import { challengeIdentity, postJson } from "../../lib/pairing/pair-protocol.js";
import type { PairingPayload } from "../../lib/pairing/pairing-api.js";
import { decodePayloadString } from "../../lib/pairing/pairing-qr.js";

type Phase = "verifying" | "polling" | "done" | "rejected" | "error";

interface RedeemResult {
  pendingId: string;
  confirmCode: string;
}

interface PollResult {
  status: "pending" | "approved" | "rejected" | "unknown";
  token?: string;
}

const POLL_INTERVAL_MS = 2000;

/** First `payload.urls[]` entry that answers AND proves the pinned fingerprint. */
async function findVerifiedUrl(payload: PairingPayload): Promise<string | null> {
  for (const url of payload.urls) {
    try {
      const proof = await challengeIdentity(url);
      if (proof.verified && proof.fingerprint === payload.id) return url;
    } catch {
      // url unreachable / failed verification — try the next.
    }
  }
  return null;
}

type PollOutcome = { token: string } | "rejected" | "unknown" | "cancelled";

/**
 * Poll `/api/pair/poll` until approved, rejected, or cancelled. Throws on
 * transport error. Only `pending` keeps polling: any status this client does
 * not know is terminal, so a future server status can never poll forever
 * (change: add-pairing-approval-dialog, X12).
 */
async function pollForToken(url: string, pendingId: string, isCancelled: () => boolean): Promise<PollOutcome> {
  while (!isCancelled()) {
    const poll = await postJson<PollResult>(url, "/api/pair/poll", { pendingId });
    if (isCancelled()) return "cancelled";
    if (poll.status === "approved" && poll.token) return { token: poll.token };
    if (poll.status === "rejected") return "rejected";
    if (poll.status !== "pending") return "unknown";
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return "cancelled";
}

/** Read + decode the payload from the URL fragment. Null when missing/invalid. */
function readPayloadFromHash(): { payload: PairingPayload | null; error: string | null } {
  const hash = window.location.hash.replace(/^#/, "").trim();
  if (!hash)
    return {
      payload: null,
      error: t("landing.err.missingCode", undefined, "This pairing link is missing its code. Re-scan the QR from the dashboard."),
    };
  try {
    return { payload: decodePayloadString(hash), error: null };
  } catch {
    return {
      payload: null,
      error: t("landing.err.malformed", undefined, "This pairing link is malformed. Re-scan the QR from the dashboard."),
    };
  }
}

export function PairLanding({ onPaired }: { onPaired?: (token: string) => void } = {}) {
  const { t } = useI18n();
  const [phase, setPhase] = useState<Phase>("verifying");
  const [error, setError] = useState<string | null>(null);
  const [confirmCode, setConfirmCode] = useState<string | null>(null);
  const cancelled = useRef(false);

  useEffect(() => () => { cancelled.current = true; }, []);

  // Persist the minted bearer and route into the dashboard (or notify a caller).
  // Same-origin: the exchange for the httpOnly cookie completes BEFORE navigation.
  const finishPaired = useCallback(async (token: string) => {
    await finishDevicePairing(token);
    setPhase("done");
    if (onPaired) onPaired(token);
    else window.location.href = "/";
  }, [onPaired]);

  const run = useCallback(async (payload: PairingPayload) => {
    cancelled.current = false;
    setError(null);
    setConfirmCode(null);
    setPhase("verifying");

    // 1. CHALLENGE — pin the server identity. Refuse when no url proves the
    //    pinned fingerprint (impostor on a reused url, or all unreachable).
    const verifiedUrl = await findVerifiedUrl(payload);
    if (cancelled.current) return;
    if (!verifiedUrl) {
      setPhase("error");
      setError(
        t(
          "landing.err.verifyFailed",
          undefined,
          "Could not verify the server's identity (pin mismatch or unreachable). Pairing refused.",
        ),
      );
      return;
    }

    // 2. REDEEM — trade the one-time code for a confirm code shown on THIS phone,
    // then 3. POLL — the operator types that code into the dashboard (D12).
    try {
      const redeemed = await postJson<RedeemResult>(verifiedUrl, "/api/pair/redeem", { code: payload.code });
      if (cancelled.current) return;
      setConfirmCode(redeemed.confirmCode);
      setPhase("polling");

      const outcome = await pollForToken(verifiedUrl, redeemed.pendingId, () => cancelled.current);
      if (outcome === "cancelled") return;
      if (outcome === "rejected") {
        setPhase("rejected");
        return;
      }
      if (outcome === "unknown") {
        setPhase("error");
        setError(t("landing.err.expiredRejected", undefined, "Pairing expired or was rejected. Re-scan the QR to start over."));
        return;
      }
      finishPaired(outcome.token);
    } catch (err) {
      setPhase("error");
      setError(
        t(
          "landing.err.failed",
          { message: err instanceof Error ? err.message : String(err) },
          `Pairing failed: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
    }
  }, [finishPaired]);

  const start = useCallback(() => {
    const { payload, error: hashError } = readPayloadFromHash();
    if (!payload) {
      setPhase("error");
      setError(hashError);
      return;
    }
    void run(payload);
  }, [run]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once on mount.
  useEffect(() => { start(); }, []);

  return (
    <div
      data-testid="pair-landing"
      className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-5 py-10 text-[var(--text-primary)]"
    >
      <h1 className="text-xl font-semibold">{t("landing.title", undefined, "Pair this device")}</h1>

      {phase === "verifying" && (
        <p data-testid="pair-landing-verifying" className="text-sm text-[var(--text-tertiary)]">
          {t("landing.verifying", undefined, "Verifying the dashboard's identity…")}
        </p>
      )}

      {phase === "polling" && confirmCode && (
        <div
          data-testid="pair-landing-confirm"
          className="rounded-lg border border-[var(--accent)] bg-[var(--accent-soft)] p-5 text-center"
        >
          <p className="text-sm text-[var(--text-secondary)]">
            {t("landing.typeCode", undefined, "Type this code on the dashboard to approve this device:")}
          </p>
          <p data-testid="pair-landing-confirm-code" className="mt-3 font-mono text-4xl font-bold tracking-widest text-[var(--text-primary)]">
            {confirmCode}
          </p>
          <p className="mt-3 text-xs text-[var(--text-secondary)]">{t("landing.waiting", undefined, "Waiting for the operator to approve…")}</p>
        </div>
      )}

      {phase === "done" && (
        <p data-testid="pair-landing-done" className="rounded border border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] p-3 text-sm text-[var(--severity-success-fg)]">
          {t("landing.paired", undefined, "Paired. Opening the dashboard…")}
        </p>
      )}

      {/* Operator denied: a new link is required, so no retry of THIS link. */}
      {phase === "rejected" && (
        <div
          data-testid="pair-landing-rejected"
          role="alert"
          className="rounded border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] p-3 text-sm text-[var(--severity-error-fg)]"
        >
          <p className="font-semibold">
            {t("landing.rejected", undefined, "The dashboard declined this device.")}
          </p>
          <p className="mt-1">
            {t("landing.rejectedHint", undefined, "If this was a mistake, ask for a new pairing link.")}
          </p>
        </div>
      )}

      {phase === "error" && (
        <div data-testid="pair-landing-error" className="space-y-3">
          <p className="rounded border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] p-3 text-sm text-[var(--severity-error-fg)]">{error}</p>
          <button
            type="button"
            data-testid="pair-landing-restart"
            onClick={start}
            className="rounded bg-[var(--accent-solid)] px-4 py-2 text-sm font-medium text-white"
          >
            {t("landing.tryAgain", undefined, "Try again")}
          </button>
        </div>
      )}
    </div>
  );
}
