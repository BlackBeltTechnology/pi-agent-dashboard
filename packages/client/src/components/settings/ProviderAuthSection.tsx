/**
 * Provider Authentication section for Settings panel — the CONNECTED LIST.
 *
 * One list of everything credentialed, merged from two independent sources
 * keyed by (source, id) — `auth` rows from GET /api/provider-auth/status and
 * `custom` rows from GET /api/providers — and badged by credential KIND
 * (Subscription / API key / Environment / Custom endpoint). The provider
 * catalogue is never rendered: the Add-provider dialog is the single entry
 * point for anything unconfigured.
 *
 * The section OWNS every flow (design D4): one GET /flow/:flowId poll per
 * flow — its timer and failure budget keyed per provider here, NOT in the
 * dialog — closing the dialog unmounts presentation, never an in-flight flow,
 * and a flow completing (or being refused) after dismissal still lands on this
 * section's handleChanged.
 *
 * Invariants preserved from the pre-redesign structure:
 *   - `handleChanged` is the SINGLE dispatch funnel for PROVIDER_AUTH_EVENT —
 *     exactly one event per successful write, from any control; never
 *     dispatched from `refresh` (a mount must not look like a write).
 *   - every flow's poll aborts after 3 consecutive failed responses — the
 *     old device-code poll's "no budget" asymmetry is unified away.
 *   - a failed or malformed status renders an inline error + Retry and never
 *     reaches an ErrorBoundary.
 *   - the AnthropicPeerHint post-install latch.
 *
 * See changes: redesign-providers-settings-page, fix-corrupt-auth-json-500,
 * dispatch-provider-auth-event, warn-missing-anthropic-messages-peer.
 */

import type { OAuthFlowStatus, ProviderAuthStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import {
  mdiAlert,
  mdiCheck,
  mdiClockOutline,
  mdiContentSave,
  mdiDelete,
  mdiKeyPlus,
  mdiLoading,
  mdiLogout,
  mdiPencil,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ANTHROPIC_PEER_SOURCE,
  IMPORT_FAILURE_PREFIX,
  useAnthropicPeerProbe,
} from "../../hooks/useAnthropicPeerProbe.js";
import { useAsyncAction } from "../../hooks/useAsyncAction.js";
import { usePackageOperations } from "../../hooks/usePackageOperations.js";
import { PROVIDER_AUTH_EVENT } from "../../hooks/useProvidersReady.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { type ProviderHealth, testProvider } from "../../lib/api/providers-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { logRejection } from "../../lib/report-error.js";
import { InlineMessage } from "../primitives/InlineMessage.js";
import { Toast, type ToastVariant, useToast } from "../primitives/Toast.js";
import {
  API_TYPE_OPTIONS,
  ProviderAddDialog,
  type AddDialogFlowState,
  type CustomEndpointInput,
  countSelectable,
  isConfiguredRow,
} from "./ProviderAddDialog.js";
import { derivePillView, ProviderHealthPill, type LiveTestResult } from "./ProviderHealthPill.js";

// ── Fetch helpers ────────────────────────────────────────────────────────────

/** Consecutive malformed/non-ok poll responses tolerated before an auth-code login aborts. */
const POLL_MAX_CONSECUTIVE_FAILURES = 3;

/** Delay before the single post-write health reconcile read (F10). */
const HEALTH_RECONCILE_DELAY_MS = 2000;

/**
 * Fail closed on BOTH failure classes — a non-ok response and a body that is
 * not an array — instead of feeding a Fastify error envelope (or any object)
 * into `statuses.filter(...)`, which white-screened the whole Settings panel
 * on a corrupt auth.json. See change: fix-corrupt-auth-json-500.
 */
async function fetchStatus(): Promise<ProviderAuthStatus[]> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/status`);
  if (!res.ok) {
    throw new Error(i18nT("err.providerAuthStatusHttp", undefined, `Provider status request failed (${res.status}).`));
  }
  const data: unknown = await res.json();
  // Array.isArray accepts [null] — and a null item would still crash the
  // rows' property access at render. Validate the items too.
  if (!Array.isArray(data) || !data.every((s) => s !== null && typeof s === "object")) {
    throw new Error(i18nT("err.providerAuthStatusShape", undefined, "Provider status response was malformed."));
  }
  return data;
}

/** The redacted custom-endpoint map + cached health from GET /api/providers. */
interface ProvidersPayload {
  providers: Record<string, { baseUrl?: string; apiKey?: string; api?: string; apiKeyResolved?: boolean }>;
  health: Record<string, ProviderHealth>;
}

async function fetchProviders(): Promise<ProvidersPayload> {
  const res = await fetch(`${getApiBase()}/api/providers`);
  if (!res.ok) {
    throw new Error(i18nT("err.providersListHttp", undefined, `Provider list request failed (${res.status}).`));
  }
  const data: any = await res.json();
  if (!data || typeof data !== "object" || !data.providers || typeof data.providers !== "object") {
    throw new Error(i18nT("err.providersListShape", undefined, "Provider list response was malformed."));
  }
  return {
    providers: data.providers,
    health: data.health && typeof data.health === "object" ? data.health : {},
  };
}

/** D5 — whether a bridge has pushed a provider catalogue since the last disconnect. */
async function fetchCatalogueReady(): Promise<boolean> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/catalogue-ready`);
  if (!res.ok) throw new Error(`catalogue-ready ${res.status}`);
  const data: any = await res.json();
  return data?.ready === true;
}

/** DELETE a provider credential, surfacing the backend error detail on failure. */
async function deleteProvider(id: string, fallback: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(conflictMessage(body) || (body && typeof body.error === "string" ? body.error : null) || fallback);
  }
}

/** PUT an api-key credential. Returns the inline error message, or null on success. */
async function putApiKey(id: string, key: string): Promise<string | null> {
  const res = await fetch(`${getApiBase()}/api/provider-auth/api-key`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ provider: id, key }),
  });
  if (res.ok) return null;
  const body = await res.json().catch(() => null);
  return conflictMessage(body) || (body && typeof body.error === "string" ? body.error : null) || i18nT("err.apiKeyWriteFailed", undefined, "Failed to save the API key.");
}

/** PATCH a single custom endpoint (upsert). Returns the inline error message, or null. */
async function patchCustomProvider(name: string, body: { baseUrl?: string; apiKey?: string; api?: string }): Promise<string | null> {
  const res = await fetch(`${getApiBase()}/api/providers/${encodeURIComponent(name)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.ok) return null;
  const data = await res.json().catch(() => null);
  return conflictMessage(data) || (data && typeof data.error === "string" ? data.error : null) || i18nT("err.customProviderWriteFailed", undefined, `Failed to save ${name}.`);
}

/** DELETE a single custom endpoint. Returns the inline error message, or null. */
async function deleteCustomProvider(name: string): Promise<string | null> {
  const res = await fetch(`${getApiBase()}/api/providers/${encodeURIComponent(name)}`, { method: "DELETE" });
  if (res.ok) return null;
  const data = await res.json().catch(() => null);
  return conflictMessage(data) || (data && typeof data.error === "string" ? data.error : null) || i18nT("err.customProviderDeleteFailed", undefined, `Failed to remove ${name}.`);
}

/**
 * Translate the server's cross-type refusal (X1) into the localized message.
 * X15: the code `provider_auth.credential_type_conflict` carries an i18n key
 * in every shipped locale — the raw English `error` never renders for it.
 */
function conflictMessage(body: any): string | null {
  if (!body || body.code !== "provider_auth.credential_type_conflict") return null;
  const storedType = typeof body.vars?.storedType === "string" ? body.vars.storedType : "";
  return i18nT(
    "err.provider_auth.credential_type_conflict",
    { storedType },
    "A credential of a different type ({storedType}) is already stored for this provider — remove it first.",
  );
}

// ── Projection ───────────────────────────────────────────────────────────────

/** The four badge kinds (D1). */
type RowKind = "subscription" | "api-key" | "environment" | "custom-endpoint";

function authRowKind(row: ProviderAuthStatus): RowKind {
  if (row.flowType !== "api_key") return "subscription";
  // ONLY ambient or an environment-sourced credential earns Environment, and
  // only while no stored key takes precedence (stored beats ambient).
  if ((row.ambient === true || row.source === "environment") && !row.maskedKey) return "environment";
  return "api-key";
}

/**
 * E8 — a custom endpoint counts as configured when its stored key is non-empty
 * AND is not an UNRESOLVED `$NAME` environment reference. A resolved reference
 * IS listed; the key stays a reference (the redacted read passes `$`-refs
 * through verbatim, so sending it back preserves it).
 *
 * Resolution is decided in the SERVER's environment: when the read annotates a
 * `$NAME` entry with `apiKeyResolved` (present ONLY for `$`-refs), that signal
 * is authoritative. Only when the annotation is absent (older server) does the
 * conservative fallback apply — and in a browser, where no environment oracle
 * exists, an unannotated reference is treated as unresolved and stays
 * unlisted: an entry whose key cannot be resolved must not be presented as
 * usable.
 */
export function customEndpointConfigured(entry: { baseUrl?: string; apiKey?: string; api?: string; apiKeyResolved?: boolean } | undefined): boolean {
  const key = entry?.apiKey ?? "";
  if (!key) return false;
  if (!key.startsWith("$")) return true;
  if (typeof entry?.apiKeyResolved === "boolean") return entry.apiKeyResolved;
  const varName = key.slice(1);
  if (!varName) return false;
  if (typeof process === "undefined" || !process.env) return false;
  return process.env[varName] !== undefined && process.env[varName] !== "";
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

export function ProviderAuthSection({ onCredentialsChanged }: {
  /**
   * Fired after a credential write lands (API-key save/removal, custom-endpoint
   * write, OAuth or device-code completion) so the owner can refetch the model
   * catalogue. See change: settings-default-model-without-session.
   */
  onCredentialsChanged?: () => void;
} = {}) {
  const [statuses, setStatuses] = useState<ProviderAuthStatus[]>([]);
  // Set when fetchStatus fails (non-ok, non-array, network). The section stays
  // mounted and interactive — the inline error carries a Retry so credentials
  // remain repairable from this state, and a failure of THIS source must not
  // hide custom-endpoint rows (X7). See change: fix-corrupt-auth-json-500.
  const [statusError, setStatusError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProvidersPayload>({ providers: {}, health: {} });
  // X8 — the inverse per-source degradation: a failed /api/providers read must
  // not hide credential rows.
  const [providersError, setProvidersError] = useState<string | null>(null);
  // D5 — null means "unknown" (no response yet, or the read failed): fail open,
  // consistent with the section's posture toward secondary signals.
  const [catalogueReady, setCatalogueReady] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  // undefined = closed · null = picker · string = the selected provider's pane
  // (or the custom-endpoint sentinel).
  const [dialogProvider, setDialogProvider] = useState<string | null | undefined>(undefined);
  // D4 — section-owned flow state, keyed per provider. Two concurrent flows
  // never share a timer or a failure counter (F3).
  const [flows, setFlows] = useState<Record<string, AddDialogFlowState>>({});
  const flowsTimersRef = useRef(new Map<string, { interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout>; failures: number }>());
  // F10 — names with a write in flight whose detached probe has not landed.
  // The ref mirrors the state so the reconcile timer's failure path can name
  // the entries whose cached health must drop without a stale closure.
  const [pendingHealth, setPendingHealth] = useState<Set<string>>(new Set());
  const pendingHealthRef = useRef<Set<string>>(new Set());
  const addPendingHealth = useCallback((name: string) => {
    pendingHealthRef.current = new Set(pendingHealthRef.current).add(name);
    setPendingHealth(pendingHealthRef.current);
  }, []);
  const clearPendingHealth = useCallback(() => {
    pendingHealthRef.current = new Set();
    setPendingHealth(new Set());
  }, []);
  const reconcileTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const { messages, showToast, dismissToast } = useToast();
  // One probe read for the whole section — per-row hooks would fan out one
  // /api/health fetch per provider. See change: warn-missing-anthropic-messages-peer.
  const { peerMissing, peerReason } = useAnthropicPeerProbe();

  const refetchProviders = useCallback(async () => {
    try {
      const data = await fetchProviders();
      setProviders(data);
      setProvidersError(null);
    } catch (err: any) {
      setProvidersError(err?.message || i18nT("err.providersListUnknown", undefined, "The custom-endpoint list is unavailable."));
    }
  }, []);

  const refresh = useCallback(async () => {
    // Each source degrades independently (X7/X8): one failure never hides the
    // other source's rows.
    const statusPromise = fetchStatus()
      .then((data) => {
        setStatuses(data);
        setStatusError(null);
      })
      .catch((err: any) => {
        setStatusError(err?.message || i18nT("err.providerAuthStatusUnknown", undefined, "Provider status is unavailable."));
      });
    const providersPromise = refetchProviders();
    const readyPromise = fetchCatalogueReady()
      .then((ready) => setCatalogueReady(ready))
      .catch(() => setCatalogueReady(null));
    await Promise.all([statusPromise, providersPromise, readyPromise]);
    setLoading(false);
  }, [refetchProviders]);

  // Row-level credential change: dispatch the readiness hint, refresh this
  // section AND notify the owner. Deliberately NOT folded into `refresh`,
  // which also runs on mount — a mount must not look like a credential write.
  // The SINGLE dispatch funnel: every successful write from every control
  // lands here, exactly one event per write (F9). The event carries no
  // payload: it is a hint to refetch, never a claim that the credential count
  // changed. See change: dispatch-provider-auth-event.
  const handleChanged = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PROVIDER_AUTH_EVENT));
    void refresh().catch(logRejection("ProviderAuthSection.refresh"));
    onCredentialsChanged?.();
  }, [refresh, onCredentialsChanged]);

  // ── F10 — exactly ONE health read ~2 s after a custom-endpoint write ───────
  const scheduleHealthReconcile = useCallback(() => {
    const timer = setTimeout(() => {
      reconcileTimersRef.current = reconcileTimersRef.current.filter((t) => t !== timer);
      void fetchProviders()
        .then((data) => {
          setProviders(data);
          clearPendingHealth();
        })
        .catch(() => {
          // The reconcile read failed: the just-written entries' cached health
          // is unknown — drop it to not-tested rather than show a stale pill.
          const stale = pendingHealthRef.current;
          setProviders((p) => {
            const nextHealth = { ...p.health };
            for (const name of stale) delete nextHealth[name];
            return { ...p, health: nextHealth };
          });
          clearPendingHealth();
        });
    }, HEALTH_RECONCILE_DELAY_MS);
    reconcileTimersRef.current.push(timer);
  }, []);

  // ── Flow completion / failure (section-owned, D4) ──────────────────────────
  /** Clear one flow's poll interval + timeout cap; the timers ref stays the single owner. */
  const stopFlowTimers = useCallback((id: string) => {
    const entry = flowsTimersRef.current.get(id);
    if (entry) {
      if (entry.interval) clearInterval(entry.interval);
      if (entry.timeout) clearTimeout(entry.timeout);
      flowsTimersRef.current.delete(id);
    }
  }, []);

  const finishFlow = useCallback((id: string) => {
    stopFlowTimers(id);
    setFlows((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    // A completion closes the dialog (the provider is now configured — the
    // picker entry is gone) and lands the single dispatch.
    setDialogProvider(undefined);
    handleChanged();
  }, [handleChanged, stopFlowTimers]);

  const failFlow = useCallback((id: string, error: string) => {
    stopFlowTimers(id);
    setFlows((prev) => ({ ...prev, [id]: { phase: "error", error } }));
  }, [stopFlowTimers]);

  // Unmount (leaving the page) still ends every flow — the abandoned-dialog
  // guarantee is scoped to DIALOG dismissal, not navigation (D4).
  useEffect(() => () => {
    for (const entry of flowsTimersRef.current.values()) {
      if (entry.interval) clearInterval(entry.interval);
      if (entry.timeout) clearTimeout(entry.timeout);
    }
    flowsTimersRef.current.clear();
    for (const timer of reconcileTimersRef.current) clearTimeout(timer);
  }, []);

  // ── Flow starter, poll, input, cancel (ONE of each — the server's
  //    /start + /flow contract replaced the auth-code/device-code pair) ──────

  /**
   * Start a sign-in flow (POST /start) and poll it to a terminal state. A
   * non-ok start (400 unknown provider / 500 failed before any step / 504
   * provider did not respond) is a TERMINAL pane error — no poll begins.
   */
  const startFlow = useCallback(async (id: string, enterpriseDomain?: string) => {
    setFlows((prev) => ({ ...prev, [id]: { phase: "starting" } }));
    let flowId: string;
    try {
      const res = await fetch(`${getApiBase()}/api/provider-auth/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: id, enterpriseDomain: enterpriseDomain || undefined }),
      });
      const data = (await res.json().catch(() => null)) as (OAuthFlowStatus & { error?: string }) | null;
      if (!res.ok || !data?.flowId) {
        throw new Error(data?.error || i18nT("err.authCodeStartFailed", undefined, "Failed to start the sign-in."));
      }
      flowId = data.flowId;
      // The server opens the system browser on the first authUrl; the poll
      // below OBSERVES the flow snapshot to a terminal state.
      setFlows((prev) => ({ ...prev, [id]: { phase: "waiting", status: data } }));
    } catch (err: any) {
      failFlow(id, err?.message ?? i18nT("err.authCodeStartFailed", undefined, "Failed to start the sign-in."));
      return;
    }

    const entry: { interval?: ReturnType<typeof setInterval>; timeout?: ReturnType<typeof setTimeout>; failures: number } = { failures: 0 };
    flowsTimersRef.current.set(id, entry);
    const stop = () => stopFlowTimers(id);

    entry.interval = setInterval(async () => {
      if (!flowsTimersRef.current.has(id)) return; // stopped — drop the in-flight tick
      try {
        const statusRes = await fetch(`${getApiBase()}/api/provider-auth/flow/${encodeURIComponent(flowId)}`);
        if (statusRes.status === 404) {
          // The flow is gone server-side (invalid/expired) — no budget recovers it.
          const body = await statusRes.json().catch(() => null);
          stop();
          failFlow(id, body?.error || i18nT("providers.authExpired", undefined, "Authorization expired"));
          return;
        }
        if (!statusRes.ok) throw new Error(`provider-auth flow ${statusRes.status}`);
        const status: OAuthFlowStatus = await statusRes.json();
        entry.failures = 0;
        // Keep the pane's snapshot current — never resurrect a flow that
        // already reached a terminal local state.
        setFlows((prev) => (prev[id]?.phase === "waiting" ? { ...prev, [id]: { phase: "waiting", status } } : prev));
        if (status.status === "complete") {
          stop();
          finishFlow(id);
        } else if (status.status === "error") {
          stop();
          failFlow(id, status.error || i18nT("providers.authExpired", undefined, "Authorization expired"));
        } else if (status.status === "expired") {
          stop();
          failFlow(id, i18nT("providers.authExpired", undefined, "Authorization expired"));
        }
      } catch {
        // Transient failures keep polling (a mid-login /api/restart must not
        // kill an in-flight login). Budget note: this is the UNIFIED budget —
        // the old device-code poll deliberately had none; every flow now ends
        // after POLL_MAX_CONSECUTIVE_FAILURES instead of silently waiting for
        // the 5-minute cap.
        entry.failures += 1;
        if (entry.failures >= POLL_MAX_CONSECUTIVE_FAILURES) {
          stop();
          failFlow(id, i18nT("providers.pollLostContact", undefined, "Lost contact with the dashboard while signing in — please try again."));
        }
      }
    }, 2000);

    // Stop polling after 5 minutes (matches callback server timeout)
    entry.timeout = setTimeout(() => {
      stop();
      failFlow(id, i18nT("providers.loginTimedOut", undefined, "Login timed out. Please try again."));
    }, 5 * 60 * 1000);
  }, [failFlow, finishFlow, stopFlowTimers]);

  /** POST one prompt answer into a live flow (manual_code / text / select). */
  const sendFlowInput = useCallback(async (flowId: string, value: string): Promise<void> => {
    // Fire-and-forget: 409 (no input pending), 404 (gone) and network errors
    // stay silent — the poll is the source of truth and renders the flow's
    // real state within one 2 s tick.
    await fetch(`${getApiBase()}/api/provider-auth/flow/${encodeURIComponent(flowId)}/input`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });
  }, []);

  /** Cancel a pending flow: DELETE it server-side, stop its poll, back to the picker. */
  const cancelFlow = useCallback(async (id: string, flowId: string) => {
    stopFlowTimers(id);
    try {
      // 204 or 404 both end the flow locally — best-effort against the server.
      await fetch(`${getApiBase()}/api/provider-auth/flow/${encodeURIComponent(flowId)}`, { method: "DELETE" });
    } catch {
      // The flow expires server-side on its own; the local state is cleared regardless.
    }
    setFlows((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setDialogProvider(null); // return to the picker
  }, [stopFlowTimers]);

  // ── Write paths (every success funnels into handleChanged) ────────────────

  /** Dialog/row api-key save. Returns the inline error, or null on success. */
  const saveApiKey = useCallback(async (id: string, key: string): Promise<string | null> => {
    const failure = await putApiKey(id, key);
    if (failure) return failure;
    setDialogProvider(undefined);
    handleChanged();
    return null;
  }, [handleChanged]);

  /** Dialog custom-endpoint create. Returns the inline error, or null. */
  const saveCustomEndpoint = useCallback(async (input: CustomEndpointInput): Promise<string | null> => {
    const failure = await patchCustomProvider(input.name, { baseUrl: input.baseUrl, apiKey: input.apiKey, api: input.api });
    if (failure) return failure;
    // Optimistic upsert; the ~2 s reconcile read is what lands the pill (F10).
    setProviders((prev) => ({
      ...prev,
      providers: { ...prev.providers, [input.name]: { baseUrl: input.baseUrl, apiKey: input.apiKey, api: input.api } },
    }));
    addPendingHealth(input.name);
    scheduleHealthReconcile();
    setDialogProvider(undefined);
    handleChanged();
    return null;
  }, [handleChanged, scheduleHealthReconcile, addPendingHealth]);

  /** Row Edit save for an existing custom endpoint (name immutable — D3). */
  const updateCustomEndpoint = useCallback(async (name: string, input: { baseUrl: string; apiKey: string; api: string }): Promise<string | null> => {
    const failure = await patchCustomProvider(name, input);
    if (failure) return failure;
    setProviders((prev) => ({
      ...prev,
      providers: { ...prev.providers, [name]: { ...prev.providers[name], ...input } },
    }));
    addPendingHealth(name);
    scheduleHealthReconcile();
    handleChanged();
    return null;
  }, [handleChanged, scheduleHealthReconcile, addPendingHealth]);

  /** Row Remove for a custom endpoint. */
  const [removingCustom, setRemovingCustom] = useState<string | null>(null);
  const removeCustomEndpoint = useCallback(async (name: string) => {
    setRemovingCustom(name);
    try {
      const failure = await deleteCustomProvider(name);
      if (failure) {
        showToast(failure, "error");
        return;
      }
      setProviders((prev) => {
        const nextProviders = { ...prev.providers };
        delete nextProviders[name];
        const nextHealth = { ...prev.health };
        delete nextHealth[name];
        return { providers: nextProviders, health: nextHealth };
      });
      handleChanged();
      showToast(i18nT("providers.customRemoved", undefined, "Provider removed"), "success");
    } finally {
      setRemovingCustom(null);
    }
  }, [handleChanged, showToast]);

  useEffect(() => { void refresh().catch(logRejection("ProviderAuthSection.refresh")); }, [refresh]);

  if (loading) {
    return <div className="text-[var(--text-muted)] text-sm py-2">{i18nT("providers.loadingProviderStatus", undefined, "Loading provider status…")}</div>;
  }

  // ── List projection ──────────────────────────────────────────────────────
  const configuredAuthRows = statuses.filter(isConfiguredRow);
  const customRows = Object.entries(providers.providers)
    .filter(([, entry]) => customEndpointConfigured(entry))
    .map(([name, entry]) => ({ name, entry }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const hasRows = configuredAuthRows.length > 0 || customRows.length > 0;
  const catalogueUnavailable = catalogueReady === false;

  const selectableCount = countSelectable(statuses);

  return (
    <div className="space-y-4">
      <Toast messages={messages} onDismiss={dismissToast} />

      {/* Add-provider — the single entry point (provider-add-flow) */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          data-testid="add-provider-button"
          onClick={() => setDialogProvider(null)}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-[var(--accent-primary-strong)] hover:brightness-110 text-white font-medium"
        >
          <Icon path={mdiKeyPlus} size={0.5} />
          {i18nT("providers.addProviderAction", undefined, "Add provider")}
          <span data-testid="add-provider-count" className="opacity-80 font-normal">
            {i18nT("providers.availableCount", { count: selectableCount }, `${selectableCount} available`)}
          </span>
        </button>
      </div>

      {/* X7 — a failed/malformed status renders inline, never an ErrorBoundary,
          and never hides the custom-endpoint source below. */}
      {statusError && (
        <InlineMessage
          severity="error"
          icon={mdiAlert}
          testId="provider-auth-status-error"
          title={statusError}
          actions={
            <button
              type="button"
              onClick={() => void refresh().catch(logRejection("ProviderAuthSection.refresh"))}
              className="focus-ring px-2 py-1 text-[11px] rounded border border-current bg-transparent disabled:opacity-60"
            >
              {i18nT("common.retry", undefined, "Retry")}
            </button>
          }
        />
      )}

      {/* X8 — the inverse per-source error, scoped beside the credential rows. */}
      {providersError && (
        <InlineMessage
          severity="error"
          icon={mdiAlert}
          testId="providers-list-error"
          title={providersError}
          actions={
            <button
              type="button"
              onClick={() => void refetchProviders()}
              className="focus-ring px-2 py-1 text-[11px] rounded border border-current bg-transparent disabled:opacity-60"
            >
              {i18nT("common.retry", undefined, "Retry")}
            </button>
          }
        />
      )}

      {/* D4/X6 — a flow that failed after the dialog closed renders HERE. */}
      {Object.entries(flows).filter(([, f]) => f.phase === "error").map(([id, f]) => {
        const name = statuses.find((s) => s.id === id)?.name ?? id;
        return (
          <InlineMessage
            key={`flow-error-${id}`}
            severity="error"
            icon={mdiAlert}
            testId="provider-flow-error"
            title={`${name}: ${f.error ?? ""}`}
          />
        );
      })}

      {/* D5/F7 — catalogue unavailable is a per-source notice, never a
          replacement for the list, and the empty state is suppressed. */}
      {catalogueUnavailable && (
        <InlineMessage
          severity="warning"
          icon={mdiAlert}
          testId="catalogue-unavailable-notice"
          title={i18nT("providers.catalogueUnavailableTitle", undefined, "API-key provider list unavailable.")}
        >
          <div>
            {i18nT(
              "providers.catalogueUnavailableBody",
              undefined,
              "No pi session is connected, so providers configured by API key or environment may be missing from this list — it may be out of date. Subscriptions are unaffected.",
            )}
          </div>
        </InlineMessage>
      )}

      {/* The connected list */}
      {hasRows ? (
        <div className="space-y-2">
          {configuredAuthRows.map((p) => (
            <AuthRow
              key={`auth:${p.id}`}
              provider={p}
              kind={authRowKind(p)}
              onChanged={handleChanged}
              showToast={showToast}
              peerMissing={p.id === "anthropic" && peerMissing}
              peerReason={peerReason}
              onEditKey={saveApiKey}
            />
          ))}
          {customRows.map(({ name, entry }) => (
            <CustomEndpointRow
              key={`custom:${name}`}
              name={name}
              entry={entry}
              health={providers.health[name]}
              pending={pendingHealth.has(name)}
              onTest={testProvider}
              onUpdate={updateCustomEndpoint}
              onRemove={() => void removeCustomEndpoint(name).catch(logRejection("ProviderAuthSection.removeCustomEndpoint"))}
              removePending={removingCustom === name}
            />
          ))}
        </div>
      ) : !statusError && !providersError && !catalogueUnavailable ? (
        <div className="p-6 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)] text-center" data-testid="providers-empty">
          <div className="text-sm font-medium text-[var(--text-primary)]">{i18nT("providers.emptyTitle", undefined, "No providers configured")}</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">
            {i18nT("providers.emptyBody", undefined, "pi needs at least one provider credential before it can run a model.")}
          </div>
        </div>
      ) : null}

      <ProviderAddDialog
        providerId={dialogProvider}
        statuses={statuses}
        flows={flows}
        onClose={() => setDialogProvider(undefined)}
        onSelectProvider={(id) => setDialogProvider(id)}
        onStartFlow={(id, domain) => void startFlow(id, domain).catch(logRejection("ProviderAuthSection.startFlow"))}
        onSendInput={sendFlowInput}
        onCancelFlow={(id, flowId) => void cancelFlow(id, flowId).catch(logRejection("ProviderAuthSection.cancelFlow"))}
        onSaveApiKey={saveApiKey}
        onSaveCustomEndpoint={saveCustomEndpoint}
      />
    </div>
  );
}

// ── Auth rows (subscription / api-key / environment) ─────────────────────────

function AuthRow({ provider, kind, onChanged, showToast, peerMissing = false, peerReason, onEditKey }: {
  provider: ProviderAuthStatus;
  kind: RowKind;
  onChanged: () => void;
  showToast: (text: string, variant?: ToastVariant) => void;
  peerMissing?: boolean;
  peerReason?: string;
  onEditKey: (id: string, key: string) => Promise<string | null>;
}) {
  const [editing, setEditing] = useState(false);
  const [keyValue, setKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveEditedKey = async () => {
    if (!keyValue.trim()) return;
    setSaving(true);
    setError(null);
    const failure = await onEditKey(provider.id, keyValue.trim());
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setEditing(false);
    setKeyValue("");
  };

  // Sign-out / key-removal are synchronous REST deletes — confirm:"http" +
  // success toast. See change: add-async-action-feedback.
  const signOut = useAsyncAction(
    () => deleteProvider(provider.id, "Failed to sign out"),
    { showToast, successToast: i18nT("providers.signedOut", { name: provider.name }, `Signed out of ${provider.name}`), onSuccess: onChanged },
  );
  const remove = useAsyncAction(
    () => deleteProvider(provider.id, "Failed to remove key"),
    { showToast, successToast: i18nT("providers.keyRemoved", { name: provider.name }, `Removed ${provider.name} key`), onSuccess: onChanged },
  );

  const badgeLabel = kind === "subscription"
    ? i18nT("providers.badgeSubscription", undefined, "Subscription")
    : kind === "environment"
      ? i18nT("providers.badgeEnvironment", undefined, "Environment")
      : i18nT("providers.badgeApiKey", undefined, "API key");

  return (
    <div className="flex flex-col gap-1 p-3 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)]" data-testid="provider-row" data-row-id={provider.id} data-row-source="auth">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">{provider.name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-secondary)]" data-testid="provider-badge">
              {badgeLabel}
            </span>
          </div>
          <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
            {/* expires === null is a PERMANENT credential (e.g. OpenRouter): it
                renders NO countdown and NO "expired" state, so the null
                check is explicit rather than truthy. */}
            {kind === "subscription" && provider.expires != null && (
              <>
                <Icon path={mdiClockOutline} size={0.45} />
                {relativeExpiry(provider.expires)}
              </>
            )}
            {kind === "environment" && (
              <span>
                {provider.envVar
                  ? i18nT("providers.fromEnvVar", { envVar: provider.envVar }, `from ${provider.envVar}`)
                  : i18nT("providers.ambientMechanism", undefined, "application default credentials · not stored by pi")}
              </span>
            )}
            {kind === "api-key" && provider.maskedKey && (
              <code className="font-mono">{provider.maskedKey}</code>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {kind === "subscription" && provider.authenticated && (
            <>
              <span className="flex items-center gap-1 text-xs text-green-400">
                <Icon path={mdiCheck} size={0.5} /> {i18nT("connection.connected", undefined, "Connected")}
              </span>
              <button
                onClick={signOut.bind.onClick}
                disabled={signOut.pending}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-secondary)] disabled:opacity-50"
              >
                <Icon path={mdiLogout} size={0.5} />
                {i18nT("common.signOut", undefined, "Sign Out")}
              </button>
            </>
          )}
          {kind === "api-key" && !editing && (
            <>
              <button
                onClick={() => setEditing(true)}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
              >
                <Icon path={mdiPencil} size={0.45} />
                {i18nT("common.edit", undefined, "Edit")}
              </button>
              <button
                onClick={remove.bind.onClick}
                disabled={remove.pending}
                className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-secondary)] disabled:opacity-50"
              >
                <Icon path={mdiDelete} size={0.5} />
                {i18nT("common.remove", undefined, "Remove")}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Key entry lives in exactly two places: the Add-provider dialog, and
          this Edit state (provider-auth-ui). Never at rest. */}
      {kind === "api-key" && editing && (
        <div className="flex items-center gap-2 mt-1">
          <input
            type="password"
            value={keyValue}
            onChange={(e) => setKeyValue(e.target.value)}
            placeholder={i18nT("gateway.pasteApiKey", undefined, "Paste API key…")}
            className="flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
            onKeyDown={(e) => { if (e.key === "Enter") void saveEditedKey().catch(logRejection("AuthRow.saveEditedKey")); }}
            autoFocus
          />
          <button onClick={() => void saveEditedKey()} disabled={saving || !keyValue.trim()} className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
            <Icon path={mdiContentSave} size={0.5} />
            {i18nT("common.save2", undefined, "Save")}
          </button>
          <button onClick={() => { setEditing(false); setKeyValue(""); }} className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
            {i18nT("common.cancel", undefined, "Cancel")}
          </button>
        </div>
      )}

      {/* Bridge peer hint — only on the authenticated Anthropic subscription row. */}
      <AnthropicPeerHint show={peerMissing && kind === "subscription" && provider.authenticated} reason={peerReason} />

      {error && (
        <div className="flex items-center gap-1 mt-1 text-xs text-red-400">
          <Icon path={mdiAlert} size={0.45} />
          {error}
        </div>
      )}
    </div>
  );
}

// ── Anthropic bridge-peer hint ───────────────────────────────────────────────

/**
 * Inline advisory under the Connected marker when the bridge's probe reports
 * the `@pi/anthropic-messages` peer unresolved. Copy leads with the next step,
 * not with a failure (the OAuth sign-in itself succeeded).
 *
 * See change: warn-missing-anthropic-messages-peer.
 */
function AnthropicPeerHint({ show, reason }: { show: boolean; reason?: string }) {
  const { install, statusFor, messageFor } = usePackageOperations("global", undefined);
  // Explicit latch: `statusFor(source) === "success"` auto-clears after 3 s and
  // would silently revert to the warning + Install button (D6b). Released when
  // the probe reports the peer resolving (i.e. `show` goes false).
  const [installed, setInstalled] = useState(false);
  const status = statusFor(ANTHROPIC_PEER_SOURCE);
  const message = messageFor(ANTHROPIC_PEER_SOURCE);

  useEffect(() => {
    if (status === "success") setInstalled(true);
  }, [status]);
  useEffect(() => {
    if (!show) setInstalled(false);
  }, [show]);

  if (!show) return null;

  if (installed) {
    return (
      <InlineMessage
        severity="info"
        icon={mdiCheck}
        testId="anthropic-peer-hint"
        title={i18nT("providers.anthropicPeerInstalled", undefined, "Peer installed — applies on the next pi session start")}
      />
    );
  }

  // An import failure means the package IS installed; installing again is wrong,
  // so both the control AND the copy switch away from "install this".
  const importFailed = typeof reason === "string" && reason.startsWith(IMPORT_FAILURE_PREFIX);
  const pending = status === "queued" || status === "running";

  return (
    <InlineMessage
      severity="warning"
      icon={mdiAlert}
      testId="anthropic-peer-hint"
      title={importFailed
        ? i18nT("providers.anthropicPeerImportFailedTitle", undefined, "The Anthropic peer package is installed but failed to load")
        : i18nT("providers.anthropicPeerMissingTitle", undefined, "One more step: install the Anthropic peer package")}
      actions={
        importFailed ? undefined : (
          <button
            type="button"
            onClick={() => install(ANTHROPIC_PEER_SOURCE)}
            disabled={pending}
            className="focus-ring px-2 py-1 text-[11px] rounded border border-current bg-transparent disabled:opacity-60"
          >
            {pending
              ? i18nT("common.installing", undefined, "Installing…")
              : i18nT("providers.installPeer", undefined, "Install peer")}
          </button>
        )
      }
    >
      <div>
        {importFailed
          ? i18nT("providers.anthropicPeerImportFailedBody", undefined, "Claude is connected, but the bridge could not import")
          : i18nT("providers.anthropicPeerMissingBody", undefined, "Claude is connected, but the bridge cannot resolve")}{" "}
        <code className="font-mono">@blackbelt-technology/pi-anthropic-messages</code>
        {i18nT(
          "providers.anthropicPeerMissingBody2",
          undefined,
          ", so flows stay in waiting_peers and tool calls fall back.",
        )}
      </div>
      {reason && <div className="mt-0.5 opacity-80">{reason}</div>}
      {message && <div className="mt-0.5 opacity-80">{message}</div>}
    </InlineMessage>
  );
}

// ── Custom-endpoint row ──────────────────────────────────────────────────────

function CustomEndpointRow({ name, entry, health, pending, onTest, onUpdate, onRemove, removePending }: {
  name: string;
  entry: { baseUrl?: string; apiKey?: string; api?: string };
  health?: ProviderHealth;
  /** A write just landed; its detached probe has not been reconciled yet. */
  pending: boolean;
  onTest: typeof testProvider;
  onUpdate: (name: string, input: { baseUrl: string; apiKey: string; api: string }) => Promise<string | null>;
  onRemove: () => void;
  removePending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [baseUrl, setBaseUrl] = useState(entry.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(entry.apiKey ?? "");
  const [api, setApi] = useState(entry.api || API_TYPE_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [live, setLive] = useState<LiveTestResult | null>(null);

  const canTest = baseUrl.trim().length > 0 && apiKey.trim().length > 0 && !testing;
  const runTest = async () => {
    if (!canTest) return;
    setTesting(true);
    // `***` is the masked sentinel — the server resolves the stored key for a
    // saved provider (provider-connection-test).
    const result = await onTest({ name, baseUrl: baseUrl.trim(), apiKey, api });
    setTesting(false);
    setLive(result.ok
      ? { ok: true, modelCount: result.modelCount }
      : { ok: false, status: result.status, error: result.error ?? "Test failed" });
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    const failure = await onUpdate(name, { baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), api });
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setEditing(false);
  };

  const view = derivePillView({ testing, live, pending, health });

  return (
    <div className="flex flex-col gap-1 p-3 rounded bg-[var(--bg-tertiary)] border border-[var(--border-primary)]" data-testid="provider-row" data-row-id={name} data-row-source="custom">
      <div className="flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-[var(--text-primary)]">{name}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border-secondary)] text-[var(--text-secondary)]" data-testid="provider-badge">
              {i18nT("providers.badgeCustom", undefined, "Custom endpoint")}
            </span>
            <ProviderHealthPill view={view} />
          </div>
          <div className="text-xs text-[var(--text-muted)]">
            <code className="font-mono">{entry.baseUrl}</code>
            {entry.api ? <> · {entry.api}</> : null}
          </div>
        </div>
        {!editing && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-secondary)]"
            >
              <Icon path={mdiPencil} size={0.45} />
              {i18nT("common.edit", undefined, "Edit")}
            </button>
            <button
              onClick={onRemove}
              disabled={removePending}
              className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] hover:bg-red-900/30 text-[var(--text-muted)] hover:text-red-400 border border-[var(--border-secondary)] disabled:opacity-50"
            >
              <Icon path={mdiDelete} size={0.5} />
              {i18nT("common.remove", undefined, "Remove")}
            </button>
          </div>
        )}
      </div>

      {/* Edit state: the name is NOT editable in place — a rename is a DELETE
          plus a PATCH upsert (the health cache is keyed by name, D3). */}
      {editing && (
        <div className="space-y-2 mt-1" data-testid="custom-endpoint-edit">
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            <span>{i18nT("providers.customName", undefined, "Name")}:</span>
            <span className="text-[var(--text-primary)] font-medium">{name}</span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => { setBaseUrl(e.target.value); setLive(null); }}
              placeholder="http://localhost:8000/v1"
              aria-label={i18nT("providers.customBaseUrl", undefined, "Base URL")}
              className="flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
            />
            <select
              value={api}
              onChange={(e) => { setApi(e.target.value); setLive(null); }}
              aria-label={i18nT("gateway.apiType", undefined, "API Type")}
              className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)]"
            >
              {API_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setLive(null); }}
              placeholder={i18nT("common.skOrEnvVarName", undefined, "sk-... or $ENV_VAR_NAME")}
              aria-label={i18nT("gateway.apiKey", undefined, "API Key")}
              className="flex-1 px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
            />
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={!canTest}
              title={!canTest && !testing
                ? i18nT("settings.baseUrlFirst", undefined, "Enter Base URL and API Key first")
                : i18nT("settings.pingModels", undefined, "Ping the provider's /models endpoint")}
              className="text-xs px-2 py-1 rounded bg-blue-600/20 text-blue-300 hover:bg-blue-600/30 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
            >
              {testing ? (
                <>
                  <Icon path={mdiLoading} size={0.45} className="animate-spin" />
                  {i18nT("common.testing", undefined, "Testing...")}
                </>
              ) : (
                i18nT("common.test", undefined, "Test")
              )}
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => void save()} disabled={saving} className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
              <Icon path={mdiContentSave} size={0.5} />
              {i18nT("common.save2", undefined, "Save")}
            </button>
            <button onClick={() => { setEditing(false); setBaseUrl(entry.baseUrl ?? ""); setApiKey(entry.apiKey ?? ""); setApi(entry.api || API_TYPE_OPTIONS[0].value); setLive(null); }} className="px-2 py-1 text-xs rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
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
