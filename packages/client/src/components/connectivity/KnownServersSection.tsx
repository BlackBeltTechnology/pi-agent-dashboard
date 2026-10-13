/**
 * Settings section for managing persisted known servers.
 * Shows the list with a two-step remove and an inline add form. Failures are
 * surfaced (load → callout + Retry, remove / move → error next to the row); a
 * non-operator sees the list read-only with a note saying why.
 *
 * See change: retro-ux-identity-connectivity.
 */

import { formatHostPort } from "@blackbelt-technology/pi-dashboard-shared/host-port.js";
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiAlertCircleOutline,
  mdiAlertOutline,
  mdiCheck,
  mdiClose,
  mdiInformationOutline,
  mdiLoading,
  mdiPlus,
  mdiShieldCheck,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { acceptKnownServerMove, addKnownServer, listKnownServersWithAccess, removeKnownServer } from "../../lib/api/known-servers-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import {
  BTN_ICON_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_SMALL,
  BTN_SMALL_DANGER,
  BTN_SMALL_GHOST,
  callout,
  errorMessage,
  HELP,
  INPUT,
  INSET,
  identityPill,
  LABEL,
  META,
  ROW,
  severityPill,
} from "./connectivity-ui.js";

interface KnownServersSectionProps {
  onChange?: () => void;
}

const rowKey = (s: { host: string; port: number }) => `${s.host}:${s.port}`;

export function KnownServersSection({ onChange }: KnownServersSectionProps = {}) {
  const [servers, setServers] = useState<KnownServerListEntry[]>([]);
  // Mutations need an operator credential; a read-only viewer sees the list only.
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [addHost, setAddHost] = useState("");
  const [addPort, setAddPort] = useState("8000");
  const [addLabel, setAddLabel] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** Entry awaiting "Confirm remove" (two-step, like the Users revoke). */
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  /** Per-row failure of a remove or a move acceptance. */
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});

  const setRowError = (key: string, message: string | null) =>
    setRowErrors((prev) => {
      const next = { ...prev };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

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

  useEffect(() => { void reload().catch(logRejection("KnownServersSection.reload")); }, [reload]);

  const handleAdd = async () => {
    const host = addHost.trim();
    const port = parseInt(addPort, 10);
    if (!host || !port || isNaN(port)) {
      setError("Host and valid port are required");
      return;
    }
    try {
      await addKnownServer(host, port, addLabel.trim() || undefined);
      setAddHost("");
      setAddPort("8000");
      setAddLabel("");
      setShowAdd(false);
      setError(null);
      await reload();
      onChange?.();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const handleRemove = async (s: KnownServerListEntry) => {
    const key = rowKey(s);
    setRowError(key, null);
    try {
      await removeKnownServer(s.host, s.port);
      setConfirmRemove(null);
      await reload();
      onChange?.();
    } catch (e) {
      setConfirmRemove(null);
      setRowError(key, i18nT("connection.removeFailed", { error: errorMessage(e) }, "Could not remove: {error}"));
    }
  };

  const handleUpdate = async (s: KnownServerListEntry) => {
    const key = rowKey(s);
    setRowError(key, null);
    if (!(await acceptKnownServerMove(s.host, s.port))) {
      setRowError(key, i18nT("connection.moveRefused", undefined, "Couldn't update this server — an operator credential is needed."));
      return;
    }
    await reload();
    onChange?.();
  };

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
      <div className={callout("error")} role="alert">
        <Icon path={mdiAlertCircleOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          {i18nT("connection.loadServersFailed", { error: loadError }, "Could not load known servers: {error}")}
          <div className="mt-1">
            <button
              type="button"
              className={BTN_SMALL}
              onClick={() => {
                setLoading(true);
                void reload().catch(logRejection("KnownServersSection.retry"));
              }}
            >
              {i18nT("common.retry", undefined, "Retry")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {!canManage && (
        <div className={`${HELP} flex items-start gap-1.5`}>
          <Icon path={mdiInformationOutline} size={0.55} className="mt-0.5 shrink-0" aria-hidden="true" />
          {i18nT(
            "connection.readOnlyNote",
            undefined,
            "Read-only — an operator credential is needed to change servers.",
          )}
        </div>
      )}

      {/* Server list */}
      {servers.length === 0 && !showAdd && (
        <div className={HELP}>
          {i18nT("common.noRemoteServersSavedAddServers", undefined, "No remote servers saved. Add servers manually or from network discovery below.")}
        </div>
      )}

      {servers.map((s, idx) => {
        const key = rowKey(s);
        const name = s.label || s.host;
        const confirming = confirmRemove === key;
        const movedAddress = s.movedTo ? formatHostPort(s.movedTo.host, s.movedTo.port) : null;
        const verifiedId = `known-verified-${idx}`;
        return (
          <div key={key} className={ROW}>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--text-primary)]">
                <span className="truncate">{name}</span>
                <span className={identityPill(false)}>{i18nT("common.remote", undefined, "Remote")}</span>
                {s.fingerprint && (
                  <>
                    <span className={severityPill("success")} aria-describedby={verifiedId}>
                      <Icon path={mdiShieldCheck} size={0.5} aria-hidden="true" />
                      {i18nT("connection.verified", undefined, "Verified")}
                    </span>
                    <span id={verifiedId} className="sr-only">
                      {i18nT("connection.verifiedHint", undefined, "Identity was verified when this server was added.")}
                    </span>
                  </>
                )}
              </div>
              <div className={META}>{s.host}:{s.port}</div>
            </div>
            {canManage &&
              (confirming ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    className={BTN_SMALL_DANGER}
                    aria-label={i18nT("connection.confirmRemoveNamed", { name, address: key }, "Confirm remove {name} ({address})")}
                    onClick={() => void handleRemove(s).catch(logRejection("KnownServersSection.handleRemove"))}
                  >
                    {i18nT("connection.confirmRemove", undefined, "Confirm remove")}
                  </button>
                  <button type="button" className={BTN_SMALL_GHOST} onClick={() => setConfirmRemove(null)}>
                    {i18nT("common.cancel", undefined, "Cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  className={BTN_ICON_GHOST}
                  aria-label={i18nT("connection.removeNamed", { name, address: key }, "Remove {name} ({address})")}
                  onClick={() => {
                    setRowError(key, null);
                    setConfirmRemove(key);
                  }}
                >
                  <Icon path={mdiClose} size={0.6} aria-hidden="true" />
                </button>
              ))}
            {movedAddress && (
              <div className={`${callout("warning")} basis-full`}>
                <Icon path={mdiAlertOutline} size={0.6} className="mt-0.5 shrink-0" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <span>{i18nT("connection.movedTo", { address: movedAddress }, "Moved to {address}")}</span>
                  <span>{` — ${i18nT("connection.movedSameIdentity", undefined, "same server identity, new address.")}`}</span>
                  {canManage && (
                    <div className="mt-1">
                      <button
                        type="button"
                        className={BTN_SMALL}
                        aria-label={i18nT("connection.updateTo", { name, address: movedAddress }, "Update {name} to {address}")}
                        onClick={() => void handleUpdate(s).catch(logRejection("KnownServersSection.handleUpdate"))}
                      >
                        {i18nT("connection.updateServer", undefined, "Update")}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
            {rowErrors[key] && (
              <div className="basis-full text-[11px] text-[var(--severity-error-fg)]" role="alert">
                {rowErrors[key]}
              </div>
            )}
          </div>
        );
      })}

      {/* Add form */}
      {!canManage ? null : showAdd ? (
        <form
          className={`space-y-2 ${INSET}`}
          onSubmit={(e) => {
            e.preventDefault();
            void handleAdd().catch(logRejection("KnownServersSection.handleAdd"));
          }}
        >
          <div className="grid grid-cols-[1fr_6rem] gap-2">
            <div className="min-w-0">
              <label htmlFor="known-add-host" className={LABEL}>{i18nT("common.host", undefined, "Host")}</label>
              <input
                id="known-add-host"
                type="text"
                placeholder={i18nT("common.hostEGOfficeMacLocal", undefined, "Host (e.g. office-mac.local)")}
                value={addHost}
                onChange={(e) => setAddHost(e.target.value)}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "known-add-error" : undefined}
                className={INPUT}
                autoFocus
              />
            </div>
            <div>
              <label htmlFor="known-add-port" className={LABEL}>{i18nT("common.port", undefined, "Port")}</label>
              <input
                id="known-add-port"
                type="number"
                inputMode="numeric"
                value={addPort}
                onChange={(e) => setAddPort(e.target.value)}
                className={`${INPUT} text-right`}
              />
            </div>
          </div>
          <div>
            <label htmlFor="known-add-label" className={LABEL}>{i18nT("common.labelOptional", undefined, "Label (optional)")}</label>
            <input
              id="known-add-label"
              type="text"
              value={addLabel}
              onChange={(e) => setAddLabel(e.target.value)}
              className={INPUT}
            />
          </div>
          {error && <div id="known-add-error" className="text-[11px] text-[var(--severity-error-fg)]" role="alert">{error}</div>}
          <div className="flex flex-wrap justify-end gap-1.5">
            <button
              type="button"
              onClick={() => { setShowAdd(false); setError(null); }}
              className={BTN_SMALL_GHOST}
            >
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button type="submit" className={BTN_PRIMARY}>
              <Icon path={mdiCheck} size={0.5} aria-hidden="true" />
              {i18nT("connection.addServer", undefined, "Add server")}
            </button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setShowAdd(true)} className={BTN_SECONDARY}>
          <Icon path={mdiPlus} size={0.55} aria-hidden="true" />
          {i18nT("common.addServerManually", undefined, "Add server manually")}
        </button>
      )}
    </div>
  );
}
