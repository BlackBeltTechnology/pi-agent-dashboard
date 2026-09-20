/**
 * The Add-provider dialog — picker + per-flowType panes.
 *
 * PRESENTATION ONLY (design D4): the providers SECTION owns every flow's poll
 * timers and the outcome of every write. Closing this dialog unmounts
 * presentation, never an in-flight flow; the section keeps polling and renders
 * the result (or a late refusal) on the connected list. Writes are reported
 * through async callbacks returning an inline error message (or null on
 * success — the section then closes the dialog and dispatches the single
 * credential-change notification).
 *
 * Picker membership: every provider NOT already configured, plus a pinned
 * Custom endpoint entry. Entries whose selection would overwrite a credential
 * of a different type under the same auth.json key render visible but
 * non-selectable, naming the remove-first path (suppression is a usability
 * layer over the server's write-path refusal, never the enforcement).
 *
 * See change: redesign-providers-settings-page.
 */
import { mdiArrowRight, mdiContentCopy, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useMemo, useState } from "react";
import type { DeviceCodeResponse, ProviderAuthStatus } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { SearchableSelectDialog, type SelectOption } from "../primitives/SearchableSelectDialog.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { testProvider } from "../../lib/api/providers-api.js";
import { derivePillView, ProviderHealthPill } from "./ProviderHealthPill.js";

/** API types a custom endpoint can speak (moved from the deleted LlmProviderCard). */
export const API_TYPE_OPTIONS = [
  { value: "openai-completions", label: "OpenAI Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "azure-openai-responses", label: "Azure OpenAI" },
  { value: "mistral-conversations", label: "Mistral" },
  { value: "bedrock-converse-stream", label: "AWS Bedrock" },
  { value: "google-generative-ai", label: "Google Gemini" },
  { value: "google-vertex", label: "Google Vertex AI" },
];

/** Section-owned flow state, mirrored into the pane for presentation. */
export interface AddDialogFlowState {
  phase: "starting" | "waiting" | "error";
  /** Authorization URL from POST /authorize — copyable fallback link. */
  authUrl?: string;
  /** Device-code payload from POST /device-code. */
  device?: DeviceCodeResponse;
  error?: string;
}

export interface CustomEndpointInput {
  name: string;
  baseUrl: string;
  apiKey: string;
  api: string;
}

export function isConfiguredRow(row: ProviderAuthStatus): boolean {
  // E9: an older server omits `configured` — a falsy filter would render an
  // empty list while credentials exist. Fall back to `authenticated`.
  return row.configured ?? row.authenticated;
}

interface PickerEntry {
  row: ProviderAuthStatus;
  suppressed: boolean;
  reason?: string;
}

/**
 * Cross-type suppression (design D2's usability layer). Two rows can resolve
 * to the same stored credential — an OAuth provider and its `<id>-api` twin —
 * so the entry whose selection would clobber the other type is suppressed:
 *   - an api_key row whose OAuth sibling holds a stored credential,
 *   - an OAuth row whose twin holds a STORED api key (ambient evidence is not
 *     a stored credential — the server refuses only stored-type conflicts).
 */
export function buildPickerEntries(statuses: ProviderAuthStatus[]): PickerEntry[] {
  const byId = new Map(statuses.map((s) => [s.id, s]));
  return statuses
    .filter((row) => !isConfiguredRow(row))
    .map((row) => {
      if (row.flowType === "api_key") {
        const siblingId = row.id.replace(/-api$/, "");
        const sibling = siblingId !== row.id ? byId.get(siblingId) : undefined;
        if (sibling && sibling.flowType !== "api_key" && isConfiguredRow(sibling)) {
          return {
            row,
            suppressed: true,
            reason: i18nT(
              "providers.pickerSuppressedBySubscription",
              { name: sibling.name },
              `Unavailable — ${sibling.name} is connected as a subscription. Sign out first to use a key instead.`,
            ),
          };
        }
      } else {
        const twin = byId.get(`${row.id}-api`);
        if (twin && twin.maskedKey) {
          return {
            row,
            suppressed: true,
            reason: i18nT(
              "providers.pickerSuppressedByKey",
              { name: row.name },
              `Unavailable — a stored API key for ${row.name} must be removed first to sign in.`,
            ),
          };
        }
      }
      return { row, suppressed: false };
    });
}

/** Number the Add-provider control names: selectable picker entries (E10). */
export function countSelectable(statuses: ProviderAuthStatus[]): number {
  return buildPickerEntries(statuses).filter((e) => !e.suppressed).length;
}

/** Sentinel id routed to the custom-endpoint pane instead of a status row. */
const CUSTOM_ENDPOINT_ID = "__custom__";

interface Props {
  /** Selected provider id, the custom-endpoint sentinel, or null for the picker. */
  providerId: string | null | undefined;
  statuses: ProviderAuthStatus[];
  /** Section-owned flow state keyed by provider id (presentation only reads). */
  flows: Record<string, AddDialogFlowState>;
  onClose: () => void;
  onSelectProvider: (id: string | null) => void;
  onStartAuthCode: (id: string) => void;
  onStartDeviceCode: (id: string, enterpriseDomain?: string) => void;
  /** Returns the inline error message, or null on success. */
  onSaveApiKey: (id: string, key: string) => Promise<string | null>;
  onSaveCustomEndpoint: (input: CustomEndpointInput) => Promise<string | null>;
}

export function ProviderAddDialog({
  providerId,
  statuses,
  flows,
  onClose,
  onSelectProvider,
  onStartAuthCode,
  onStartDeviceCode,
  onSaveApiKey,
  onSaveCustomEndpoint,
}: Props) {
  if (providerId === undefined) return null;
  const selected = providerId !== null ? statuses.find((s) => s.id === providerId) ?? null : null;
  return (
    <div data-testid="provider-add-dialog">
      {providerId === CUSTOM_ENDPOINT_ID ? (
        <CustomEndpointPane onClose={onClose} onBack={() => onSelectProvider(null)} onSave={onSaveCustomEndpoint} />
      ) : providerId !== null && !selected ? null : selected ? (
        <ProviderPane
          provider={selected}
          flows={flows}
          onClose={onClose}
          onBack={() => onSelectProvider(null)}
          onStartAuthCode={onStartAuthCode}
          onStartDeviceCode={onStartDeviceCode}
          onSaveApiKey={onSaveApiKey}
        />
      ) : (
        <ProviderPicker statuses={statuses} onClose={onClose} onSelect={(id) => onSelectProvider(id)} />
      )}
    </div>
  );
}

// ── Picker ───────────────────────────────────────────────────────────────────

function ProviderPicker({ statuses, onClose, onSelect }: {
  statuses: ProviderAuthStatus[];
  onClose: () => void;
  onSelect: (id: string) => void;
}) {
  const entries = useMemo(() => buildPickerEntries(statuses), [statuses]);
  const options: SelectOption[] = entries.map((e) => ({
    value: e.row.id,
    label: e.row.name,
    description: e.suppressed
      ? e.reason
      : e.row.flowType === "device_code"
        ? i18nT("providers.pickerDeviceSubtitle", undefined, "Sign in with a device code")
        : e.row.envVar
          ? i18nT("providers.pickerEnvSubtitle", { envVar: e.row.envVar }, `or set ${e.row.envVar}`)
          : undefined,
    badge: e.row.flowType === "api_key"
      ? i18nT("providers.badgeApiKey", undefined, "API key")
      : "OAuth",
    group: e.row.flowType === "api_key"
      ? i18nT("providers.groupApiKeys", undefined, "API keys")
      : i18nT("providers.groupSubscriptions", undefined, "Subscriptions"),
    disabled: e.suppressed || undefined,
    disabledReason: e.reason,
  }));
  // The pinned entry is offered with or without a catalogue, under any search.
  options.push({
    value: CUSTOM_ENDPOINT_ID,
    label: i18nT("providers.customEndpointEntry", undefined, "Custom endpoint…"),
    description: i18nT("providers.customEndpointSubtitle", undefined, "Any OpenAI- or Anthropic-compatible base URL"),
    pinned: true,
  });

  return (
    <SearchableSelectDialog
      title={i18nT("providers.addProviderTitle", undefined, "Add provider")}
      options={options}
      onSelect={onSelect}
      onCancel={onClose}
      placeholder={i18nT("providers.searchProviders", undefined, "Search providers…")}
    />
  );
}

// ── Pane shell ───────────────────────────────────────────────────────────────

function PaneShell({ title, onBack, onClose, children, footer }: {
  title: string;
  onBack: () => void;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Dialog open onClose={onClose} title={title} size="sm">
      {children}
      <div className="flex justify-end gap-2 pt-3">
        <button type="button" onClick={onBack} className="px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)]">
          {i18nT("common.back", undefined, "Back")}
        </button>
        {footer}
      </div>
    </Dialog>
  );
}

// ── Per-flowType dispatch ────────────────────────────────────────────────────

function ProviderPane({ provider, flows, onClose, onBack, onStartAuthCode, onStartDeviceCode, onSaveApiKey }: {
  provider: ProviderAuthStatus;
  flows: Record<string, AddDialogFlowState>;
  onClose: () => void;
  onBack: () => void;
  onStartAuthCode: (id: string) => void;
  onStartDeviceCode: (id: string, enterpriseDomain?: string) => void;
  onSaveApiKey: (id: string, key: string) => Promise<string | null>;
}) {
  if (provider.flowType === "api_key") {
    return <ApiKeyPane provider={provider} onClose={onClose} onBack={onBack} onSave={onSaveApiKey} />;
  }
  if (provider.flowType === "device_code") {
    return (
      <DeviceCodePane
        provider={provider}
        flow={flows[provider.id]}
        onBack={onBack}
        onClose={onClose}
        onStart={(domain) => onStartDeviceCode(provider.id, domain)}
      />
    );
  }
  return (
    <AuthCodePane
      provider={provider}
      flow={flows[provider.id]}
      onBack={onBack}
      onClose={onClose}
      onStart={() => onStartAuthCode(provider.id)}
    />
  );
}

// ── API-key pane ─────────────────────────────────────────────────────────────

function ApiKeyPane({ provider, onClose, onBack, onSave }: {
  provider: ProviderAuthStatus;
  onClose: () => void;
  onBack: () => void;
  onSave: (id: string, key: string) => Promise<string | null>;
}) {
  const [keyValue, setKeyValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [keyRequired, setKeyRequired] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!keyValue.trim()) {
      // Validate before writing: an empty key must not reach the API.
      setKeyRequired(true);
      return;
    }
    setKeyRequired(false);
    setBusy(true);
    setError(null);
    const failure = await onSave(provider.id, keyValue.trim());
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <PaneShell title={i18nT("providers.addKeyPaneTitle", { name: provider.name }, `Add ${provider.name}`)} onBack={onBack} onClose={onClose}
      footer={
        <button type="button" data-testid="dialog-submit" onClick={() => void submit()} disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
          {i18nT("providers.addProviderAction", undefined, "Add provider")}
        </button>
      }
    >
      <label htmlFor="provider-api-key-input" className="block text-xs text-[var(--text-secondary)] mb-1">
        {i18nT("gateway.apiKey", undefined, "API Key")}
      </label>
      <input
        id="provider-api-key-input"
        type="password"
        value={keyValue}
        onChange={(e) => { setKeyValue(e.target.value); setKeyRequired(false); }}
        placeholder="sk-…"
        autoComplete="off"
        className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
      />
      {keyRequired && (
        <div className="mt-1 text-xs text-red-400" data-testid="dialog-validation">
          {i18nT("providers.keyRequired", undefined, "An API key is required.")}
        </div>
      )}
      {provider.envVar && (
        <div className="mt-2 text-[11px] text-[var(--text-muted)]">
          {i18nT(
            "providers.envVarHint",
            { envVar: provider.envVar },
            `pi also reads ${provider.envVar} from the environment — set that instead to keep the key out of the file.`,
          )}
        </div>
      )}
      {error && (
        <div className="mt-2 text-xs text-red-400" data-testid="dialog-error">{error}</div>
      )}
    </PaneShell>
  );
}

// ── Auth-code pane ───────────────────────────────────────────────────────────

function AuthCodePane({ provider, flow, onBack, onClose, onStart }: {
  provider: ProviderAuthStatus;
  flow?: AddDialogFlowState;
  onBack: () => void;
  onClose: () => void;
  onStart: () => void;
}) {
  const waiting = flow?.phase === "starting" || flow?.phase === "waiting";
  return (
    <PaneShell title={i18nT("providers.signInPaneTitle", { name: provider.name }, `Sign in to ${provider.name}`)} onBack={onBack} onClose={onClose}>
      {!flow && (
        <>
          <p className="text-xs text-[var(--text-secondary)]">
            {i18nT("providers.authCodePaneBody", undefined, "A browser window will open to complete the sign-in. This dialog can be closed — the sign-in finishes in the background.")}
          </p>
          <button type="button" data-testid="dialog-sign-in" onClick={onStart}
            className="mt-3 px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium">
            {i18nT("common.signIn", undefined, "Sign In")}
          </button>
        </>
      )}
      {waiting && (
        <div className="space-y-2" data-testid="dialog-flow-waiting">
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-secondary)]">
            <Icon path={mdiLoading} size={0.5} className="animate-spin" />
            {i18nT("status.waitingForAuthorization", undefined, "Waiting for authorization…")}
          </div>
          {flow?.authUrl && (
            <div className="text-[11px] text-[var(--text-muted)] break-all">
              {i18nT("providers.authUrlFallback", undefined, "If the browser did not open, use this link:")}{" "}
              <a href={flow.authUrl} target="_blank" rel="noopener" className="underline break-all">{flow.authUrl}</a>
            </div>
          )}
        </div>
      )}
      {flow?.phase === "error" && (
        <div className="mt-2 text-xs text-red-400" data-testid="dialog-flow-error">{flow.error}</div>
      )}
    </PaneShell>
  );
}

// ── Device-code pane ─────────────────────────────────────────────────────────

function DeviceCodePane({ provider, flow, onBack, onClose, onStart }: {
  provider: ProviderAuthStatus;
  flow?: AddDialogFlowState;
  onBack: () => void;
  onClose: () => void;
  onStart: (domain?: string) => void;
}) {
  // GitHub Copilot prompts for an Enterprise domain BEFORE the flow starts.
  const [askingEnterprise, setAskingEnterprise] = useState(provider.id === "github-copilot");
  const [enterpriseDomain, setEnterpriseDomain] = useState("");
  const device: DeviceCodeResponse | undefined = flow?.device;

  if (!flow && askingEnterprise) {
    return (
      <PaneShell title={i18nT("providers.signInPaneTitle", { name: provider.name }, `Sign in to ${provider.name}`)} onBack={onBack} onClose={onClose}>
        <label htmlFor="provider-enterprise-domain" className="block text-xs text-[var(--text-secondary)] mb-1">
          {i18nT("providers.enterpriseDomainLabel", undefined, "GitHub Enterprise domain")}
        </label>
        <input
          id="provider-enterprise-domain"
          type="text"
          value={enterpriseDomain}
          onChange={(e) => setEnterpriseDomain(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { setAskingEnterprise(false); onStart(enterpriseDomain || undefined); } }}
          placeholder={i18nT("git.enterpriseDomainBlankForGithubCom", undefined, "Enterprise domain (blank for github.com)")}
          autoFocus
          className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
        />
        <div className="flex justify-end gap-2 pt-3">
          <button type="button" onClick={() => { setAskingEnterprise(false); onStart(enterpriseDomain || undefined); }}
            className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium">
            <Icon path={mdiArrowRight} size={0.5} className="inline mr-0.5" />
            {i18nT("common.continue", undefined, "Continue")}
          </button>
        </div>
      </PaneShell>
    );
  }

  const waiting = flow?.phase === "starting" || (flow?.phase === "waiting" && !!device);
  return (
    <PaneShell title={i18nT("providers.signInPaneTitle", { name: provider.name }, `Sign in to ${provider.name}`)} onBack={onBack} onClose={onClose}>
      {!flow && !askingEnterprise && (
        <button type="button" data-testid="dialog-sign-in" onClick={() => onStart()}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium">
          {i18nT("providers.startDeviceSignIn", undefined, "Sign in with a device code")}
        </button>
      )}
      {device && waiting && (
        <div data-testid="dialog-flow-waiting">
          <div className="text-xs text-[var(--text-secondary)]">{i18nT("common.enterThisCodeAt", undefined, "Enter this code at:")}</div>
          <div className="flex items-center gap-2 mt-1">
            <code className="text-lg font-bold text-[var(--text-primary)] tracking-wider">{device.userCode}</code>
            <button type="button" onClick={() => void navigator.clipboard?.writeText(device.userCode)}
              className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
              title={i18nT("common.copyCode", undefined, "Copy code")}>
              <Icon path={mdiContentCopy} size={0.5} />
            </button>
          </div>
          <a href={device.verificationUri} target="_blank" rel="noopener" className="block mt-1 text-xs underline break-all">{device.verificationUri}</a>
          {/* The user must click — the verification URL is never opened automatically. */}
          <button type="button" onClick={() => window.open(device.verificationUri, "_blank")}
            className="mt-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium">
            {i18nT("common.openRegistrationPage", undefined, "Open Registration Page")}
          </button>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-[var(--text-muted)]">
            <Icon path={mdiLoading} size={0.45} className="animate-spin" />
            {i18nT("providers.deviceWaiting", undefined, "Waiting for authorization… you can close this dialog — the sign-in will finish in the background.")}
          </div>
        </div>
      )}
      {flow?.phase === "error" && (
        <div data-testid="dialog-flow-error">
          <div className="text-xs text-red-400">{flow.error}</div>
          <button type="button" onClick={() => onStart()}
            className="mt-2 px-3 py-1.5 text-xs rounded bg-[var(--bg-tertiary)] hover:bg-[var(--bg-surface)] text-[var(--text-secondary)] border border-[var(--border-secondary)]">
            {i18nT("providers.tryAgain", undefined, "Try Again")}
          </button>
        </div>
      )}
    </PaneShell>
  );
}

// ── Custom-endpoint pane ─────────────────────────────────────────────────────

function CustomEndpointPane({ onClose, onBack, onSave }: {
  onClose: () => void;
  onBack: () => void;
  onSave: (input: CustomEndpointInput) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [api, setApi] = useState(API_TYPE_OPTIONS[0].value);
  const [error, setError] = useState<string | null>(null);
  const [validation, setValidation] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [live, setLive] = useState<{ ok: true; modelCount: number } | { ok: false; status?: number; error: string } | null>(null);

  const canTest = baseUrl.trim().length > 0 && apiKey.trim().length > 0 && !testing;
  const runTest = async () => {
    if (!canTest) return;
    setTesting(true);
    const result = await testProvider({ baseUrl: baseUrl.trim(), apiKey, api });
    setTesting(false);
    setLive(result.ok
      ? { ok: true, modelCount: result.modelCount }
      : { ok: false, status: result.status, error: result.error ?? "Test failed" });
  };

  const submit = async () => {
    // Validate before writing: a blank/whitespace name or an empty key is
    // refused HERE with a visible message — no request is issued.
    if (name.trim() === "") {
      setValidation(i18nT("providers.customNameRequired", undefined, "Provider name is required"));
      return;
    }
    if (!apiKey.trim()) {
      setValidation(i18nT("providers.keyRequired", undefined, "An API key is required."));
      return;
    }
    setValidation(null);
    setBusy(true);
    setError(null);
    const failure = await onSave({ name: name.trim(), baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), api });
    setBusy(false);
    if (failure) setError(failure);
  };

  return (
    <PaneShell title={i18nT("providers.customPaneTitle", undefined, "Add custom endpoint")} onBack={onBack} onClose={onClose}
      footer={
        <button type="button" data-testid="dialog-submit" onClick={() => void submit()} disabled={busy}
          className="px-3 py-1.5 text-xs rounded bg-blue-600 hover:bg-blue-500 text-white font-medium disabled:opacity-50">
          {i18nT("providers.addProviderAction", undefined, "Add provider")}
        </button>
      }
    >
      <div className="space-y-2">
        <div>
          <label htmlFor="custom-endpoint-name" className="block text-xs text-[var(--text-secondary)] mb-1">
            {i18nT("providers.customName", undefined, "Name")}
          </label>
          <input
            id="custom-endpoint-name"
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setValidation(null); }}
            placeholder="local-vllm"
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)]"
          />
        </div>
        <div>
          <label htmlFor="custom-endpoint-url" className="block text-xs text-[var(--text-secondary)] mb-1">
            {i18nT("providers.customBaseUrl", undefined, "Base URL")}
          </label>
          <input
            id="custom-endpoint-url"
            type="text"
            value={baseUrl}
            onChange={(e) => { setBaseUrl(e.target.value); setLive(null); }}
            placeholder="http://localhost:8000/v1"
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
          />
        </div>
        <div>
          <label htmlFor="custom-endpoint-api" className="block text-xs text-[var(--text-secondary)] mb-1">
            {i18nT("gateway.apiType", undefined, "API Type")}
          </label>
          <select
            id="custom-endpoint-api"
            value={api}
            onChange={(e) => { setApi(e.target.value); setLive(null); }}
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)]"
          >
            {API_TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="custom-endpoint-key" className="block text-xs text-[var(--text-secondary)] mb-1">
            {i18nT("gateway.apiKey", undefined, "API Key")}
          </label>
          <input
            id="custom-endpoint-key"
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setLive(null); setValidation(null); }}
            placeholder={i18nT("common.skOrEnvVarName", undefined, "sk-... or $ENV_VAR_NAME")}
            autoComplete="off"
            className="w-full px-2 py-1.5 text-xs rounded bg-[var(--bg-secondary)] border border-[var(--border-secondary)] text-[var(--text-primary)] placeholder-[var(--text-muted)] font-mono"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="dialog-test"
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
          <ProviderHealthPill view={derivePillView({ testing, live })} />
        </div>
      </div>
      {validation && (
        <div className="mt-2 text-xs text-red-400" data-testid="dialog-validation">{validation}</div>
      )}
      {error && (
        <div className="mt-2 text-xs text-red-400" data-testid="dialog-error">{error}</div>
      )}
    </PaneShell>
  );
}
