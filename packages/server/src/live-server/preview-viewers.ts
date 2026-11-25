/**
 * Which connected browsers can render a tier-5 preview (`tier5Viewers`, D9). The decision is server-side and per socket:
 * (a) the tab announced `live_preview_accept` with `preview` (old clients never do, so a legacy-framing client never causes a
 * site to start under a base it cannot render) and (b) the socket classified to tier 5 at upgrade (D1 predicates over the
 * upgrade's Host, peer and the live config). Counting reads the live socket set, so a closed tab stops counting at once.
 * See change: serve-live-previews-on-capability-origin (D9).
 */
import type { IncomingMessage } from "node:http";
import type { ResolvedPreviewOrigins } from "@blackbelt-technology/pi-dashboard-shared/preview-origins.js";
import { hasProxyForwardingHeaders } from "../auth/localhost-guard.js";
import { parseAccept, selectMintTier } from "./preview-tier.js";

interface ViewerSocket {
  previewTier5?: boolean;
  previewAccepted?: boolean;
  readyState?: number;
}
const OPEN = 1;

/** Classify a browser socket from its upgrade request and remember the answer on it. */
export function stampPreviewViewer(
  ws: object,
  request: Pick<IncomingMessage, "headers" | "socket">,
  ctx: { genuinelyLocal: boolean; resolved: ResolvedPreviewOrigins },
): boolean {
  const decision = selectMintTier({
    hostHeader: request.headers.host,
    socketPort: request.socket?.localPort,
    genuinelyLocal: ctx.genuinelyLocal,
    forwardingHeaders: hasProxyForwardingHeaders(request.headers as Record<string, unknown>),
    socketTls: (request.socket as { encrypted?: boolean } | undefined)?.encrypted === true,
    originHeader: typeof request.headers.origin === "string" ? request.headers.origin : undefined,
    resolved: ctx.resolved,
    accept: ["origin", "preview"],
    kind: "port",
  });
  const tier5 = decision.tier === "tier5";
  (ws as ViewerSocket).previewTier5 = tier5;
  return tier5;
}

/** A `live_preview_accept` message: the tab renders `/preview/<pid>/` frames. Malformed ⇒ not counted. */
export function markPreviewAccept(ws: object, accept: unknown): void {
  (ws as ViewerSocket).previewAccepted = parseAccept(accept).preview;
}

/** Is any OPEN socket both tier-5 classified and announced? */
export function hasTier5Viewer(clients: Iterable<object>): boolean {
  for (const c of clients) {
    const s = c as ViewerSocket;
    if (s.previewTier5 === true && s.previewAccepted === true && (s.readyState === undefined || s.readyState === OPEN)) return true;
  }
  return false;
}
