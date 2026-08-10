/**
 * Settings section for managing persisted known servers.
 * Shows the list with remove buttons and an inline add form.
 */

import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";
import { mdiCheck, mdiClose, mdiPlus, mdiServerNetwork } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { addKnownServer, listKnownServers, removeKnownServer } from "../../lib/api/known-servers-api.js";

interface KnownServersSectionProps {
  onChange?: () => void;
}

export function KnownServersSection({ onChange }: KnownServersSectionProps = {}) {
  const [servers, setServers] = useState<KnownServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [addHost, setAddHost] = useState("");
  const [addPort, setAddPort] = useState("8000");
  const [addLabel, setAddLabel] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await listKnownServers();
      setServers(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleRemove = async (host: string, port: number) => {
    try {
      await removeKnownServer(host, port);
      await reload();
      onChange?.();
    } catch {
      // ignore
    }
  };

  if (loading) {
    return (
      <div className="text-sm text-[var(--text-muted)]">{i18nT("status.loading2", undefined, "Loading...")}</div>
    );
  }

  return (
    <div className="space-y-2">
      {/* Server list */}
      {servers.length === 0 && !showAdd && (
        <div className="text-sm text-[var(--text-muted)] py-1">
          {i18nT("common.noRemoteServersSavedAddServers", undefined, "No remote servers saved. Add servers manually or from network discovery below.")}
        </div>
      )}

      {servers.map((s) => (
        <div
          key={`${s.host}:${s.port}`}
          className="flex items-center gap-2 px-3 py-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)]"
        >
          <Icon path={mdiServerNetwork} size={0.55} className="text-purple-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-[var(--text-primary)] truncate">
              {s.label || s.host}
            </div>
            <div className="text-xs text-[var(--text-muted)]">
              {s.host}:{s.port}
            </div>
          </div>
          <button
            onClick={() => handleRemove(s.host, s.port)}
            className="text-[var(--text-muted)] hover:text-red-400 transition-colors p-1 cursor-pointer"
            title={i18nT("common.removeServer", undefined, "Remove server")}
          >
            <Icon path={mdiClose} size={0.5} />
          </button>
        </div>
      ))}

      {/* Add form */}
      {showAdd ? (
        <div className="space-y-2 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)]">
          <div className="flex gap-2">
            <input
              type="text"
              placeholder={i18nT("common.hostEGOfficeMacLocal", undefined, "Host (e.g. office-mac.local)")}
              value={addHost}
              onChange={(e) => setAddHost(e.target.value)}
              className="flex-1 bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
              autoFocus
            />
            <input
              type="number"
              placeholder={i18nT("common.port", undefined, "Port")}
              value={addPort}
              onChange={(e) => setAddPort(e.target.value)}
              className="w-20 bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)] text-right"
            />
          </div>
          <input
            type="text"
            placeholder={i18nT("common.labelOptional", undefined, "Label (optional)")}
            value={addLabel}
            onChange={(e) => setAddLabel(e.target.value)}
            className="w-full bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
          />
          {error && <div className="text-xs text-red-400">{error}</div>}
          <div className="flex gap-2 justify-end">
            <button
              onClick={() => { setShowAdd(false); setError(null); }}
              className="px-2 py-1 text-xs text-[var(--text-muted)] hover:text-[var(--text-secondary)] cursor-pointer"
            >
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button
              onClick={handleAdd}
              className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded cursor-pointer"
            >
              <Icon path={mdiCheck} size={0.45} />
              {i18nT("common.add2", undefined, "Add")}
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 transition-colors cursor-pointer"
        >
          <Icon path={mdiPlus} size={0.5} />
          {i18nT("common.addServerManually", undefined, "Add server manually")}
        </button>
      )}
    </div>
  );
}
