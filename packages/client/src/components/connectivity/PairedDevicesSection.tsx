/**
 * Settings → Security → Paired Devices.
 * Lists devices paired via QR/copy-string (bearer device auth) and revokes them.
 * Revoke moves the device into a held state (refused everywhere at once, restorable for 90 days: a 10 s
 * Undo notice and the Revoked devices list). The Device key and "Status checks from" columns, and every
 * mutating control, follow the device-key-mutual-check change; the controls are offered only to a viewer
 * the server accepts as an operator (the revoked-list call answers 401/403 otherwise).
 * Also mints tokens for MCP clients directly (D6, change:
 * mcp-legacy-clients-and-token-issuance): label → one POST → the plaintext
 * token shown ONCE with a copyable `claude mcp add` snippet, dismissed once.
 */

import { mdiCellphoneKey, mdiClose, mdiDelete, mdiLockOpenAlertOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { SafeLink } from "../../lib/nav/safe-navigation.js";
import {
  type BridgeTokenContext,
  createPairedDevice,
  deleteRevokedDevice,
  getBridgeTokenContext,
  listPairedDevices,
  listRevokedDevices,
  type MintedDeviceToken,
  type PairedDeviceView,
  type RevokedDeviceView,
  reachableUrls,
  removeCompanion,
  restorePairedDevice,
  revokePairedDevice,
  type Tier,
} from "../../lib/pairing/paired-devices-api.js";
import { logRejection } from "../../lib/report-error.js";
import { copyText } from "../../lib/util/clipboard.js";
import { REVOKE_NOTICE_MS, RevokedDevicesPanel, RevokeNotice, type RevokeNoticeState } from "./RevokedDevicesPanel.js";

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
type Purpose = "mcp" | "bridge";

/** Anchor of the Built-in HTTPS section on the Gateway page. */
const BUILT_IN_HTTPS_PATH = "/settings/gateway";
const BUILT_IN_HTTPS_ANCHOR = "gateway-built-in-https";

/** Before the context loads (or if it cannot) the bridge purpose is unavailable: never offered on a guess. */
const NO_BRIDGE_CONTEXT: BridgeTokenContext = { httpsChannel: false, tlsListenerUrls: [], acceptBridges: false };

/** `https://host:port` of the TLS listener → the `wss://` address a bridge dials. */
const toWss = (httpsUrl: string): string => httpsUrl.replace(/^https:/i, "wss:").replace(/\/+$/, "");

/** One-line descriptions of what each tier can do (change: expand-mcp-tiered-surface). */
export const TIER_OPTIONS: ReadonlyArray<{ value: Tier; label: string; description: string }> = [
  { value: "observe", label: "Observe", description: "Read-only: list sessions, read events, diffs, files." },
  { value: "control", label: "Control", description: "Drive sessions: prompts, abort, model and thinking level." },
  { value: "operate", label: "Operate", description: "Full control: restart the server, install packages, force-kill processes." },
];

/** Purpose picker: MCP client / script, or a bridge on another machine (vault-eligible only over proven HTTPS). */
function TokenPurposeFieldset({
  purpose,
  onPurpose,
  ctx,
  refusedUrl,
  onOpenBuiltInHttps,
}: {
  purpose: Purpose;
  onPurpose: (p: Purpose) => void;
  ctx: BridgeTokenContext;
  refusedUrl: string | null | undefined;
  onOpenBuiltInHttps: (e: { preventDefault: () => void }) => void;
}) {
  return (
    <fieldset className="space-y-1" data-testid="token-purpose">
      <legend className="text-xs text-[var(--text-muted)]">
        {i18nT("settings.tokenPurpose", undefined, "Purpose")}
      </legend>
      <label className="flex items-start gap-2 text-xs">
        <input type="radio" name="token-purpose" value="mcp" checked={purpose === "mcp"} onChange={() => onPurpose("mcp")} />
        <span className="font-medium">{i18nT("settings.tokenPurposeMcp", undefined, "MCP client or script")}</span>
      </label>
      <label className="flex items-start gap-2 text-xs">
        <input
          type="radio"
          name="token-purpose"
          value="bridge"
          disabled={!ctx.httpsChannel}
          checked={purpose === "bridge"}
          onChange={() => ctx.httpsChannel && onPurpose("bridge")}
        />
        <span className="font-medium">
          {i18nT("settings.tokenPurposeBridge", undefined, "Bridge on another machine (can receive vault values)")}
        </span>
      </label>
      {!ctx.httpsChannel && (
        <div
          className="flex items-start gap-1.5 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-2 text-xs text-[var(--text-secondary)]"
          role="note"
          data-testid="bridge-unavailable"
        >
          <Icon path={mdiLockOpenAlertOutline} size={0.6} className="mt-px shrink-0" aria-hidden="true" />
          <div className="min-w-0 space-y-1">
            <p className="m-0">
              {i18nT(
                "settings.bridgeUnavailable",
                undefined,
                "Not vault-eligible — open the dashboard over HTTPS to issue a bridge token.",
              )}
            </p>
            {ctx.tlsListenerUrls[0] ? (
              <SafeLink
                className="break-all font-mono text-[var(--link)] hover:underline"
                href={ctx.tlsListenerUrls[0]}
                rel="noopener noreferrer"
              >
                {ctx.tlsListenerUrls[0]}
              </SafeLink>
            ) : (
              <SafeLink
                className="text-[var(--link)] hover:underline"
                href={`${BUILT_IN_HTTPS_PATH}#${BUILT_IN_HTTPS_ANCHOR}`}
                onClick={onOpenBuiltInHttps}
              >
                {i18nT("settings.bridgeEnableHttps", undefined, "Turn on Built-in HTTPS to issue bridge tokens")}
              </SafeLink>
            )}
          </div>
        </div>
      )}
      {refusedUrl !== undefined && (
        <div role="alert" className="text-xs text-[var(--status-error)]" data-testid="bridge-refused">
          {refusedUrl
            ? i18nT(
                "settings.bridgeRefusedUrl",
                { url: refusedUrl },
                "The hub does not see this connection as proven HTTPS, so no bridge token was issued. Open the dashboard at {url}.",
              )
            : i18nT(
                "settings.bridgeRefused",
                undefined,
                "The hub does not see this connection as proven HTTPS, so no bridge token was issued. Turn on Built-in HTTPS and open the dashboard over it.",
              )}
        </div>
      )}
    </fieldset>
  );
}

/** Plaintext-once panel: the token, and the snippet that uses it (MCP `claude mcp add`, or a bridge's env lines). */
function MintedTokenPanel({
  token,
  purpose,
  bridgeSnippet,
  mcpSnippet,
  copyOutcome,
  onCopy,
  onDismiss,
}: {
  token: string;
  purpose: Purpose;
  bridgeSnippet: string | null;
  mcpSnippet: string;
  copyOutcome: "idle" | "ok" | "failed";
  onCopy: (text: string) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="space-y-2 rounded border border-[var(--border-primary)] bg-[var(--bg-tertiary)] p-3"
      data-testid="mcp-token-result"
    >
      <div className="text-xs text-[var(--text-muted)]">
        {i18nT("common.tokenShownOnce", undefined, "Copy this token now — it is shown only once.")}
      </div>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate text-xs">{token}</code>
        <button
          type="button"
          className="text-xs text-[var(--accent)] hover:underline"
          onClick={() => onCopy(token)}
        >
          {i18nT("common.copyToken", undefined, "Copy token")}
        </button>
      </div>
      {purpose === "bridge" ? (
        bridgeSnippet ? (
          <code className="block overflow-x-auto whitespace-pre rounded bg-[var(--bg-primary)] p-2 text-xs" data-testid="bridge-token-snippet">
            {bridgeSnippet}
          </code>
        ) : (
          <p className="m-0 text-xs text-[var(--text-secondary)]" data-testid="bridge-token-note">
            {i18nT(
              "settings.bridgeNoAddress",
              undefined,
              "No bridge address yet. Turn on Accept bridges in Built-in HTTPS (Gateway page) and listen on an address other devices can reach. Then set PI_DASHBOARD_URL to its wss address and PI_DASHBOARD_TOKEN to this token on the device.",
            )}
          </p>
        )
      ) : (
        <code className="block overflow-x-auto rounded bg-[var(--bg-primary)] p-2 text-xs">
          {mcpSnippet}
        </code>
      )}
      <div className="flex items-center gap-3">
        {(purpose === "mcp" || bridgeSnippet) && (
          <button
            type="button"
            className="text-xs text-[var(--accent)] hover:underline"
            onClick={() => onCopy(purpose === "bridge" ? (bridgeSnippet ?? "") : mcpSnippet)}
          >
            {i18nT("common.copySnippet", undefined, "Copy snippet")}
          </button>
        )}
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
          onClick={onDismiss}
        >
          {i18nT("common.dismiss", undefined, "Dismiss")}
        </button>
      </div>
    </div>
  );
}

/** Tier label as shown to people: Observe / Control / Operate (the `TIER_OPTIONS` names). */
function tierLabel(tier: Tier): string {
  return TIER_OPTIONS.find((o) => o.value === tier)?.label ?? tier;
}

/** A thrown value's message, else `fallback`. */
function messageOf(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

/** Device key (short id) and "Status checks from" (companion origins, each removable by an operator). */
function KeyAndCompanions({
  device,
  operator,
  onRemoveCompanion,
}: {
  device: PairedDeviceView;
  operator: boolean;
  onRemoveCompanion: (deviceId: string, companionId: string) => void;
}) {
  const companions = device.companions ?? [];
  return (
    <>
      <div className="text-xs text-[var(--text-muted)]" data-testid={`device-key-${device.id}`}>
        {i18nT("pairedDevices.deviceKey", undefined, "Device key")}:{" "}
        {device.keyId ? <code className="font-mono">{device.keyId}</code> : i18nT("pairedDevices.deviceKeyNone", undefined, "none yet")}
      </div>
      <div className="text-xs text-[var(--text-muted)]" data-testid={`companions-${device.id}`}>
        {i18nT("pairedDevices.statusChecksFrom", undefined, "Status checks from")}:{" "}
        {companions.length === 0
          ? i18nT("pairedDevices.statusChecksNone", undefined, "none")
          : companions.map((c) => (
              <span key={c.id} className="mr-2 inline-flex items-center gap-1">
                {/* The origin is the requester's claim: a text child only. */}
                <span className="font-mono">{c.origin}</span>
                {operator && (
                  <button
                    type="button"
                    className="text-[var(--text-muted)] hover:text-[var(--status-error)]"
                    aria-label={i18nT("pairedDevices.removeStatusCheck", { origin: c.origin }, "Remove status check from {origin}")}
                    title={i18nT("pairedDevices.removeStatusCheckTitle", undefined, "Remove this status check")}
                    onClick={() => onRemoveCompanion(device.id, c.id)}
                  >
                    <Icon path={mdiClose} size={0.6} />
                  </button>
                )}
              </span>
            ))}
      </div>
    </>
  );
}

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
  // Purpose "Bridge on another machine" (change: prove-vault-bridge-tls, D8/D9). `mintedPurpose` fixes how
  // the result panel reads even if the picker changes behind it.
  const [purpose, setPurpose] = useState<Purpose>("mcp");
  const [mintedPurpose, setMintedPurpose] = useState<Purpose>("mcp");
  const [bridgeCtx, setBridgeCtx] = useState<BridgeTokenContext>(NO_BRIDGE_CONTEXT);
  const [refusedUrl, setRefusedUrl] = useState<string | null | undefined>(undefined);
  const [, navigate] = useLocation();
  // Held devices (D6). `operator` = the server accepted this viewer on the operator-only revoked list;
  // until then (and on any failure) no mutating control is offered.
  const [operator, setOperator] = useState(false);
  const [revoked, setRevoked] = useState<RevokedDeviceView[]>([]);
  const [unreadable, setUnreadable] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notices, setNotices] = useState<RevokeNoticeState[]>([]);
  const noticeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  // No timer may outlive the section.
  useEffect(() => {
    const timers = noticeTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  const dropNotice = useCallback((id: string) => {
    const timer = noticeTimers.current.get(id);
    if (timer) clearTimeout(timer);
    noticeTimers.current.delete(id);
    setNotices((ns) => ns.filter((n) => n.id !== id));
  }, []);

  /** Show "<name> revoked · Undo" for exactly {@link REVOKE_NOTICE_MS}. */
  const startNotice = useCallback(
    (id: string, name: string) => {
      const prior = noticeTimers.current.get(id);
      if (prior) clearTimeout(prior);
      setNotices((ns) => [...ns.filter((n) => n.id !== id), { id, name }]);
      noticeTimers.current.set(id, setTimeout(() => dropNotice(id), REVOKE_NOTICE_MS));
    },
    [dropNotice],
  );

  const copyOnce = useCallback((text: string) => {
    void copyText(text).then((ok) => setCopyOutcome(ok ? "ok" : "failed"));
  }, []);

  const loadRevoked = useCallback(async () => {
    try {
      const r = await listRevokedDevices();
      setOperator(r.operator);
      setRevoked(r.operator ? r.devices : []);
      setUnreadable(r.operator ? r.unreadable : false);
    } catch {
      // Cannot tell whether this viewer is an operator: fail closed, keep the paired list usable.
      setOperator(false);
      setRevoked([]);
      setUnreadable(false);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      await Promise.all([listPairedDevices().then(setDevices), loadRevoked()]);
    } catch (e: any) {
      setError(e?.message ?? "failed to load");
    } finally {
      setLoading(false);
    }
  }, [loadRevoked]);

  useEffect(() => { void reload().catch(logRejection("PairedDevicesSection.reload")); }, [reload]);

  const handleRevoke = async (id: string) => {
    if (revoking) return; // guard against double-submit
    setRevoking(id);
    const name = devices.find((d) => d.id === id)?.label ?? id;
    try {
      await revokePairedDevice(id);
      setConfirmId(null);
      setError(null);
      startNotice(id, name);
      await reload();
    } catch (e: any) {
      setError(e?.message ?? "failed to revoke");
    } finally {
      setRevoking(null);
    }
  };

  /** Undo a revoke (from the notice or the revoked list); 404/409 ⇒ "No longer available" and a refresh. */
  const handleUndo = async (id: string, fromNotice: boolean) => {
    if (busyId) return;
    setBusyId(id);
    setUnavailable(false);
    try {
      const outcome = await restorePairedDevice(id);
      if (outcome === "restored") {
        dropNotice(id);
      } else if (fromNotice) {
        setNotices((ns) => ns.map((n) => (n.id === id ? { ...n, unavailable: true } : n)));
      } else {
        setUnavailable(true);
      }
      setError(null);
      await reload();
    } catch (e) {
      setError(messageOf(e, "failed to restore"));
    } finally {
      setBusyId(null);
    }
  };

  const handleDeleteNow = async (id: string) => {
    setBusyId(id);
    setUnavailable(false);
    try {
      if ((await deleteRevokedDevice(id)) === "unavailable") setUnavailable(true);
      setError(null);
      await reload();
    } catch (e) {
      setError(messageOf(e, "failed to delete"));
    } finally {
      setBusyId(null);
    }
  };

  const handleRemoveCompanion = async (deviceId: string, companionId: string) => {
    try {
      await removeCompanion(deviceId, companionId);
      setError(null);
      await reload();
    } catch (e) {
      setError(messageOf(e, "failed to remove"));
    }
  };

  /** Open the create flow: load reachable URLs and preselect the browser origin. */
  const openCreate = useCallback(async () => {
    setLabelDraft("");
    setTier("observe");
    setPurpose("mcp");
    setRefusedUrl(undefined);
    setBridgeCtx(NO_BRIDGE_CONTEXT);
    setStage("label");
    void getBridgeTokenContext().then(setBridgeCtx, () => setBridgeCtx(NO_BRIDGE_CONTEXT));
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

  /** The hub does not see this request as proven HTTPS: stay in the dialog, name the address, drop the purpose. */
  const onBridgeRefused = (httpsUrl: unknown) => {
    const url = typeof httpsUrl === "string" ? httpsUrl : undefined;
    setRefusedUrl(url ?? null);
    setBridgeCtx((c) => ({ ...c, httpsChannel: false, tlsListenerUrls: url ? [url] : c.tlsListenerUrls }));
    setPurpose("mcp");
    setError(null);
  };

  const handleCreate = async () => {
    if (minting) return; // guard against double-submit (Enter + click)
    setMinting(true);
    try {
      // One-shot panel (D6): the plaintext token lives in React state only
      // while the result panel is open, and is dropped on dismiss.
      // A bridge token is always operate-tier + `purpose: "bridge"`; the MCP call is unchanged.
      const result = purpose === "bridge" ? await createPairedDevice(labelDraft, "operate", "bridge") : await createPairedDevice(labelDraft, tier);
      setLabelDraft("");
      setMinted(result);
      setMintedPurpose(purpose);
      setStage("result");
      setError(null);
    } catch (e: any) {
      if (purpose === "bridge" && e?.code === "bridge_token_requires_https") {
        onBridgeRefused(e.httpsUrl);
      } else {
        setError(e?.message ?? "failed to mint token");
        setStage("closed");
      }
    } finally {
      setMinting(false);
    }
  };

  /** The base the snippet targets: the picked URL, else the browser origin. */
  const snippetTarget = () => base || snippetBase();

  const openBuiltInHttps = (e: { preventDefault: () => void }) => {
    e.preventDefault();
    navigate(BUILT_IN_HTTPS_PATH);
    // The section renders after the route swap: scroll once it exists.
    requestAnimationFrame(() => document.getElementById(BUILT_IN_HTTPS_ANCHOR)?.scrollIntoView({ block: "start" }));
  };

  const dismissMinted = () => {
    setMinted(null);
    setMintedPurpose("mcp");
    setStage("closed");
    void reload().catch(logRejection("PairedDevicesSection.dismissReload"));
  };

  const bridgeEndpoint = bridgeCtx.acceptBridges && bridgeCtx.tlsListenerUrls[0] ? toWss(bridgeCtx.tlsListenerUrls[0]) : null;
  const bridgeSnippet = minted && bridgeEndpoint ? `PI_DASHBOARD_URL=${bridgeEndpoint}\nPI_DASHBOARD_TOKEN=${minted.token}` : null;
  const mcpSnippet = minted
    ? `claude mcp add --transport http pi-dashboard ${snippetTarget()}/mcp --header "Authorization: Bearer ${minted.token}"`
    : "";

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
          <TokenPurposeFieldset
            purpose={purpose}
            onPurpose={setPurpose}
            ctx={bridgeCtx}
            refusedUrl={refusedUrl}
            onOpenBuiltInHttps={openBuiltInHttps}
          />
          {purpose === "bridge" ? (
            <p className="m-0 text-xs text-[var(--text-secondary)]" data-testid="bridge-tier-note">
              {i18nT("settings.bridgeTierNote", undefined, "Bridge tokens use the Operate tier: a bridge needs it to open its connection.")}
            </p>
          ) : (
            <>
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
            </>
          )}
        </div>
      )}
      {stage === "result" && minted && (
        <MintedTokenPanel
          token={minted.token}
          purpose={mintedPurpose}
          bridgeSnippet={bridgeSnippet}
          mcpSnippet={mcpSnippet}
          copyOutcome={copyOutcome}
          onCopy={copyOnce}
          onDismiss={dismissMinted}
        />
      )}
      {notices.map((n) => (
        <RevokeNotice key={n.id} notice={n} onUndo={(id) => void handleUndo(id, true)} />
      ))}
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
                    {tierLabel(d.tier)}
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
                <KeyAndCompanions device={d} operator={operator} onRemoveCompanion={(id, cid) => void handleRemoveCompanion(id, cid)} />
              </div>
              {!operator ? null : confirmId === d.id ? (
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
      {operator && (
        <RevokedDevicesPanel
          devices={revoked}
          unreadable={unreadable}
          unavailable={unavailable}
          busyId={busyId}
          now={Date.now()}
          onUndo={(id) => void handleUndo(id, false)}
          onDeleteNow={handleDeleteNow}
        />
      )}
    </div>
  );
}
