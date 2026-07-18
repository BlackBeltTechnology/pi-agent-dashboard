/**
 * Settings → Security → Pair a device (operator-side pairing view).
 *
 * Wires the shipped-but-uncalled `GET /api/pair/payload` + `POST /api/pair/approve`
 * so an operator can complete a QR/copy-string pairing. Renders the payload as a
 * QR (same `qrcode` idiom as `QrCodeDialog.tsx`) AND a copyable base64url string,
 * shows the server fingerprint + one-time-code TTL countdown + advertised `urls[]`,
 * and drives the D12 typed compare-code approval.
 *
 * When no secure road exists (`no_reachable_endpoint`), shows the D5/D6 empty
 * state: pairing needs a secure context, so it offers Start tunnel + the
 * `http://localhost` same-machine note — never implies plain-http LAN works in
 * a browser. See change: wire-nonzrok-pairing-view.
 */
import { mdiCheck, mdiCheckCircle, mdiContentCopy, mdiRefresh, mdiShieldKeyOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { approvePairing, getPairPayload, type PairingPayload } from "../../lib/pairing/pairing-api.js";

/** Encode the payload JSON as a base64url copy-string (device accepts both). */
function encodePayloadString(payload: PairingPayload): string {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

type ViewState = "loading" | "ready" | "empty" | "error";

export function PairingView() {
  const [, navigate] = useLocation();
  const [state, setState] = useState<ViewState>("loading");
  const [payload, setPayload] = useState<PairingPayload | null>(null);
  const [copyString, setCopyString] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [confirmCode, setConfirmCode] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvedLabel, setApprovedLabel] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const deadlineRef = useRef(0);

  const load = useCallback(async () => {
    setState("loading");
    setApproveError(null);
    setApprovedLabel(null);
    setConfirmCode("");
    try {
      const res = await getPairPayload();
      if (res.ok) {
        setPayload(res.payload);
        setCopyString(encodePayloadString(res.payload));
        deadlineRef.current = Date.now() + 60_000;
        setSecondsLeft(60);
        setState("ready");
      } else if (res.error === "no_reachable_endpoint") {
        setState("empty");
      } else {
        setErrorMsg(res.error);
        setState("error");
      }
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "failed to load pairing payload");
      setState("error");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Render the QR from the copy-string (see QrCodeDialog.tsx for the jsdom note).
  useEffect(() => {
    if (state === "ready" && canvasRef.current && copyString) {
      Promise.resolve(
        QRCode.toCanvas(canvasRef.current, copyString, {
          width: 256,
          margin: 2,
          color: { dark: "#000000", light: "#ffffff" },
        }),
      ).catch(() => {
        /* no-op — QR render failed (headless/jsdom, no canvas ctx) */
      });
    }
  }, [state, copyString]);

  // TTL countdown for the one-time code.
  useEffect(() => {
    if (state !== "ready") return;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  const expired = state === "ready" && secondsLeft <= 0;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyString);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const handleApprove = async () => {
    if (!payload || approving || !confirmCode.trim() || expired) return;
    setApproving(true);
    setApproveError(null);
    try {
      const device = await approvePairing(payload.code, confirmCode.trim());
      setApprovedLabel(device.label);
      setConfirmCode("");
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setApproving(false);
    }
  };

  if (state === "loading") {
    return <div className="text-sm text-[var(--text-muted)]">{i18nT("status.loading2", undefined, "Loading...")}</div>;
  }

  if (state === "error") {
    return (
      <div className="space-y-2" data-testid="pairing-error">
        <div className="text-sm text-[var(--danger,#ef4444)]">{errorMsg}</div>
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          onClick={load}
        >
          <Icon path={mdiRefresh} size={0.6} /> {i18nT("common.retry", undefined, "Retry")}
        </button>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="space-y-3" data-testid="pairing-empty">
        <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
          <Icon path={mdiShieldKeyOutline} size={0.9} className="mt-0.5 shrink-0 text-[var(--text-muted)]" />
          <p>
            {i18nT(
              "common.pairingNeedsSecureRoad",
              undefined,
              "Pairing a remote device needs a secure road (the Gateway or a publicly-trusted TLS URL). A browser on a plain-http LAN address cannot pair — the identity check requires a secure context.",
            )}
          </p>
        </div>
        <button
          type="button"
          data-testid="pairing-start-tunnel"
          className="rounded border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
          onClick={() => navigate("/settings/gateway")}
        >
          {i18nT("tunnel.startATunnel", undefined, "Set up the Gateway")}
        </button>
        <p className="text-xs text-[var(--text-muted)]">
          {i18nT(
            "common.localhostEscapeHatch",
            undefined,
            "On the same machine, http://localhost is already a secure context and can pair. This is not a remote/LAN path.",
          )}
        </p>
      </div>
    );
  }

  // state === "ready"
  return (
    <div className="space-y-4" data-testid="pairing-view">
      {/* QR + copy-string */}
      <div className="flex flex-col items-center gap-3">
        <canvas ref={canvasRef} data-testid="pairing-qr-canvas" className="rounded" />
        <div className="flex w-full items-center gap-2 rounded bg-[var(--bg-surface,var(--bg-secondary))] px-3 py-2">
          <span
            className="flex-1 select-all truncate font-mono text-xs text-[var(--text-secondary)]"
            title={copyString}
            data-testid="pairing-copy-string"
          >
            {copyString}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            title={copied ? "Copied!" : "Copy pairing string"}
            data-testid="pairing-copy-btn"
            className="shrink-0 text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.7} />
          </button>
        </div>
      </div>

      {/* Fingerprint + TTL */}
      <div className="space-y-1 text-xs text-[var(--text-muted)]">
        <div>
          {i18nT("common.fingerprint", undefined, "Fingerprint")}:{" "}
          <code className="select-all text-[var(--text-secondary)]" data-testid="pairing-fingerprint">
            {payload?.id}
          </code>
        </div>
        <div data-testid="pairing-ttl">
          {expired ? (
            <span className="text-[var(--danger,#ef4444)]">
              {i18nT("common.codeExpired", undefined, "Code expired — regenerate to pair.")}
            </span>
          ) : (
            <>
              {i18nT("common.codeExpiresIn", undefined, "Code expires in")} {secondsLeft}s
            </>
          )}
        </div>
      </div>

      {/* Advertised endpoints */}
      {payload && payload.urls.length > 0 && (
        <ul className="space-y-0.5">
          {payload.urls.map((u) => (
            <li key={u} className="truncate font-mono text-xs text-[var(--text-muted)]" data-testid="pairing-url">
              {u}
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        data-testid="pairing-regenerate"
        className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
        onClick={load}
      >
        <Icon path={mdiRefresh} size={0.6} /> {i18nT("common.regenerate", undefined, "Regenerate")}
      </button>

      {/* Approval */}
      <div className="space-y-2 border-t border-[var(--border-primary,var(--border))] pt-3">
        {approvedLabel ? (
          <div className="flex items-center gap-2 text-sm text-[var(--success,#22c55e)]" data-testid="pairing-approved">
            <Icon path={mdiCheckCircle} size={0.8} />
            {i18nT("common.devicePaired", undefined, "Device paired")}: {approvedLabel}
          </div>
        ) : (
          <>
            <label className="text-sm text-[var(--text-secondary)]" htmlFor="pairing-confirm-input">
              {i18nT("common.typeConfirmCode", undefined, "Type the confirmation code shown on the device")}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="pairing-confirm-input"
                data-testid="pairing-confirm-input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                className="w-40 rounded border border-[var(--border-secondary,var(--border))] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-sm text-[var(--text-primary)]"
                value={confirmCode}
                onChange={(e) => setConfirmCode(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApprove();
                }}
              />
              <button
                type="button"
                data-testid="pairing-approve-btn"
                disabled={approving || !confirmCode.trim() || expired}
                className="rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                onClick={handleApprove}
              >
                {approving ? i18nT("common.approving", undefined, "Approving…") : i18nT("common.approve", undefined, "Approve")}
              </button>
            </div>
            {approveError && (
              <div className="text-sm text-[var(--danger,#ef4444)]" data-testid="pairing-approve-error">
                {approveError}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
