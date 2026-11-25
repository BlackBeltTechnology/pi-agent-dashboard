/**
 * Guided Google Cloud setup (manual wizard, steps 1–4): console deep links + copyable gcloud commands for an
 * organisation's own OAuth client. Presentational — the project id / owner account are local state; the client
 * JSON upload lives in the "Add organisation sign-in" form. Ported from the gmail plugin and now enabling every
 * product API. See change: add-google-connect.
 */
import { copyText, SafeLink, TextField, useT } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../shared/setup.js";
import { btn, muted } from "./ui.js";
import { AUDIENCE_HELP_EN, consoleLinks, gcloudCommands, type WizardStep } from "./wizard.js";

type Translate = ReturnType<typeof useT>;

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
    <div className={muted} data-testid={`google-need-project-id-step-${step}`}>
      {t("needValidProjectId", undefined, "A valid project id is needed before the project links and commands appear.")}
    </div>
  );
}

function StepLink({ href, label }: { href: string; label: string }) {
  return (
    <SafeLink href={href} target="_blank" rel="noopener noreferrer" className="focus-ring text-xs text-[var(--accent-text)] underline">
      {label}
    </SafeLink>
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
      data-testid={`google-step-${n}`}
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


function projectErrorText(t: Translate, projectErr: "looks_like_name" | "invalid" | null): string | null {
  return (
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
        : null
  );
}


function ProjectModeLinks({
  mode,
  links,
  cmds,
}: {
  mode: "new" | "existing";
  links: ReturnType<typeof consoleLinks>;
  cmds: ReturnType<typeof gcloudCommands>;
}) {
  const t = useT();
  return mode === "new" ? (
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
  );
}


function AuthLoginNote({ cmds }: { cmds: ReturnType<typeof gcloudCommands> }) {
  const t = useT();
  if (!cmds.authLogin) return null;
  return (
    <>
      <div className={muted} data-testid="google-auth-login-note">
        {t("authLoginNote", undefined, "Run this once first, so gcloud can act as the owner account:")}
      </div>
      <Copyable value={cmds.authLogin} />
    </>
  );
}

function EnableApis({ links, cmds }: { links: ReturnType<typeof consoleLinks>; cmds: ReturnType<typeof gcloudCommands> }) {
  const t = useT();
  return links.enableApis && cmds.enable ? (
    <>
      <div className="flex gap-3">
        <StepLink href={links.enableApis} label={t("enableApis", undefined, "Enable the Google product APIs")} />
      </div>
      <Copyable value={cmds.enable} />
    </>
  ) : (
    <div className={muted} data-testid="google-need-project-id">
      {t("needValidProjectId", undefined, "A valid project id is needed before the project links and commands appear.")}
    </div>
  );
}

export interface SetupWizardProps {
  /** Step to emphasise (a hand-off or upload error maps to a step); `null` = the first step. */
  highlight: WizardStep | null;
  /** Prefill from an automatic-setup hand-off. */
  initial?: { projectId?: string; owner?: string };
  /** The owner account the user typed (valid or empty), so the add form can record it. */
  onOwner?: (email: string) => void;
}

/** Manual wizard: steps 1–4 (project + APIs, branding, audience, OAuth client). */
export function SetupWizard({ highlight, initial, onOwner }: SetupWizardProps) {
  const t = useT();
  const [projectId, setProjectId] = useState(initial?.projectId ?? "");
  const [owner, setOwner] = useState(initial?.owner ?? "");
  // Presentational only: `existing` by default once a project id is known.
  const [mode, setMode] = useState<"new" | "existing">(initial?.projectId ? "existing" : "new");
  // Validation errors appear on blur only and clear the moment the value turns valid.
  const [projectErr, setProjectErr] = useState<"looks_like_name" | "invalid" | null>(null);
  const [ownerErr, setOwnerErr] = useState(false);
  const links = consoleLinks(projectId, owner);
  const cmds = gcloudCommands(projectId, owner);
  const current: WizardStep = highlight ?? 1;

  const onProjectChange = (v: string) => {
    setProjectId(v);
    if (!v.trim() || classifyProjectId(v) === "ok") setProjectErr(null);
  };
  const onProjectBlur = () => {
    const cls = classifyProjectId(projectId);
    setProjectErr(cls === "looks_like_name" || cls === "invalid" ? cls : null);
  };
  const onOwnerChange = (v: string) => {
    setOwner(v);
    const email = normalizeEmail(v);
    if (!v.trim() || isEmail(email)) {
      setOwnerErr(false);
      onOwner?.(email);
    }
  };
  const onOwnerBlur = () => {
    const email = normalizeEmail(owner);
    setOwnerErr(!!email && !isEmail(email));
  };
  const done = (n: WizardStep) => n < current;

  return (
    <ol className="m-0 flex list-none flex-col p-0" data-testid="google-wizard">
      <WizardStepItem n={1} title={t("step1", undefined, "1. Google Cloud project + product APIs")} current={current === 1} done={done(1)}>
        <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0" data-testid="google-project-mode">
          <legend className="sr-only">{t("projectModeLegend", undefined, "Project")}</legend>
          {(["new", "existing"] as const).map((m) => (
            <label key={m} className={`${muted} flex items-center gap-1`}>
              <input
                type="radio"
                name="google-project-mode"
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
                className="focus-ring"
                data-testid={`google-project-mode-${m}`}
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
                {t("projectIdHint", undefined, "The id of your Google Cloud project, not its display name: lower-case letters, digits and hyphens, for example acme-pi-connect.")}
                {projectErr === "looks_like_name" && (
                  <>
                    {" "}
                    <StepLink href={links.projectList} label={t("openProjectList", undefined, "Open the project list")} />
                  </>
                )}
              </>
            }
            error={projectErrorText(t, projectErr)}
            mono
            value={projectId}
            onChange={onProjectChange}
            placeholder="acme-pi-connect"
            testIds={{ control: "google-project-id", error: "google-project-error" }}
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
            error={ownerErr ? t("errOwnerInvalid", undefined, "Enter a full email address, for example you@example.com.") : null}
            value={owner}
            onChange={onOwnerChange}
            placeholder="you@example.com"
            testIds={{ control: "google-owner-account", error: "google-owner-error" }}
          />
        </div>
        <AuthLoginNote cmds={cmds} />
        <ProjectModeLinks mode={mode} links={links} cmds={cmds} />
        <EnableApis links={links} cmds={cmds} />
      </WizardStepItem>
      <WizardStepItem n={2} title={t("step2", undefined, "2. Branding")} current={current === 2} done={done(2)}>
        <ProjectLink href={links.branding} label={t("openBranding", undefined, "Open Branding")} step={2} />
        <div className={muted}>{t("fallback2", undefined, "If the link moved: APIs & Services → OAuth consent screen.")}</div>
      </WizardStepItem>
      <WizardStepItem n={3} title={t("step3", undefined, "3. Audience + test users")} current={current === 3} done={done(3)}>
        <ProjectLink href={links.audience} label={t("openAudience", undefined, "Open Audience")} step={3} />
        <div className={muted}>{t("audienceHelp", undefined, AUDIENCE_HELP_EN)}</div>
        <div className={muted}>
          {t(
            "audienceErrors",
            undefined,
            "Google error pages: org_internal = the account is outside the organisation, switch to External; access_denied = add the account as a test user; admin_policy_enforced = that account's Workspace admin must trust the OAuth client.",
          )}
        </div>
      </WizardStepItem>
      <WizardStepItem n={4} title={t("step4", undefined, "4. OAuth client")} current={current === 4} done={done(4)}>
        <ProjectLink href={links.clientCreate} label={t("openClients", undefined, "Create client")} step={4} />
        <div className={muted}>
          {t(
            "clientHelp",
            undefined,
            "Application type: Desktop app (or Web application, then register the redirect URI shown under the client). Download the JSON and choose it in the form.",
          )}
        </div>
      </WizardStepItem>
    </ol>
  );
}
