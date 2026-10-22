/**
 * One card of Settings ▸ Servers: a server IDENTITY with its route table.
 *
 * The card shows the name (saved label, else advertised name, else host), the fingerprint in short
 * form or "identity not advertised", whether this device is paired, the route table
 * (`ServerRouteTable`) and the actions the viewer may use: two-step remove of the whole server and
 * accepting a move suggestion (operator-only) and the ONE pair action for a server this device
 * holds no credential for (`use-pair-action`). A route that proved a different identity is shown
 * as refused with a callout — it is never used and no credential is sent there.
 *
 * The section owns the data and passes async callbacks that resolve to an error text or `null`.
 *
 * See change: group-servers-by-identity (D1, D2, D8; spec known-servers "Settings panel known servers section").
 */
import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { PairAction, PairClient, RouteSource } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { mdiAccountKeyOutline, mdiAlertOutline, mdiFingerprint, mdiOpenInNew, mdiQrcode, mdiShieldAlertOutline, mdiShieldCheck } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useState } from "react";
import { getOpenServerWindow } from "../../lib/electron-server-windows.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import type { ListEntry, ListRoute, PairedState } from "../../lib/server-list-model.js";
import { BTN_SMALL, callout, identityPill, META, severityPill } from "./connectivity-ui.js";
import { PairWithCodeDialog } from "./PairWithCodeDialog.js";
import { RemoveControl, RouteTable, routeAddress, routeUrl } from "./ServerRouteTable.js";
import { type RouteExplain, shortFingerprint } from "./server-route-chips.js";
import { isActionable, usePairAction } from "./use-pair-action.js";
import { VerifyAndRequestDialog } from "./VerifyAndRequestDialog.js";

/** What the section lets a card do; each callback resolves to an error text, or `null` on success. */
export interface ServerCardActions {
  removeRoute(route: ListRoute): Promise<string | null>;
  removeServer(entry: ListEntry): Promise<string | null>;
  acceptMove(entry: ListEntry): Promise<string | null>;
  addRoute(route: ListRoute, label: string, fingerprint: string | undefined): Promise<{ error: string | null; updated: boolean }>;
}

export interface ServerCardProps {
  entry: ListEntry;
  client: PairClient;
  /** A local server (this machine / this dashboard): offers no pair action. */
  isLocal: boolean;
  canManage: boolean;
  explain: ReadonlyMap<string, RouteExplain>;
  /** How each STORED route was learned, by `routeKey`. */
  storedSource: ReadonlyMap<string, RouteSource>;
  /** Scan results by `routeKey` (name, version). */
  discovered: ReadonlyMap<string, DiscoveredServerInfo>;
  /** A discovered route is already saved (host:port match, or fingerprint + port match). */
  isAdded(route: ListRoute, fingerprint: string | undefined): boolean;
  actions: ServerCardActions;
}

function pairedText(state: PairedState): string {
  switch (state) {
    case "this-dashboard":
      return i18nT("connection.paired.thisDashboard", undefined, "This dashboard");
    case "paired":
      return i18nT("connection.paired.paired", undefined, "Paired");
    case "needs-pairing":
      return i18nT("connection.paired.needsPairing", undefined, "Needs pairing");
    case "not-paired":
      return i18nT("connection.paired.notPaired", undefined, "Not paired");
    case "unknown-in-this-tab":
      return i18nT("connection.paired.unknownInTab", undefined, "Unknown in this tab");
  }
}

function pairActionView(action: PairAction): { label: string; icon: string } {
  switch (action.kind) {
    case "request-access":
      return { label: i18nT("connection.pair.requestAccess", undefined, "Request access…"), icon: mdiAccountKeyOutline };
    case "verify-and-request":
      return { label: i18nT("connection.pair.verifyAndRequest", undefined, "Verify and request access…"), icon: mdiFingerprint };
    case "pair-with-code":
      return { label: i18nT("connection.pair.withCode", undefined, "Pair with code…"), icon: mdiQrcode };
  }
}

function RefusedCallout({ routes }: { routes: ListRoute[] }) {
  return (
    <div className={callout("error")}>
      <Icon path={mdiShieldAlertOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {routes.map((r) => (
          <div key={r.key}>
            <strong className="font-mono">{routeUrl(r)}</strong>{" "}
            {r.provenFingerprint
              ? i18nT("connection.refusedDifferent", { fp: shortFingerprint(r.provenFingerprint) }, "answered with a different identity ({fp}).")
              : i18nT("connection.refusedInvalid", undefined, "answered with an identity proof that did not verify.")}{" "}
            {i18nT("connection.refusedNever", undefined, "It is never used and no credential is sent there. Another machine may have taken this address.")}
          </div>
        ))}
      </div>
    </div>
  );
}

function MovedCallout({ name, address, canManage, onAccept }: { name: string; address: string; canManage: boolean; onAccept: () => Promise<string | null> }) {
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <div className={callout("warning")}>
        <Icon path={mdiAlertOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <span>{i18nT("connection.movedTo", { address }, "Moved to {address}")}</span>
          <span>{` — ${i18nT("connection.movedSameIdentity", undefined, "same server identity, new address.")}`}</span>
          {canManage && (
            <div className="mt-1">
              <button
                type="button"
                className={BTN_SMALL}
                aria-label={i18nT("connection.updateTo", { name, address }, "Update {name} to {address}")}
                onClick={() => onAccept().then(setError).catch(logRejection("MovedCallout.accept"))}
              >
                {i18nT("connection.updateServer", undefined, "Update")}
              </button>
            </div>
          )}
        </div>
      </div>
      {error && (
        <div className="text-[11px] text-[var(--severity-error-fg)]" role="alert">
          {error}
        </div>
      )}
    </>
  );
}

function CardTitle({ name, isLocal, pinned, refused, id }: { name: string; isLocal: boolean; pinned: boolean; refused: number; id: string }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
      <span className="truncate">{name}</span>
      <span className={identityPill(isLocal)}>{isLocal ? i18nT("common.localPill", undefined, "Local") : i18nT("common.remote", undefined, "Remote")}</span>
      {pinned && (
        <>
          <span className={severityPill("success")} aria-describedby={id}>
            <Icon path={mdiShieldCheck} size={0.5} aria-hidden="true" />
            {i18nT("connection.verified", undefined, "Verified")}
          </span>
          <span id={id} className="sr-only">
            {i18nT("connection.verifiedHint", undefined, "Identity was verified when this server was added.")}
          </span>
        </>
      )}
      {refused > 0 && (
        <span className={severityPill("error")}>
          <Icon path={mdiShieldAlertOutline} size={0.5} aria-hidden="true" />
          {i18nT("connection.addressesRefused", { n: refused }, "{n} address refused")}
        </span>
      )}
    </div>
  );
}

type PairState = ReturnType<typeof usePairAction>;

/** The one pair action of the card, when this client can run it. */
function PairButton({ action, client, name, pair }: { action: PairAction; client: PairClient; name: string; pair: PairState }) {
  if (!isActionable(client, action)) return null;
  const view = pairActionView(action);
  const newTab = client === "browser" && action.kind === "request-access";
  return (
    <button
      type="button"
      data-testid="pair-action"
      className={BTN_SMALL}
      disabled={pair.busy}
      aria-label={
        newTab
          ? i18nT("connection.pair.namedNewTab", { action: view.label, name }, "{action} {name} (opens in a new tab)")
          : i18nT("connection.pair.named", { action: view.label, name }, "{action} {name}")
      }
      onClick={() => pair.run(action)}
    >
      <Icon path={view.icon} size={0.5} aria-hidden="true" />
      {view.label}
      {newTab && <Icon path={mdiOpenInNew} size={0.5} aria-hidden="true" />}
    </button>
  );
}

/** What follows a pair action: a refusal note (with "Pair with code instead" on `knock_not_lan`) and the dialogs. */
function PairFollowUp({ entry, action, pair }: { entry: ListEntry; action: PairAction | null; pair: PairState }) {
  const name = entry.title;
  const openServerWindow = getOpenServerWindow();
  return (
    <>
      {pair.note && (
        <div className={callout("error")} role="alert">
          <Icon path={mdiAlertOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            {pair.note.text}
            {pair.note.reason === "knock_not_lan" && entry.fingerprint && (
              <div className="mt-1">
                <button type="button" className={BTN_SMALL} onClick={pair.startCode}>
                  {i18nT("connection.pair.withCodeInstead", undefined, "Pair with code instead")}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {pair.dialog === "code" && entry.fingerprint && <PairWithCodeDialog name={name} fingerprint={entry.fingerprint} onClose={pair.closeDialog} />}
      {pair.dialog === "verify" && action?.kind === "verify-and-request" && openServerWindow && (
        <VerifyAndRequestDialog
          name={name}
          route={action.route}
          openServerWindow={openServerWindow}
          onPairWithCode={entry.fingerprint ? pair.startCode : undefined}
          onClose={pair.closeDialog}
        />
      )}
    </>
  );
}

export function ServerCard({ entry, client, isLocal, canManage, explain, storedSource, discovered, isAdded, actions }: ServerCardProps) {
  const name = entry.title;
  const pair = usePairAction({ client, name, fingerprint: entry.fingerprint });
  const primary = entry.routes.find((r) => r.used) ?? entry.routes[0];
  const version = primary ? discovered.get(primary.key)?.version : undefined;
  const stored = entry.routes.filter((r) => storedSource.has(r.key));
  const refused = entry.routes.filter((r) => r.refused);
  const verifiedId = `server-verified-${entry.key}`;

  const action = isLocal ? null : entry.pairAction;

  return (
    <article aria-label={name} data-testid="server-card" data-fingerprint={entry.fingerprint} className="space-y-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-0 flex-[1_1_12rem]">
          <CardTitle name={name} isLocal={isLocal} pinned={entry.saved && !!entry.fingerprint} refused={refused.length} id={verifiedId} />
          <div className={META}>
            <span className="font-mono">{entry.fingerprint ? shortFingerprint(entry.fingerprint) : i18nT("connection.identityNotAdvertised", undefined, "identity not advertised")}</span>
            {" · "}
            <span data-testid="paired-state">{pairedText(entry.pairedState)}</span>
            {" · "}
            {entry.routes.length === 1 ? i18nT("connection.oneAddress", undefined, "1 address") : i18nT("connection.nAddresses", { n: entry.routes.length }, "{n} addresses")}
            {version ? ` · v${version}` : ""}
          </div>
          {entry.sameIdentityAs.length > 0 && (
            <div className={META}>{i18nT("connection.sameIdentityAs", { name: entry.sameIdentityAs.map((o) => o.title).join(", ") }, "Same server as {name}")}</div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {action && <PairButton action={action} client={client} name={name} pair={pair} />}
          {canManage && stored.length > 0 && (
            <RemoveControl variant="server" name={name} address={stored.length === 1 ? routeAddress(stored[0]) : null} onRemove={() => actions.removeServer(entry)} />
          )}
        </div>
      </div>

      <RouteTable
        name={name}
        fingerprint={entry.fingerprint}
        routes={entry.routes}
        canManage={canManage}
        explain={explain}
        storedSource={storedSource}
        discovered={discovered}
        isAdded={isAdded}
        onAddRoute={(route, label) => actions.addRoute(route, label, entry.fingerprint)}
        onRemoveRoute={actions.removeRoute}
      />

      {refused.length > 0 && <RefusedCallout routes={refused} />}
      {entry.movedTo && (
        <MovedCallout name={name} address={formatHostPort(entry.movedTo.host, entry.movedTo.port)} canManage={canManage} onAccept={() => actions.acceptMove(entry)} />
      )}

      <PairFollowUp entry={entry} action={action} pair={pair} />
    </article>
  );
}
