/**
 * Gmail settings section (design D7 wizard + accounts panel). Renders the
 * 6-step Google Cloud setup wizard (deep links, copyable gcloud commands,
 * client-JSON upload, sign-in error → step mapping) and the accounts panel
 * (add / re-auth / level / alias / revoke, status badges, honest scope limit).
 * Sign-in flows render through the host `ui:oauth-flow` primitive.
 * See change: add-gmail-plugin.
 */
import { oauthFlowClient, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { validateClientJson } from "../shared/client-json.js";
import type { AccountInfo } from "../shared/protocol.js";
import { TIERS, type Tier } from "../shared/scopes.js";
import { consoleLinks, errorStep, gcloudCommands, type WizardStep } from "./wizard.js";

const API = "/api/plugins/gmail";

interface GmailState {
  client: { configured: boolean; clientId?: string; projectId?: string };
  accounts: AccountInfo[];
}

type FlowState = React.ComponentProps<ReturnType<typeof useUiPrimitive<"ui:oauth-flow">>>["flow"];
type FlowStatus = NonNullable<FlowState["status"]>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: init?.body ? { "content-type": "application/json" } : undefined,
  });
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { code: body.error });
  return body;
}

const btn =
  "rounded border border-[var(--border)] px-2 py-0.5 text-[12px] hover:bg-[var(--bg-hover)] disabled:opacity-50";
const muted = "text-[12px] text-[var(--text-muted)]";

/** Poll a flow every 500 ms until terminal. */
function useFlowPoll(flowId: string | undefined, onPending: (s: FlowStatus) => void, onDone: (err: string | null) => void) {
  const pending = useRef(onPending);
  const done = useRef(onDone);
  pending.current = onPending;
  done.current = onDone;
  useEffect(() => {
    if (!flowId) return;
    let stopped = false;
    const timer = setInterval(() => {
      oauthFlowClient.status(flowId).then(
        (s) => {
          if (stopped) return;
          if (s.status === "pending") pending.current(s);
          else done.current(s.status === "complete" ? null : (s.error ?? s.status));
        },
        (err: unknown) => {
          if (!stopped) done.current(err instanceof Error ? err.message : String(err));
        },
      );
    }, 500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [flowId]);
}

function Copyable({ value }: { value: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded bg-[var(--bg-subtle)] px-2 py-1 text-[12px]">{value}</code>
      <button type="button" className={btn} onClick={() => void navigator.clipboard?.writeText(value)}>
        {t("copy", undefined, "Copy")}
      </button>
    </div>
  );
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-[12px] text-[var(--accent)] underline">
      {label}
    </a>
  );
}

export function SetupWizard({
  state,
  highlight,
  onUploaded,
}: {
  state: GmailState;
  highlight: WizardStep | null;
  onUploaded: () => void;
}) {
  const t = useT();
  const [projectId, setProjectId] = useState(state.client.projectId ?? "");
  const [uploadError, setUploadError] = useState<{ code: string; step: WizardStep } | null>(null);
  const links = consoleLinks(projectId.trim());
  const [cmdCreate, cmdEnable] = gcloudCommands(projectId.trim());
  const [focus, setFocus] = useState<WizardStep | null>(highlight);
  useEffect(() => setFocus(highlight ?? uploadError?.step ?? null), [highlight, uploadError]);

  const upload = async (file: File) => {
    setUploadError(null);
    const textContent = await file.text();
    const local = validateClientJson(textContent);
    if (!local.ok) {
      setUploadError({ code: local.error.code, step: local.error.step });
      return;
    }
    try {
      await api("/client", { method: "PUT", body: JSON.stringify({ json: JSON.parse(textContent) }) });
      if (local.client.projectId && !projectId) setProjectId(local.client.projectId);
      onUploaded();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "upload_failed";
      setUploadError({ code, step: errorStep(code) ?? 5 });
    }
  };

  const stepClass = (n: WizardStep) =>
    `rounded border p-2 ${focus === n ? "border-[var(--warning)]" : "border-[var(--border)]"}`;
  const uploadMsg: Record<string, string> = {
    not_json: t("errNotJson", undefined, "That file is not valid JSON. Upload the client_secret_*.json you downloaded (step 5)."),
    web_client: t("errWebClient", undefined, "This is a Web application client. Create a Desktop app client instead (step 4)."),
    not_installed: t("errNotInstalled", undefined, "No Desktop (`installed`) client in this file. Create a Desktop app client (step 4)."),
    bad_client_id: t("errBadClientId", undefined, "The client id does not end in .apps.googleusercontent.com (step 4)."),
    client_in_use: t(
      "errClientInUse",
      undefined,
      "Accounts are connected with the current client. Revoke them first, then upload a different client.",
    ),
    missing_secret: t("errMissingSecret", undefined, "The file has no client secret. Download it again from the client page (step 5)."),
  };

  return (
    <ol className="flex flex-col gap-2" data-testid="gmail-wizard">
      <li className={stepClass(1)} data-testid="gmail-step-1">
        <div className="font-medium text-[13px]">{t("step1", undefined, "1. Google Cloud project + Gmail API")}</div>
        <label className={`${muted} flex items-center gap-2`}>
          {t("projectId", undefined, "Project id")}
          <input
            data-testid="gmail-project-id"
            className="rounded border border-[var(--border)] bg-transparent px-1 text-[12px]"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="my-gmail-agent"
          />
        </label>
        <div className={muted}>{t("withoutGcloud", undefined, "Without gcloud:")}</div>
        <div className="flex gap-3">
          <StepLink href={links.projectCreate} label={t("createProject", undefined, "Create project")} />
          <StepLink href={links.gmailApi} label={t("enableGmail", undefined, "Enable the Gmail API")} />
        </div>
        <div className={muted}>{t("withGcloud", undefined, "With gcloud (run it yourself):")}</div>
        <Copyable value={cmdCreate as string} />
        <Copyable value={cmdEnable as string} />
      </li>
      <li className={stepClass(2)} data-testid="gmail-step-2">
        <div className="font-medium text-[13px]">{t("step2", undefined, "2. Branding")}</div>
        <StepLink href={links.branding} label={t("openBranding", undefined, "Open Branding")} />
        <div className={muted}>{t("fallback2", undefined, "If the link moved: APIs & Services → OAuth consent screen.")}</div>
      </li>
      <li className={stepClass(3)} data-testid="gmail-step-3">
        <div className="font-medium text-[13px]">{t("step3", undefined, "3. Audience + test users")}</div>
        <StepLink href={links.audience} label={t("openAudience", undefined, "Open Audience")} />
        <div className={muted}>
          {t(
            "audienceHelp",
            undefined,
            "Workspace org: choose Internal. Otherwise External, and add every Gmail address you will connect as a test user. In Testing, tokens expire after 7 days; “Publish app” gives longer-lived tokens with an unverified-app warning.",
          )}
        </div>
      </li>
      <li className={stepClass(4)} data-testid="gmail-step-4">
        <div className="font-medium text-[13px]">{t("step4", undefined, "4. Desktop OAuth client")}</div>
        <StepLink href={links.clientCreate} label={t("openClients", undefined, "Create client")} />
        <div className={muted}>
          {t("clientHelp", undefined, "Application type: Desktop app. Download the JSON. If the link moved: APIs & Services → Credentials.")}
        </div>
      </li>
      <li className={stepClass(5)} data-testid="gmail-step-5">
        <div className="font-medium text-[13px]">{t("step5", undefined, "5. Upload client_secret_*.json")}</div>
        <input
          type="file"
          accept="application/json,.json"
          data-testid="gmail-client-upload"
          aria-label={t("uploadLabel", undefined, "Upload the OAuth client JSON")}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />
        {state.client.configured && (
          <div className={muted} data-testid="gmail-client-ok">
            ✓ {state.client.clientId}
          </div>
        )}
        {uploadError && (
          <div role="alert" className="text-[12px] text-[var(--error)]" data-testid="gmail-upload-error" data-step={uploadError.step}>
            {uploadMsg[uploadError.code] ?? uploadError.code}
          </div>
        )}
      </li>
      <li className={stepClass(6)} data-testid="gmail-step-6">
        <div className="font-medium text-[13px]">{t("step6", undefined, "6. Test sign-in")}</div>
        <div className={muted}>{t("step6Help", undefined, "Add your first account below — that is the test sign-in.")}</div>
      </li>
    </ol>
  );
}

const TIER_LABEL: Record<Tier, string> = { readonly: "readonly", draft: "draft", send: "send" };

function AccountRow({
  acct,
  onChanged,
  onFlow,
  onRevoked,
}: {
  acct: AccountInfo;
  onChanged: () => void;
  onFlow: (flowId: string) => void;
  onRevoked: (email: string, remoteRevoked: boolean) => void;
}) {
  const t = useT();
  const [alias, setAlias] = useState(acct.alias ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setMsg(null);
    try {
      await fn();
    } catch (err) {
      setMsg((err as { code?: string }).code ?? (err as Error).message);
    }
  };
  const setLevel = (tier: Tier) =>
    run(async () => {
      const r = await api<{ applied?: boolean; flowId?: string }>(`/accounts/${encodeURIComponent(acct.sub)}/level`, {
        method: "POST",
        body: JSON.stringify({ tier }),
      });
      if (r.flowId) onFlow(r.flowId);
      else onChanged();
    });
  return (
    <li className="flex flex-wrap items-center gap-2 rounded border border-[var(--border)] p-2" data-testid="gmail-account-row" data-email={acct.email}>
      <span className="font-medium text-[13px]" data-testid="gmail-account-email">
        {acct.email}
      </span>
      {acct.status === "ok" ? (
        <span className="rounded bg-[var(--success-bg)] px-1 text-[11px]" data-testid="gmail-account-status" data-status="ok">
          {t("statusOk", undefined, "ok")}
        </span>
      ) : (
        <span className="rounded bg-[var(--warning-bg)] px-1 text-[11px]" data-testid="gmail-account-status" data-status="reauth_required">
          {t("statusReauth", undefined, "re-auth needed")}
        </span>
      )}
      {acct.testingHint && (
        <span className={muted} title={t("testingHint", undefined, "Testing-mode app: Google expires this grant after 7 days.")}>
          {t("testingBadge", undefined, "testing: 7-day")}
        </span>
      )}
      <label className={muted}>
        {t("level", undefined, "Level")}{" "}
        <select
          data-testid="gmail-account-level"
          value={acct.tier}
          onChange={(e) => void setLevel(e.target.value as Tier)}
          className="rounded border border-[var(--border)] bg-transparent text-[12px]"
        >
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {TIER_LABEL[tier]}
            </option>
          ))}
        </select>
      </label>
      <input
        aria-label={t("aliasLabel", undefined, "Alias")}
        data-testid="gmail-account-alias"
        className="w-24 rounded border border-[var(--border)] bg-transparent px-1 text-[12px]"
        value={alias}
        placeholder={t("aliasPlaceholder", undefined, "alias")}
        onChange={(e) => setAlias(e.target.value)}
        onBlur={() =>
          alias !== (acct.alias ?? "") &&
          void run(async () => {
            await api(`/accounts/${encodeURIComponent(acct.sub)}`, { method: "PATCH", body: JSON.stringify({ alias: alias || null }) });
            onChanged();
          })
        }
      />
      <button type="button" className={btn} data-testid="gmail-account-reauth" onClick={() =>
          void run(async () => {
            // Force a fresh consent at the current level (status reset on persist).
            const r = await api<{ flowId?: string }>(`/accounts/${encodeURIComponent(acct.sub)}/reauth`, { method: "POST" });
            if (r.flowId) onFlow(r.flowId);
          })
        }>
        {t("reauth", undefined, "Re-authenticate")}
      </button>
      <button
        type="button"
        className={btn}
        data-testid="gmail-account-revoke"
        onClick={() =>
          void run(async () => {
            const r = await api<{ remoteRevoked: boolean }>(`/accounts/${encodeURIComponent(acct.sub)}`, { method: "DELETE" });
            onRevoked(acct.email, r.remoteRevoked);
            onChanged();
          })
        }
      >
        {t("revoke", undefined, "Revoke")}
      </button>
      {msg && (
        <span role="alert" className="text-[12px] text-[var(--error)]">
          {msg}
        </span>
      )}
    </li>
  );
}

export function GmailSettings() {
  const t = useT();
  const OAuthFlow = useUiPrimitive("ui:oauth-flow");
  const [state, setState] = useState<GmailState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [lastRevoke, setLastRevoke] = useState<string | null>(null);
  const [newTier, setNewTier] = useState<Tier>("readonly");

  const refresh = useCallback(async () => {
    try {
      setState(await api<GmailState>("/state"));
      setLoadError(null);
    } catch (err) {
      setLoadError((err as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const startFlow = async (flowId: string) => {
    setFlowError(null);
    try {
      setFlow({ phase: "waiting", status: await oauthFlowClient.status(flowId) });
    } catch (err) {
      setFlow(null);
      setFlowError(err instanceof Error ? err.message : String(err));
    }
  };
  useFlowPoll(
    flow?.status?.flowId,
    (status) => setFlow({ phase: "waiting", status }),
    (err) => {
      setFlow(null);
      setFlowError(err);
      void refresh();
    },
  );

  const addAccount = async () => {
    setFlowError(null);
    setFlow({ phase: "starting" });
    try {
      const r = await api<{ flowId: string }>("/accounts", { method: "POST", body: JSON.stringify({ tier: newTier }) });
      await startFlow(r.flowId);
    } catch (err) {
      setFlow(null);
      setFlowError((err as { code?: string }).code ?? (err as Error).message);
    }
  };

  if (loadError) return <div role="alert" className="text-[12px] text-[var(--error)]">{loadError}</div>;
  if (!state) return <div className={muted}>{t("loading", undefined, "Loading…")}</div>;

  const step = errorStep(flowError);
  return (
    <section className="flex flex-col gap-3" data-testid="gmail-settings" aria-labelledby="gmail-settings-title">
      <h3 id="gmail-settings-title" className="font-semibold text-[14px]">
        {t("title", undefined, "Gmail")}
      </h3>
      <details open={!state.client.configured || state.accounts.length === 0 || step !== null}>
        <summary className="cursor-pointer text-[13px]">{t("setup", undefined, "Google Cloud setup")}</summary>
        <SetupWizard state={state} highlight={step} onUploaded={() => void refresh()} />
      </details>

      <div className="flex flex-col gap-2" data-testid="gmail-accounts">
        <div className="font-medium text-[13px]">{t("accounts", undefined, "Accounts")}</div>
        <p className={muted} data-testid="gmail-level-help">
          {t(
            "levelHelp",
            undefined,
            "Levels: readonly = read; draft = + drafts; send = + send, reply, labels, archive, trash. Levels are enforced by this plugin, not by Google: a token carries every scope Google granted (draft-level compose access could technically send), so a level controls what the agent's tools may do. Any session on this dashboard can use every account within its level.",
          )}
        </p>
        {state.accounts.length === 0 && <div className={muted}>{t("noAccounts", undefined, "No accounts connected.")}</div>}
        <ul className="flex flex-col gap-2">
          {state.accounts.map((a) => (
            <AccountRow
              key={a.sub}
              acct={a}
              onChanged={() => void refresh()}
              onFlow={(id) => void startFlow(id)}
              onRevoked={(email, remote) =>
                setLastRevoke(
                  remote
                    ? t("revokedOk", { email }, `${email} removed and access revoked at Google.`)
                    : t(
                        "revokeManual",
                        { email },
                        `${email} removed locally, but Google could not be reached. Revoke access at myaccount.google.com/permissions.`,
                      ),
                )
              }
            />
          ))}
        </ul>
        {flow ? (
          <OAuthFlow
            flow={flow}
            onSendInput={(id, value) => oauthFlowClient.input(id, value)}
            onCancel={(id) => {
              void oauthFlowClient.cancel(id);
            }}
          />
        ) : (
          <div className="flex items-center gap-2">
            <select
              aria-label={t("newLevel", undefined, "Level for the new account")}
              data-testid="gmail-new-level"
              value={newTier}
              onChange={(e) => setNewTier(e.target.value as Tier)}
              className="rounded border border-[var(--border)] bg-transparent text-[12px]"
            >
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {TIER_LABEL[tier]}
                </option>
              ))}
            </select>
            <button type="button" className={btn} data-testid="gmail-add-account" disabled={!state.client.configured} onClick={() => void addAccount()}>
              {t("addAccount", undefined, "Add account")}
            </button>
          </div>
        )}
        {flowError && (
          <div role="alert" className="text-[12px] text-[var(--error)]" data-testid="gmail-flow-error" data-step={step ?? ""}>
            {step
              ? t("flowErrorStep", { error: flowError, step }, `Sign-in failed (${flowError}). Fix wizard step ${step}.`)
              : t("flowError", { error: flowError }, `Sign-in failed: ${flowError}`)}
          </div>
        )}
        {lastRevoke && (
          <div role="status" className={muted} data-testid="gmail-revoke-result">
            {lastRevoke}
          </div>
        )}
      </div>
    </section>
  );
}
