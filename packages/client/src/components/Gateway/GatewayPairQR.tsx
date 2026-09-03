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
 * collapse-pairing-into-gateway: the "no secure road" block (explain + Set up
 * the Gateway + `http://localhost` escape hatch) keys on the
 * `no_reachable_endpoint` RESPONSE via an explicit `noSecureRoad` flag — never
 * on the endpoint count or an unloaded payload (D3). The setup action is
 * redirectable per host via `onSetupRequested` (dialog → Setup tab, page →
 * focus the provider section); absent the prop it navigates to
 * `/settings/gateway`, scrolling the Connect-a-device section into view when
 * already there (D3a). The context panel shows the full fingerprint and the
 * payload's own `urls[]` (D7).
 *
 * See change: add-gateway-qr-network-selector, collapse-pairing-into-gateway.
 */

import type { TunnelEndpoint } from "@blackbelt-technology/pi-dashboard-shared/tunnel-provider.js";
import { mdiCheck, mdiContentCopy, mdiLockOutline, mdiRefresh } from "@mdi/js";
import { Icon } from "@mdi/react";
import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { getGatewayEndpoints, guardPairingUrls, isPairingEligible, splitEndpoints } from "../../lib/gateway/gateway-endpoints.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { approvePairing, getPairPayload, type PairingPayload } from "../../lib/pairing/pairing-api.js";
import { encodePairingQrUrl, encodePayloadString } from "../../lib/pairing/pairing-qr.js";

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
  const { t } = useI18n();
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
      aria-label={t("gateway.pair.chooseNetwork", undefined, "Choose which network the QR encodes")}
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
                ? "border-[var(--accent)] bg-[var(--bg-secondary)]"
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
                  : "border-[var(--border)] text-[var(--text-secondary)]"
              }`}
            >
              {isPairing ? t("gateway.pair.pairing", undefined, "pairing") : t("gateway.pair.link", undefined, "link")}
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
  const { t } = useI18n();
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
      setApproveError(e instanceof Error ? e.message : t("gateway.pair.err.approvalFailed", undefined, "approval failed"));
    } finally {
      setApproving(false);
    }
  };

  if (approvedLabel) {
    return (
      <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
        <div className="text-sm text-[var(--success,#22c55e)]" data-testid="gateway-pair-approved">
          {t("gateway.pair.devicePaired", { label: approvedLabel }, `Device paired: ${approvedLabel}`)}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3">
      <label className="text-sm text-[var(--text-secondary)]" htmlFor="gateway-confirm-input">
        {t("gateway.pair.typeConfirmation", undefined, "Type the confirmation code shown on the device")}
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
          // Spec: qr-device-pairing → "Advisory countdown does not gate approval".
          // The Approve control MUST NOT gain an `|| expired` clause: a redeeming
          // device restarts the TTL server-side, so the server is the sole
          // authority on validity (it rejects a lapsed code at approval time).
          disabled={approving || !confirmCode.trim()}
          onClick={() => void approve()}
          className="rounded border border-[var(--border)] px-3 py-1 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] disabled:opacity-50"
        >
          {approving ? t("gateway.pair.approving", undefined, "Approving…") : t("gateway.pair.approve", undefined, "Approve")}
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
    <div className="relative mt-3 break-all rounded border border-[var(--border)] bg-[var(--bg-secondary)] p-2 font-mono text-[10.5px] text-[var(--text-secondary)]">
      <span data-testid="gateway-pair-copystring">{text}</span>
      <button
        type="button"
        onClick={() => void copy()}
        data-testid="gateway-pair-copy-btn"
        className="absolute right-1 top-1 rounded border border-[var(--border)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[9.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
      >
        <Icon path={copied ? mdiCheck : mdiContentCopy} size={0.5} />
      </button>
    </div>
  );
}

type State = "loading" | "ready" | "empty" | "error";

/** Eyebrow line + advisory countdown tag (extracted to keep the host under the complexity cap). */
function CountdownHeader({ pairingPayload, expired, secondsLeft }: { pairingPayload: PairingPayload | null; expired: boolean; secondsLeft: number }) {
  const { t } = useI18n();
  return (
    <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
      {t("gateway.pair.connectDevice", undefined, "Connect a device")}
      {pairingPayload && (
        <span className="ml-2 font-semibold normal-case text-[var(--amber,#d29922)]">
          {expired
            ? t("gateway.pair.codeExpired", undefined, "· code expired")
            : t("gateway.pair.codeExpires", { seconds: secondsLeft }, `· code expires ${secondsLeft}s`)}
        </span>
      )}
    </p>
  );
}

/**
 * The D3 "no secure road" block: outcome headline → why → ONE primary CTA →
 * rule-separated escape hatch, with the dashed QR placeholder beside it
 * (shape of success, NN/g empty states; WCAG 1.4.1 — never colour alone).
 * Matches mockups/gateway-empty.html. Rendered ONLY on the `noSecureRoad`
 * flag — the `no_reachable_endpoint` RESPONSE, never an endpoint count.
 */
function NoSecureRoadBlock({ onSetup }: { onSetup: () => void }) {
  const { t } = useI18n();
  return (
    <div className="mb-3 mt-1 flex flex-wrap items-start gap-5" data-testid="gateway-pair-no-secure-road">
      <div
        role="img"
        aria-label={t(
          "gateway.pair.qrPlaceholderAria",
          undefined,
          "A pairing QR code will appear here once a secure endpoint exists",
        )}
        className="grid h-[132px] w-[132px] flex-none place-items-center rounded-md border-2 border-dashed border-[var(--border-strong)] text-[var(--text-tertiary)]"
      >
        <Icon path={mdiLockOutline} size={1.6} />
      </div>
      <div className="min-w-[260px] flex-1">
        <h3 className="mb-1.5 text-[15px] font-semibold text-[var(--text-primary)]">
          {t("gateway.pair.noSecureRoadTitle", undefined, "No secure road to pair over yet")}
        </h3>
        <p className="mb-3.5 max-w-[54ch] text-sm text-[var(--text-secondary)]">
          {t(
            "common.pairingNeedsSecureRoad",
            undefined,
            "Pairing a remote device needs a secure road (the Gateway or a publicly-trusted TLS URL). A browser on a plain-http LAN address cannot pair — the identity check requires a secure context.",
          )}
        </p>
        <button
          type="button"
          data-testid="gateway-pair-no-secure-road-setup"
          onClick={onSetup}
          className="min-h-[44px] rounded bg-[var(--accent-solid)] px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("tunnel.startATunnel", undefined, "Set up the Gateway")}
        </button>
        <p className="mt-3.5 max-w-[60ch] border-t border-[var(--border-subtle)] pt-3 text-xs text-[var(--text-secondary)]">
          {t(
            "common.localhostEscapeHatch",
            undefined,
            "On the same machine, http://localhost is already a secure context and can pair. This is not a remote/LAN path.",
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Pairing context-panel details (D7): the fingerprint renders in FULL and
 * selectable (the 12-char form stays only as the QR caption), and the
 * advertised urls come from the PAYLOAD, not the endpoint-selection list — the
 * payload is TLS-filtered server-side, so the two sets can differ.
 */
function PairingContextDetails({ payload }: { payload: PairingPayload }) {
  const { t } = useI18n();
  return (
    <div className="mt-2 space-y-1.5 text-[10.5px] text-[var(--text-secondary)]">
      <div>
        {t("common.fingerprint", undefined, "Fingerprint")}{" "}
        <code data-testid="gateway-pair-fingerprint" className="select-all break-all font-mono text-[var(--text-primary)]">
          {payload.id}
        </code>
      </div>
      <div data-testid="gateway-pair-urls">
        <span className="font-semibold uppercase tracking-wide">
          {t("gateway.pair.advertisedUrls", undefined, "Advertised URLs")}
        </span>
        <ul className="mt-0.5 space-y-0.5">
          {payload.urls.map((u) => (
            <li key={u} className="truncate font-mono">
              {u}
            </li>
          ))}
        </ul>
      </div>
      <p className="max-w-[70ch]">
        {t(
          "gateway.pair.pairingNote",
          undefined,
          "Only publicly-trusted TLS endpoints ride in the pairing QR (D14). Select a mesh/LAN row above for a direct link QR; the device must already be on that network.",
        )}
      </p>
    </div>
  );
}

export function GatewayPairQR(
  { endpoints: providedEps, onSetupRequested }: { endpoints?: TunnelEndpoint[]; onSetupRequested?: () => void } = {},
) {
  const { t } = useI18n();
  const [route, navigate] = useLocation();
  const [state, setState] = useState<State>("loading");
  const [payload, setPayload] = useState<PairingPayload | null>(null);
  const [copyStr, setCopyStr] = useState("");
  const [endpoints, setEndpoints] = useState<TunnelEndpoint[]>(providedEps ?? []);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // The "no secure road" condition, carried by the API RESPONSE itself — set
  // ONLY in the `no_reachable_endpoint` branch of load() and cleared at the top
  // of every load(). Never derive it from `payload === null`: the payload is
  // also null while loading, and a derived flag would flash the block on every
  // healthy mount (design D3; spec scenario "The condition is not inferred from
  // an unloaded payload").
  const [noSecureRoad, setNoSecureRoad] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [selected, setSelected] = useState<TunnelEndpoint | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const deadlineRef = useRef(0);

  // D3a: the setup action is never absent. A host may redirect it
  // (onSetupRequested); absent the prop the fallback navigates to the Gateway
  // page — unless we ARE that page, in which case it scrolls the
  // Connect-a-device section into view so the action still does something real.
  const handleSetupRequested = useCallback(() => {
    if (onSetupRequested) {
      onSetupRequested();
      return;
    }
    if (route === "/settings/gateway") {
      (document.getElementById("connect-a-device") ?? rootRef.current)?.scrollIntoView({ block: "start" });
      return;
    }
    navigate("/settings/gateway");
  }, [onSetupRequested, route, navigate]);

  const load = useCallback(async () => {
    setState("loading");
    setNoSecureRoad(false);
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
        setNoSecureRoad(true);
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
      setErrorMsg(e instanceof Error ? e.message : t("gateway.pair.err.loadFailed", undefined, "failed to load pairing payload"));
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
    <div data-testid="gateway-pair-qr" ref={rootRef}>
      <CountdownHeader pairingPayload={pairingPayload} expired={expired} secondsLeft={secondsLeft} />

      {state === "loading" && (
        <p className="text-sm text-[var(--text-secondary)]" data-testid="gateway-pair-loading">
          {t("status.loading2", undefined, "Loading…")}
        </p>
      )}

      {noSecureRoad && <NoSecureRoadBlock onSetup={handleSetupRequested} />}
      {state === "error" && (
        <p className="text-sm text-[var(--danger,#ef4444)]" data-testid="gateway-pair-error">
          {errorMsg}
        </p>
      )}

      {state === "ready" && (
        <>
          <div className="flex flex-wrap gap-4">
            <div className="shrink-0">
              <QrCanvas text={qrText} />
              {pairingPayload && (
                <p className="mt-1.5 text-center text-[11px] text-[var(--text-secondary)]">
                  {t("gateway.pair.oneTime", undefined, "one-time")} ·{" "}
                  <b className="font-mono text-[var(--amber,#d29922)]">{secondsLeft}s</b>
                  <br />
                  {t("gateway.pair.fingerprint", { fp: pairingPayload.id.slice(0, 12) }, `fp ${pairingPayload.id.slice(0, 12)}`)}
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
              <PairingContextDetails payload={pairingPayload} />
            </>
          ) : (
            <div className="mt-3" data-testid="gateway-link-note">
              <code className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{selected?.url}</code>
              <p className="mt-1 text-[10.5px] text-[var(--text-secondary)]">
                {t(
                  "gateway.pair.linkNote",
                  undefined,
                  "Opens the dashboard directly — no pairing, no secret. Access is governed by trusted networks; the device must already be on this network.",
                )}
              </p>
            </div>
          )}

          {/* Typed compare-code approval (D12) — pairing selection only. */}
          {pairingPayload && <PairingApproval key={pairingPayload.code} code={pairingPayload.code} />}
        </>
      )}

      {/* Available on ready AND empty — with the old empty paragraph retired,
          regenerate is the only recovery affordance left in a blank state. */}
      {["ready", "empty"].includes(state) && (
        <button
          type="button"
          data-testid="gateway-pair-regenerate"
          onClick={() => void load()}
          className="mt-3 flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        >
          <Icon path={mdiRefresh} size={0.6} /> {t("gateway.pair.regenerate", undefined, "Regenerate")}
        </button>
      )}
    </div>
  );
}
