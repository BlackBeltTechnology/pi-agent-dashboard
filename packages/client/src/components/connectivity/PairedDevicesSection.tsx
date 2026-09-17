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
  reachableUrls,
  revokePairedDevice,
  type Tier,
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

/** One-line descriptions of what each tier can do (change: expand-mcp-tiered-surface). */
export const TIER_OPTIONS: ReadonlyArray<{ value: Tier; label: string; description: string }> = [
  { value: "observe", label: "Observe", description: "Read-only: list sessions, read events, diffs, files." },
  { value: "control", label: "Control", description: "Drive sessions: prompts, abort, model and thinking level." },
  { value: "operate", label: "Operate", description: "Full control: restart the server, install packages, force-kill processes." },
];

export function PairedDevicesSection() {
  const [devices, setDevices] = useState<PairedDeviceView[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stage, setStage] = useState<CreateStage>("closed");
  const [labelDraft, setLabelDraft] = useState("");
  // Default `observe`: the safest tier is preselected for a first-time operator.
  const [tier, setTier] = useState<Tier>("observe");
  const [baseUrls, setBaseUrls] = useState<string[]>([]);
  const [base, setBase] = useState<string>("");
  const [minting, setMinting] = useState(false);
  const [minted, setMinted] = useState<MintedDeviceToken | null>(null);
  // Copy feedback for the plaintext-once panel: a silent clipboard failure is
  // how the ONLY copy of the token gets lost, so the outcome is always shown.
  const [copyOutcome, setCopyOutcome] = useState<"idle" | "ok" | "failed">("idle");

  const copyOnce = useCallback((text: string) => {
    void copyText(text).then((ok) => setCopyOutcome(ok ? "ok" : "failed"));
  }, []);

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

  /** Open the create flow: load reachable URLs and preselect the browser origin. */
  const openCreate = useCallback(async () => {
    setLabelDraft("");
    setTier("observe");
    setStage("label");
    try {
      const urls = await reachableUrls();
      setBaseUrls(urls);
      const origin = window.location.origin;
      setBase(urls.includes(origin) ? origin : (urls[0] ?? ""));
    } catch {
      // Discovery failed: fall back to the API base (a remote dashboard would
      // otherwise be replaced by the browser origin, targeting the wrong server).
      setBaseUrls([]);
      setBase(snippetBase());
    }
  }, []);

  const handleCreate = async () => {
    if (minting) return; // guard against double-submit (Enter + click)
    setMinting(true);
    try {
      // One-shot panel (D6): the plaintext token lives in React state only
      // while the result panel is open, and is dropped on dismiss.
      const result = await createPairedDevice(labelDraft, tier);
      setLabelDraft("");
      setMinted(result);
      setStage("result");
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? "failed to mint token");
      setStage("closed");
    } finally {
      setMinting(false);
    }
  };

  /** The base the snippet targets: the picked URL, else the browser origin. */
  const snippetTarget = () => base || snippetBase();

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
            className="text-sm text-[var(--accent)] hover:underline"
            onClick={() => {
              void openCreate();
            }}
          >
            {i18nT("settings.createMcpToken", undefined, "Create token for an MCP client")}
          </button>
        </div>
      )}
      {stage === "label" && (
        <div className="space-y-2" data-testid="create-token-form">
          <div className="flex items-center gap-2">
            <input
              aria-label={i18nT("common.tokenLabel", undefined, "Token label")}
              className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-transparent px-2 py-1 text-sm"
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
              className="text-sm text-[var(--accent)] hover:underline"
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
          <fieldset className="space-y-1">
            <legend className="text-xs text-[var(--text-muted)]">
              {i18nT("settings.tokenTier", undefined, "Capability")}
            </legend>
            {TIER_OPTIONS.map((opt) => (
              <label key={opt.value} className="flex items-start gap-2 text-xs">
                <input
                  type="radio"
                  name="mcp-token-tier"
                  value={opt.value}
                  checked={tier === opt.value}
                  onChange={() => setTier(opt.value)}
                />
                <span>
                  <span className="font-medium">{opt.label}</span>{" — "}
                  <span className="text-[var(--text-muted)]">{opt.description}</span>
                </span>
              </label>
            ))}
            {tier === "operate" && (
              <div className="text-xs text-[var(--status-error)]" data-testid="operate-warning">
                {i18nT(
                  "settings.operateWarning",
                  undefined,
                  "Operate grants restart, package and process control.",
                )}
              </div>
            )}
          </fieldset>
          <label className="flex items-center gap-2 text-xs">
            <span className="text-[var(--text-muted)]">
              {i18nT("settings.tokenBaseUrl", undefined, "Reachable at")}
            </span>
            <select
              aria-label={i18nT("settings.tokenBaseUrl", undefined, "Reachable at")}
              className="min-w-0 flex-1 rounded border border-[var(--border-primary)] bg-transparent px-2 py-1 text-xs"
              value={base}
              onChange={(e) => setBase(e.target.value)}
            >
              {baseUrls.length === 0 && <option value={base}>{base}</option>}
              {baseUrls.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      {stage === "result" && minted && (
        <div
          className="space-y-2 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3"
          data-testid="mcp-token-result"
        >
          <div className="text-xs text-[var(--text-muted)]">
            {i18nT("common.tokenShownOnce", undefined, "Copy this token now — it is shown only once.")}
          </div>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate text-xs">{minted.token}</code>
            <button
              type="button"
              className="text-xs text-[var(--accent)] hover:underline"
              onClick={() => copyOnce(minted.token)}
            >
              {i18nT("common.copyToken", undefined, "Copy token")}
            </button>
          </div>
          <code className="block overflow-x-auto rounded bg-[var(--bg-primary)] p-2 text-xs">
            {`claude mcp add --transport http pi-dashboard ${snippetTarget()}/mcp --header "Authorization: Bearer ${minted.token}"`}
          </code>
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="text-xs text-[var(--accent)] hover:underline"
              onClick={() =>
                copyOnce(
                  `claude mcp add --transport http pi-dashboard ${snippetTarget()}/mcp --header "Authorization: Bearer ${minted.token}"`,
                )
              }
            >
              {i18nT("common.copySnippet", undefined, "Copy snippet")}
            </button>
            {copyOutcome === "ok" && (
              <span className="text-xs text-[var(--text-muted)]">{i18nT("common.copied", undefined, "Copied")}</span>
            )}
            {copyOutcome === "failed" && (
              <span className="text-xs text-[var(--status-error)]">
                {i18nT("common.copyFailed", undefined, "Copy failed — select and copy manually.")}
              </span>
            )}
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
              className="flex items-center gap-2 rounded border border-[var(--border-primary)] px-3 py-2"
            >
              <Icon path={mdiCellphoneKey} size={0.8} className="text-[var(--text-muted)] shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm">
                  {d.label}
                  <span
                    className="ml-2 rounded bg-[var(--bg-surface)] px-1.5 py-0.5 align-middle text-[10px] uppercase text-[var(--text-muted)]"
                    data-testid={`tier-${d.id}`}
                  >
                    {d.tier}
                  </span>
                  {d.source === "manual" && (
                    <span className="ml-2 rounded bg-[var(--bg-surface)] px-1.5 py-0.5 align-middle text-[10px] uppercase text-[var(--text-muted)]">
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
