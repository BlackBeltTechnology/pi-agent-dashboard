/**
 * Gateway "Connect a device" — one QR at a time, driven by a network selector.
 *
 * A radio group lists every reachable endpoint (the union of pairing + link
 * endpoints). Exactly ONE QR renders, encoding the selected endpoint:
 *   - **pairing** (TLS) — encodes the base64url `pi:pair:v1.…` copy-string of
 *     the secure `{ v, id, code, urls[] }` payload minted by
 *     `GET /api/pair/payload`. `urls[]` is TLS-only (server read-time gate);
 *     the client re-guards with `guardPairingUrls` before encoding. The QR
 *     encodes a camera-scannable `https://<selected-tls-endpoint>/pair#<payload>`
 *     deep link (payload in the fragment, so the one-time code never reaches the
 *     server / logs; change: make-pairing-qr-camera-scannable). The copyable
 *     string stays the bare `pi:pair:v1.…` payload for Electron paste. The
 *     context panel shows expiry + fingerprint + copy-string + confirmation
 *     input + Approve (typed compare-code, D12).
 *   - **link** (no-TLS http mesh/LAN) — encodes the BARE URL string only. No
 *     pairing payload, no `crypto.subtle`, no bearer. The context panel swaps to
 *     the bare URL + "opens the dashboard directly, no pairing, no secret" note.
 *
 * Default selection = the public TLS pairing endpoint (`pairingEps[0]`); with no
 * TLS endpoint it falls back to the first link endpoint (`linkEps[0]`). The
 * transport gate (D14), `splitEndpoints`, and the pairing contracts are
 * unchanged — only the presentation collapses from a QR wall to one selectable
 * QR.
 *
 * See change: add-gateway-qr-network-selector.
 */

import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { mdiCheck, mdiContentCopy, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { getGatewayEndpoints, guardPairingUrls, isPairingEligible, splitEndpoints } from "../../lib/gateway-endpoints.js";
import { approvePairing, getPairPayload, type PairingPayload } from "../../lib/pairing-api.js";
import { encodePairingQrUrl, encodePayloadString } from "../../lib/pairing-qr.js";

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
  // `data-qr-text` mirrors the encoded payload so tests can assert QR content
  // (jsdom cannot read the rendered canvas bitmap).
  return <canvas ref={ref} className="rounded bg-white" data-testid="gateway-qr-canvas" data-qr-text={text} />;
}

/**
 * Radio-group network selector: one selectable row per endpoint. Keyboard
 * accessible (arrow keys move selection, Space/Enter commit, roving tabIndex).
 */
function NetworkSelector({
  endpoints,
  selected,
  onSelect,
}: {
  endpoints: TunnelEndpoint[];
  selected: TunnelEndpoint | null;
  onSelect: (ep: TunnelEndpoint) => void;
}) {
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const move = (delta: number) => {
    const idx = endpoints.findIndex((ep) => ep.url === selected?.url);
    const next = endpoints[(idx + delta + endpoints.length) % endpoints.length];
    if (!next) return;
    onSelect(next);
    rowRefs.current[next.url]?.focus();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (endpoints.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      move(1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      move(-1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label="Choose which network the QR encodes"
      onKeyDown={onKeyDown}
      className="min-w-[240px] flex-1"
    >
      {endpoints.map((ep) => {
        const isPairing = isPairingEligible(ep);
        const isSel = selected?.url === ep.url;
        return (
          <div
            key={ep.url}
            ref={(el) => {
              rowRefs.current[ep.url] = el;
            }}
            role="radio"
            aria-checked={isSel}
            tabIndex={isSel ? 0 : -1}
            data-testid="gateway-pair-endpoint"
            onClick={() => onSelect(ep)}
            onKeyDown={(e) => {
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                onSelect(ep);
              }
            }}
            className={`flex cursor-pointer items-center gap-2 rounded border px-2 py-1.5 ${
              isSel
                ? "border-[var(--accent,#3b82f6)] bg-[var(--bg-secondary)]"
                : "border-transparent hover:bg-[var(--bg-secondary)]"
            }`}
          >
            {/* Non-colour selection cue (filled vs hollow), not colour-only. */}
            <span aria-hidden className="font-mono text-[13px] text-[var(--text-secondary)]">
              {isSel ? "●" : "○"}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${
                isPairing ? "bg-[var(--green-soft,#132d1c)] text-[#5dd67f]" : "bg-[#152a3a] text-[#5cb8e6]"
              }`}
            >
              {ep.kind}
            </span>
            <code className="flex-1 truncate font-mono text-[11px] text-[var(--text-secondary)]">{ep.url}</code>
            <span
              className={`rounded border px-1.5 py-px text-[9.5px] ${
                isPairing
                  ? "border-[#23502f] bg-[var(--green-soft,#132d1c)] text-[#5dd67f]"
                  : "border-[var(--border)] text-[var(--text-muted)]"
              }`}
            >
              {isPairing ? "pairing" : "link"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Typed compare-code approval (D12). Owns its own confirm-code state so its
 * branching stays isolated from the parent. The parent remounts it via `key`
 * on regenerate. Submission is NOT gated on the local countdown: the code's TTL
 * restarts server-side when the device redeems, so the server is the sole
 * authority on validity and returns mismatch / no_pending / expired errors that
 * surface below. Gating here would wrongly block an approval the server accepts.
 */
function PairingApproval({ code }: { code: string }) {
  const [confirmCode, setConfirmCode] = useState("");
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approvedLabel, setApprovedLabel] = useState<string | null>(null);

  const approve = async () => {
    if (approving || !confirmCode.trim()) return;
    setApproving(true);
    setApproveError(null);
    try {
      const device = await approvePairing(code, confirmCode.trim());
      setApprovedLabel(device.label);
      setConfirmCode("");
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : "approval failed");
    } finally {
      setApproving(false);
    }
  };

  if (approvedLabel) {
    return (
      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        <div className="text-sm text-[var(--success,#22c55e)]" data-testid="gateway-pair-approved">
          Device paired: {approvedLabel}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
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
          disabled={approving || !confirmCode.trim()}
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
    </div>
  );
}

/** The `pi:pair:v1.…` copy-string box with a self-contained copy-to-clipboard button. */
function CopyString({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* ignore */
    }
  };
  return (
    <div className="relative mt-3 break-all rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 font-mono text-[10.5px] text-[var(--text-muted)]">
      <span data-testid="gateway-pair-copystring">{text}</span>
      <button
        type="button"
        onClick={() => void copy()}
        data-testid="gateway-pair-copy-btn"
        className="absolute right-1 top-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-muted)] hover:text-[var(--text-primary)]"
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.5} />
      </button>
    </div>
  );
}

type State = "loading" | "ready" | "empty" | "error";

export function GatewayPairQR({ endpoints: providedEps }: { endpoints?: TunnelEndpoint[] } = {}) {
  const [state, setState] = useState<State>("loading");
  const [payload, setPayload] = useState<PairingPayload | null>(null);
  const [copyStr, setCopyStr] = useState("");
  const [endpoints, setEndpoints] = useState<TunnelEndpoint[]>(providedEps ?? []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [selected, setSelected] = useState<TunnelEndpoint | null>(null);
  const deadlineRef = useRef(0);

  const load = useCallback(async () => {
    setState("loading");
    try {
      const eps = providedEps ?? (await getGatewayEndpoints());
      if (!providedEps) setEndpoints(eps);
      const res = await getPairPayload();
      if (res.ok) {
        // Defence-in-depth: never encode a non-TLS url (task 8.3).
        guardPairingUrls(res.payload.urls);
        setPayload(res.payload);
        setCopyStr(encodePayloadString(res.payload));
        deadlineRef.current = Date.now() + 60_000;
        setSecondsLeft(60);
      } else if (res.error === "no_reachable_endpoint") {
        // No TLS road to pair over — link endpoints (if any) still render.
        setPayload(null);
        setCopyStr("");
      } else {
        setErrorMsg(res.error);
        setState("error");
        return;
      }
      const { pairing, link } = splitEndpoints(eps);
      setState(pairing.length + link.length === 0 ? "empty" : "ready");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : "failed to load pairing payload");
      setState("error");
    }
  }, [providedEps]);

  useEffect(() => {
    void load();
  }, [load]);

  // Reset the default selection whenever the endpoint set reloads: tunnel first
  // (pairingEps[0]), else the first link endpoint.
  useEffect(() => {
    const { pairing, link } = splitEndpoints(endpoints);
    setSelected(pairing[0] ?? link[0] ?? null);
  }, [endpoints]);

  useEffect(() => {
    if (state !== "ready" || !payload) return;
    const tick = () => setSecondsLeft(Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000)));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [state, payload]);

  const { pairing: pairingEps, link: linkEps } = splitEndpoints(endpoints);
  const allEps = [...pairingEps, ...linkEps];
  // Non-null only when a TLS pairing endpoint is selected AND its payload loaded;
  // a single narrowed handle avoids repeating `pairingSelected && payload` in JSX.
  const pairingPayload = selected && payload && isPairingEligible(selected) ? payload : null;
  // Pairing selection → camera-scannable `https://<selected-tls>/pair#<payload>`
  // deep link on the SELECTED TLS endpoint (change: make-pairing-qr-camera-scannable);
  // link selection → the bare URL. The copy-string stays the raw payload.
  const qrText = pairingPayload && selected ? encodePairingQrUrl(pairingPayload, selected.url) : (selected?.url ?? "");
  const expired = !!pairingPayload && secondsLeft <= 0;

  return (
    <div data-testid="gateway-pair-qr">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
        Connect a device
        {pairingPayload && (
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

      {state === "ready" && (
        <>
          <div className="flex flex-wrap gap-4">
            <div className="shrink-0">
              <QrCanvas text={qrText} />
              {pairingPayload && (
                <p className="mt-1.5 text-center text-[11px] text-[var(--text-muted)]">
                  one-time · <b className="font-mono text-[var(--amber,#d29922)]">{secondsLeft}s</b>
                  <br />
                  fp {pairingPayload.id.slice(0, 12)}
                </p>
              )}
            </div>

            {/* Network selector — one selectable row per endpoint (a11y radio group). */}
            <NetworkSelector endpoints={allEps} selected={selected} onSelect={setSelected} />
          </div>

          {/* Context panel — swaps by the selected endpoint's mode. */}
          {pairingPayload ? (
            <>
              <CopyString text={copyStr} />

              <p className="mt-2 text-[10.5px] text-[var(--text-muted)]">
                Only publicly-trusted TLS endpoints ride in the pairing QR (D14). Select a mesh/LAN row above for a
                direct link QR; the device must already be on that network.
              </p>
            </>
          ) : (
            <div className="mt-3" data-testid="gateway-link-note">
              <code className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{selected?.url}</code>
              <p className="mt-1 text-[10.5px] text-[var(--text-muted)]">
                Opens the dashboard directly — no pairing, no secret. Access is governed by trusted networks; the
                device must already be on this network.
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

          {/* Typed compare-code approval (D12) — pairing selection only. */}
          {pairingPayload && <PairingApproval key={pairingPayload.code} code={pairingPayload.code} />}
        </>
      )}
    </div>
  );
}
