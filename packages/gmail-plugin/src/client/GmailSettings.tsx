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
 *
 * retro-ux-plugin-settings-forms: labelled inputs through the shared settings
 * field family, numbered wizard step chips (`aria-current="step"`, done = check),
 * "Connected" / "Re-auth needed" pills, per-account control names, one primary
 * "Add account" button with a linked disabled reason, flow errors as a severity
 * notice. Immediate-save model unchanged.
 */
import {
  copyText,
  FieldShell,
  oauthFlowClient,
  SelectField,
  SettingsGroup,
  SettingsNotice,
  TextField,
  useT,
  useUiPrimitive,
} from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { validateClientJson } from "../shared/client-json.js";
import type { AccountInfo } from "../shared/protocol.js";
import { TIERS, type Tier } from "../shared/scopes.js";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../shared/setup.js";
import {
  AUDIENCE_HELP_EN,
  CONSENT_HINT_EN,
  consoleLinks,
  ERROR_EN,
  errorKey,
  errorStep,
  gcloudCommands,
  type WizardStep,
} from "./wizard.js";

const API = "/api/plugins/gmail";

interface GmailState {
  client: { configured: boolean; clientId?: string; projectId?: string };
  accounts: AccountInfo[];
  /** Saved setup fields (`plugins.gmail`); absent from older servers. */
  setup?: { projectId?: string; ownerAccount?: string };
}

interface SavedSetup {
  projectId: string;
  ownerAccount: string;
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

// Secondary button recipe (`ui-contract.md`); `tap-target` = 44 px touch, 32 px from sm.
const btn =
  "focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2.5 text-xs font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] disabled:opacity-50";
// The section's one primary action (white on the theme-invariant `--accent-solid`).
const primaryBtn =
  "focus-ring tap-target rounded-md bg-[var(--accent-solid)] px-3 text-xs font-semibold text-white disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]";
const field =
  "focus-ring rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-2 py-1 text-xs text-[var(--text-primary)]";
const muted = "text-xs text-[var(--text-secondary)]";
const errorText = "text-xs text-[var(--severity-error-fg)]";
// Static strings: Tailwind cannot see interpolated class names.
const pillBase = "inline-flex items-center rounded-full border px-1.5 py-px text-[11px] font-semibold";
const badgeOk = `${pillBase} border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]`;
const badgeReauth = `${pillBase} border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]`;

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
  const [result, setResult] = useState<"copied" | "failed" | null>(null);
  const seq = useRef(0);
  const copy = async (): Promise<void> => {
    const n = ++seq.current;
    const ok = await copyText(value);
    if (n !== seq.current) return; // a later click superseded this one
    setResult(ok ? "copied" : "failed");
    setTimeout(() => {
      if (n === seq.current) setResult(null);
    }, 1500);
  };
  const label =
    result === "copied" ? t("copied", undefined, "Copied") : result === "failed" ? t("copyFailed", undefined, "Copy failed") : t("copy", undefined, "Copy");
  return (
    <div className="flex items-center gap-2">
      <code className="flex-1 overflow-x-auto rounded bg-[var(--bg-tertiary)] px-2 py-1 font-mono text-[12px] text-[var(--text-primary)]">{value}</code>
      <button type="button" className={btn} onClick={() => void copy()}>
        <span role="status">{label}</span>
      </button>
    </div>
  );
}

/** A project-scoped link, or the "valid project id needed" statement while the id is empty or invalid. */
function ProjectLink({ href, label, step }: { href: string | null; label: string; step: WizardStep }) {
  const t = useT();
  if (href) return <StepLink href={href} label={label} />;
  return (
    <div className={muted} data-testid={`gmail-need-project-id-step-${step}`}>
      {t("needValidProjectId", undefined, "A valid project id is needed before the project links and commands appear.")}
    </div>
  );
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="focus-ring text-xs text-[var(--accent-text)] underline">
      {label}
    </a>
  );
}

function WizardStepItem({
  n,
  title,
  current,
  done,
  children,
}: {
  n: WizardStep;
  title: string;
  current: boolean;
  done: boolean;
  children: React.ReactNode;
}) {
  const t = useT();
  return (
    <li
      className="grid grid-cols-[24px_1fr] gap-2 border-t border-[var(--border-subtle)] py-2 first:border-t-0"
      data-testid={`gmail-step-${n}`}
      aria-current={current ? "step" : undefined}
      data-done={done ? "true" : undefined}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold ${
          current
            ? "border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]"
            : done
              ? "border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]"
              : "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]"
        }`}
      >
        {done ? <span aria-hidden="true">✓</span> : n}
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <div className="text-xs font-semibold text-[var(--text-primary)]">
          {title.replace(/^\d+\.\s*/, "")}
          {done ? <span className="sr-only"> — {t("stepDone", undefined, "done")}</span> : null}
        </div>
        {children}
      </div>
    </li>
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
  const savedSetup = useRef<SavedSetup>({
    projectId: state.setup?.projectId ?? "",
    ownerAccount: state.setup?.ownerAccount ?? "",
  });
  const [projectId, setProjectId] = useState(state.setup?.projectId ?? state.client.projectId ?? "");
  const [owner, setOwner] = useState(state.setup?.ownerAccount ?? "");
  // Presentational only (design D2): `existing` by default once a project id is known.
  const [mode, setMode] = useState<"new" | "existing">(state.setup?.projectId || state.client.projectId ? "existing" : "new");
  // Validation errors appear on blur only and clear the moment the value turns valid.
  const [projectErr, setProjectErr] = useState<"looks_like_name" | "invalid" | null>(null);
  const [ownerErr, setOwnerErr] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState<{ saved: string; json: string } | null>(null);
  const [uploadError, setUploadError] = useState<{ code: string; step: WizardStep } | null>(null);
  const links = consoleLinks(projectId, owner);
  const cmds = gcloudCommands(projectId, owner);
  const [focus, setFocus] = useState<WizardStep | null>(highlight);
  useEffect(() => setFocus(highlight ?? uploadError?.step ?? null), [highlight, uploadError]);

  /** Persist setup fields; rejects on failure. The reply (normalized values) is what counts as saved. */
  const saveSetup = async (partial: Partial<SavedSetup>): Promise<void> => {
    const r = await api<{ setup?: { projectId?: string; ownerAccount?: string } }>("/setup", {
      method: "PUT",
      body: JSON.stringify(partial),
    });
    savedSetup.current = r.setup
      ? { projectId: r.setup.projectId ?? "", ownerAccount: r.setup.ownerAccount ?? "" }
      : { ...savedSetup.current, ...partial };
  };
  const saveOnBlur = (partial: Partial<SavedSetup>) => {
    setSaveError(null);
    saveSetup(partial).catch((err: unknown) => setSaveError((err as { code?: string }).code ?? (err as Error).message));
  };

  const onProjectChange = (v: string) => {
    setProjectId(v);
    if (!v.trim() || classifyProjectId(v) === "ok") setProjectErr(null);
  };
  const onProjectBlur = () => {
    const cls = classifyProjectId(projectId);
    if (cls === "looks_like_name" || cls === "invalid") {
      setProjectErr(cls);
      return;
    }
    setProjectErr(null);
    const next = cls === "ok" ? normalizeProjectId(projectId) : "";
    if (next !== savedSetup.current.projectId) saveOnBlur({ projectId: next });
  };
  const onOwnerChange = (v: string) => {
    setOwner(v);
    if (!v.trim() || isEmail(normalizeEmail(v))) setOwnerErr(false);
  };
  const onOwnerBlur = () => {
    const email = normalizeEmail(owner);
    if (email && !isEmail(email)) {
      setOwnerErr(true);
      return;
    }
    setOwnerErr(false);
    if (email !== savedSetup.current.ownerAccount) saveOnBlur({ ownerAccount: email });
  };
  const useJsonProject = () => {
    if (!mismatch) return;
    const id = mismatch.json;
    setMismatch(null);
    setProjectId(id);
    setProjectErr(null);
    saveOnBlur({ projectId: id });
  };

  const upload = async (file: File) => {
    setUploadError(null);
    setMismatch(null);
    const textContent = await file.text();
    const local = validateClientJson(textContent);
    if (!local.ok) {
      setUploadError({ code: local.error.code, step: local.error.step });
      return;
    }
    // Flush a valid, unsaved typed id first (removes the blur/upload race); a failed
    // save aborts the upload so the comparison never runs against a stale id.
    if (classifyProjectId(projectId) === "ok" && normalizeProjectId(projectId) !== savedSetup.current.projectId) {
      try {
        await saveSetup({ projectId: normalizeProjectId(projectId) });
      } catch {
        setUploadError({ code: "setup_save_failed", step: 1 });
        return;
      }
    }
    try {
      const reply = await api<{ projectId?: string }>("/client", { method: "PUT", body: JSON.stringify({ json: JSON.parse(textContent) }) });
      const jsonId = reply.projectId;
      if (jsonId) {
        const savedId = savedSetup.current.projectId;
        if (!savedId) {
          // Nothing saved yet: adopt the client's project id.
          setProjectId(jsonId);
          setProjectErr(null);
          saveOnBlur({ projectId: jsonId });
        } else if (savedId !== jsonId) {
          setMismatch({ saved: savedId, json: jsonId });
        }
      }
      onUploaded();
    } catch (err) {
      const code = (err as { code?: string }).code ?? "upload_failed";
      setUploadError({ code, step: errorStep(code) ?? 5 });
    }
  };

  // Current step: the highlighted one, else the next thing the user has to do.
  const current: WizardStep | null =
    focus ?? (!state.client.configured ? 1 : state.accounts.length === 0 ? 6 : null);
  const isDone = (n: WizardStep) =>
    n !== current && (state.client.configured ? n <= 5 || state.accounts.length > 0 : current !== null && n < current);
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
    setup_save_failed: t("errSetupSave", undefined, "The project id could not be saved, so the upload was not sent. Try again (step 1)."),
  };
  const projectErrText =
    projectErr === "looks_like_name"
      ? t(
          "errProjectLooksLikeName",
          undefined,
          "That looks like the project name. The wizard needs the project id (lower-case, for example pidashboard-510015): open the project list and copy the ID column.",
        )
      : projectErr === "invalid"
        ? t(
            "errProjectInvalid",
            undefined,
            "A project id is 6–30 characters: lower-case letters, digits and hyphens, starting with a letter and not ending with a hyphen.",
          )
        : null;

  return (
    <ol className="m-0 flex list-none flex-col p-0" data-testid="gmail-wizard">
      <WizardStepItem n={1} title={t("step1", undefined, "1. Google Cloud project + Gmail API")} current={current === 1} done={isDone(1)}>
        <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0" data-testid="gmail-project-mode">
          <legend className="sr-only">{t("projectModeLegend", undefined, "Project")}</legend>
          {(["new", "existing"] as const).map((m) => (
            <label key={m} className={`${muted} flex items-center gap-1`}>
              <input
                type="radio"
                name="gmail-project-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="focus-ring"
                data-testid={`gmail-project-mode-${m}`}
              />
              {m === "new" ? t("projectModeNew", undefined, "Create a new project") : t("projectModeExisting", undefined, "Use an existing project")}
            </label>
          ))}
        </fieldset>
        <div onBlur={onProjectBlur}>
          <TextField
            label={t("projectId", undefined, "Project id")}
            hint={
              <>
                {t(
                  "projectIdHint",
                  undefined,
                  "The id of your Google Cloud project, not its display name: lower-case letters, digits and hyphens, for example my-gmail-agent. The console's project list shows both; the id is in the ID column.",
                )}
                {projectErr === "looks_like_name" && (
                  <>
                    {" "}
                    <StepLink href={links.projectList} label={t("openProjectList", undefined, "Open the project list")} />
                  </>
                )}
              </>
            }
            error={projectErrText}
            mono
            value={projectId}
            onChange={onProjectChange}
            placeholder="my-gmail-agent"
            testIds={{ control: "gmail-project-id", error: "gmail-project-error" }}
          />
        </div>
        <div onBlur={onOwnerBlur}>
          <TextField
            label={t("ownerAccount", undefined, "Owner account (optional)")}
            hint={t(
              "ownerHint",
              undefined,
              "The Google account that owns the project. Console links and gcloud commands then act as this account instead of your browser's default one.",
            )}
            error={ownerErr ? t("errOwnerInvalid", undefined, "Enter a full email address, for example you@gmail.com.") : null}
            value={owner}
            onChange={onOwnerChange}
            placeholder="you@gmail.com"
            testIds={{ control: "gmail-owner-account", error: "gmail-owner-error" }}
          />
        </div>
        {saveError && (
          <div role="alert" className={errorText} data-testid="gmail-setup-save-error">
            {t("errSetupSave", undefined, "The project id could not be saved, so the upload was not sent. Try again (step 1).")} ({saveError})
          </div>
        )}
        {mismatch && (
          <SettingsNotice tone="error" testId="gmail-project-mismatch">
            <div className="flex flex-col gap-1">
              <span>
                {t(
                  "projectMismatch",
                  { saved: mismatch.saved, json: mismatch.json },
                  `The uploaded client belongs to project ${mismatch.json}, but the saved project id is ${mismatch.saved}.`,
                )}
              </span>
              <span>
                <button type="button" className={btn} data-testid="gmail-project-mismatch-use" onClick={useJsonProject}>
                  {t("projectMismatchUse", { id: mismatch.json }, `Use ${mismatch.json}`)}
                </button>
              </span>
            </div>
          </SettingsNotice>
        )}
        {cmds.authLogin && (
          <>
            <div className={muted} data-testid="gmail-auth-login-note">
              {t("authLoginNote", undefined, "Run this once first, so gcloud can act as the owner account:")}
            </div>
            <Copyable value={cmds.authLogin} />
          </>
        )}
        {mode === "new" ? (
          <>
            <div className={muted}>{t("withoutGcloud", undefined, "Without gcloud:")}</div>
            <div className="flex gap-3">
              <StepLink href={links.projectCreate} label={t("createProject", undefined, "Create project")} />
            </div>
            {cmds.create && (
              <>
                <div className={muted}>{t("withGcloud", undefined, "With gcloud (run it yourself):")}</div>
                <Copyable value={cmds.create} />
              </>
            )}
          </>
        ) : (
          <>
            <div className={muted}>{t("findProject", undefined, "Find your project's id:")}</div>
            <div className="flex gap-3">
              <StepLink href={links.projectList} label={t("openProjectList", undefined, "Open the project list")} />
            </div>
            <Copyable value={cmds.projectsList} />
          </>
        )}
        {links.gmailApi && cmds.enable ? (
          <>
            <div className="flex gap-3">
              <StepLink href={links.gmailApi} label={t("enableGmail", undefined, "Enable the Gmail API")} />
            </div>
            <Copyable value={cmds.enable} />
          </>
        ) : (
          <div className={muted} data-testid="gmail-need-project-id">
            {t("needValidProjectId", undefined, "A valid project id is needed before the project links and commands appear.")}
          </div>
        )}
      </WizardStepItem>
      <WizardStepItem n={2} title={t("step2", undefined, "2. Branding")} current={current === 2} done={isDone(2)}>
        <ProjectLink href={links.branding} label={t("openBranding", undefined, "Open Branding")} step={2} />
        <div className={muted}>{t("fallback2", undefined, "If the link moved: APIs & Services → OAuth consent screen.")}</div>
      </WizardStepItem>
      <WizardStepItem n={3} title={t("step3", undefined, "3. Audience + test users")} current={current === 3} done={isDone(3)}>
        <ProjectLink href={links.audience} label={t("openAudience", undefined, "Open Audience")} step={3} />
        <div className={muted}>
          {t(
            "audienceHelp",
            undefined,
            AUDIENCE_HELP_EN,
          )}
        </div>
        <div className={muted}>
          {t(
            "audienceErrors",
            undefined,
            "Google error pages: org_internal = the account is outside the organization, switch to External; access_denied = add the account as a test user; admin_policy_enforced = the account's Workspace admin must trust this OAuth client.",
          )}
        </div>
      </WizardStepItem>
      <WizardStepItem n={4} title={t("step4", undefined, "4. Desktop OAuth client")} current={current === 4} done={isDone(4)}>
        <ProjectLink href={links.clientCreate} label={t("openClients", undefined, "Create client")} step={4} />
        <div className={muted}>
          {t("clientHelp", undefined, "Application type: Desktop app. Download the JSON. If the link moved: APIs & Services → Credentials.")}
        </div>
      </WizardStepItem>
      <WizardStepItem n={5} title={t("step5", undefined, "5. Upload client_secret_*.json")} current={current === 5} done={isDone(5)}>
        <FieldShell
          label={t("uploadLabel", undefined, "Upload the OAuth client JSON")}
          hint={null}
          stacked
          error={uploadError ? (uploadMsg[uploadError.code] ?? uploadError.code) : null}
          testIds={{ error: "gmail-upload-error" }}
          errorAttrs={uploadError ? { "data-step": String(uploadError.step) } : undefined}
          control={({ id, describedBy, invalid }) => (
            <input
              id={id}
              type="file"
              className="focus-ring text-xs text-[var(--text-primary)]"
              accept="application/json,.json"
              data-testid="gmail-client-upload"
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
              }}
            />
          )}
        />
        {state.client.configured && (
          <div className={muted} data-testid="gmail-client-ok">
            ✓ {state.client.clientId}
          </div>
        )}
      </WizardStepItem>
      <WizardStepItem n={6} title={t("step6", undefined, "6. Test sign-in")} current={current === 6} done={isDone(6)}>
        <div className={muted}>{t("step6Help", undefined, "Add your first account below — that is the test sign-in.")}</div>
      </WizardStepItem>
    </ol>
  );
}

const TIER_LABEL: Record<Tier, string> = { readonly: "readonly", draft: "draft", send: "send" };
const TIER_DESC: Record<Tier, [key: string, en: string]> = {
  readonly: ["tierReadonly", "read mail"],
  draft: ["tierDraft", "read + create drafts"],
  send: ["tierSend", "read, draft, send, reply, labels, archive, trash"],
};

/** Each level's own description, as a select option list. */
function useTierOptions(): { value: string; label: string }[] {
  const t = useT();
  return TIERS.map((tier) => ({ value: tier, label: `${TIER_LABEL[tier]} — ${t(TIER_DESC[tier][0], undefined, TIER_DESC[tier][1])}` }));
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
  const tierOptions = useTierOptions();
  const [alias, setAlias] = useState(acct.alias ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [aliasMsg, setAliasMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [filtersOn, setFiltersOn] = useState(acct.filters === true);
  useEffect(() => setFiltersOn(acct.filters === true), [acct.filters]);
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
  const toggleFilters = (enabled: boolean) =>
    run(async () => {
      const r = await api<{ applied?: boolean; flowId?: string }>(`/accounts/${encodeURIComponent(acct.sub)}/filters`, {
        method: "POST",
        body: JSON.stringify({ enabled }),
      });
      if (r.flowId) onFlow(r.flowId);
      else {
        setFiltersOn(enabled);
        onChanged();
      }
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
      className="flex flex-col gap-2 rounded-md border border-[var(--border-secondary)] p-2"
      data-testid="gmail-account-row"
      data-email={acct.email}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text-primary)]" data-testid="gmail-account-email">
          {acct.email}
        </span>
        {acct.status === "ok" ? (
          <span className={badgeOk} data-testid="gmail-account-status" data-status="ok">
            {t("statusOk", undefined, "Connected")}
          </span>
        ) : (
          <span className={badgeReauth} data-testid="gmail-account-status" data-status="reauth_required">
            {t("statusReauth", undefined, "Re-auth needed")}
          </span>
        )}
        {acct.testingHint && (
          <span className={muted} title={t("testingHint", undefined, "Testing-mode app: Google expires this grant after 7 days.")}>
            {t("testingBadge", undefined, "testing: 7-day")}
          </span>
        )}
        <input
          aria-label={t("aliasFor", { email: acct.email }, `Alias for ${acct.email}`)}
          data-testid="gmail-account-alias"
          className={`${field} w-28`}
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
            aria-label={t("levelFor", { email: acct.email }, `Level for ${acct.email}`)}
            data-testid="gmail-account-level"
            value={acct.tier}
            onChange={(e) => void setLevel(e.target.value as Tier)}
            className={field}
          >
            {tierOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className={`${muted} flex items-center gap-1`}>
          <input
            type="checkbox"
            className="focus-ring"
            data-testid="gmail-account-filters"
            aria-label={t("filtersFor", { email: acct.email }, `Filters for ${acct.email}`)}
            checked={filtersOn}
            onChange={(e) => void toggleFilters(e.target.checked)}
          />
          {t("filtersLabel", undefined, "Filters")}
        </label>
        <button
          type="button"
          className={btn}
          data-testid="gmail-account-reauth"
          aria-label={t("reauthFor", { email: acct.email }, `Re-authenticate ${acct.email}`)}
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
        <button
          type="button"
          className={btn}
          data-testid="gmail-account-revoke"
          aria-label={t("revokeFor", { email: acct.email }, `Revoke ${acct.email}`)}
          onClick={() => setConfirming(true)}
        >
          {t("revoke", undefined, "Revoke")}
        </button>
        {msg && (
          <span role="alert" className={errorText}>
            {msg}
          </span>
        )}
      </div>
      <p className={`${muted} m-0`} data-testid="gmail-account-filters-help">
        {t(
          "filtersHelp",
          undefined,
          "Filters let agents list, create and delete Gmail filters. Turning them on asks Google for one extra permission (gmail.settings.basic); creating and deleting also need level send.",
        )}
      </p>
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

function AddAccount({
  configured,
  newTier,
  onTier,
  onAdd,
}: {
  configured: boolean;
  newTier: Tier;
  onTier: (t: Tier) => void;
  onAdd: () => void;
}) {
  const t = useT();
  const addReasonId = useId();
  const tierOptions = useTierOptions();
  return (
    <div className="flex flex-col gap-2">
      <SelectField
        label={t("newLevel", undefined, "Level for the new account")}
        hint={null}
        value={newTier}
        options={tierOptions}
        onChange={(v) => onTier(v as Tier)}
        testIds={{ control: "gmail-new-level" }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={primaryBtn}
          data-testid="gmail-add-account"
          disabled={!configured}
          aria-describedby={configured ? undefined : addReasonId}
          onClick={onAdd}
        >
          {t("addAccount", undefined, "Add account")}
        </button>
        {!configured && (
          <span id={addReasonId} className={muted} data-testid="gmail-add-account-reason">
            {t("addAccountDisabled", undefined, "Upload the OAuth client JSON (step 5 above) to enable this.")}
          </span>
        )}
      </div>
      <p className={`${muted} m-0`} data-testid="gmail-cross-org-hint">
        {t(
          "crossOrgHint",
          undefined,
          "Accounts outside the project's Workspace organization need an External audience, with each account added as a test user (step 3).",
        )}
      </p>
    </div>
  );
}

/** Failed sign-in as a severity notice; the sentence names the wizard step that fixes it. */
function FlowErrorNotice({ code, step, errKey, clientId }: { code: string; step: WizardStep | null; errKey: string; clientId: string }) {
  const t = useT();
  return (
    <SettingsNotice tone="error">
      <div data-testid="gmail-flow-error" data-step={step ?? ""}>
        {t(errKey, { clientId }, ERROR_EN[errKey])}{" "}
        <span className="text-[var(--severity-error-fg)]" data-testid="gmail-flow-error-code">
          ({code})
        </span>
      </div>
    </SettingsNotice>
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

  if (loadError) {
    return (
      <SettingsNotice tone="error" testId="gmail-load-error">
        {loadError}
      </SettingsNotice>
    );
  }
  if (!state)
    return (
      <div data-testid="gmail-loading" className={muted}>
        {t("loading", undefined, "Loading…")}
      </div>
    );

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
      <h3 id="gmail-settings-title" className="m-0 text-sm font-semibold text-[var(--text-primary)]">
        {t("title", undefined, "Gmail")}
      </h3>
      <SettingsGroup
        title={t("setup", undefined, "Google Cloud setup")}
        meta={summary}
        summaryTestId="gmail-setup-summary"
        defaultOpen={!client.configured || state.accounts.length === 0 || step !== null}
      >
        <SetupWizard state={state} highlight={step} onUploaded={() => void refresh()} />
      </SettingsGroup>

      <div className="flex flex-col gap-2" data-testid="gmail-accounts">
        <div className="text-sm font-semibold text-[var(--text-primary)]">{t("accounts", undefined, "Accounts")}</div>
        <p className={`${muted} m-0`} data-testid="gmail-level-help">
          {t(
            "levelHelp",
            undefined,
            "Levels are enforced by this plugin, not by Google: a token carries every scope Google granted (draft-level compose access could technically send), so a level limits what the agent's tools may do. Any session on this dashboard can use every account within its level.",
          )}
        </p>
        {state.accounts.length === 0 && <div className={muted}>{t("noAccounts", undefined, "No accounts connected.")}</div>}
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
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
            <p className={`${muted} m-0`} data-testid="gmail-consent-hint">
              {t(
                "consentHint",
                undefined,
                CONSENT_HINT_EN,
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
                <summary className="focus-ring cursor-pointer text-xs text-[var(--text-primary)]">
                  {t("googleErrorSummary", undefined, "Google showed an error instead of returning here?")}
                </summary>
                <div className={muted}>{t("googleErrorHelp", undefined, "Pick the error code Google displayed:")}</div>
                <div className="mt-1 flex flex-wrap gap-2">
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
          <AddAccount configured={client.configured} newTier={newTier} onTier={setNewTier} onAdd={() => void addAccount()} />
        )}
        {flowError && <FlowErrorNotice code={flowError} step={step} errKey={errKey} clientId={client.clientId ?? ""} />}
        {lastRevoke && (
          <div role="status" className={muted} data-testid="gmail-revoke-result">
            {lastRevoke}
          </div>
        )}
      </div>
    </section>
  );
}
