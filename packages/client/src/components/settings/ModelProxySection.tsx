/**
 * Model Proxy settings section (task 13.1).
 *
 * Renders:
 *   - Master toggle (modelProxy.enabled)
 *   - Default model dropdown
 *   - Optional second port input
 *   - API keys table with reveal-once banner + revoke/purge actions
 *
 * Mounted in SettingsPanel providers tab after "LLM Providers" section.
 * See change: add-dashboard-model-proxy.
 */

import { mdiClipboardCheckOutline, mdiClose, mdiDragVertical, mdiPlus, mdiRefresh, mdiTrashCan } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  type CreateApiKeyResult,
  createApiKey,
  deleteApiKey,
  listApiKeys,
  type ProxyApiKeyEntry,
  refreshRegistry,
  revokeApiKey,
} from "../../lib/api/model-proxy-api.js";
import { ModelSelector } from "./ModelSelector.js";

// ── Types ────────────────────────────────────────────────────────────────

export interface ModelProxyConfig {
  enabled?: boolean;
  defaultModel?: string;
  preferredModels?: string[];
  modelAliases?: Record<string, string>;
  secondPort?: number;
  maxConcurrentStreams?: number;
  perKeyConcurrentStreams?: number;
  logRequests?: boolean;
}

interface Props {
  config: ModelProxyConfig;
  onChange: (patch: ModelProxyConfig) => void;
  /** Set to true when bridge reports @blackbelt-technology/pi-model-proxy is installed in pi settings.json */
  upstreamExtensionDetected?: boolean;
  /** Registry-available models (`provider/id`), for the ModelSelector + availability pills. */
  availableModels?: Array<{ provider: string; id: string }>;
}

// ── Preferred Models editor (change: fix-and-prefer-model-proxy-resolution) ──

interface PreferredModelsEditorProps {
  value: string[];
  onChange: (next: string[]) => void;
  availableModels: Array<{ provider: string; id: string }>;
  availableSet: Set<string>;
}

function PreferredModelsEditor({ value, onChange, availableModels, availableSet }: PreferredModelsEditorProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  const reorder = (from: number, to: number) => {
    if (from === to || from < 0 || to < 0) return;
    const next = [...value];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };

  const remove = (idx: number) => onChange(value.filter((_, i) => i !== idx));

  const add = (label: string) => {
    if (!value.includes(label)) onChange([...value, label]);
  };

  return (
    <div data-testid="preferred-models-editor">
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
        {i18nT("common.preferredModels", undefined, "Preferred Models")}{" "}
        <span className="text-[var(--text-tertiary)]">
          {i18nT("common.orderedFallbackFirstAvailable", undefined, "(ordered fallback — first available entry; supersedes Default Model)")}
        </span>
      </label>
      {value.length > 0 && (
        <div className="bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)] mb-2">
          {value.map((fqid, idx) => {
            const slash = fqid.indexOf("/");
            const prov = slash > 0 ? fqid.slice(0, slash + 1) : "";
            const rest = slash > 0 ? fqid.slice(slash + 1) : fqid;
            const isAvail = availableSet.has(fqid);
            return (
              <div
                key={fqid}
                draggable
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => { if (dragIndex != null) reorder(dragIndex, idx); setDragIndex(null); }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-secondary)] last:border-0"
                data-testid="preferred-model-row"
              >
                <span className="text-[var(--text-muted)] cursor-grab flex-none" aria-hidden>
                  <Icon path={mdiDragVertical} size={0.6} />
                </span>
                <span className="text-[11px] text-[var(--text-muted)] w-4 text-right flex-none">{idx + 1}</span>
                <span className="flex-1 min-w-0 text-xs font-mono truncate">
                  <span className="text-[var(--text-tertiary)]">{prov}</span>{rest}
                </span>
                <span
                  className={`text-[11px] px-1.5 rounded-full flex-none ${
                    isAvail
                      ? "text-[var(--accent-green)] bg-[color-mix(in_srgb,var(--accent-green)_14%,transparent)]"
                      : "text-[var(--text-muted)] bg-[var(--bg-surface)]"
                  }`}
                >
                  {isAvail ? i18nT("common.available", undefined, "available") : i18nT("common.noCredential", undefined, "no credential")}
                </span>
                <button
                  className="text-[var(--text-tertiary)] hover:text-red-400 flex-none"
                  onClick={() => remove(idx)}
                  aria-label={i18nT("common.remove2", undefined, "Remove")}
                  data-testid={`preferred-remove-${idx}`}
                >
                  <Icon path={mdiClose} size={0.6} />
                </button>
              </div>
            );
          })}
        </div>
      )}
      <ModelSelector
        models={availableModels}
        placeholder={i18nT("common.addModel", undefined, "＋ Add model")}
        onSelect={add}
      />
    </div>
  );
}

// ── Model Aliases editor ──

interface AliasEntry { key: string; value: string; }

interface ModelAliasesEditorProps {
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  availableModels: Array<{ provider: string; id: string }>;
}

function ModelAliasesEditor({ value, onChange, availableModels }: ModelAliasesEditorProps) {
  // Local entry list so a partially-typed alias (empty key or value) can exist
  // without collapsing the map. Committed (dropping empties) on every edit.
  const [entries, setEntries] = useState<AliasEntry[]>(() =>
    Object.entries(value).map(([key, val]) => ({ key, value: val })),
  );

  const commit = (next: AliasEntry[]) => {
    setEntries(next);
    const obj: Record<string, string> = {};
    for (const { key, value: v } of next) {
      const k = key.trim();
      if (k && v.trim()) obj[k] = v.trim();
    }
    onChange(obj);
  };

  const setKey = (idx: number, key: string) =>
    commit(entries.map((e, i) => (i === idx ? { ...e, key } : e)));
  const setValue = (idx: number, val: string) =>
    commit(entries.map((e, i) => (i === idx ? { ...e, value: val } : e)));
  const remove = (idx: number) => commit(entries.filter((_, i) => i !== idx));
  const addRow = () => setEntries([...entries, { key: "", value: "" }]);

  return (
    <div data-testid="model-aliases-editor">
      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
        {i18nT("models.modelAliases", undefined, "Model Aliases")}{" "}
        <span className="text-[var(--text-tertiary)]">
          {i18nT("common.aliasShortNameToModel", undefined, "(map a short name to a fully-qualified model)")}
        </span>
      </label>
      {entries.length > 0 && (
        <div className="bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)] mb-2">
          {entries.map((e, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 px-2 py-1.5 border-b border-[var(--border-secondary)] last:border-0"
              data-testid="alias-row"
            >
              <input
                type="text"
                className="w-32 flex-none bg-[var(--bg-tertiary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-xs font-mono text-[var(--text-primary)]"
                placeholder={i18nT("common.alias", undefined, "alias")}
                value={e.key}
                onChange={(ev) => setKey(idx, ev.target.value)}
                data-testid={`alias-key-${idx}`}
              />
              <span className="text-[var(--text-muted)] flex-none">→</span>
              <div className="flex-1 min-w-0">
                <ModelSelector
                  current={e.value || undefined}
                  models={availableModels}
                  placeholder={i18nT("common.selectModel", undefined, "Select model…")}
                  onSelect={(label) => setValue(idx, label)}
                />
              </div>
              <button
                className="text-[var(--text-tertiary)] hover:text-red-400 flex-none"
                onClick={() => remove(idx)}
                aria-label={i18nT("common.remove2", undefined, "Remove")}
                data-testid={`alias-remove-${idx}`}
              >
                <Icon path={mdiClose} size={0.6} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={addRow}
        className="flex items-center gap-1.5 text-sm text-[var(--accent-blue)] hover:text-blue-400"
        data-testid="add-alias-button"
      >
        <Icon path={mdiPlus} size={0.6} />
        {i18nT("common.addAlias", undefined, "Add alias")}
      </button>
    </div>
  );
}

// ── Reveal-once banner (task 13.3) ────────────────────────────────────────

interface RevealBannerProps {
  keyInfo: CreateApiKeyResult;
  onDismiss: () => void;
}

function RevealBanner({ keyInfo, onDismiss }: RevealBannerProps) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard.writeText(keyInfo.key).catch(() => {
      // Fallback: create temp textarea
      const ta = document.createElement("textarea");
      ta.value = keyInfo.key;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      className="border border-amber-500 bg-amber-950/40 rounded p-3 mb-3"
      data-testid="reveal-banner"
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-amber-400">
          {i18nT("common.saveThisKeyNowYouCannot", undefined, "⚠ Save this key now — you cannot view it again")}
        </span>
        <button
          className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
          onClick={onDismiss}
          aria-label={i18nT("common.dismiss", undefined, "Dismiss")}
          data-testid="reveal-banner-dismiss"
        >
          <Icon path={mdiClose} size={0.6} />
        </button>
      </div>
      <code className="block text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-secondary)] rounded px-2 py-1 mb-2 break-all select-all">
        {keyInfo.key}
      </code>
      <button
        onClick={copy}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-amber-600 hover:bg-amber-500 text-white"
        data-testid="copy-key-button"
      >
        <Icon path={mdiClipboardCheckOutline} size={0.55} />
        {copied ? "Copied!" : "Copy key"}
      </button>
    </div>
  );
}

// ── New Key Form ──────────────────────────────────────────────────────────

interface NewKeyFormProps {
  onCreated: (result: CreateApiKeyResult) => void;
  onCancel: () => void;
}

function NewKeyForm({ onCreated, onCancel }: NewKeyFormProps) {
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!label.trim()) { setError("Label is required"); return; }
    setBusy(true);
    setError(null);
    try {
      const result = await createApiKey({ label: label.trim() });
      onCreated(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create key");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex gap-2 items-center mb-2" data-testid="new-key-form">
      <input
        type="text"
        className="flex-1 bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-sm text-[var(--text-primary)]"
        placeholder={i18nT("common.keyLabel", undefined, "Key label")}
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void submit(); if (e.key === "Escape") onCancel(); }}
        autoFocus
        data-testid="new-key-label-input"
      />
      <button
        className="px-2 py-1 rounded text-xs bg-[var(--accent-blue)] hover:opacity-90 text-white disabled:opacity-50"
        onClick={() => void submit()}
        disabled={busy}
        data-testid="new-key-submit"
      >
        {busy ? "Creating…" : "Create"}
      </button>
      <button
        className="px-2 py-1 rounded text-xs text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        onClick={onCancel}
      >
        {i18nT("common.cancel", undefined, "Cancel")}
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

// ── Key Row ───────────────────────────────────────────────────────────────

interface KeyRowProps {
  entry: ProxyApiKeyEntry;
  onRevoke: () => void;
  onDelete: () => void;
}

function KeyRow({ entry, onRevoke, onDelete }: KeyRowProps) {
  const isRevoked = entry.revokedAt != null;

  return (
    <div className="flex items-center gap-2 py-1.5 border-b border-[var(--border-secondary)] last:border-0">
      <div className="flex-1 min-w-0">
        <span className={`text-sm ${isRevoked ? "line-through text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"}`}>
          {entry.label}
        </span>
        {entry.createdBy && (
          <span className="ml-2 text-xs text-[var(--text-tertiary)]">{entry.createdBy}</span>
        )}
        {entry.lastUsedAt && (
          <span className="ml-2 text-xs text-[var(--text-tertiary)]">
            {i18nT("common.lastUsed", undefined, "last used")} {new Date(entry.lastUsedAt).toLocaleDateString()}
          </span>
        )}
      </div>
      <span className="text-xs text-[var(--text-tertiary)]">
        {entry.scopes?.join(", ") ?? "all"}
      </span>
      {!isRevoked ? (
        <button
          className="text-xs text-amber-400 hover:text-amber-300"
          onClick={onRevoke}
          title={i18nT("common.revokeKey", undefined, "Revoke key")}
          data-testid={`revoke-${entry.id}`}
        >
          {i18nT("common.revoke", undefined, "Revoke")}
        </button>
      ) : (
        <button
          className="text-xs text-red-400 hover:text-red-300"
          onClick={onDelete}
          title={i18nT("common.purgeKey", undefined, "Purge key")}
          data-testid={`purge-${entry.id}`}
        >
          <Icon path={mdiTrashCan} size={0.55} />
        </button>
      )}
    </div>
  );
}

// ── Main section component ────────────────────────────────────────────────

export function ModelProxySection({ config, onChange, upstreamExtensionDetected, availableModels }: Props) {
  const models = availableModels ?? [];
  const availableSet = React.useMemo(
    () => new Set(models.map((m) => `${m.provider}/${m.id}`)),
    [models],
  );
  const [keys, setKeys] = useState<ProxyApiKeyEntry[]>([]);
  const [revokedKeys, setRevokedKeys] = useState<ProxyApiKeyEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newlyCreated, setNewlyCreated] = useState<CreateApiKeyResult | null>(null);
  // Persist "key was created" trail even after banner dismiss (task 13.3)
  const [lastCreatedLabel, setLastCreatedLabel] = useState<string | null>(null);
  const [secondPortInput, setSecondPortInput] = useState(
    config.secondPort != null ? String(config.secondPort) : "",
  );
  const [secondPortError, setSecondPortError] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listApiKeys();
      setKeys(result.keys);
      setRevokedKeys(result.revoked);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (config.enabled) void loadKeys();
  }, [config.enabled, loadKeys]);

  const handleToggle = () => onChange({ ...config, enabled: !config.enabled });

  const handleSecondPortBlur = () => {
    const raw = secondPortInput.trim();
    if (!raw) {
      setSecondPortError(null);
      onChange({ ...config, secondPort: undefined });
      return;
    }
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1024 || n > 65535) {
      setSecondPortError("Port must be 1024–65535");
      return;
    }
    setSecondPortError(null);
    onChange({ ...config, secondPort: n });
  };

  const handleKeyCreated = (result: CreateApiKeyResult) => {
    setNewlyCreated(result);
    setLastCreatedLabel(result.label);
    setShowNewForm(false);
    void loadKeys();
  };

  const handleRevoke = async (id: string) => {
    try {
      await revokeApiKey(id);
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to revoke key");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteApiKey(id);
      await loadKeys();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete key");
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshRegistry();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Refresh failed");
    }
  };

  return (
    <div className="space-y-4">
      {/* Master toggle */}
      <div className="flex items-center justify-between">
        <div>
          <span className="text-sm font-medium text-[var(--text-primary)]">{i18nT("common.apiProxy", undefined, "API Proxy")}</span>
          <p className="text-xs text-[var(--text-tertiary)]">
            {i18nT("providers.exposeOpenaiCompatible", undefined, "Expose OpenAI-compatible")} <code>/v1/chat/completions</code> {i18nT("providers.andAnthropicCompatible", undefined, "and Anthropic-compatible")} <code>/v1/messages</code> {i18nT("common.endpointsBackedByYourConfiguredProvid", undefined, "endpoints backed by your configured providers.")}
          </p>
        </div>
        <button
          role="switch"
          aria-checked={config.enabled ?? false}
          onClick={handleToggle}
          className={`relative inline-flex h-5 w-9 rounded-full transition-colors ${config.enabled ? "bg-[var(--accent-blue)]" : "bg-[var(--border-secondary)]"}`}
          data-testid="proxy-toggle"
        >
          <span
            className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform mt-0.75 ${config.enabled ? "translate-x-4" : "translate-x-0.5"}`}
          />
        </button>
      </div>

      {/* Task 14.1: coexistence warning — non-blocking, user-initiated disable only */}
      {config.enabled && upstreamExtensionDetected && (
        <div className="rounded border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
          <strong>{i18nT("common.note", undefined, "Note:")}</strong> {i18nT("common.theUpstream", undefined, "The upstream")} <code>@blackbelt-technology/pi-model-proxy</code> {i18nT("packages.extensionIsAlsoActiveInOne", undefined, "extension is also active in one or more pi sessions.\n          Both will work; the dashboard proxy runs on")} <code>:8000/v1</code> {i18nT("common.whileTheUpstreamUses", undefined, "while the upstream uses")} <code>:9876</code>{i18nT("common.consider", undefined, ".\n          Consider")}{" "}
          <a
            href="https://github.com/BlackBeltTechnology/pi-model-proxy#disable"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-amber-100"
          >
            {i18nT("packages.disablingTheUpstreamExtension", undefined, "disabling the upstream extension")}
          </a>{" "}
          {i18nT("common.toAvoidDuplicateListeners", undefined, "to avoid duplicate listeners.")}
        </div>
      )}

      {config.enabled && (
        <>
          {/* Default model */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {i18nT("common.defaultModel", undefined, "Default Model")} <span className="text-[var(--text-tertiary)]">{i18nT("common.optionalUsedWhenRequestOmitsModel", undefined, "(optional — used when request omits model)")}</span>
            </label>
            <input
              type="text"
              className="w-full bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded px-2 py-1.5 text-sm text-[var(--text-primary)] font-mono"
              placeholder={i18nT("providers.eGAnthropicClaude35", undefined, "e.g. anthropic/claude-3-5-sonnet")}
              value={config.defaultModel ?? ""}
              onChange={(e) => onChange({ ...config, defaultModel: e.target.value || undefined })}
              data-testid="default-model-input"
            />
          </div>

          {/* Preferred Models (change: fix-and-prefer-model-proxy-resolution) */}
          <PreferredModelsEditor
            value={config.preferredModels ?? []}
            onChange={(next) => onChange({ ...config, preferredModels: next.length > 0 ? next : undefined })}
            availableModels={models}
            availableSet={availableSet}
          />

          {/* Model Aliases */}
          <ModelAliasesEditor
            value={config.modelAliases ?? {}}
            onChange={(next) => onChange({ ...config, modelAliases: Object.keys(next).length > 0 ? next : undefined })}
            availableModels={models}
          />

          {/* Second port */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">
              {i18nT("settings.secondPort", undefined, "Second Port")} <span className="text-[var(--text-tertiary)]">{i18nT("common.optionalForClientsThatHardcodeV1", undefined, "(optional — for clients that hardcode /v1 path-prefix-less base URLs)")}</span>
            </label>
            <input
              type="number"
              min={1024}
              max={65535}
              className={`w-32 bg-[var(--bg-secondary)] border rounded px-2 py-1.5 text-sm text-[var(--text-primary)] ${secondPortError ? "border-red-400" : "border-[var(--border-secondary)]"}`}
              placeholder={i18nT("common.eG9876", undefined, "e.g. 9876")}
              value={secondPortInput}
              onChange={(e) => { setSecondPortInput(e.target.value); setSecondPortError(null); }}
              onBlur={handleSecondPortBlur}
              data-testid="second-port-input"
            />
            {secondPortError && (
              <p className="text-xs text-red-400 mt-1" data-testid="second-port-error">{secondPortError}</p>
            )}
          </div>

          {/* API Keys */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wide">
                {i18nT("gateway.apiKeys", undefined, "API Keys")}
              </span>
              <button
                onClick={handleRefresh}
                title={i18nT("providers.refreshModelRegistry", undefined, "Refresh model registry")}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                data-testid="refresh-registry-button"
              >
                <Icon path={mdiRefresh} size={0.6} />
              </button>
            </div>

            {/* Reveal-once banner for newly created key (task 13.3) */}
            {newlyCreated && (
              <RevealBanner
                keyInfo={newlyCreated}
                onDismiss={() => setNewlyCreated(null)}
              />
            )}

            {/* Trail after dismissal */}
            {!newlyCreated && lastCreatedLabel && (
              <p className="text-xs text-[var(--text-tertiary)] mb-2">
                {i18nT("common.key", undefined, "Key")} <em>{lastCreatedLabel}</em> {i18nT("common.wasCreatedSeeLogsForUsage", undefined, "was created. See logs for usage.")}
              </p>
            )}

            {error && <p className="text-xs text-red-400 mb-2">{error}</p>}

            {loading ? (
              <p className="text-xs text-[var(--text-tertiary)]">{i18nT("common.loading2", undefined, "Loading…")}</p>
            ) : (
              <div className="bg-[var(--bg-secondary)] rounded border border-[var(--border-secondary)]">
                {keys.length === 0 && revokedKeys.length === 0 ? (
                  <p className="text-xs text-[var(--text-tertiary)] px-3 py-2">{i18nT("gateway.noApiKeysYet", undefined, "No API keys yet.")}</p>
                ) : (
                  <div className="px-3">
                    {keys.map((k) => (
                      <KeyRow
                        key={k.id}
                        entry={k}
                        onRevoke={() => void handleRevoke(k.id)}
                        onDelete={() => void handleDelete(k.id)}
                      />
                    ))}
                    {revokedKeys.length > 0 && (
                      <>
                        <p className="text-xs text-[var(--text-tertiary)] mt-2 mb-1">{i18nT("status.revoked", undefined, "Revoked")}</p>
                        {revokedKeys.map((k) => (
                          <KeyRow
                            key={k.id}
                            entry={k}
                            onRevoke={() => void handleRevoke(k.id)}
                            onDelete={() => void handleDelete(k.id)}
                          />
                        ))}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {showNewForm ? (
              <div className="mt-2">
                <NewKeyForm
                  onCreated={handleKeyCreated}
                  onCancel={() => setShowNewForm(false)}
                />
              </div>
            ) : (
              <button
                onClick={() => setShowNewForm(true)}
                className="flex items-center gap-1.5 text-sm text-[var(--accent-blue)] hover:text-blue-400 mt-2"
                data-testid="new-key-button"
              >
                <Icon path={mdiPlus} size={0.6} />
                {i18nT("gateway.newApiKey", undefined, "New API key")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
