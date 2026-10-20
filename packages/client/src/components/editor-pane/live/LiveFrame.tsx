/**
 * The framed half of the live-server viewer, shared by port targets, static
 * targets and `HtmlPreview` (change: improve-canvas-html-and-url-ux, D3-D9;
 * mockup S2/S3).
 *
 *   header  [← Targets] [root · address] [Restricted] [↻] [Scripts | Static] [Open ↗]
 *   notices exposure (Run scripts) · agent update (Reload) · root-absolute hint
 *   banner  blocked external origins (restricted previews)
 *   frame   sandbox from the policy (never allow-same-origin), src = minted capability path
 *
 * The policy is derived (provenance → egress, toggle + exposure → scripts) and
 * passed on EVERY mint. A token is reused only while (target, policy, exposure
 * epoch, viewer) is unchanged; otherwise the frame re-mints, and no frame is ever
 * shown under a token minted for another policy. No `srcdoc`, ever.
 */
import type { LiveTargetAddedBy } from "@blackbelt-technology/pi-dashboard-shared/live-server.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../../../lib/api/api-context.js";
import { useI18n } from "../../../lib/i18n/i18n.js";
import { frameSrc, isLocalOperator, localTargetUrl, type Opener, sandboxFor } from "../../../lib/live-preview/preview-policy.js";
import { EgressBanner } from "./EgressBanner.js";
import { AddressConfirm, ExposedNotice, InlineError, RootAbsoluteHint, UpdatedNotice } from "./LiveFrameParts.js";
import { LiveHeader } from "./LiveHeader.js";
import { useAddressBar } from "./useAddressBar.js";
import { useEgressReport } from "./useEgressReport.js";
import { useFramePolicy } from "./useFramePolicy.js";
import { useOpenExternal } from "./useOpenExternal.js";

export type FramedTarget =
  | { kind: "port"; id: string; host: string; port: number; addedBy?: LiveTargetAddedBy }
  | { kind: "static"; id: string; /** Absolute document root. */ root: string };

export interface LiveFrameProps {
  target: FramedTarget;
  /** Encoded initial deep path (+query/fragment), no leading slash. */
  initialDeep: string;
  /** Who opened it: operator → open egress, anything else → restricted. */
  opener: Opener;
  title: string;
  onBack?: () => void;
  /** Add/launch another loopback port (the address bar's confirmed navigation). Resolves to an error text or null. */
  onLaunchPort?: (input: { host: string; port: number; deep: string }) => Promise<string | null>;
  /** Agent re-declare of this tab: bumps → reload. */
  reloadNonce?: number;
  /** Agent re-declared the ACTIVE tab: offer "Updated by the agent · Reload". */
  updatedByAgent?: boolean;
  onAckUpdate?: () => void;
}

const newViewerId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `v${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;

/** Last two path segments of the document root, with a trailing slash (display only). */
function lastSegments(root: string): string {
  const parts = root.split(/[\\/]/).filter(Boolean);
  return `${parts.slice(-2).join("/")}/`;
}

/** Banner polling while restricted; one read for the root-absolute hint on an open static page. */
function egressModeFor(egress: "open" | "restricted", kind: FramedTarget["kind"]): "poll" | "once" | "off" {
  if (egress === "restricted") return "poll";
  return kind === "static" ? "once" : "off";
}

/** Agent bumped this tab (higher canvas version while it was not active): run `reload`. */
function useReloadOnChange(nonce: number | undefined, reload: () => void): void {
  const last = useRef(nonce);
  useEffect(() => {
    if (nonce === last.current) return;
    last.current = nonce;
    reload();
  }, [nonce, reload]);
}

/** Frame body: the sandboxed iframe, the mint error, or the loading line. */
function FrameBody({ src, sandbox, title, nonce, error }: { src: string | null; sandbox: string; title: string; nonce: number; error: string | null }) {
  const { t } = useI18n();
  if (src) {
    return (
      <iframe
        key={nonce}
        data-testid="live-iframe"
        // D3: opaque origin — NEVER allow-same-origin, so the page cannot read the
        // dashboard token or call /api/*. The token set follows the policy; scripts
        // off → the attribute is present and empty. No `srcdoc`, ever.
        sandbox={sandbox}
        src={src}
        title={title}
        className="min-h-[16rem] flex-1 border-0 bg-white"
      />
    );
  }
  if (error) {
    return (
      <div role="alert" data-testid="live-error" className="p-3 text-xs text-[var(--severity-error-fg)]">
        {error}
      </div>
    );
  }
  return (
    <div data-testid="live-loading" className="p-3 text-xs text-[var(--text-tertiary)]">
      {t("common.loading2", undefined, "Loading…")}
    </div>
  );
}

export function LiveFrame({ target, initialDeep, opener, title, onBack, onLaunchPort, reloadNonce, updatedByAgent, onAckUpdate }: LiveFrameProps) {
  const viewerId = useRef(newViewerId()).current;
  const bar = useAddressBar(target, initialDeep, onLaunchPort);
  const [frameNonce, setFrameNonce] = useState(0);
  const { scriptsOn, setScriptsOn, exposure, runApproved, capability, error, granted, showRun, approveRun } = useFramePolicy(
    target.id,
    opener,
    viewerId,
  );

  const egressMode = egressModeFor(granted.egress, target.kind);
  const egress = useEgressReport(target.id, capability?.tokenId, egressMode);

  const reload = useCallback(() => {
    // Re-read the exposure policy first: a missed push must not leave a scripted frame up.
    exposure.refresh();
    setFrameNonce((n) => n + 1);
    egress.restart();
  }, [exposure.refresh, egress.restart]);

  useReloadOnChange(reloadNonce, reload);

  const external = useOpenExternal(target.id, granted, runApproved, viewerId, bar.deep);

  const localUserPort =
    target.kind === "port" && target.addedBy === "user" && typeof window !== "undefined" && isLocalOperator(window.location.hostname);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <LiveHeader
        onBack={onBack}
        root={target.kind === "static" ? { chip: lastSegments(target.root), full: target.root } : null}
        addr={bar.addr}
        addrInvalid={bar.error != null}
        onAddrChange={bar.setAddr}
        onSubmit={bar.submit}
        restricted={granted.egress === "restricted"}
        onReload={reload}
        scriptsOn={target.kind === "static" ? scriptsOn : null}
        onScriptsChange={setScriptsOn}
        openHref={localUserPort && target.kind === "port" ? localTargetUrl(target.host, target.port, bar.deep) : null}
        onOpen={() => void external.open()}
      />

      {bar.error && (
        <InlineError testId="live-address-error" id="live-address-error">
          {bar.error}
        </InlineError>
      )}
      {external.error && <InlineError testId="live-open-error">{external.error}</InlineError>}
      {bar.pending && (
        <AddressConfirm target={`${bar.pending.host}:${bar.pending.port}`} onAdd={() => void bar.addPending()} onCancel={bar.cancelPending} />
      )}
      {updatedByAgent && (
        <UpdatedNotice
          onReload={() => {
            reload();
            onAckUpdate?.();
          }}
        />
      )}
      {showRun && <ExposedNotice onRun={approveRun} />}
      {egress.report?.rootAbsolute && target.kind === "static" && <RootAbsoluteHint />}

      {granted.egress === "restricted" && capability && (
        <EgressBanner
          report={egress.report}
          targetId={target.id}
          tokenId={capability.tokenId}
          viewerId={viewerId}
          onReload={reload}
          onChanged={egress.restart}
        />
      )}

      <FrameBody
        src={capability ? frameSrc(getApiBase(), capability.path, bar.deep) : null}
        sandbox={sandboxFor(granted)}
        title={title}
        nonce={frameNonce}
        error={error}
      />
    </div>
  );
}
