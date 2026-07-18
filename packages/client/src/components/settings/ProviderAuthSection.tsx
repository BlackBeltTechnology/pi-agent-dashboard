/**
 * Provider Authentication section for Settings panel.
 * OAuth login buttons + API key inputs for pi LLM providers.
 */

import type { DeviceCodeResponse, ProviderAuthHandlerIdsResponse, ProviderAuthStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiAlert,
  mdiArrowRight,
  mdiCheck,
  mdiClockOutline,
  mdiContentCopy,
  mdiContentSave,
  mdiDelete,
  mdiKeyPlus,
  mdiLoading,
  mdiLogin,
  mdiLogout,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useAsyncAction } from "../../hooks/useAsyncAction.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { Toast, type ToastVariant, useToast } from "../primitives/Toast.js";

// ── Fetch helpers ────────────────────────────────────────────────────────────

async function fetchStatus(): Promise<ProviderAuthStatus[]> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/status`);
  return res.json();
}

/** Provider ids the dashboard can actually complete a login flow for. */
async function fetchHandlerIds(): Promise<Set<string>> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/handlers`);
  if (!res.ok) throw new Error(i18nT("err.loadProviderAuthHandlers", undefined, "Failed to load provider auth handlers"));
  const data: ProviderAuthHandlerIdsResponse = await res.json();
  return new Set(data.ids ?? []);
}

/** DELETE a provider credential, surfacing the backend error detail on failure. */
async function deleteProvider(id: string, fallback: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const detail = await res
      .json()
      .then((d) => (d && typeof d.error === "string" ? d.error : null))
      .catch(() => null);
    throw new Error(detail || fallback);
  }
}

// ── Time formatting ──────────────────────────────────────────────────────────

function relativeExpiry(expires: number): string {
  const diff = expires - Date.now();
  if (diff <= 0) return "expired";
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `expires in ${days}d`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `expires in ${hours}h`;
  const mins = Math.floor(diff / 60_000);
  return `expires in ${mins}m`;
}

// ── Main component ───────────────────────────────────────────────────────────

export function ProviderAuthSection() {
  const [statuses, setStatuses] = useState<ProviderAuthStatus[]>([]);
  // null = not yet known (loading or fetch failed). Never gate OAuth rows
  // closed while unknown — a secondary capability probe must not become a
  // hard sign-in outage. See change: adopt-pi-071-072-073-features.
  const [handlerIds, setHandlerIds] = useState<Set<string> | null>(null);
  const [loading, setLoading] = useState(true);
  const { messages, showToast, dismissToast } = useToast();

  const refresh = useCallback(async () => {
    try {
      const data = await fetchStatus();
      setStatuses(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    fetchHandlerIds().then(setHandlerIds).catch(() => setHandlerIds(null));
  }, []);

  if (loading) {
    return <div className="text-[var(--text-muted)] text-sm py-2">{i18nT("providers.loadingProviderStatus", undefined, "Loading provider status…")}</div>;
  }

  const oauthProviders = statuses.filter((s) => s.flowType !== "api_key");
  const apiKeyProviders = statuses.filter((s) => s.flowType === "api_key");

  return (
    <div className="space-y-4">
      <Toast messages={messages} onDismiss={dismissToast} />
      {/* OAuth Providers */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider">{i18nT("gateway.subscriptionsOauth", undefined, "Subscriptions (OAuth)")}</h3>
        {oauthProviders.map((p) => (
          <OAuthProviderRow key={p.id} provider={p} supported={handlerIds === null ? true : handlerIds.has(p.id)} onChanged={refresh} showToast={showToast} />
        ))}
      </div>

      {/* API Key Providers */}
      <div className="space-y-2">
        <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wider mt-4">{i18nT("gateway.apiKeys", undefined, "API Keys")}</h3>
        {apiKeyProviders.map((p) => (
          <ApiKeyRow key={p.id} provider={p} onChanged={refresh} showToast={showToast} />
        ))}
      </div>
    </div>
  );
}

// ── OAuth Provider Row ───────────────────────────────────────────────────────

function OAuthProviderRow({ provider, supported, onChanged, showToast }: { provider: ProviderAuthStatus; supported: boolean; onChanged: () => void; showToast: (text: string, variant?: ToastVariant) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deviceModal, setDeviceModal] = useState<DeviceCodeResponse | null>(null);
  const [enterpriseInput, setEnterpriseInput] = useState(false);
  const [enterpriseDomain, setEnterpriseDomain] = useState("");
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cleanup polling and timeouts on unmount
  useEffect(() => () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);

  const startAuthCode = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/provider-auth/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      // Server opens system browser and starts temp callback server.
      // Poll status until the provider shows as authenticated.
      if (pollingRef.current) clearInterval(pollingRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);

      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${getApiBase()}/api/provider-auth/status`);
          const statuses: ProviderAuthStatus[] = await statusRes.json();
          const updated = statuses.find((s) => s.id === provider.id);
          if (updated?.authenticated) {
            if (pollingRef.current) clearInterval(pollingRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            setBusy(false);
            onChanged();
          }
        } catch { /* retry */ }
      }, 2000);

      // Stop polling after 5 minutes (matches callback server timeout)
      timeoutRef.current = setTimeout(() => {
        if (pollingRef.current) clearInterval(pollingRef.current);
        setBusy((prev) => {
          if (prev) setError("Login timed out. Please try again.");
          return false;
        });
      }, 5 * 60 * 1000);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const startDeviceCode = async (domain?: string) => {
    setBusy(true);
    setError(null);
    setEnterpriseInput(false);
    try {
      const res = await fetch(`${getApiBase()}/api/provider-auth/device-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, enterpriseDomain: domain || undefined }),
      });
      const data: DeviceCodeResponse = await res.json();
      if (!res.ok) throw new Error((data as any).error);
      setDeviceModal(data);

      // Poll for completion (user opens the URL manually via button)
      pollingRef.current = setInterval(async () => {
        try {
          const statusRes = await fetch(`${getApiBase()}/api/provider-auth/device-status/${data.flowId}`);
          const statusData = await statusRes.json();
          if (statusData.status === "complete") {
            clearInterval(pollingRef.current!);
            setDeviceModal(null);
            setBusy(false);
            onChanged();
          } else if (statusData.status === "expired" || statusData.status === "error") {
            clearInterval(pollingRef.current!);
            setDeviceModal(null);
            setBusy(false);
            setError(statusData.error || "Authorization expired");
          }
        } catch { /* retry */ }
      }, 3000);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  };

  const handleSignIn = () => {
    if (provider.flowType === "device_code") {
      if (provider.id === "github-copilot") {
        setEnterpriseInput(true);
        return;
      }
      startDeviceCode();
    } else {
      startAuthCode();
    }
  };

  // Sign-out is a synchronous REST delete — confirm:"http" + success toast.
  // See change: add-async-action-feedback.
  const signOut = useAsyncAction(
    () => deleteProvider(provider.id, "Failed to sign out"),
    { showToast, successToast: `Signed out of ${provider.name}`, onSuccess: onChanged },
  );

  return (
    <div className="flex flex-col gap-1 p-3 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)]">{provider.name}</div>
          {provider.authenticated && provider.expires && (
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Icon path={mdiClockOutline} size={0.45} />
              {relativeExpiry(provider.expires)}
            </div>
          )}
        </div>
        {provider.authenticated ? (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Icon path={mdiCheck} size={0.5} /> {i18nT("connection.connected", undefined, "Connected")}
            </span>
            <button
              onClick={signOut.bind.onClick}
              disabled={busy || signOut.pending}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-secondary)] disabled:opacity-50"
            >
              <Icon path={mdiLogout} size={0.5} />
              {signOut.pending ? "Signing Out…" : "Sign Out"}
            </button>
          </div>
        ) : (
          // Tooltip lives on the wrapper span: a disabled <button> does not fire
          // hover events in all browsers, so a `title` on it would never show.
          <span title={supported ? undefined : `OAuth flow not yet supported in dashboard for ${provider.name}`} className="inline-flex">
            <button
              onClick={supported ? handleSignIn : undefined}
              disabled={busy || !supported}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50"
            >
              {busy ? <Icon path={mdiLoading} size={0.5} className="animate-spin" /> : <Icon path={mdiLogin} size={0.5} />}
              {i18nT("common.signIn", undefined, "Sign In")}
            </button>
          </span>
        )}
      </div>

      {/* GitHub Enterprise domain prompt */}
      {enterpriseInput && (
        <div className="flex items-center gap-2 mt-2">
          <input
            type="text"
            value={enterpriseDomain}
            onChange={(e) => setEnterpriseDomain(e.target.value)}
            placeholder={i18nT("git.enterpriseDomainBlankForGithubCom", undefined, "Enterprise domain (blank for github.com)")}
            className="flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
            onKeyDown={(e) => { if (e.key === "Enter") startDeviceCode(enterpriseDomain); }}
            autoFocus
          />
          <button
            onClick={() => startDeviceCode(enterpriseDomain)}
            className="px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white"
          >
            <Icon path={mdiArrowRight} size={0.45} className="inline mr-0.5" />{i18nT("common.continue", undefined, "Continue")}
          </button>
          <button
            onClick={() => setEnterpriseInput(false)}
            className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]"
          >
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </div>
      )}

      {/* Device code modal */}
      {deviceModal && (
        <div className="mt-2 p-3 rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)]">
          <div className="text-xs text-[var(--text-muted)] mb-2">{i18nT("common.enterThisCodeAt", undefined, "Enter this code at:")}</div>
          <a href={deviceModal.verificationUri} target="_blank" rel="noopener" className="text-xs text-blue-400 hover:underline break-all">
            {deviceModal.verificationUri}
          </a>
          <div className="flex items-center gap-2 mt-2">
            <code className="text-lg font-bold text-[var(--text-primary)] tracking-wider">{deviceModal.userCode}</code>
            <button
              onClick={() => navigator.clipboard.writeText(deviceModal.userCode)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              title={i18nT("common.copyCode", undefined, "Copy code")}
            >
              <Icon path={mdiContentCopy} size={0.5} />
            </button>
          </div>
          <button
            onClick={() => window.open(deviceModal.verificationUri, "_blank")}
            className="mt-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium"
          >
            {i18nT("common.openRegistrationPage", undefined, "Open Registration Page")}
          </button>
          <div className="flex items-center gap-1 mt-2 text-xs text-[var(--text-muted)]">
            <Icon path={mdiLoading} size={0.45} className="animate-spin" />
            {i18nT("status.waitingForAuthorization", undefined, "Waiting for authorization…")}
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
          <Icon path={mdiAlert} size={0.45} />
          {error}
        </div>
      )}
    </div>
  );
}

// ── API Key Row ──────────────────────────────────────────────────────────────

function ApiKeyRow({ provider, onChanged, showToast }: { provider: ProviderAuthStatus; onChanged: () => void; showToast: (text: string, variant?: ToastVariant) => void }) {
  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    if (!keyValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${getApiBase()}/api/provider-auth/api-key`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: provider.id, key: keyValue.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setEditing(false);
      setKeyValue("");
      onChanged();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  };

  // Remove key is a synchronous REST delete — confirm:"http" + success toast.
  // See change: add-async-action-feedback.
  const remove = useAsyncAction(
    () => deleteProvider(provider.id, "Failed to remove key"),
    { showToast, successToast: `Removed ${provider.name} key`, onSuccess: onChanged },
  );

  return (
    <div className="flex flex-col gap-1 p-3 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)]">{provider.name}</div>
        </div>
        {provider.authenticated && !editing ? (
          <div className="flex items-center gap-2">
            {provider.maskedKey && (
              <code className="text-xs text-[var(--text-muted)] font-mono">{provider.maskedKey}</code>
            )}
            <span className="flex items-center gap-1 text-xs text-green-400">
              <Icon path={mdiCheck} size={0.5} /> {i18nT("common.configured", undefined, "Configured")}
            </span>
            <button
              onClick={remove.bind.onClick}
              disabled={busy || remove.pending}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-secondary)] disabled:opacity-50"
            >
              <Icon path={mdiDelete} size={0.5} />
              {remove.pending ? "Removing…" : "Remove"}
            </button>
          </div>
        ) : !editing ? (
          <button
            onClick={() => setEditing(true)}
            className="px-3 py-1.5 text-xs rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
          >
            <Icon path={mdiKeyPlus} size={0.45} className="inline mr-0.5" />{i18nT("common.addKey", undefined, "Add Key")}
          </button>
        ) : null}
      </div>

      {editing && (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder={i18nT("gateway.pasteApiKey", undefined, "Paste API key…")}
            className="flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); }}
            autoFocus
          />
          <button onClick={handleSave} disabled={busy || !keyValue.trim()} className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            <Icon path={mdiContentSave} size={0.5} />
            {i18nT("common.save2", undefined, "Save")}
          </button>
          <button onClick={() => { setEditing(false); setKeyValue(""); }} className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
          <Icon path={mdiAlert} size={0.45} />
          {error}
        </div>
      )}
    </div>
  );
}
