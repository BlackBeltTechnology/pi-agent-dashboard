/**
 * "Set up automatically" (design D3/D5–D11): the secondary entry, the start form,
 * the run progress panel (polls `GET setup/run/:id` every second while live), the
 * human-checkpoint / audience / links / busy prompts and the hand-off notice.
 * The run itself lives in the gmail server; this file only renders its secret-free
 * view and posts the user's answers. "Add account" stays the section's one primary
 * button (it lives in `GmailSettings.tsx`); everything here is secondary.
 * See change: add-gmail-auto-setup.
 */
import { SettingsNotice, TextField, ToggleField, useT, useUiPrimitive } from "@blackbelt-technology/dashboard-plugin-runtime";
import type React from "react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  type Audience,
  type AutoSetupState,
  type CheckpointKind,
  type PublishLinks,
  SETUP_STEP_IDS,
  type SetupDecision,
  type SetupRunRequest,
  type SetupRunState,
  type SetupRunView,
  type SetupStepId,
  type SetupStepStatus,
} from "../shared/auto-setup.js";
import { classifyProjectId, isEmail, normalizeEmail, normalizeProjectId } from "../shared/setup.js";
import { CHECKPOINT_KEY, handoffKey, isLive, LINK_ERROR_KEY, startErrorKey, validateLinks } from "./auto-setup.js";
import { api, btn, errorText, muted } from "./ui.js";
import { ERROR_EN } from "./wizard.js";

const POLL_MS = 1000;

const CHECKPOINT_EN: Record<string, string> = {
  autoCpSignIn:
    "Sign in to Google in the dedicated browser window that just opened, using the owner account. You type the password there yourself; the dashboard never sees it. Setup continues as soon as you are signed in.",
  autoCpTerms: "Google Cloud is asking you to accept its terms of service in the dedicated browser window. Read and accept them there; setup continues afterwards.",
  autoCpPolicy:
    "Tick “I agree to the Google API Services: User Data Policy” in the dedicated browser window yourself. The dashboard never ticks it for you. Setup continues once it is ticked.",
  autoCpPublish:
    "Confirm “Push to production?” in the dedicated browser window. Publishing removes the 7-day token expiry. Setup continues once the app is in production.",
};

const STEP_LABEL: Record<SetupStepId, [key: string, en: string]> = {
  project: ["autoStepProject", "Project"],
  api: ["autoStepApi", "Gmail API"],
  branding: ["autoStepBranding", "Branding"],
  publish: ["autoStepPublish", "Audience + publish"],
  client: ["autoStepClient", "OAuth client"],
  capture: ["autoStepCapture", "Save secret"],
};

const STATUS_LABEL: Record<SetupStepStatus, [key: string, en: string]> = {
  pending: ["autoStatusPending", "waiting"],
  running: ["autoStatusRunning", "in progress"],
  done: ["autoStatusDone", "done"],
  skipped: ["autoStatusSkipped", "already done"],
  handoff: ["autoStatusHandoff", "needs you"],
};

type PollResult = { view: SetupRunView } | { gone: true } | null;

/** One poll: the view, `gone` on 404, or `null` for a transient failure (keep polling). */
async function pollOnce(runId: string): Promise<PollResult> {
  try {
    return { view: await api<SetupRunView>(`/setup/run/${encodeURIComponent(runId)}`) };
  } catch (err) {
    return (err as { status?: number }).status === 404 ? { gone: true } : null;
  }
}

/** Poll the run view every second while the run is live; a 404 means the run is gone. */
function useSetupRun(runId: string | null): { view: SetupRunView | null; lost: boolean; refresh: () => void } {
  const [view, setView] = useState<SetupRunView | null>(null);
  const [lost, setLost] = useState(false);
  const tickRef = useRef<() => void>(() => {});
  useEffect(() => {
    setView(null);
    setLost(false);
    if (!runId) return;
    let stopped = false;
    let inflight = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const stop = () => {
      stopped = true;
      if (timer) clearInterval(timer);
    };
    const tick = async (): Promise<void> => {
      if (stopped || inflight) return;
      inflight = true;
      const r = await pollOnce(runId);
      inflight = false;
      if (stopped || !r) return;
      if ("gone" in r) {
        stop();
        setLost(true);
        return;
      }
      setView(r.view);
      if (!isLive(r.view.state)) stop();
    };
    tickRef.current = () => void tick();
    void tick();
    timer = setInterval(() => void tick(), POLL_MS);
    return stop;
  }, [runId]);
  return { view, lost, refresh: useCallback(() => tickRef.current(), []) };
}

/** A refused request as a sentence: known codes are translated, a 400 shows the server's own rule text. */
function useErrorText() {
  const t = useT();
  return (err: unknown): string => {
    const { code, detail } = err as { code?: string; detail?: string };
    const key = startErrorKey(code);
    if (key) return t(key, undefined, ERROR_EN[key]);
    if (detail) return detail;
    const generic = t("autoErrGeneric", undefined, ERROR_EN.autoErrGeneric);
    return code ? `${generic} (${code})` : generic;
  };
}

const CHIP_TONE = {
  done: "border-[var(--severity-success-border)] bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]",
  handoff: "border-[var(--severity-warning-border)] bg-[var(--severity-warning-bg)] text-[var(--severity-warning-fg)]",
  current: "border-[var(--tint-blue-border)] bg-[var(--tint-blue-bg)] text-[var(--tint-blue-fg)]",
  idle: "border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-secondary)]",
} as const;

function chipTone(st: SetupStepStatus, current: boolean): string {
  if (st === "done" || st === "skipped") return CHIP_TONE.done;
  if (st === "handoff") return CHIP_TONE.handoff;
  return current ? CHIP_TONE.current : CHIP_TONE.idle;
}

function StepChip({ id, status, current }: { id: SetupStepId; status: SetupStepStatus; current: boolean }) {
  const t = useT();
  const [labelKey, labelEn] = STEP_LABEL[id];
  const [statusKey, statusEn] = STATUS_LABEL[status];
  return (
    <li
      data-testid={`gmail-setup-step-${id}`}
      data-status={status}
      aria-current={current ? "step" : undefined}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${chipTone(status, current)}`}
    >
      {status === "done" || status === "skipped" ? <span aria-hidden="true">✓</span> : null}
      {t(labelKey, undefined, labelEn)}
      <span className="sr-only"> — {t(statusKey, undefined, statusEn)}</span>
    </li>
  );
}

function StepChips({ view }: { view: SetupRunView }) {
  const t = useT();
  const live = isLive(view.state);
  const status = new Map(view.steps.map((s) => [s.id, s.status]));
  return (
    <ol className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={t("autoStepsLabel", undefined, "Setup steps")} data-testid="gmail-setup-steps">
      {SETUP_STEP_IDS.map((id) => (
        <StepChip key={id} id={id} status={status.get(id) ?? "pending"} current={live && view.step === id} />
      ))}
    </ol>
  );
}

function AudienceDecision({
  decision,
  busy,
  onChoose,
}: {
  decision: Extract<SetupDecision, { kind: "audience" }>;
  busy: boolean;
  onChoose: (a: Audience) => void;
}) {
  const t = useT();
  const internal = decision.detected === "internal";
  const org = decision.org ?? t("autoOrgFallback", undefined, "its organization");
  return (
    <SettingsNotice tone="info" testId="gmail-setup-audience">
      <div className="flex flex-col gap-2">
        <strong>{t("autoAudienceTitle", undefined, "Who will sign in to this app?")}</strong>
        <span>
          {internal
            ? t(
                "autoAudienceInternalHelp",
                { org },
                `Your account belongs to ${org}. Internal admits only accounts of that organization and shows no unverified-app warning. External admits any Google account you add as a test user and shows “Google hasn't verified this app” at sign-in.`,
              )
            : t(
                "autoAudienceExternalOnly",
                undefined,
                "This project has no organization (a personal Google account), so only External is available. At sign-in Google shows “Google hasn't verified this app”: choose Advanced and continue. Publishing removes the 7-day token expiry and admits at most 100 users.",
              )}
        </span>
        <span className="flex flex-wrap gap-2" role="group" aria-label={t("autoAudienceTitle", undefined, "Who will sign in to this app?")}>
          {internal && (
            <button type="button" className={btn} disabled={busy} data-testid="gmail-setup-audience-internal" onClick={() => onChoose("internal")}>
              {t("autoAudienceInternal", undefined, "Internal")}
            </button>
          )}
          <button type="button" className={btn} disabled={busy} data-testid="gmail-setup-audience-external" onClick={() => onChoose("external")}>
            {t("autoAudienceExternal", undefined, "External")}
          </button>
        </span>
      </div>
    </SettingsNotice>
  );
}

function LinksDecision({
  decision,
  busy,
  onConfirm,
}: {
  decision: Extract<SetupDecision, { kind: "links" }>;
  busy: boolean;
  onConfirm: (links: PublishLinks) => void;
}) {
  const t = useT();
  const [links, setLinks] = useState<PublishLinks>(decision.links);
  const [confirmed, setConfirmed] = useState(false);
  const errors = validateLinks(links);
  const set = (key: keyof PublishLinks) => (v: string) => setLinks((l) => ({ ...l, [key]: v }));
  const err = (key: keyof PublishLinks): string | null => {
    const e = errors[key];
    return e ? t(LINK_ERROR_KEY[e], undefined, ERROR_EN[LINK_ERROR_KEY[e]]) : null;
  };
  const valid = Object.keys(errors).length === 0;
  return (
    <SettingsNotice tone="info" testId="gmail-setup-links">
      <div className="flex flex-col gap-2">
        <strong>{t("autoLinksTitle", undefined, "Links for Google's consent screen")}</strong>
        <span>
          {t(
            "autoLinksHelp",
            undefined,
            "Google requires a home page, a privacy-policy link and an authorized domain before an External app can be published. They appear on Google's consent screen for every account that signs in. The defaults point at the dashboard's public repository; replace them with your own if you prefer.",
          )}
        </span>
        <TextField
          label={t("autoLinkHome", undefined, "Home page")}
          hint={null}
          mono
          value={links.homePage}
          onChange={set("homePage")}
          error={err("homePage")}
          testIds={{ control: "gmail-setup-link-home", error: "gmail-setup-link-home-error" }}
        />
        <TextField
          label={t("autoLinkPrivacy", undefined, "Privacy policy")}
          hint={null}
          mono
          value={links.privacyPolicy}
          onChange={set("privacyPolicy")}
          error={err("privacyPolicy")}
          testIds={{ control: "gmail-setup-link-privacy", error: "gmail-setup-link-privacy-error" }}
        />
        <TextField
          label={t("autoLinkDomain", undefined, "Authorized domain")}
          hint={null}
          mono
          value={links.authorizedDomain}
          onChange={set("authorizedDomain")}
          error={err("authorizedDomain")}
          testIds={{ control: "gmail-setup-link-domain", error: "gmail-setup-link-domain-error" }}
        />
        <ToggleField
          label={t("autoLinksConfirm", undefined, "I understand these links appear on Google's consent screen for every account, and I want to use them.")}
          hint={null}
          testIds={{ control: "gmail-setup-links-confirm" }}
          value={confirmed}
          onChange={setConfirmed}
        />
        <span>
          <button
            type="button"
            className={btn}
            disabled={busy || !confirmed || !valid}
            data-testid="gmail-setup-links-continue"
            onClick={() => onConfirm({ homePage: links.homePage.trim(), privacyPolicy: links.privacyPolicy.trim(), authorizedDomain: links.authorizedDomain.trim().toLowerCase() })}
          >
            {t("autoLinksContinue", undefined, "Use these links")}
          </button>
        </span>
      </div>
    </SettingsNotice>
  );
}

function BusyNotice({ holder, busy, onTakeover }: { holder?: string; busy: boolean; onTakeover: () => void }) {
  const t = useT();
  const ConfirmDialog = useUiPrimitive("ui:confirm-dialog");
  const [confirming, setConfirming] = useState(false);
  const who = holder ?? t("autoBusyUnknown", undefined, "another session");
  return (
    <SettingsNotice tone="warning" testId="gmail-setup-busy">
      <div className="flex flex-col gap-2">
        <span data-testid="gmail-setup-busy-holder">
          {t("autoBusy", { holder: who }, `The dedicated browser is in use by ${who}. Setup waits until it is free, or you can take it over.`)}
        </span>
        <span>
          <button type="button" className={btn} disabled={busy} data-testid="gmail-setup-takeover" onClick={() => setConfirming(true)}>
            {t("autoTakeover", undefined, "Take over")}
          </button>
        </span>
      </div>
      {confirming && (
        <ConfirmDialog
          message={t(
            "autoTakeoverConfirm",
            { holder: who },
            `Take the dedicated browser over from ${who}? Whatever it is doing there is interrupted.`,
          )}
          confirmLabel={t("autoTakeover", undefined, "Take over")}
          onConfirm={() => {
            setConfirming(false);
            onTakeover();
          }}
          onCancel={() => setConfirming(false)}
        />
      )}
    </SettingsNotice>
  );
}

/** Hand-off: why it stopped, what Google already has, and (capture) how to add a new secret. */
function HandoffNotice({ view }: { view: SetupRunView }) {
  const t = useT();
  const h = view.handoff;
  if (!h) return null;
  const key = handoffKey(h.reason);
  const projectId = view.created.projectId;
  const clients = view.created.clients;
  const client = clients[clients.length - 1] ?? "";
  return (
    <SettingsNotice tone="warning" testId="gmail-setup-handoff">
      <div className="flex flex-col gap-1.5" data-reason={h.reason} data-step={h.wizardStep}>
        <strong>{t("autoHandoffTitle", undefined, "Automatic setup stopped — finish by hand")}</strong>
        <span data-testid="gmail-setup-handoff-reason">{t(key, undefined, ERROR_EN[key])}</span>
        {h.reason === "domain_blocked" && h.domains && h.domains.length > 0 && (
          <ul className="m-0 list-disc pl-5" data-testid="gmail-setup-handoff-domains">
            {h.domains.map((d) => (
              <li key={d}>
                <code>{d}</code>
              </li>
            ))}
          </ul>
        )}
        <span>
          {t(
            "autoHandoffAt",
            { step: h.wizardStep },
            `Continue at step ${h.wizardStep} of the manual setup below; the project id and owner account are already filled in.`,
          )}
        </span>
        {(projectId || clients.length > 0) && (
          <div data-testid="gmail-setup-created">
            <span>{t("autoCreated", undefined, "Already created in Google Cloud:")}</span>
            <ul className="m-0 list-disc pl-5">
              {projectId && <li>{t("autoCreatedProject", { id: projectId }, `Project ${projectId}`)}</li>}
              {clients.map((c) => (
                <li key={c}>{t("autoCreatedClient", { name: c }, `OAuth client ${c}`)}</li>
              ))}
            </ul>
          </div>
        )}
        {h.reason === "secret_capture_failed" && client && (
          <span data-testid="gmail-setup-secret-help">
            {t(
              "autoSecretHelp",
              { client },
              `Google shows a client secret only once, when the client is created, so ${client} cannot be read back. In the console open APIs & Services → Credentials → ${client}, choose “Add secret”, download the new JSON and upload it in step 5 below.`,
            )}
          </span>
        )}
      </div>
    </SettingsNotice>
  );
}

/** Report a `done` / `handoff` view to the parent once per run state. */
function useReportTerminal(view: SetupRunView | null, onFinished: (v: SetupRunView) => void): void {
  const latest = useRef(onFinished);
  latest.current = onFinished;
  const reported = useRef("");
  useEffect(() => {
    if (!view || (view.state !== "done" && view.state !== "handoff")) return;
    const key = `${view.runId}:${view.state}`;
    if (reported.current === key) return;
    reported.current = key;
    latest.current(view);
  }, [view]);
}

function CheckpointNotice({ kind, busy, onSignedIn }: { kind: CheckpointKind; busy: boolean; onSignedIn: () => void }) {
  const t = useT();
  return (
    <SettingsNotice tone="info" testId="gmail-setup-checkpoint">
      <div className="flex flex-col gap-2" data-kind={kind}>
        <span>{t(CHECKPOINT_KEY[kind], undefined, CHECKPOINT_EN[CHECKPOINT_KEY[kind]])}</span>
        {kind === "sign_in" && (
          <span>
            <button type="button" className={btn} disabled={busy} data-testid="gmail-setup-signed-in" onClick={onSignedIn}>
              {t("autoSignedIn", undefined, "I've signed in")}
            </button>
          </span>
        )}
      </div>
    </SettingsNotice>
  );
}

function EndNotice({ state }: { state: SetupRunState }) {
  const t = useT();
  if (state === "done") {
    return (
      <SettingsNotice tone="success" testId="gmail-setup-done">
        {t("autoDone", undefined, "Automatic setup finished and the OAuth client is saved. Add your Google account below.")}
      </SettingsNotice>
    );
  }
  if (state !== "cancelled") return null;
  return (
    <SettingsNotice tone="info" testId="gmail-setup-cancelled">
      {t("autoCancelled", undefined, "Automatic setup was cancelled. Anything it already created in Google Cloud is kept.")}
    </SettingsNotice>
  );
}

function LostNotice({ onDismiss }: { onDismiss: () => void }) {
  const t = useT();
  return (
    <SettingsNotice tone="warning" testId="gmail-setup-lost">
      <div className="flex flex-col gap-2">
        <span>
          {t(
            "autoLost",
            undefined,
            "The setup run is no longer available, for example after a dashboard restart. Start it again; it continues from the first unfinished step.",
          )}
        </span>
        <span>
          <button type="button" className={btn} data-testid="gmail-setup-dismiss" onClick={onDismiss}>
            {t("autoDismiss", undefined, "Dismiss")}
          </button>
        </span>
      </div>
    </SettingsNotice>
  );
}

function RunPanel({
  runId,
  onAudience,
  onDismiss,
  onFinished,
}: {
  runId: string;
  onAudience: (a: Audience) => void;
  onDismiss: () => void;
  /** Run reached `done` or `handoff` (reported once per run state). */
  onFinished: (v: SetupRunView) => void;
}) {
  const t = useT();
  const errorTextOf = useErrorText();
  const { view, lost, refresh } = useSetupRun(runId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  useReportTerminal(view, onFinished);

  const act = async (path: string, init: RequestInit): Promise<boolean> => {
    setActionError(null);
    setBusy(true);
    try {
      await api(`/setup/run/${encodeURIComponent(runId)}${path}`, init);
      refresh();
      return true;
    } catch (err) {
      setActionError(errorTextOf(err));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const post = (path: string, body: object) => act(path, { method: "POST", body: JSON.stringify(body) });

  if (lost) return <LostNotice onDismiss={onDismiss} />;
  if (!view) {
    return (
      <div role="status" className={muted} data-testid="gmail-setup-loading">
        {t("autoStarting", undefined, "Starting the dedicated browser…")}
      </div>
    );
  }

  const live = isLive(view.state);
  return (
    <div className="flex flex-col gap-2" data-testid="gmail-setup-run" data-state={view.state} aria-busy={live || undefined}>
      <h4 ref={heading} tabIndex={-1} className="focus-ring m-0 text-xs font-semibold text-[var(--text-primary)]">
        {t("autoRunTitle", undefined, "Automatic setup")}
      </h4>
      <StepChips view={view} />
      {(view.state === "starting" || view.state === "running") && (
        <div role="status" className={muted} data-testid="gmail-setup-working">
          {view.state === "starting"
            ? t("autoStarting", undefined, "Starting the dedicated browser…")
            : t("autoWorking", undefined, "Working in the dedicated browser window. You do not need to do anything yet.")}
        </div>
      )}
      {view.state === "waiting_user" && view.checkpoint && (
        <CheckpointNotice kind={view.checkpoint.kind} busy={busy} onSignedIn={() => void post("/continue", {})} />
      )}
      {view.state === "waiting_decision" && view.decision?.kind === "audience" && (
        <AudienceDecision
          decision={view.decision}
          busy={busy}
          onChoose={(audience) => void post("/continue", { audience }).then((ok) => ok && onAudience(audience))}
        />
      )}
      {view.state === "waiting_decision" && view.decision?.kind === "links" && (
        <LinksDecision
          key={JSON.stringify(view.decision.links)}
          decision={view.decision}
          busy={busy}
          onConfirm={(links) => void post("/continue", { links, confirmLinks: true })}
        />
      )}
      {view.state === "busy" && <BusyNotice holder={view.busy?.holder} busy={busy} onTakeover={() => void act("/takeover", { method: "POST" })} />}
      <EndNotice state={view.state} />
      {view.state === "handoff" && <HandoffNotice view={view} />}
      {actionError && (
        <div role="alert" className={errorText} data-testid="gmail-setup-action-error">
          {actionError}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {live ? (
          <button type="button" className={btn} disabled={busy} data-testid="gmail-setup-cancel" onClick={() => void act("", { method: "DELETE" })}>
            {t("autoCancel", undefined, "Cancel setup")}
          </button>
        ) : (
          <button type="button" className={btn} data-testid="gmail-setup-dismiss" onClick={onDismiss}>
            {t("autoDismiss", undefined, "Dismiss")}
          </button>
        )}
      </div>
    </div>
  );
}

function StartForm({
  id,
  defaults,
  starting,
  error,
  onStart,
  onClose,
}: {
  id: string;
  defaults: { projectId: string; ownerEmail: string };
  starting: boolean;
  error: string | null;
  onStart: (req: SetupRunRequest) => void;
  onClose: () => void;
}) {
  const t = useT();
  const [mode, setMode] = useState<"new" | "existing">(defaults.projectId ? "existing" : "new");
  const [projectId, setProjectId] = useState(defaults.projectId);
  const [owner, setOwner] = useState(defaults.ownerEmail);
  const [touched, setTouched] = useState({ project: false, owner: false });
  const ownerEmail = normalizeEmail(owner);
  const ownerOk = isEmail(ownerEmail);
  const cls = classifyProjectId(projectId);
  // New mode: an empty id is fine (the run generates one); a typed one must be valid.
  const projectOk = mode === "existing" ? cls === "ok" : projectId.trim() === "" || cls === "ok";
  const ownerErr = touched.owner && !ownerOk ? t("errOwnerInvalid", undefined, "Enter a full email address, for example you@gmail.com.") : null;
  const projectErr =
    touched.project && !projectOk
      ? cls === "looks_like_name"
        ? t("errProjectLooksLikeName", undefined, "That looks like the project name. The wizard needs the project id (lower-case, for example pidashboard-510015): open the project list and copy the ID column.")
        : t("errProjectInvalid", undefined, "A project id is 6–30 characters: lower-case letters, digits and hyphens, starting with a letter and not ending with a hyphen.")
      : null;
  const submit = () => {
    setTouched({ project: true, owner: true });
    if (!ownerOk || !projectOk) return;
    onStart({
      mode,
      ownerEmail,
      ...(cls === "ok" && projectId.trim() ? { projectId: normalizeProjectId(projectId) } : {}),
    });
  };
  return (
    <div id={id} role="group" aria-label={t("autoRunTitle", undefined, "Automatic setup")} className="flex flex-col gap-2" data-testid="gmail-setup-form">
      <fieldset className="m-0 flex flex-wrap items-center gap-3 border-0 p-0" data-testid="gmail-setup-mode">
        <legend className="sr-only">{t("projectModeLegend", undefined, "Project")}</legend>
        {(["new", "existing"] as const).map((m) => (
          <label key={m} className={`${muted} flex items-center gap-1`}>
            <input
              type="radio"
              name="gmail-setup-mode"
              value={m}
              checked={mode === m}
              onChange={() => setMode(m)}
              className="focus-ring"
              data-testid={`gmail-setup-mode-${m}`}
            />
            {m === "new" ? t("projectModeNew", undefined, "Create a new project") : t("projectModeExisting", undefined, "Use an existing project")}
          </label>
        ))}
      </fieldset>
      <div onBlur={() => setTouched((x) => ({ ...x, project: true }))}>
        <TextField
          label={mode === "new" ? t("autoProjectOptional", undefined, "Project id (optional)") : t("projectId", undefined, "Project id")}
          hint={
            mode === "new"
              ? t("autoProjectNewHint", undefined, "Leave empty and the setup picks a free id like pi-dashboard-ab12cd.")
              : t("autoProjectExistingHint", undefined, "The id of your existing Google Cloud project (the ID column of the console's project list), not its display name.")
          }
          error={projectErr}
          mono
          value={projectId}
          onChange={setProjectId}
          placeholder="my-gmail-agent"
          testIds={{ control: "gmail-setup-project-id", error: "gmail-setup-project-error" }}
        />
      </div>
      <div onBlur={() => setTouched((x) => ({ ...x, owner: true }))}>
        <TextField
          label={t("autoOwnerLabel", undefined, "Google account that owns the project")}
          hint={t("autoOwnerHint", undefined, "You will sign in with this account in the dedicated browser window. The setup never sees its password.")}
          error={ownerErr}
          type="email"
          autoComplete="email"
          value={owner}
          onChange={setOwner}
          placeholder="you@gmail.com"
          testIds={{ control: "gmail-setup-owner", error: "gmail-setup-owner-error" }}
        />
      </div>
      {error && (
        <div role="alert" className={errorText} data-testid="gmail-setup-start-error">
          {error}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={btn} disabled={starting} data-testid="gmail-setup-start" onClick={submit}>
          {t("autoStart", undefined, "Start automatic setup")}
        </button>
        <button type="button" className={btn} data-testid="gmail-setup-close" onClick={onClose}>
          {t("autoClose", undefined, "Close")}
        </button>
      </div>
    </div>
  );
}

export interface AutoSetupSectionProps {
  autoSetup?: AutoSetupState;
  /** Saved setup fields, used to prefill the start form. */
  setup?: { projectId?: string; ownerAccount?: string };
  /** The user picked an audience (feeds the sign-in unverified-app notice, D11). */
  onAudience: (a: Audience) => void;
  /** Run reached `done`: the owner email prefills "Add account". */
  onOwnerEmail: (email: string) => void;
  /** Run reached `handoff` (view) or the hand-off was dismissed / a new run started (null). */
  onHandoff: (v: SetupRunView | null) => void;
  /** Reload `GET state` (the run changed what is configured). */
  onRefresh: () => void;
}

function RemoteNote() {
  const t = useT();
  return (
    <SettingsNotice tone="info" testId="gmail-setup-remote">
      {t(
        "autoRemoteNote",
        undefined,
        "Automatic setup needs a browser window on the computer that runs the dashboard, so it is offered only when you open the dashboard on that computer. Use the manual steps below.",
      )}
    </SettingsNotice>
  );
}

/** The secondary entry button, the replace notice and (when open) the start form. */
function Entry({
  autoSetup,
  setup,
  starting,
  startError,
  onStart,
}: {
  autoSetup: AutoSetupState;
  setup: AutoSetupSectionProps["setup"];
  starting: boolean;
  startError: string | null;
  onStart: (req: SetupRunRequest) => void;
}) {
  const t = useT();
  const formId = useId();
  const [formOpen, setFormOpen] = useState(false);
  return (
    <div className="flex flex-col gap-2" data-testid="gmail-setup-auto">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={btn}
          data-testid="gmail-setup-entry"
          aria-expanded={formOpen}
          aria-controls={formOpen ? formId : undefined}
          onClick={() => setFormOpen((o) => !o)}
        >
          {t("autoEntry", undefined, "Set up automatically")}
        </button>
        <span className={muted}>
          {t("autoEntryHelp", undefined, "Opens a dedicated browser window on this computer and does the console steps for you. You do the sign-in and the consent clicks yourself.")}
        </span>
      </div>
      {autoSetup.replacesClient && (
        <SettingsNotice tone="warning" testId="gmail-setup-replace">
          {t("autoReplaceNote", undefined, "An OAuth client is already configured, but no account uses it. Automatic setup replaces it with a new client.")}
        </SettingsNotice>
      )}
      {formOpen && (
        <StartForm
          id={formId}
          defaults={{ projectId: setup?.projectId ?? "", ownerEmail: setup?.ownerAccount ?? "" }}
          starting={starting}
          error={startError}
          onStart={onStart}
          onClose={() => setFormOpen(false)}
        />
      )}
    </div>
  );
}

/** Entry (per `autoSetup`) + start form + run panel. Renders nothing when unavailable and no run is shown. */
export function AutoSetupSection({ autoSetup, setup, onAudience, onOwnerEmail, onHandoff, onRefresh }: AutoSetupSectionProps): React.ReactElement | null {
  const errorTextOf = useErrorText();
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const dismissed = useRef(new Set<string>());

  // Re-attach to a run the server still holds (page reload mid-run).
  const attachId = autoSetup?.runId;
  useEffect(() => {
    if (attachId && !runId && !dismissed.current.has(attachId)) setRunId(attachId);
  }, [attachId, runId]);

  const start = async (req: SetupRunRequest): Promise<void> => {
    setStartError(null);
    setStarting(true);
    try {
      const r = await api<{ runId: string }>("/setup/run", { method: "POST", body: JSON.stringify(req) });
      onHandoff(null);
      setRunId(r.runId);
    } catch (err) {
      setStartError(errorTextOf(err));
    } finally {
      setStarting(false);
    }
  };
  const dismiss = () => {
    if (runId) dismissed.current.add(runId);
    setRunId(null);
    onHandoff(null);
  };
  const finished = (v: SetupRunView) => {
    if (v.state === "done" && v.ownerEmail) onOwnerEmail(v.ownerEmail);
    if (v.state === "handoff") onHandoff(v);
    onRefresh();
  };

  if (runId) {
    return (
      <div className="flex flex-col gap-2" data-testid="gmail-setup-auto">
        <RunPanel runId={runId} onAudience={onAudience} onDismiss={dismiss} onFinished={finished} />
      </div>
    );
  }
  if (!autoSetup) return null;
  if (autoSetup.available) return <Entry autoSetup={autoSetup} setup={setup} starting={starting} startError={startError} onStart={(req) => void start(req)} />;
  return !autoSetup.local || autoSetup.reason === "remote_dashboard" ? <RemoteNote /> : null;
}
