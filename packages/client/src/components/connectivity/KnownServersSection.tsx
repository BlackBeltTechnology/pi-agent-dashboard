/**
 * Settings ▸ Servers — ONE list of server identities (saved ∪ discovered ∪ Electron keyring).
 *
 * Replaces the former "Known Servers" and "Network Discovery" sections: discovery is a source of
 * this list (scan button, diagnostic empty-state and manual add live here), and a server found by a
 * scan joins the card of the identity it advertises. Every route is proven with the identity
 * challenge (`createRouteChecker`); a route that proves another identity is refused and never used.
 * Mutations (add / remove / update) are operator-only: a read-only viewer sees the list with a note.
 * Failures are surfaced (load → callout + Retry, remove / move → next to the card or route, scan →
 * callout + Retry).
 *
 * The card itself is `ServerCard`; the scan bar, diagnostic and manual-add form are in
 * `NetworkDiscoverySection`. Pure grouping / ranking / pair-action logic is `lib/server-list-model`.
 *
 * See change: retro-ux-identity-connectivity, group-servers-by-identity (D1–D4, D6, D8, D9; tasks 7.x).
 */

import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { type Route, type RouteSource, routeKey } from "@blackbelt-technology/pi-dashboard-shared/server-routes.js";
import { mdiAlertCircleOutline, mdiInformationOutline, mdiLoading, mdiPlus } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listKnownServersWithAccess } from "../../lib/api/known-servers-api.js";
import { getListServers, getOpenServerWindow } from "../../lib/electron-server-windows.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { buildServerList, type ListRoute } from "../../lib/server-list-model.js";
import { BTN_SECONDARY, BTN_SMALL, callout, errorMessage, HELP } from "./connectivity-ui.js";
import { DiscoveryDiagnostic, ManualAddForm, ScanBar, useDiscoveryScan } from "./NetworkDiscoverySection.js";
import { ServerCard } from "./ServerCard.js";
import { createServerCardActions } from "./server-card-actions.js";
import { useElectronServers } from "./use-electron-servers.js";
import { useRouteProofs } from "./use-route-proofs.js";

interface KnownServersSectionProps {
  /** Called after the saved list changed (add / remove / update) so a parent can refresh its own copy. */
  onChange?: () => void;
}

/** The routes a saved entry stores; a pre-routes server lists none, so its host:port is one plain-http route. */
function storedRoutes(e: KnownServerListEntry): Route[] {
  return e.routes && e.routes.length > 0 ? e.routes : [{ host: e.host, port: e.port, scheme: "http", source: "saved" }];
}

/** How each stored route was learned, by `routeKey`. */
function storedSourceOf(servers: readonly KnownServerListEntry[]): Map<string, RouteSource> {
  const m = new Map<string, RouteSource>();
  for (const e of servers) for (const r of storedRoutes(e)) m.set(routeKey(r), r.source);
  return m;
}

/** Ports of the saved entries holding each fingerprint: "same identity, same port" is already saved. */
function savedPortsByFingerprint(servers: readonly KnownServerListEntry[]): Map<string, Set<number>> {
  const m = new Map<string, Set<number>>();
  for (const e of servers) {
    if (!e.fingerprint) continue;
    const ports = m.get(e.fingerprint) ?? new Set<number>();
    ports.add(e.port);
    for (const r of storedRoutes(e)) if (r.scheme === "http") ports.add(r.port);
    m.set(e.fingerprint, ports);
  }
  return m;
}

/** The manual-add form (after "Add server manually" or an empty scan) or the button that opens it; operator-only. */
function AddServerArea(props: {
  canManage: boolean;
  showForm: boolean;
  dismissable: boolean;
  storedKeys: ReadonlySet<string>;
  offerHttpsAdd: boolean;
  onOpen: () => void;
  onCancel: () => void;
  onAdded: () => void;
}) {
  if (props.showForm) {
    return (
      <ManualAddForm
        storedKeys={props.storedKeys}
        offerHttpsAdd={props.offerHttpsAdd}
        onAdded={props.onAdded}
        onCancel={props.dismissable ? props.onCancel : undefined}
        autoFocus={props.dismissable}
      />
    );
  }
  if (!props.canManage) return null;
  return (
    <button type="button" onClick={props.onOpen} className={BTN_SECONDARY}>
      <Icon path={mdiPlus} size={0.55} aria-hidden="true" />
      {i18nT("common.addServerManually", undefined, "Add server manually")}
    </button>
  );
}

function LoadError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className={callout("error")} role="alert">
      <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {i18nT("connection.loadServersFailed", { error }, "Could not load known servers: {error}")}
        <div className="mt-1">
          <button type="button" className={BTN_SMALL} onClick={onRetry}>
            {i18nT("common.retry", undefined, "Retry")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function KnownServersSection({ onChange }: KnownServersSectionProps = {}) {
  const [servers, setServers] = useState<KnownServerListEntry[]>([]);
  // Mutations need an operator credential; a read-only viewer sees the list only.
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);

  const alive = useRef(true);
  const { discovered, scanning, scanned, scanError, scan } = useDiscoveryScan(alive);
  const electron = useElectronServers(alive);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    try {
      const data = await listKnownServersWithAccess();
      setServers(data.servers);
      setCanManage(data.canManage);
      setLoadError(null);
    } catch (e) {
      setLoadError(errorMessage(e, i18nT("common.requestFailed", undefined, "request failed")));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload().catch(logRejection("KnownServersSection.reload"));
  }, [reload]);

  const client = getOpenServerWindow() || getListServers() ? "electron" : "browser";
  const found = useMemo(() => discovered.map((d) => ({ host: d.host, port: d.port, fingerprint: d.fingerprint, name: d.name })), [discovered]);
  // The routes to prove do not depend on the proofs: group once without them, then with them.
  const routes = useMemo(() => buildServerList({ client, saved: servers, discovered: found, electron }), [client, servers, found, electron]);
  const storedSource = useMemo(() => storedSourceOf(servers), [servers]);
  const { checks, explain } = useRouteProofs(routes.entries, { canManage, storedSource, alive });
  const model = useMemo(() => buildServerList({ client, saved: servers, discovered: found, electron, checks }), [client, servers, found, electron, checks]);
  const discoveredByKey = useMemo(() => new Map(discovered.map((d) => [routeKey({ host: d.host, port: d.port, scheme: "http" }), d])), [discovered]);
  const localKeys = useMemo(() => new Set(discovered.filter((d) => d.isLocal).map((d) => routeKey({ host: d.host, port: d.port, scheme: "http" }))), [discovered]);
  const savedPortsByFp = useMemo(() => savedPortsByFingerprint(servers), [servers]);

  const refresh = async () => {
    await reload();
    onChange?.();
  };
  const actions = createServerCardActions(storedSource, refresh);

  if (loading) {
    return (
      <div className={`${HELP} flex items-center gap-1.5`} role="status">
        <Icon path={mdiLoading} size={0.6} className="animate-spin" aria-hidden="true" />
        {i18nT("status.loading2", undefined, "Loading...")}
      </div>
    );
  }

  if (loadError) {
    return (
      <LoadError
        error={loadError}
        onRetry={() => {
          setLoading(true);
          void reload().catch(logRejection("KnownServersSection.retry"));
        }}
      />
    );
  }

  // A failed scan counts as completed, so the diagnostic and the manual-add form appear with the error.
  const emptyScan = scanned && discovered.length === 0;
  const showForm = canManage && (showAdd || emptyScan);
  const storedKeys = new Set(storedSource.keys());
  const isAdded = (route: ListRoute, fingerprint: string | undefined) =>
    storedKeys.has(route.key) || (!!fingerprint && (savedPortsByFp.get(fingerprint)?.has(route.port) ?? false));

  return (
    <div className="space-y-3">
      {!canManage && (
        <div className={`${HELP} flex items-start gap-1.5`}>
          <Icon path={mdiInformationOutline} size={0.55} className="mt-0.5 shrink-0" aria-hidden="true" />
          {i18nT("connection.readOnlyNote", undefined, "Read-only — an operator credential is needed to change servers.")}
        </div>
      )}

      {model.entries.length === 0 && !showForm && (
        <div className={HELP}>
          {i18nT("connection.noServersSaved", undefined, "No remote servers saved. Scan the network or add a server by address.")}
        </div>
      )}

      {model.entries.map((entry) => (
        <ServerCard
          key={entry.key}
          entry={entry}
          client={client}
          isLocal={entry.isCurrent || entry.routes.some((r) => r.kind === "loopback" || localKeys.has(r.key))}
          canManage={canManage}
          explain={explain}
          storedSource={storedSource}
          discovered={discoveredByKey}
          isAdded={isAdded}
          actions={actions}
        />
      ))}

      <ScanBar scanning={scanning} scanned={scanned} scanError={scanError} found={discovered.length} onScan={() => void scan()} />

      {emptyScan && <DiscoveryDiagnostic />}

      <AddServerArea
        canManage={canManage}
        showForm={showForm}
        dismissable={showAdd && !emptyScan}
        storedKeys={storedKeys}
        offerHttpsAdd={model.offerHttpsAdd}
        onOpen={() => setShowAdd(true)}
        onCancel={() => setShowAdd(false)}
        onAdded={() => {
          setShowAdd(false);
          void refresh().catch(logRejection("KnownServersSection.refresh"));
        }}
      />
    </div>
  );
}
