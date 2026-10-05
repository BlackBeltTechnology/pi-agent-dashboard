/**
 * Gmail settings section (design D7 wizard + accounts panel). Renders the
 * 6-step Google Cloud setup wizard (deep links, copyable gcloud commands,
 * client-JSON upload, sign-in error → step mapping) and the accounts panel
 * (add / re-auth / level / alias / revoke, status badges, honest scope limit).
 * Sign-in flows render through the host `ui:oauth-flow` primitive.
 * See change: add-gmail-plugin.
 *
 * improve-gmail-settings-ux: declared theme tokens + `.focus-ring` on every
 * control; consent hint + "Google showed an error?" disclosure while a sign-in
 * waits (reported code latched via `reportedRef`, so neither poll callback can
 * overwrite it or re-mount the flow); every flow error rendered as a sentence
 * (`errorKey` / `ERROR_EN`); Revoke via `ui:confirm-dialog`; alias feedback;
 * level descriptions; collapsed-summary project/client id.
 */
import { oauthFlowClient, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { validateClientJson } from "../shared/client-json.js";
import type { AccountInfo } from "../shared/protocol.js";
import { TIERS, type Tier } from "../shared/scopes.js";
import { consoleLinks, ERROR_EN, errorKey, errorStep, gcloudCommands, type WizardStep } from "./wizard.js";

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
  "focus-ring rounded border border-[var(--border-primary)] px-2 py-0.5 text-[12px] hover:bg-[var(--bg-hover)] disabled:opacity-50";
const field = "focus-ring rounded border border-[var(--border-primary)] bg-transparent text-[12px]";
const muted = "text-[12px] text-[var(--text-muted)]";
const errorText = "text-[12px] text-[var(--severity-error-fg)]";
// Static strings: Tailwind cannot see interpolated class names.
const badgeOk =
  "rounded border border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] px-1 text-[11px] text-[var(--severity-success-fg)]";
const badgeReauth =
  "rounded border border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] px-1 text-[11px] text-[var(--severity-warning-fg)]";

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
      <code className="flex-1 overflow-x-auto rounded bg-[var(--bg-tertiary)] px-2 py-1 text-[12px]">{value}</code>
      <button type="button" className={btn} onClick={() => void navigator.clipboard?.writeText(value)}>
        {t("copy", undefined, "Copy")}
      </button>
    </div>
  );
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring text-[12px] text-[var(--accent-text)] underline">
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
    `rounded border p-2 ${focus === n ? "border-[var(--accent)]" : "border-[var(--border-primary)]"}`;
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
            className={`${field} px-1`}
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
            "Internal admits only accounts of the project's own Workspace organization: choose it only when every account you will connect belongs to that organization. Otherwise choose External and add every address you will connect as a test user. In Testing, tokens expire after 7 days; “Publish app” gives longer-lived tokens with an unverified-app warning.",
          )}
        </div>
        <div className={muted}>
          {t(
            "audienceErrors",
            undefined,
            "Google error pages: org_internal = the account is outside the organization, switch to External; access_denied = add the account as a test user; admin_policy_enforced = the account's Workspace admin must trust this OAuth client.",
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
          className="focus-ring text-[12px]"
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
          <div role="alert" className={errorText} data-testid="gmail-upload-error" data-step={uploadError.step}>
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
const TIER_DESC: Record<Tier, [key: string, en: string]> = {
  readonly: ["tierReadonly", "read mail"],
  draft: ["tierDraft", "read + create drafts"],
  send: ["tierSend", "read, draft, send, reply, labels, archive, trash"],
};

/** `<option>`s carrying each level's own description. */
function TierOptions() {
  const t = useT();
  return (
    <>
      {TIERS.map((tier) => (
        <option key={tier} value={tier}>
          {`${TIER_LABEL[tier]} — ${t(TIER_DESC[tier][0], undefined, TIER_DESC[tier][1])}`}
        </option>
      ))}
    </>
  );
}

/** Codes the user can report from Google's own error page (closed list, design D1). */
const REPORT_CODES = ["org_internal", "access_denied", "admin_policy_enforced", "other"] as const;

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
  const ConfirmDialog = useUiPrimitive("ui:confirm-dialog");
  const [alias, setAlias] = useState(acct.alias ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [aliasMsg, setAliasMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
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
  const saveAlias = async () => {
    try {
      await api(`/accounts/${encodeURIComponent(acct.sub)}`, { method: "PATCH", body: JSON.stringify({ alias: alias || null }) });
      setAliasMsg({ ok: true, text: t("aliasSaved", undefined, "Saved") });
      onChanged();
    } catch (err) {
      const code = (err as { code?: string }).code ?? (err as Error).message;
      const text =
        code === "alias_taken"
          ? t("errAliasTaken", undefined, "That alias is already used by another account.")
          : code === "invalid_alias"
            ? t("errInvalidAlias", undefined, "Aliases are 1–40 letters, digits, '.', '_' or '-'.")
            : code;
      setAliasMsg({ ok: false, text });
    }
  };
  const revoke = () =>
    run(async () => {
      const r = await api<{ remoteRevoked: boolean }>(`/accounts/${encodeURIComponent(acct.sub)}`, { method: "DELETE" });
      onRevoked(acct.email, r.remoteRevoked);
      onChanged();
    });
  return (
    <li
      className="flex flex-col gap-1 rounded border border-[var(--border-primary)] p-2"
      data-testid="gmail-account-row"
      data-email={acct.email}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-[13px]" data-testid="gmail-account-email">
          {acct.email}
        </span>
        {acct.status === "ok" ? (
          <span className={badgeOk} data-testid="gmail-account-status" data-status="ok">
            {t("statusOk", undefined, "ok")}
          </span>
        ) : (
          <span className={badgeReauth} data-testid="gmail-account-status" data-status="reauth_required">
            {t("statusReauth", undefined, "re-auth needed")}
          </span>
        )}
        {acct.testingHint && (
          <span className={muted} title={t("testingHint", undefined, "Testing-mode app: Google expires this grant after 7 days.")}>
            {t("testingBadge", undefined, "testing: 7-day")}
          </span>
        )}
        <input
          aria-label={t("aliasLabel", undefined, "Alias")}
          data-testid="gmail-account-alias"
          className={`${field} w-24 px-1`}
          value={alias}
          placeholder={t("aliasPlaceholder", undefined, "alias")}
          onChange={(e) => {
            setAlias(e.target.value);
            setAliasMsg(null);
          }}
          onBlur={() => alias !== (acct.alias ?? "") && void saveAlias()}
        />
        {aliasMsg && (
          <span
            role={aliasMsg.ok ? "status" : "alert"}
            className={aliasMsg.ok ? muted : errorText}
            data-testid="gmail-alias-feedback"
          >
            {aliasMsg.text}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className={muted}>
          {t("level", undefined, "Level")}{" "}
          <select
            data-testid="gmail-account-level"
            value={acct.tier}
            onChange={(e) => void setLevel(e.target.value as Tier)}
            className={field}
          >
            <TierOptions />
          </select>
        </label>
        <button
          type="button"
          className={btn}
          data-testid="gmail-account-reauth"
          onClick={() =>
            void run(async () => {
              // Force a fresh consent at the current level (status reset on persist).
              const r = await api<{ flowId?: string }>(`/accounts/${encodeURIComponent(acct.sub)}/reauth`, { method: "POST" });
              if (r.flowId) onFlow(r.flowId);
            })
          }
        >
          {t("reauth", undefined, "Re-authenticate")}
        </button>
        <button type="button" className={btn} data-testid="gmail-account-revoke" onClick={() => setConfirming(true)}>
          {t("revoke", undefined, "Revoke")}
        </button>
        {msg && (
          <span role="alert" className={errorText}>
            {msg}
          </span>
        )}
      </div>
      {confirming && (
        <ConfirmDialog
          message={t(
            "revokeConfirm",
            { email: acct.email },
            `Revoke ${acct.email}? The dashboard forgets the account and asks Google to revoke its access.`,
          )}
          confirmLabel={t("revoke", undefined, "Revoke")}
          onConfirm={() => {
            setConfirming(false);
            void revoke();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </li>
  );
}

export function GmailSettings() {
  const t = useT();
  const OAuthFlow = useUiPrimitive("ui:oauth-flow");
  const newLevelId = useId();
  const [state, setState] = useState<GmailState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [flowError, setFlowError] = useState<string | null>(null);
  const [lastRevoke, setLastRevoke] = useState<string | null>(null);
  const [newTier, setNewTier] = useState<Tier>("readonly");
  // Latch (design D1): once the user reports a Google-page code, no late poll
  // result may overwrite it or re-mount the flow view. Reset on a new flow.
  const reportedRef = useRef<string | null>(null);

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
    reportedRef.current = null;
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
    (status) => {
      if (reportedRef.current) return;
      setFlow({ phase: "waiting", status });
    },
    (err) => {
      if (reportedRef.current) return;
      setFlow(null);
      setFlowError(err);
      void refresh();
    },
  );

  /** Order is load-bearing (design D1): latch, then clear, then cancel. */
  const report = (code: string) => {
    const flowId = flow?.status?.flowId;
    reportedRef.current = code;
    setFlow(null);
    setFlowError(code);
    if (flowId) void oauthFlowClient.cancel(flowId).catch(() => {});
  };

  const addAccount = async () => {
    reportedRef.current = null;
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

  if (loadError) return <div role="alert" className={errorText}>{loadError}</div>;
  if (!state) return <div className={muted}>{t("loading", undefined, "Loading…")}</div>;

  const step = errorStep(flowError);
  const errKey = errorKey(flowError);
  const { client } = state;
  const summary = !client.configured
    ? t("summaryNotConfigured", undefined, "not configured")
    : client.projectId
      ? t("summaryProject", { projectId: client.projectId }, `✓ project ${client.projectId}`)
      : t("summaryClient", { clientId: client.clientId ?? "" }, `✓ ${client.clientId ?? ""}`);
  return (
    <section className="flex flex-col gap-3" data-testid="gmail-settings" aria-labelledby="gmail-settings-title">
      <h3 id="gmail-settings-title" className="font-semibold text-[14px]">
        {t("title", undefined, "Gmail")}
      </h3>
      <details open={!client.configured || state.accounts.length === 0 || step !== null}>
        <summary className="focus-ring cursor-pointer text-[13px]" data-testid="gmail-setup-summary">
          {t("setup", undefined, "Google Cloud setup")} <span className={muted}>{summary}</span>
        </summary>
        <SetupWizard state={state} highlight={step} onUploaded={() => void refresh()} />
      </details>

      <div className="flex flex-col gap-2" data-testid="gmail-accounts">
        <div className="font-medium text-[13px]">{t("accounts", undefined, "Accounts")}</div>
        <p className={muted} data-testid="gmail-level-help">
          {t(
            "levelHelp",
            undefined,
            "Levels are enforced by this plugin, not by Google: a token carries every scope Google granted (draft-level compose access could technically send), so a level limits what the agent's tools may do. Any session on this dashboard can use every account within its level.",
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
          <div className="flex flex-col gap-2">
            <p className={muted} data-testid="gmail-consent-hint">
              {t(
                "consentHint",
                undefined,
                "On Google's consent screen tick every permission (Select all). The Gmail permission may start unticked.",
              )}
            </p>
            <OAuthFlow
              flow={flow}
              onSendInput={(id, value) => oauthFlowClient.input(id, value)}
              onCancel={(id) => {
                void oauthFlowClient.cancel(id);
              }}
            />
            {flow.phase === "waiting" && (
              <details data-testid="gmail-google-error">
                <summary className="focus-ring cursor-pointer text-[12px]">
                  {t("googleErrorSummary", undefined, "Google showed an error instead of returning here?")}
                </summary>
                <div className={muted}>{t("googleErrorHelp", undefined, "Pick the error code Google displayed:")}</div>
                <div className="flex flex-wrap gap-2">
                  {REPORT_CODES.map((code) => (
                    <button
                      key={code}
                      type="button"
                      className={btn}
                      data-testid={`gmail-report-${code}`}
                      onClick={() => report(code)}
                    >
                      {code === "other" ? t("reportOther", undefined, "Something else") : code}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2">
              <label htmlFor={newLevelId} className={muted}>
                {t("newLevel", undefined, "Level for the new account")}
              </label>
              <select
                id={newLevelId}
                data-testid="gmail-new-level"
                value={newTier}
                onChange={(e) => setNewTier(e.target.value as Tier)}
                className={field}
              >
                <TierOptions />
              </select>
              <button
                type="button"
                className={btn}
                data-testid="gmail-add-account"
                disabled={!client.configured}
                onClick={() => void addAccount()}
              >
                {t("addAccount", undefined, "Add account")}
              </button>
            </div>
            <p className={muted} data-testid="gmail-cross-org-hint">
              {t(
                "crossOrgHint",
                undefined,
                "Accounts outside the project's Workspace organization need an External audience, with each account added as a test user (step 3).",
              )}
            </p>
          </div>
        )}
        {flowError && (
          <div role="alert" className={errorText} data-testid="gmail-flow-error" data-step={step ?? ""}>
            {t(errKey, { clientId: client.clientId ?? "" }, ERROR_EN[errKey])}{" "}
            <span className={muted} data-testid="gmail-flow-error-code">
              ({flowError})
            </span>
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
