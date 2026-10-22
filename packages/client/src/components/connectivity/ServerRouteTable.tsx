/**
 * The route table of a server card (Settings ▸ Servers): one row per route — kind, address, identity
 * proof state, latency, where it was learned — with the per-route actions: add a discovered route,
 * "Already added", and the two-step "Remove address". Also the shared two-step `RemoveControl`
 * (Remove → Confirm remove / Cancel, matching the Users revoke flow) the card header reuses.
 *
 * See change: group-servers-by-identity (spec known-servers "Settings panel known servers section").
 */
import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { RouteSource } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import {
  mdiCheck,
  mdiClose,
  mdiCloseCircleOutline,
  mdiHelpCircleOutline,
  mdiLoading,
  mdiPlus,
  mdiShieldAlertOutline,
  mdiShieldCheckOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import type { ListRoute } from "../../lib/server-list-model.js";
import {
  BTN_ICON_GHOST,
  BTN_SMALL,
  BTN_SMALL_DANGER,
  BTN_SMALL_GHOST,
  BTN_SMALL_PRIMARY,
  INPUT,
  type Severity,
  severityPill,
} from "./connectivity-ui.js";
import { type RouteExplain, routeKindLabel, shortFingerprint } from "./server-route-chips.js";

export const routeAddress = (r: Pick<ListRoute, "host" | "port">) => formatHostPort(r.host, r.port);
export const routeUrl = (r: Pick<ListRoute, "scheme" | "host" | "port">) => `${r.scheme}://${routeAddress(r)}`;

// ── Views ─────────────────────────────────────────────────────────────

interface IdentityView {
  text: string;
  severity: Severity;
  icon: string;
}

const proven = () => i18nT("connection.identityProven", undefined, "Identity proven");

function unreachableView(explain: RouteExplain): IdentityView {
  const text =
    explain === "reachable"
      ? i18nT("connection.route.blockedInBrowserCap", undefined, "Blocked in this browser")
      : explain === "name-not-resolved"
        ? i18nT("connection.nameNotFound", undefined, "Name not found")
        : i18nT("connection.unreachable", undefined, "Unreachable");
  return { text, severity: "neutral", icon: mdiCloseCircleOutline };
}

/** The identity cell of a route: text + icon + severity (never colour alone). */
function identityView(route: ListRoute, explain: RouteExplain): IdentityView {
  const different = i18nT("connection.differentIdentity", undefined, "Different identity");
  switch (route.state) {
    case "unchecked":
      return { text: i18nT("connection.checking", undefined, "Checking…"), severity: "neutral", icon: mdiLoading };
    case "proven":
      return { text: proven(), severity: "success", icon: mdiShieldCheckOutline };
    case "network-not-allowed":
      return { text: `${proven()} · ${i18nT("common.networkNotAllowed", undefined, "Network not allowed")}`, severity: "warning", icon: mdiShieldCheckOutline };
    case "different-identity":
      return { text: route.provenFingerprint ? `${different} ${shortFingerprint(route.provenFingerprint)}` : different, severity: "error", icon: mdiShieldAlertOutline };
    case "invalid-proof":
      return { text: i18nT("connection.invalidProof", undefined, "Invalid identity proof"), severity: "error", icon: mdiShieldAlertOutline };
    case "cant-prove":
      return { text: i18nT("connection.cantProve", undefined, "Can't prove identity"), severity: "warning", icon: mdiHelpCircleOutline };
    case "cant-prove-in-browser":
      return { text: i18nT("connection.cantProveBrowser", undefined, "Can't prove in this browser"), severity: "warning", icon: mdiHelpCircleOutline };
    case "unreachable":
      return unreachableView(explain);
  }
}

function learnedFrom(route: ListRoute, stored: RouteSource | undefined): string {
  const parts: string[] = [];
  if (stored) parts.push(stored === "pairing" ? i18nT("connection.learned.pairing", undefined, "Pairing") : i18nT("connection.learned.saved", undefined, "Saved"));
  if (route.discovered) parts.push(i18nT("connection.learned.mdns", undefined, "Network scan"));
  if (route.inKeyring) parts.push(i18nT("connection.learned.keyring", undefined, "This app's keyring"));
  return parts.join(" · ") || "—";
}

// ── Two-step remove ───────────────────────────────────────────────────

interface RemoveControlProps {
  /** `route`: the table's text button "Remove address"; `server`: the header's icon button. */
  variant: "route" | "server";
  name: string;
  /** The address the control names; `null` for a whole server with several saved routes. */
  address: string | null;
  /** Resolves to an error text, or `null` on success. */
  onRemove: () => Promise<string | null>;
}

export function RemoveControl({ variant, name, address, onRemove }: RemoveControlProps) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const subject = { name, address: address ?? "" };

  const confirm = () => {
    setError(null);
    onRemove()
      .then((message) => {
        setConfirming(false);
        setError(message);
      })
      .catch(logRejection("RemoveControl.remove"));
  };

  const confirmLabel =
    variant === "route"
      ? i18nT("connection.confirmRemoveAddress", subject, "Confirm remove address {address} of {name}")
      : address
        ? i18nT("connection.confirmRemoveNamed", subject, "Confirm remove {name} ({address})")
        : i18nT("connection.confirmRemoveAll", subject, "Confirm remove {name} and all its saved addresses");
  const beginLabel =
    variant === "route"
      ? i18nT("connection.removeAddressNamed", subject, "Remove address {address} of {name}")
      : address
        ? i18nT("connection.removeNamed", subject, "Remove {name} ({address})")
        : i18nT("connection.removeAll", subject, "Remove {name} and all its saved addresses");

  return (
    <>
      {confirming ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={BTN_SMALL_DANGER} aria-label={confirmLabel} onClick={confirm}>
            {i18nT("connection.confirmRemove", undefined, "Confirm remove")}
          </button>
          <button type="button" className={BTN_SMALL_GHOST} onClick={() => setConfirming(false)}>
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </span>
      ) : (
        <button
          type="button"
          className={variant === "route" ? BTN_SMALL_GHOST : BTN_ICON_GHOST}
          aria-label={beginLabel}
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          {variant === "route" ? i18nT("connection.removeAddress", undefined, "Remove address") : <Icon path={mdiClose} size={0.6} aria-hidden="true" />}
        </button>
      )}
      {error && (
        <div className="basis-full text-[11px] text-[var(--severity-error-fg)]" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

// ── Add a discovered route ────────────────────────────────────────────

const addedNote = (text: string) => (
  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--severity-success-fg)]">
    <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
    {text}
  </span>
);

interface AddRouteControlProps {
  route: ListRoute;
  info: DiscoveredServerInfo | undefined;
  /** The route is already saved: show "Already added" instead of Add. */
  added: boolean;
  /** Operator-only: without it there is no Add. */
  canManage: boolean;
  onAdd: (label: string) => Promise<{ error: string | null; updated: boolean }>;
}

function AddRouteControl({ route, info, added, canManage, onAdd }: AddRouteControlProps) {
  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = info?.name ?? info?.host ?? route.host;

  const confirm = () => {
    setError(null);
    onAdd(label.trim())
      .then((res) => {
        if (res.error) return setError(res.error);
        setUpdated(res.updated);
        setAdding(false);
        setLabel("");
      })
      .catch(logRejection("AddRouteControl.add"));
  };

  let control: ReactNode = null;
  if (updated) control = addedNote(i18nT("connection.updatedExistingEntry", undefined, "Updated existing entry"));
  else if (added) control = addedNote(i18nT("common.alreadyAdded", undefined, "Already added"));
  else if (canManage && adding) {
    control = (
      <span className="flex flex-wrap items-center gap-1.5">
        <label htmlFor={`server-add-label-${route.key}`} className="sr-only">
          {i18nT("connection.labelFor", { name }, "Label for {name}")}
        </label>
        <input
          id={`server-add-label-${route.key}`}
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={i18nT("common.label", undefined, "Label")}
          className={`${INPUT} !min-h-[32px] !w-36 !py-0.5 !text-xs`}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") confirm();
            if (e.key === "Escape") setAdding(false);
          }}
        />
        <button type="button" className={BTN_SMALL_PRIMARY} aria-label={i18nT("connection.confirmAdd", { name }, "Add {name}")} onClick={confirm}>
          <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
          {i18nT("common.add2", undefined, "Add")}
        </button>
        <button type="button" className={BTN_SMALL_GHOST} aria-label={i18nT("connection.cancelAdd", { name }, "Cancel adding {name}")} onClick={() => setAdding(false)}>
          {i18nT("common.cancel", undefined, "Cancel")}
        </button>
      </span>
    );
  } else if (canManage) {
    control = (
      <button
        type="button"
        className={BTN_SMALL}
        aria-label={i18nT("connection.startAdd", { name, address: routeAddress(route) }, "Add {name} ({address})")}
        onClick={() => {
          setAdding(true);
          setLabel(name);
        }}
      >
        <Icon path={mdiPlus} size={0.5} aria-hidden="true" />
        {i18nT("common.add2", undefined, "Add")}
      </button>
    );
  }

  return (
    <>
      {control}
      {error && (
        <div className="mt-1 text-[11px] text-[var(--severity-error-fg)]" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

// ── The table ─────────────────────────────────────────────────────────

export interface RouteTableProps {
  name: string;
  fingerprint: string | undefined;
  routes: ListRoute[];
  canManage: boolean;
  explain: ReadonlyMap<string, RouteExplain>;
  /** How each STORED route was learned, by `routeKey`. */
  storedSource: ReadonlyMap<string, RouteSource>;
  /** Scan results by `routeKey` (name, version). */
  discovered: ReadonlyMap<string, DiscoveredServerInfo>;
  isAdded(route: ListRoute, fingerprint: string | undefined): boolean;
  onAddRoute(route: ListRoute, label: string): Promise<{ error: string | null; updated: boolean }>;
  onRemoveRoute(route: ListRoute): Promise<string | null>;
}

function RouteRow({ route, table }: { route: ListRoute; table: RouteTableProps }) {
  const view = identityView(route, table.explain.get(route.key));
  const stored = table.storedSource.has(route.key);
  const removable = table.canManage && stored && table.routes.filter((r) => table.storedSource.has(r.key)).length > 1;
  return (
    <tr data-testid="route-row" data-route-state={route.state} data-refused={route.refused || undefined} className="border-t border-[var(--border-subtle)] align-top text-[var(--text-primary)]">
      <td className="py-1.5 pr-2">
        <span className="inline-flex flex-wrap items-center gap-1">
          {routeKindLabel(route.kind)}
          {route.used && <span className={severityPill("success")}>{i18nT("connection.routeUsed", undefined, "used")}</span>}
        </span>
      </td>
      <td className="py-1.5 pr-2 font-mono break-all">{routeUrl(route)}</td>
      <td className="py-1.5 pr-2">
        <span className={severityPill(view.severity)}>
          <Icon path={view.icon} size={0.5} className={route.state === "unchecked" ? "animate-spin" : ""} aria-hidden="true" />
          {view.text}
        </span>
      </td>
      <td className="py-1.5 pr-2">{route.latencyMs !== undefined ? i18nT("connection.route.latency", { ms: Math.round(route.latencyMs) }, "{ms} ms") : "—"}</td>
      <td className="py-1.5 pr-2 text-[var(--text-secondary)]">{learnedFrom(route, table.storedSource.get(route.key))}</td>
      <td className="py-1.5">
        <span className="flex flex-wrap items-center gap-1.5">
          {route.discovered && (
            <AddRouteControl
              route={route}
              info={table.discovered.get(route.key)}
              added={table.isAdded(route, table.fingerprint)}
              canManage={table.canManage}
              onAdd={(label) => table.onAddRoute(route, label)}
            />
          )}
          {removable && <RemoveControl variant="route" name={table.name} address={routeAddress(route)} onRemove={() => table.onRemoveRoute(route)} />}
        </span>
      </td>
    </tr>
  );
}

export function RouteTable(props: RouteTableProps) {
  const caption = i18nT("connection.routesOf", { name: props.name }, "Addresses of {name}");
  const th = "py-1 pr-2 font-semibold";
  return (
    <div role="region" aria-label={caption} tabIndex={0} className="focus-ring overflow-x-auto rounded">
      <table className="w-full min-w-[34rem] border-collapse text-left text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-[var(--text-secondary)]">
            <th scope="col" className={th}>{i18nT("connection.col.route", undefined, "Route")}</th>
            <th scope="col" className={th}>{i18nT("connection.address", undefined, "Address")}</th>
            <th scope="col" className={th}>{i18nT("connection.col.identity", undefined, "Identity")}</th>
            <th scope="col" className={th}>{i18nT("connection.col.latency", undefined, "Latency")}</th>
            <th scope="col" className={th}>{i18nT("connection.col.learned", undefined, "Learned from")}</th>
            <th scope="col" className="py-1 font-semibold">
              <span className="sr-only">{i18nT("connection.col.actions", undefined, "Actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.routes.map((r) => (
            <RouteRow key={r.key} route={r} table={props} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
