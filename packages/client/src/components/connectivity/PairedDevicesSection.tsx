/**
 * Settings → Security → Paired Devices.
 * Lists devices paired via QR/copy-string (bearer device auth) and revokes them.
 * Revoke deletes the server-side registry row so the device's token stops working.
 * Also mints tokens for MCP clients directly (D6, change:
 * mcp-legacy-clients-and-token-issuance): label → one POST → the plaintext
 * token shown ONCE with a copyable `claude mcp add` snippet, dismissed once.
 */

import { mdiCellphoneKey, mdiDelete } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useState } from "react";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  createPairedDevice,
  listPairedDevices,
  type MintedDeviceToken,
  type PairedDeviceView,
  revokePairedDevice,
} from "../../lib/pairing/paired-devices-api.js";
import { logRejection } from "../../lib/report-error.js";
import { copyText } from "../../lib/util/clipboard.js";

function formatLastSeen(iso: string | null): string {
  if (!iso) return i18nT("common.neverSeen", undefined, "never");
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/**
 * The reachable dashboard base the snippet targets. When the client base is
 * same-origin (`""`), fall back to the origin the user is actually looking at,
 * so a tunnel user gets the tunnel origin (D6).
 */
function snippetBase(): string {
  return getApiBase() || window.location.origin;
}

type CreateStage = "closed" | "label" | "result";

export function PairedDevicesSection() {
  const [devices, setDevices] = useState<PairedDeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<CreateStage>("closed");
  const [labelDraft, setLabelDraft] = useState("");
  const [minted, setMinted] = useState<MintedDeviceToken | null>(null);

  const reload = useCallback(async () => {
    try {
      setDevices(await listPairedDevices());
    } catch (e: any) {
      setError(e?.message ?? "failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void reload().catch(logRejection("PairedDevicesSection.reload")); }, [reload]);

  const handleRevoke = async (id: string) => {
    if (revoking) return; // guard against double-submit
    setRevoking(id);
    try {
      await revokePairedDevice(id);
      setConfirmId(null);
      setError(null);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? "failed to revoke");
    } finally {
      setRevoking(null);
    }
  };

  const handleCreate = async () => {
    try {
      // One-shot panel (D6): the plaintext token lives in React state only
      // while the result panel is open, and is dropped on dismiss.
      const result = await createPairedDevice(labelDraft);
      setLabelDraft("");
      setMinted(result);
      setStage("result");
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "failed to mint token");
      setStage("closed");
    }
  };

  const dismissMinted = () => {
    setMinted(null);
    setStage("closed");
    void reload().catch(logRejection("PairedDevicesSection.dismissReload"));
  };

  if (loading) {
    return <div className="text-sm text-[var(--text-muted)]">{i18nT("status.loading2", undefined, "Loading...")}</div>;
  }

  return (
    <div className="space-y-2">
      {error && <div className="text-sm text-[var(--danger,#ef4444)]">{error}</div>}
      {stage === "closed" && (
        <div>
          <button
            type="button"
            className="text-sm text-[var(--accent,#3b82f6)] hover:underline"
            onClick={() => {
              setLabelDraft("");
              setStage("label");
            }}
          >
            {i18nT("settings.createMcpToken", undefined, "Create token for an MCP client")}
          </button>
        </div>
      )}
      {stage === "label" && (
        <div className="flex items-center gap-2">
          <input
            aria-label={i18nT("common.tokenLabel", undefined, "Token label")}
            className="min-w-0 flex-1 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm"
            value={labelDraft}
            placeholder={i18nT("common.tokenLabelPlaceholder", undefined, "e.g. claude-code")}
            onChange={(e) => setLabelDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleCreate();
              if (e.key === "Escape") setStage("closed");
            }}
          />
          <button
            type="button"
            className="text-sm text-[var(--accent,#3b82f6)] hover:underline"
            onClick={() => void handleCreate()}
          >
            {i18nT("common.create", undefined, "Create")}
          </button>
          <button
            type="button"
            className="text-xs text-[var(--text-muted)] hover:underline"
            onClick={() => setStage("closed")}
          >
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </div>
      )}
      {stage === "result" && minted && (
        <div
          className="space-y-2 rounded border border-[var(--border)] bg-[var(--bg-elevated,#141414)] p-3"
          data-testid="mcp-token-result"
        >
          <div className="text-xs text-[var(--text-muted)]">
            {i18nT("common.tokenShownOnce", undefined, "Copy this token now — it is shown only once.")}
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{minted.token}</code>
            <button
              type="button"
              className="text-xs text-[var(--accent,#3b82f6)] hover:underline"
              onClick={() => void copyText(minted.token)}
            >
              {i18nT("common.copyToken", undefined, "Copy token")}
            </button>
          </div>
          <code className="block overflow-x-auto rounded bg-[var(--bg,#0f0f0f)] p-2 text-xs">
            {`claude mcp add --transport http pi-dashboard ${snippetBase()}/mcp --header "Authorization: Bearer ${minted.token}"`}
          </code>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-[var(--accent,#3b82f6)] hover:underline"
              onClick={() =>
                void copyText(
                  `claude mcp add --transport http pi-dashboard ${snippetBase()}/mcp --header "Authorization: Bearer ${minted.token}"`,
                )
              }
            >
              {i18nT("common.copySnippet", undefined, "Copy snippet")}
            </button>
            <span className="flex-1" />
            <button
              type="button"
              className="text-xs text-[var(--text-muted)] hover:underline"
              onClick={dismissMinted}
            >
              {i18nT("common.dismiss", undefined, "Dismiss")}
            </button>
          </div>
        </div>
      )}
      {devices.length === 0 ? (
        <div className="text-sm text-[var(--text-muted)] py-1">
          {i18nT("common.noPairedDevices", undefined, "No paired devices. Pair a phone from the pairing view (QR / copy-string).")}
        </div>
      ) : (
        <ul className="space-y-1">
          {devices.map((d) => (
            <li
              key={d.id}
              className="flex items-center gap-2 rounded border border-[var(--border)] px-3 py-2"
            >
              <Icon path={mdiCellphoneKey} size={0.8} className="text-[var(--text-muted)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {d.label}
                  {d.source === "manual" && (
                    <span className="ml-2 rounded bg-[var(--bg-elevated,#1a1a1a)] px-1.5 py-0.5 align-middle text-[10px] uppercase text-[var(--text-muted)]">
                      {i18nT("common.manualSource", undefined, "manual")}
                    </span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)]">
                  {i18nT("common.lastSeen", undefined, "last seen")}: {formatLastSeen(d.lastSeen)}
                </div>
              </div>
              {confirmId === d.id ? (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    className="text-xs text-[var(--danger,#ef4444)] hover:underline disabled:opacity-50"
                    disabled={revoking === d.id}
                    onClick={() => handleRevoke(d.id)}
                  >
                    {i18nT("common.confirmRevoke", undefined, "Confirm revoke")}
                  </button>
                  <button
                    type="button"
                    className="text-xs text-[var(--text-muted)] hover:underline"
                    onClick={() => setConfirmId(null)}
                  >
                    {i18nT("common.cancel", undefined, "Cancel")}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  title={i18nT("common.revokeDevice", undefined, "Revoke device")}
                  className="shrink-0 text-[var(--text-muted)] hover:text-[var(--danger,#ef4444)]"
                  onClick={() => setConfirmId(d.id)}
                >
                  <Icon path={mdiDelete} size={0.8} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
