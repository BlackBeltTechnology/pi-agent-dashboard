/**
 * Gateway "Connect a device" — two QR kinds split by transport (D1 corrected).
 *
 *   - **Pairing QR** — the secure `{ v, id, code, urls[] }` payload minted by
 *     `GET /api/pair/payload`. `urls[]` is TLS-only (server read-time gate);
 *     the client re-guards with `guardPairingUrls` before encoding (task 8.3).
 *     The QR encodes a camera-scannable `https://<tls-endpoint>/pair#<payload>`
 *     deep link (payload in the fragment, so the one-time code never reaches
 *     the server / logs); the copyable string stays the bare `pi:pair:v1.…`
 *     payload for Electron paste. See change: make-pairing-qr-camera-scannable.
 *   - **Link QR** — for each no-TLS `http` mesh/LAN endpoint, a QR of the BARE
 *     URL string only (task 8.2). No pairing payload, no `crypto.subtle`, no
 *     bearer over the wire. Scanning opens the dashboard directly.
 *
 * The endpoint mini-list marks each source `in QR` (TLS) or `excluded`
 * (no-TLS → link QR only), matching the mockup. Typed compare-code approval
 * (D12) completes the pairing.
 *
 * See change: add-tunnel-providers.
 */

import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { mdiCheck, mdiContentCopy, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { getGatewayEndpoints, guardPairingUrls, splitEndpoints } from "../../lib/gateway-endpoints.js";
import { approvePairing, getPairPayload, type PairingPayload } from "../../lib/pairing-api.js";
import { encodePairingQrUrl, encodePayloadString } from "../../lib/pairing-qr.js";

/**
 * The scannable pairing-QR text: an `https://<tls-endpoint>/pair#<payload>` deep
 * link landed on the primary TLS endpoint (`payload.urls[]` is TLS-only + is the
 * challenge set the browser PairView pins). Falls back to the bare copy-string
 * only when no TLS origin exists.
 */
function pairingQrText(
  payload: PairingPayload | null,
  pairingEps: TunnelEndpoint[],
  copyStr: string,
): string {
  const landingBase = pairingEps[0]?.url ?? payload?.urls[0];
  return payload && landingBase ? encodePairingQrUrl(payload, landingBase) : copyStr;
}

/** A QR canvas for arbitrary text (pairing string or bare link URL). */
function QrCanvas({ text, size = 132 }: { text: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!ref.current || !text) return;
    Promise.resolve(
      QRCode.toCanvas(ref.current, text, {
        width: size,
        margin: 2,
        color: { dark: "#000000", light: "#ffffff" },
      }),
    ).catch(() => {
      /* headless/jsdom — non-fatal */
    });
  }, [text, size]);
  return <canvas ref={ref} className="rounded bg-white" data-testid="gateway-qr-canvas" />;
}

type State = "loading" | "ready" | "empty" | "error";

export function GatewayPairQR({ endpoints: providedEps }: { endpoints?: TunnelEndpoint[] } = {}) {
  const [state, setState] = useState<State>("loading");
  const [payload, setPayload] = useState<PairingPayload | null>(null);
  const [copyStr, setCopyStr] = useState("");
  const [copied, setCopied] = useState(false);
  const [endpoints, setEndpoints] = useState<TunnelEndpoint[]>(providedEps ?? []);
  const [confirmCode, setConfirmCode] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvedLabel, setApprovedLabel] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const deadlineRef = useRef(0);

  const load = useCallback(async () => {
    setState("loading");
    setApproveError(null);
    setApprovedLabel(null);
    setConfirmCode("");
    try {
      if (!providedEps) setEndpoints(await getGatewayEndpoints());
      const res = await getPairPayload();
      if (res.ok) {
        // Defence-in-depth: never encode a non-TLS url (task 8.3).
        guardPairingUrls(res.payload.urls);
        setPayload(res.payload);
        setCopyStr(encodePayloadString(res.payload));
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
  }, [providedEps]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (state !== "ready") return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state]);

  const expired = state === "ready" && secondsLeft <= 0;
  const { pairing: pairingEps, link: linkEps } = splitEndpoints(endpoints);
  const qrText = pairingQrText(payload, pairingEps, copyStr);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };

  const approve = async () => {
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

  return (
    <div data-testid="gateway-pair-qr">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Connect a device
        {state === "ready" && (
          <span className="ml-2 font-semibold normal-case text-[var(--amber,#d29922)]">
            {expired ? "· code expired" : `· code expires ${secondsLeft}s`}
          </span>
        )}
      </p>

      {state === "empty" && (
        <p className="text-sm text-[var(--text-secondary)]" data-testid="gateway-pair-empty">
          No TLS endpoint to pair over. Start a public tunnel or add an https:// URL — a plain-http LAN
          address cannot run the secure pairing handshake.
        </p>
      )}
      {state === "error" && (
        <p className="text-sm text-[var(--danger,#ef4444)]">{errorMsg}</p>
      )}

      {state === "ready" && payload && (
        <>
          <div className="flex flex-wrap gap-4">
            <div className="shrink-0">
              <QrCanvas text={qrText} />
              <p className="mt-1.5 text-center text-[11px] text-[var(--text-muted)]">
                one-time · <b className="font-mono text-[var(--amber,#d29922)]">{secondsLeft}s</b>
                <br />
                fp {payload.id.slice(0, 12)}
              </p>
            </div>
            <div className="min-w-[220px] flex-1">
              {pairingEps.map((ep) => (
                <div
                  key={ep.url}
                  className="flex items-center gap-2 border-b border-[var(--border)] py-1.5 last:border-none"
                  data-testid="gateway-pair-endpoint"
                >
                  <span className="rounded bg-[var(--green-soft,#132d1c)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-[#5dd67f]">
                    {ep.kind}
                  </span>
                  <code className="flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">{ep.url}</code>
                  <span className="rounded border border-[#23502f] bg-[var(--green-soft,#132d1c)] px-1.5 py-px text-[9.5px] text-[#5dd67f]">
                    in QR
                  </span>
                </div>
              ))}
              {linkEps.map((ep) => (
                <div
                  key={ep.url}
                  className="flex items-center gap-2 border-b border-[var(--border)] py-1.5 last:border-none"
                  data-testid="gateway-pair-endpoint"
                >
                  <span className="rounded bg-[#152a3a] px-1.5 py-0.5 text-[9.5px] font-bold uppercase text-[#5cb8e6]">
                    {ep.kind}
                  </span>
                  <code className="flex-1 truncate font-mono text-[11px] text-[var(--text-muted)]">{ep.url}</code>
                  <span className="rounded border border-[var(--border)] px-1.5 py-px text-[9.5px] text-[var(--text-muted)]">
                    excluded
                  </span>
                </div>
              ))}
              <div className="relative mt-2.5 break-all rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 font-mono text-[10.5px] text-[var(--text-muted)]">
                <span data-testid="gateway-pair-copystring">{copyStr}</span>
                <button
                  type="button"
                  onClick={() => copy(copyStr)}
                  data-testid="gateway-pair-copy-btn"
                  className="absolute right-1 top-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
                >
                  <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.5} />
                </button>
              </div>
            </div>
          </div>

          <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">
            Only publicly-trusted TLS endpoints ride in the QR (D14). Mesh/LAN excluded — use a link QR below;
            the device must already be on the mesh.
          </p>

          {/* Link QRs for no-TLS endpoints (task 8.2) */}
          {linkEps.length > 0 && (
            <div className="mt-3" data-testid="gateway-link-qrs">
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Link QR — already on this network
              </p>
              <div className="flex flex-wrap gap-3">
                {linkEps.map((ep) => (
                  <div key={ep.url} className="flex flex-col items-center gap-1" data-testid="gateway-link-qr">
                    <QrCanvas text={ep.url} size={96} />
                    <code className="max-w-[120px] truncate font-mono text-[10px] text-[var(--text-muted)]" title={ep.url}>
                      {ep.url}
                    </code>
                  </div>
                ))}
              </div>
              <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">
                Opens the dashboard directly (no pairing, no secret). Access is governed by trusted networks.
              </p>
            </div>
          )}

          <button
            type="button"
            data-testid="gateway-pair-regenerate"
            onClick={() => void load()}
            className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text-primary)]"
          >
            <Icon path={mdiRefresh} size={0.6} /> Regenerate
          </button>

          {/* Typed compare-code approval (D12) */}
          <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
            {approvedLabel ? (
              <div className="text-sm text-[var(--success,#22c55e)]" data-testid="gateway-pair-approved">
                Device paired: {approvedLabel}
              </div>
            ) : (
              <>
                <label className="text-sm text-[var(--text-secondary)]" htmlFor="gateway-confirm-input">
                  Type the confirmation code shown on the device
                </label>
                <div className="flex items-center gap-2">
                  <input
                    id="gateway-confirm-input"
                    data-testid="gateway-pair-confirm-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    className="w-40 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-2 py-1 font-mono text-sm text-[var(--text-primary)]"
                    value={confirmCode}
                    onChange={(e) => setConfirmCode(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void approve();
                    }}
                  />
                  <button
                    type="button"
                    data-testid="gateway-pair-approve-btn"
                    disabled={approving || !confirmCode.trim() || expired}
                    onClick={() => void approve()}
                    className="rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
                  >
                    {approving ? "Approving…" : "Approve"}
                  </button>
                </div>
                {approveError && (
                  <div className="text-sm text-[var(--danger,#ef4444)]" data-testid="gateway-pair-approve-error">
                    {approveError}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
