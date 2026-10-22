/**
 * Route chips of one server identity: kind + proof outcome (and latency) as TEXT,
 * never colour alone. Shared by the header selector and Settings ▸ Servers.
 *
 * See change: group-servers-by-identity (D2, D4; spec server-selector "Route chips state their proof in text").
 */
import type { KnownServerProbeStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { RouteKind } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import {
  mdiAccessPoint,
  mdiEarth,
  mdiHomeOutline,
  mdiLan,
  mdiShieldAlertOutline,
  mdiWeb,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { ListRoute } from "../../lib/server-list-model.js";
import { type RouteChipTone, routeChip } from "./connectivity-ui.js";

const KIND_ICON: Record<RouteKind, string> = {
  loopback: mdiHomeOutline,
  lan: mdiLan,
  mdns: mdiAccessPoint,
  tunnel: mdiEarth,
  public: mdiWeb,
};

/** The dashboard server's own explanation of a route this browser could not reach (`null`: none / unavailable). */
export type RouteExplain = KnownServerProbeStatus | null | undefined;

export function routeKindLabel(kind: RouteKind): string {
  switch (kind) {
    case "loopback":
      return i18nT("connection.route.kind.loopback", undefined, "This machine");
    case "lan":
      return i18nT("connection.route.kind.lan", undefined, "Local network");
    case "mdns":
      return i18nT("connection.route.kind.mdns", undefined, "mDNS name");
    case "tunnel":
      return i18nT("connection.route.kind.tunnel", undefined, "Tunnel (zrok)");
    case "public":
      return i18nT("connection.route.kind.public", undefined, "Public URL");
  }
}

/** `sha256:` + the first 16 characters (the form logs and chips use; the full value lives in the compare dialogs). */
export function shortFingerprint(fingerprint: string): string {
  const i = fingerprint.indexOf(":");
  return fingerprint.slice(0, i + 1 + 16);
}

/** What a chip says besides its kind, and how it is toned. Text only, whatever the tone. */
function routeOutcome(route: ListRoute, explain?: RouteExplain): { text: string | null; tone: RouteChipTone } {
  switch (route.state) {
    case "unchecked":
      return { text: null, tone: "ok" };
    case "proven":
      return { text: i18nT("connection.route.latency", { ms: Math.round(route.latencyMs ?? 0) }, "{ms} ms"), tone: "ok" };
    case "network-not-allowed":
      return { text: i18nT("common.networkNotAllowed", undefined, "Network not allowed").toLowerCase(), tone: "off" };
    case "different-identity":
      return {
        text: route.provenFingerprint
          ? i18nT("connection.route.differentIdentityFp", { fp: shortFingerprint(route.provenFingerprint) }, "different identity {fp}")
          : i18nT("connection.route.differentIdentity", undefined, "different identity"),
        tone: "bad",
      };
    case "invalid-proof":
      return { text: i18nT("connection.route.invalidProof", undefined, "invalid identity proof"), tone: "bad" };
    case "cant-prove":
      return { text: i18nT("connection.route.cantProve", undefined, "can't prove identity"), tone: "off" };
    case "cant-prove-in-browser":
      return { text: i18nT("connection.route.cantProveBrowser", undefined, "can't prove in this browser"), tone: "off" };
    case "unreachable":
      if (explain === "reachable") return { text: i18nT("connection.route.blockedInBrowser", undefined, "blocked in this browser"), tone: "off" };
      if (explain === "name-not-resolved") return { text: i18nT("connection.route.nameNotFound", undefined, "name not found"), tone: "off" };
      return { text: i18nT("connection.route.offline", undefined, "offline"), tone: "off" };
  }
}

export function RouteChip({ route, explain }: { route: ListRoute; explain?: RouteExplain }) {
  const { text, tone } = routeOutcome(route, explain);
  const kind = routeKindLabel(route.kind);
  // A proven route reads `Kind · 4 ms`; every other outcome reads `Kind: outcome`.
  const label = text === null ? kind : route.state === "proven" ? `${kind} · ${text}` : `${kind}: ${text}`;
  return (
    <span
      data-testid="route-chip"
      data-route-kind={route.kind}
      data-route-state={route.state}
      data-used={route.used || undefined}
      title={`${route.scheme}://${route.host}:${route.port}`}
      className={routeChip(tone, route.used)}
    >
      <Icon path={tone === "bad" ? mdiShieldAlertOutline : KIND_ICON[route.kind]} size={0.45} aria-hidden="true" />
      {label}
    </span>
  );
}
