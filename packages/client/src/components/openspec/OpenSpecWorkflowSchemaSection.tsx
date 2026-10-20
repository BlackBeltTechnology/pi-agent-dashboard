/**
 * OpenSpec Workflow Schema settings section (`/settings/openspec#workflow-schema`).
 *
 * - "Default for new projects" switch: a Save-Bar draft owned by the caller
 *   (SettingsPanel config draft → `PUT /api/config`); this component only
 *   renders it.
 * - One card per cwd: status pill + one plain sentence + at most one
 *   recommended action; every other allowed action sits in a "More actions"
 *   menu button (APG menu pattern). Actions write repository files IMMEDIATELY
 *   after a per-action confirmation dialog and are NOT a Save Bar source (no
 *   draft, no baseline, no dirty count). Availability mirrors the server's
 *   allowed-state table (`allowedWorkflowSchemaActions`); presentation is the
 *   pure `workflowSchemaPresentation`.
 * - Only the acting card is busy; the result is a severity callout under it.
 *
 * There is no dry-run endpoint, so the dialog's path list is derived
 * client-side from known data; the worktree branch comes from
 * `GET /api/git/worktrees` (best-effort).
 *
 * Visual design: the approved mockup (`openspec/changes/add-pi-spec-driven-schema/mockups/`),
 * tokens and recipes of `ui-contract.md`; no raw palette classes.
 *
 * See change: add-pi-spec-driven-schema.
 */

import { ToggleField } from "@blackbelt-technology/dashboard-plugin-runtime";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type { OpenSpecWorkflowSchemaStatus } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiAlert,
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiDeleteOutline,
  mdiDotsVertical,
  mdiFileSwapOutline,
  mdiInformationOutline,
  mdiLinkVariant,
  mdiMinusCircleOutline,
  mdiPinOutline,
  mdiRefresh,
  mdiSync,
  mdiToggleSwitchOffOutline,
  mdiToggleSwitchOutline,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useId, useRef, useState } from "react";
import { useSearch } from "wouter";
import { fetchWorktrees } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useOpenSpecMap } from "../../lib/openspec/OpenSpecMapContext.js";
import {
  BUILTIN_DEFAULT_SCHEMA,
  previousDefaultOptions,
  richParts,
  runWorkflowSchemaAction,
  SEVERITY_PILL_CLASS,
  type SentencePart,
  WORKFLOW_SCHEMA_NAME,
  type WorkflowSchemaAction,
  type WorkflowSchemaCardKey,
  type WorkflowSchemaOutcome,
  type WorkflowSchemaPresentation,
  type WorkflowSchemaSeverity,
  workflowSchemaPresentation,
} from "../../lib/openspec/openspec-workflow-schema-api.js";

interface Props {
  defaultForNewProjects: boolean;
  onDefaultChange: (next: boolean) => void;
}

const SCHEMA_DIR = "openspec/schemas/pi-spec-driven/";
const CONFIG_PATH = "openspec/config.yaml";
const PIN_FILE = ".openspec.yaml";
const ENABLE_PIN_GLOB = `openspec/changes/*/${PIN_FILE}`;
const KEEP_RECORDED = "";
const MAX_NAMES = 5;

const baseName = (cwd: string) => cwd.replace(/\/+$/, "").split("/").pop() || cwd;
const capitalize = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

// ── per-action copy (every string through i18n) ─────────────────────────────

const ACTION_ICON: Record<WorkflowSchemaAction, string> = {
  enable: mdiToggleSwitchOutline,
  disable: mdiToggleSwitchOffOutline,
  update: mdiRefresh,
  adopt: mdiFileSwapOutline,
  pin: mdiPinOutline,
  remove: mdiDeleteOutline,
};

const PILL_ICON: Record<WorkflowSchemaCardKey, string> = {
  none: mdiMinusCircleOutline,
  kept: mdiMinusCircleOutline,
  enabled: mdiCheckCircleOutline,
  unpinned: mdiAlert,
  outdated: mdiAlert,
  unmanaged: mdiAlert,
  newer: mdiInformationOutline,
  incompatible: mdiAlertCircleOutline,
  conflict: mdiAlertCircleOutline,
  missing: mdiAlertCircleOutline,
  missingDefault: mdiAlertCircleOutline,
};

const CALLOUT_ICON: Record<WorkflowSchemaSeverity, string> = {
  success: mdiCheckCircleOutline,
  warning: mdiAlert,
  error: mdiAlertCircleOutline,
  info: mdiInformationOutline,
  neutral: mdiInformationOutline,
};

/** Short verb: "Run Enable again", "Enable was refused". */
function verb(a: WorkflowSchemaAction): string {
  switch (a) {
    case "enable": return i18nT("openspec.schemaVerb.enable", undefined, "Enable");
    case "disable": return i18nT("openspec.schemaVerb.disable", undefined, "Disable");
    case "update": return i18nT("openspec.schemaVerb.update", undefined, "Update");
    case "adopt": return i18nT("openspec.schemaVerb.adopt", undefined, "Adopt");
    case "pin": return i18nT("openspec.schemaVerb.pin", undefined, "Pin");
    case "remove": return i18nT("openspec.schemaVerb.remove", undefined, "Remove");
  }
}

function past(a: WorkflowSchemaAction): string {
  switch (a) {
    case "enable": return i18nT("openspec.schemaPast.enable", undefined, "Enabled");
    case "disable": return i18nT("openspec.schemaPast.disable", undefined, "Disabled");
    case "update": return i18nT("openspec.schemaPast.update", undefined, "Updated");
    case "adopt": return i18nT("openspec.schemaPast.adopt", undefined, "Adopted");
    case "pin": return i18nT("openspec.schemaPast.pin", undefined, "Pinned");
    case "remove": return i18nT("openspec.schemaPast.remove", undefined, "Removed");
  }
}

function busyLabel(a: WorkflowSchemaAction): string {
  switch (a) {
    case "enable": return i18nT("openspec.schemaBusy.enable", undefined, "Enabling…");
    case "disable": return i18nT("openspec.schemaBusy.disable", undefined, "Disabling…");
    case "update": return i18nT("openspec.schemaBusy.update", undefined, "Updating…");
    case "adopt": return i18nT("openspec.schemaBusy.adopt", undefined, "Adopting…");
    case "pin": return i18nT("openspec.schemaBusy.pin", undefined, "Pinning…");
    case "remove": return i18nT("openspec.schemaBusy.remove", undefined, "Removing…");
  }
}

/** Singular/plural pick (the catalog has no plural rules): two keys. */
function plural(count: number, oneKey: string, oneFb: string, manyKey: string, manyFb: string): string {
  return count === 1 ? i18nT(oneKey, { count: String(count) }, oneFb) : i18nT(manyKey, { count: String(count) }, manyFb);
}

/** Card button / menu item label (with the trailing "…" of a dialog opener). */
function actionLabel(a: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus, key: WorkflowSchemaCardKey): string {
  switch (a) {
    case "enable": return i18nT("openspec.schemaAct.enable", undefined, "Enable…");
    case "disable": return i18nT("openspec.schemaAct.disable", undefined, "Disable…");
    case "update":
      return key === "missing"
        ? i18nT("openspec.schemaAct.regenerate", undefined, "Regenerate…")
        : i18nT("openspec.schemaAct.update", undefined, "Update schema…");
    case "adopt": return i18nT("openspec.schemaAct.adopt", undefined, "Adopt…");
    case "pin":
      return plural(s.unpinnedChanges.length, "openspec.schemaAct.pinOne", "Pin {count} change…", "openspec.schemaAct.pinMany", "Pin {count} changes…");
    case "remove": return i18nT("openspec.schemaAct.remove", undefined, "Remove schema files…");
  }
}

/** Dialog confirm button: names the outcome. */
function confirmLabel(a: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus): string {
  switch (a) {
    case "enable": return i18nT("openspec.schemaConfirm.enable", undefined, "Enable");
    case "disable": return i18nT("openspec.schemaConfirm.disable", undefined, "Disable");
    case "update": return i18nT("openspec.schemaConfirm.update", undefined, "Update schema");
    case "adopt": return i18nT("openspec.schemaConfirm.adopt", undefined, "Adopt and regenerate");
    case "pin":
      return plural(s.unpinnedChanges.length, "openspec.schemaConfirm.pinOne", "Pin {count} change", "openspec.schemaConfirm.pinMany", "Pin {count} changes");
    case "remove": return i18nT("openspec.schemaConfirm.remove", undefined, "Remove schema files");
  }
}

function dialogTitle(a: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus, name: string): string {
  const vars = { name };
  switch (a) {
    case "enable": return i18nT("openspec.schemaTitle.enable", vars, "Enable pi-spec-driven in {name}?");
    case "disable": return i18nT("openspec.schemaTitle.disable", vars, "Disable pi-spec-driven in {name}?");
    case "update": return i18nT("openspec.schemaTitle.update", vars, "Update pi-spec-driven in {name}?");
    case "adopt": return i18nT("openspec.schemaTitle.adopt", vars, "Adopt pi-spec-driven in {name}?");
    case "remove": return i18nT("openspec.schemaTitle.remove", vars, "Remove pi-spec-driven from {name}?");
    case "pin": {
      const count = s.unpinnedChanges.length;
      const v = { name, count: String(count) };
      return count === 1
        ? i18nT("openspec.schemaTitle.pinOne", v, "Pin {count} change in {name}?")
        : i18nT("openspec.schemaTitle.pinMany", v, "Pin {count} changes in {name}?");
    }
  }
}

/** One-sentence consequence under the dialog title. */
function dialogLead(a: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus): SentencePart[] {
  const cfg = s.configured ?? BUILTIN_DEFAULT_SCHEMA;
  const tpl = (k: string, fb: string) => i18nT(`openspec.schemaLead.${k}`, undefined, fb);
  switch (a) {
    case "enable":
      return richParts(
        tpl("enable", "New changes in this project will use {schema}. Active changes that have no {file} are pinned to {prev} so they keep their current schema."),
        { schema: WORKFLOW_SCHEMA_NAME, file: PIN_FILE, prev: cfg },
      );
    case "disable":
      return richParts(
        isStampless(s)
          ? tpl("disableStampless", "This project has no record of its previous default. Choose the schema new changes should use again.")
          : tpl("disable", "New changes go back to the previous default recorded in the schema stamp. The schema files stay in the repository."),
        {},
      );
    case "update":
      return richParts(tpl("update", "Regenerates the schema files from this dashboard version."), {});
    case "adopt":
      return richParts(tpl("adopt", "{dir} has no dashboard stamp. Adopting replaces it with the schema this dashboard generates."), { dir: `${WORKFLOW_SCHEMA_NAME}/` });
    case "pin":
      return richParts(tpl("pin", "Writes a {file} into each change below, so it keeps the schema you pick whatever the default becomes."), { file: PIN_FILE });
    case "remove":
      return richParts(tpl("remove", "Deletes the schema files from this project. The default stays {cfg}."), { cfg });
  }
}

/** Paths the action will write — derived client-side (no dry-run endpoint). Paths only. */
function pathsFor(action: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus): string[] {
  switch (action) {
    case "enable":
      return [SCHEMA_DIR, CONFIG_PATH, ENABLE_PIN_GLOB];
    case "disable":
      return [CONFIG_PATH];
    case "update":
    case "adopt":
    case "remove":
      return [SCHEMA_DIR];
    case "pin":
      return s.unpinnedChanges.map((n) => `openspec/changes/${n}/${PIN_FILE}`);
  }
}

/** Stamp-less Disable (no usable recorded previous default) must name one. */
const isStampless = (s: OpenSpecWorkflowSchemaStatus) => s.generated === "none" || s.generated === "unmanaged";

function needsPreviousDefault(action: WorkflowSchemaAction, s: OpenSpecWorkflowSchemaStatus): boolean {
  return action === "adopt" || action === "update" || (action === "disable" && isStampless(s));
}

// ── small presentational pieces ─────────────────────────────────────────────

function Parts({ parts }: { parts: SentencePart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.code ? (
          <code key={i} className="font-mono font-semibold">
            {p.text}
          </code>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

function Callout({
  severity,
  role,
  testId,
  children,
}: {
  severity: WorkflowSchemaSeverity;
  role?: "status" | "alert";
  testId?: string;
  children: ReactNode;
}) {
  return (
    <div
      role={role}
      data-severity={severity}
      data-testid={testId}
      className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-[12px] leading-relaxed ${SEVERITY_PILL_CLASS[severity]}`}
    >
      <Icon path={CALLOUT_ICON[severity]} size={0.6} className="mt-0.5 flex-none" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-1">{children}</div>
    </div>
  );
}

const SECONDARY_BUTTON =
  "focus-ring inline-flex items-center justify-center gap-1.5 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] tap-target text-[12px] font-semibold";

// ── More actions menu (APG menu button) ─────────────────────────────────────

/** Close a popup when the mouse goes down outside `ref`. */
function useCloseOnOutsideMouseDown(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, ref, close]);
}

/** APG menu roving focus: the item index a key moves to, or null for other keys. */
function menuFocusTarget(key: string, at: number, count: number): number | null {
  switch (key) {
    case "ArrowDown": return at + 1;
    case "ArrowUp": return at - 1;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

interface MenuEntry {
  action: WorkflowSchemaAction;
  label: string;
}

function ActionMenu({
  cwd,
  name,
  entries,
  disabled,
  onSelect,
}: {
  cwd: string;
  name: string;
  entries: MenuEntry[];
  disabled: boolean;
  onSelect: (a: WorkflowSchemaAction) => void;
}) {
  const [open, setOpen] = useState(false);
  const [initial, setInitial] = useState<"first" | "last">("first");
  const wrapRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const buttonId = useId();
  const menuId = useId();

  useEffect(() => {
    if (open) itemRefs.current[initial === "last" ? entries.length - 1 : 0]?.focus();
  }, [open, initial, entries.length]);

  useCloseOnOutsideMouseDown(open, wrapRef, () => setOpen(false));

  const focusItem = (i: number) => itemRefs.current[(i + entries.length) % entries.length]?.focus();

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const at = itemRefs.current.findIndex((el) => el === document.activeElement);
    const move = menuFocusTarget(e.key, at, entries.length);
    if (move !== null) {
      e.preventDefault();
      focusItem(move);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      buttonRef.current?.focus();
    } else if (e.key === "Tab") setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative flex-none">
      <button
        ref={buttonRef}
        type="button"
        id={buttonId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={i18nT("openspec.schemaMenuLabel", { name }, "More actions for {name}")}
        disabled={disabled}
        onClick={() => {
          setInitial("first");
          setOpen((o) => !o);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setInitial(e.key === "ArrowUp" ? "last" : "first");
            setOpen(true);
          }
        }}
        className={`${SECONDARY_BUTTON} min-w-[44px] sm:min-w-[32px] disabled:bg-[var(--bg-tertiary)] disabled:text-[var(--text-secondary)]`}
      >
        <Icon path={mdiDotsVertical} size={0.8} aria-hidden="true" />
      </button>
      {open && (
        <div
          role="menu"
          id={menuId}
          aria-labelledby={buttonId}
          onKeyDown={onMenuKeyDown}
          className="absolute right-0 top-full z-10 mt-1 w-56 max-w-[calc(100vw-3rem)] rounded-lg border border-[var(--border-strong)] bg-[var(--bg-surface)] py-1 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)]"
        >
          {entries.map((entry, i) => (
            <div key={entry.action} role="none">
              {entry.action === "remove" && i > 0 && (
                <hr className="my-1 border-0 border-t border-[var(--border-secondary)]" />
              )}
              <button
                ref={(el) => {
                  itemRefs.current[i] = el;
                }}
                type="button"
                role="menuitem"
                tabIndex={-1}
                data-action={entry.action}
                data-testid={`workflow-schema-${entry.action}-${cwd}`}
                onClick={() => {
                  setOpen(false);
                  onSelect(entry.action);
                }}
                className="focus-ring flex w-full items-center gap-2 px-3 tap-target text-left text-[12px] text-[var(--text-primary)] hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-hover)]"
              >
                <Icon
                  path={ACTION_ICON[entry.action]}
                  size={0.7}
                  className={entry.action === "remove" ? "text-[var(--tint-red-fg)]" : undefined}
                  aria-hidden="true"
                />
                {entry.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── result callout ──────────────────────────────────────────────────────────

interface ActionResult {
  action: WorkflowSchemaAction;
  outcome: WorkflowSchemaOutcome;
}

function SuccessCallout({
  testId,
  action,
  outcome,
  warn,
  children,
}: {
  testId: string;
  action: WorkflowSchemaAction;
  outcome: WorkflowSchemaOutcome;
  warn: ReactNode;
  children: ReactNode;
}) {
  const worktree = outcome.data?.worktree;
  const branch = worktree?.isWorktree && worktree.branch ? worktree.branch : null;
  const skipped = outcome.data?.skipped ?? [];
  const writtenText = plural(
    outcome.data?.written.length ?? 0,
    "openspec.schemaResult.writtenOne",
    "{count} path written",
    "openspec.schemaResult.writtenMany",
    "{count} paths written",
  );
  return (
    <Callout severity="success" role="status" testId={testId}>
      <p>
        <strong>{`${past(action)}.`}</strong> {writtenText}
        {branch !== null && (
          <>
            {" "}
            <Parts parts={richParts(i18nT("openspec.schemaResult.onBranch", undefined, "on branch {branch}"), { branch })} />
          </>
        )}
        .
      </p>
      <p>{i18nT("openspec.schemaResult.noCommit", undefined, "The dashboard does not commit: review and commit them to share with your team.")}</p>
      {skipped.length > 0 && (
        <p>
          <Parts
            parts={richParts(
              skipped.length === 1
                ? i18nT("openspec.schemaResult.skippedOne", undefined, "{count} change skipped — already has a {file}: {names}.")
                : i18nT("openspec.schemaResult.skippedMany", undefined, "{count} changes skipped — already have a {file}: {names}."),
              { file: PIN_FILE, names: skipped.join(", ") },
              { count: String(skipped.length) },
            )}
          />
        </p>
      )}
      {warn}
      {children}
    </Callout>
  );
}

function ResultCallout({ cwd, status, result }: { cwd: string; status: OpenSpecWorkflowSchemaStatus; result: ActionResult }) {
  const { action, outcome } = result;
  const testId = `workflow-schema-result-${cwd}`;
  const written = outcome.data?.written ?? [];
  const warnings = outcome.data?.warnings ?? [];
  const warn = warnings.map((w) => <p key={w}>{`${capitalize(w)}.`}</p>);
  const files =
    written.length > 0 ? (
      <details>
        <summary className="flex cursor-pointer items-center tap-target text-[12px] font-semibold underline">
          {i18nT("openspec.schemaShowFiles", { count: String(written.length) }, "Show files ({count})")}
        </summary>
        <ul className="list-disc pl-4 font-mono text-[12px]">
          {written.map((f) => (
            <li key={f} className="break-all">
              {f}
            </li>
          ))}
        </ul>
      </details>
    ) : null;

  if (outcome.httpStatus === 409) {
    return (
      <Callout severity="info" role="status" testId={testId}>
        <p className="font-semibold">{i18nT("openspec.schemaResult.inFlight", undefined, "Another action is running for this project.")}</p>
        <p>{i18nT("openspec.schemaResult.inFlightHint", undefined, "Try again in a moment; the buttons stay available.")}</p>
      </Callout>
    );
  }

  if (outcome.success && written.length > 0) {
    return (
      <SuccessCallout testId={testId} action={action} outcome={outcome} warn={warn}>
        {files}
      </SuccessCallout>
    );
  }

  if (outcome.success) {
    return (
      <Callout severity="neutral" role="status" testId={testId}>
        <p className="font-semibold">{i18nT("openspec.schemaNoop", undefined, "Nothing to change.")}</p>
        {warn}
      </Callout>
    );
  }

  const message = outcome.error ?? i18nT("openspec.schemaFailed", undefined, "Action failed");
  if (outcome.data?.partial) {
    return (
      <Callout severity="warning" role="alert" testId={testId}>
        <p>
          <strong>{i18nT("openspec.schemaResult.partial", undefined, "Partially applied.")}</strong>{" "}
          {i18nT("openspec.schemaResult.partialNext", { verb: verb(action) }, "Run {verb} again to finish.")}
        </p>
        <p>{message}</p>
        {files}
      </Callout>
    );
  }

  const p = workflowSchemaPresentation(status);
  return (
    <Callout severity="error" role="alert" testId={testId}>
      <p className="font-semibold">{i18nT("openspec.schemaResult.refused", { verb: verb(action) }, "{verb} was refused.")}</p>
      <p>{message}</p>
      <p>
        {i18nT(
          "openspec.schemaResult.currentState",
          { label: p.label, sentence: p.sentence.map((x) => x.text).join("") },
          "Current state: {label}. {sentence}",
        )}
      </p>
    </Callout>
  );
}

// ── card ────────────────────────────────────────────────────────────────────

function NameList({ names }: { names: string[] }) {
  if (names.length === 0) return null;
  return (
    <ul className="mt-1 font-mono text-[11px] text-[var(--text-secondary)]">
      {names.slice(0, MAX_NAMES).map((n) => (
        <li key={n}>{n}</li>
      ))}
      {names.length > MAX_NAMES && (
        <li>{i18nT("openspec.schemaMore", { count: String(names.length - MAX_NAMES) }, "and {count} more")}</li>
      )}
    </ul>
  );
}

function Spinner() {
  return <Icon path={mdiSync} size={0.6} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />;
}

/** The recommended button (progress while it runs) + progress for a menu action. */
function CardActions({
  cwd,
  status,
  presentation: p,
  busyAction,
  onAction,
}: {
  cwd: string;
  status: OpenSpecWorkflowSchemaStatus;
  presentation: WorkflowSchemaPresentation;
  busyAction: WorkflowSchemaAction | undefined;
  onAction: (a: WorkflowSchemaAction) => void;
}) {
  const rec = p.recommended;
  const busy = busyAction !== undefined;
  const menuBusy = busyAction !== undefined && busyAction !== rec;
  if (!rec && !menuBusy) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {rec && (
        <button
          type="button"
          data-testid={`workflow-schema-${rec}-${cwd}`}
          data-action={rec}
          aria-disabled={busy || undefined}
          onClick={() => {
            if (!busy) onAction(rec);
          }}
          className={`${SECONDARY_BUTTON} px-2.5 aria-disabled:text-[var(--text-secondary)]`}
        >
          {busyAction === rec && <Spinner />}
          {busyAction === rec ? busyLabel(rec) : actionLabel(rec, status, p.key)}
        </button>
      )}
      {busyAction && menuBusy && (
        <span role="status" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--text-secondary)]">
          <Spinner />
          {busyLabel(busyAction)}
        </span>
      )}
    </div>
  );
}

function WorkflowSchemaCard({
  cwd,
  status,
  selected,
  busyAction,
  result,
  onAction,
  cardRef,
  headingRef,
}: {
  cwd: string;
  status: OpenSpecWorkflowSchemaStatus;
  selected: boolean;
  busyAction: WorkflowSchemaAction | undefined;
  result: ActionResult | undefined;
  onAction: (a: WorkflowSchemaAction) => void;
  cardRef: (el: HTMLElement | null) => void;
  headingRef: (el: HTMLElement | null) => void;
}) {
  const p = workflowSchemaPresentation(status);
  const name = baseName(cwd);
  const headingId = useId();
  const busy = busyAction !== undefined;
  const names = p.key === "unpinned" ? status.unpinnedChanges : [];

  return (
    <li
      ref={cardRef}
      data-testid={`workflow-schema-row-${cwd}`}
      data-state={p.key}
      data-selected={selected || undefined}
      aria-busy={busy || undefined}
      aria-labelledby={headingId}
      className={`rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-3 shadow-[inset_0_1px_0_var(--elevation-rim),0_4px_8px_var(--shadow-card)] ${
        selected ? "outline outline-2 outline-offset-2 outline-[var(--focus-ring)]" : ""
      }`}
    >
      {selected && (
        <p className="mb-1.5 flex items-center gap-1 text-[12px] font-semibold text-[var(--text-secondary)]">
          <Icon path={mdiLinkVariant} size={0.6} aria-hidden="true" />
          {i18nT("openspec.schemaOpenedFromFolder", undefined, "Opened from folder")}
        </p>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3
              id={headingId}
              ref={headingRef}
              tabIndex={-1}
              className="focus-ring text-[12px] font-semibold text-[var(--text-primary)]"
            >
              {name}
            </h3>
            <span
              data-testid={`workflow-schema-status-${cwd}`}
              className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${SEVERITY_PILL_CLASS[p.severity]}`}
            >
              <Icon path={PILL_ICON[p.key]} size={0.55} aria-hidden="true" />
              {p.label}
            </span>
          </div>
          <p className="mt-0.5 break-all font-mono text-[11px] text-[var(--text-secondary)]">{cwd}</p>
        </div>
        {p.menu.length > 0 && (
          <ActionMenu
            cwd={cwd}
            name={name}
            disabled={busy}
            entries={p.menu.map((a) => ({ action: a, label: actionLabel(a, status, p.key) }))}
            onSelect={onAction}
          />
        )}
      </div>
      <p className="mt-2 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        <Parts parts={p.sentence} />
      </p>
      <NameList names={names} />
      <CardActions cwd={cwd} status={status} presentation={p} busyAction={busyAction} onAction={onAction} />
      {result && (
        <div className="mt-2">
          <ResultCallout cwd={cwd} status={status} result={result} />
        </div>
      )}
    </li>
  );
}

// ── section ─────────────────────────────────────────────────────────────────

interface PendingAction {
  cwd: string;
  action: WorkflowSchemaAction;
}

export function OpenSpecWorkflowSchemaSection({ defaultForNewProjects, onDefaultChange }: Props) {
  const map = useOpenSpecMap();
  const entries = [...map.entries()].filter(([, d]) => d.workflowSchema !== undefined);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [busy, setBusy] = useState<Record<string, WorkflowSchemaAction>>({});
  const [results, setResults] = useState<Record<string, ActionResult>>({});

  // Deep link: `?cwd=<cwd>#workflow-schema` (folder-section notice chip).
  const search = useSearch();
  const targetCwd = new URLSearchParams(search).get("cwd");
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLElement>());
  const headingRefs = useRef(new Map<string, HTMLElement>());
  // The target card mounts only once its status has hydrated, so re-run on that.
  const targetReady = targetCwd !== null && map.get(targetCwd)?.workflowSchema !== undefined;
  useEffect(() => {
    if (window.location.hash !== "#workflow-schema" && !targetCwd) return;
    if (targetCwd && targetReady) {
      cardRefs.current.get(targetCwd)?.scrollIntoView?.({ block: "center" });
      headingRefs.current.get(targetCwd)?.focus({ preventScroll: true });
    } else if (!targetCwd) rootRef.current?.scrollIntoView?.({ block: "start" });
  }, [targetCwd, targetReady]);

  async function run(p: PendingAction, extra: { previousDefault?: string; pinTo?: string }) {
    const s = map.get(p.cwd)?.workflowSchema;
    if (!s) return;
    setPending(null);
    setBusy((b) => ({ ...b, [p.cwd]: p.action }));
    const outcome = await runWorkflowSchemaAction({
      cwd: p.cwd,
      action: p.action,
      // `confirm` is the server's explicit-consent flag for Adopt / stamp-less Disable.
      ...(p.action === "adopt" || (p.action === "disable" && isStampless(s)) ? { confirm: true } : {}),
      ...(p.action === "pin" ? { changes: s.unpinnedChanges } : {}),
      ...(extra.pinTo ? { pinTo: extra.pinTo } : {}),
      ...(extra.previousDefault ? { previousDefault: extra.previousDefault } : {}),
    });
    setBusy((b) => {
      const { [p.cwd]: _done, ...rest } = b;
      return rest;
    });
    setResults((r) => ({ ...r, [p.cwd]: { action: p.action, outcome } }));
  }

  return (
    <div id="workflow-schema" ref={rootRef} data-testid="openspec-workflow-schema-settings" className="mt-6">
      <h2 className="text-sm font-semibold text-[var(--text-primary)] mb-1 pb-1 border-b border-[var(--border-secondary)]">
        {i18nT("openspec.workflowSchemaTitle", undefined, "OpenSpec Workflow Schema")}
      </h2>
      <p className="mb-3 text-[12px] leading-relaxed text-[var(--text-secondary)]">
        {i18nT(
          "openspec.workflowSchemaIntro",
          undefined,
          "pi-spec-driven is the dashboard's OpenSpec workflow; it adds an explicit “Not needed” design skip. Actions on a project write files immediately after you confirm; the default switch below waits for Save.",
        )}
      </p>

      <ToggleField
        label={i18nT("openspec.schemaDefaultLabel", undefined, "Default for new projects")}
        hint={i18nT(
          "openspec.schemaDefaultHint",
          undefined,
          "When on, initializing OpenSpec in a directory that had none also enables pi-spec-driven. Never applies to existing OpenSpec projects.",
        )}
        keyLabel="openspec.workflowSchema.defaultForNewProjects"
        value={defaultForNewProjects}
        onChange={onDefaultChange}
        testIds={{ control: "workflow-schema-default-switch" }}
      />

      <div className="mt-3" data-testid="workflow-schema-list">
        {entries.length === 0 ? (
          <p
            className="rounded-lg border border-dashed border-[var(--border-secondary)] p-3 text-[12px] leading-relaxed text-[var(--text-secondary)]"
            data-testid="workflow-schema-empty"
          >
            <Parts
              parts={richParts(
                i18nT(
                  "openspec.schemaEmpty",
                  undefined,
                  "No OpenSpec projects yet. A project appears here once the dashboard has polled a folder that contains {dir}.",
                ),
                { dir: "openspec/" },
              )}
            />
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map(([cwd, data]) => (
              <WorkflowSchemaCard
                key={cwd}
                cwd={cwd}
                status={data.workflowSchema as OpenSpecWorkflowSchemaStatus}
                selected={cwd === targetCwd}
                busyAction={busy[cwd]}
                result={results[cwd]}
                onAction={(action) => setPending({ cwd, action })}
                cardRef={(el) => {
                  if (el) cardRefs.current.set(cwd, el);
                  else cardRefs.current.delete(cwd);
                }}
                headingRef={(el) => {
                  if (el) headingRefs.current.set(cwd, el);
                  else headingRefs.current.delete(cwd);
                }}
              />
            ))}
          </ul>
        )}
      </div>

      {pending && map.get(pending.cwd)?.workflowSchema && (
        <WorkflowSchemaConfirmDialog
          pending={pending}
          status={map.get(pending.cwd)?.workflowSchema as OpenSpecWorkflowSchemaStatus}
          onCancel={() => setPending(null)}
          onConfirm={(extra) => void run(pending, extra)}
        />
      )}
    </div>
  );
}

// ── confirmation dialog (one per action) ────────────────────────────────────

const FIELD_LABEL = "block text-[12px] font-semibold text-[var(--text-primary)]";
const FIELD_HELP = "mt-1 text-[12px] leading-relaxed text-[var(--text-secondary)]";
const FIELD_INPUT =
  "focus-ring mt-1 w-full rounded border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 tap-target text-sm text-[var(--text-primary)]";
const FILE_LIST =
  "rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-3 py-2 font-mono text-[12px] text-[var(--text-primary)]";

/** Best-effort worktree branch of a cwd (null for the main checkout / on failure). */
function useWorktreeBranch(cwd: string): string | null {
  const [branch, setBranch] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetchWorktrees(cwd)
      .then((list) => {
        const norm = (p: string) => p.replace(/\/+$/, "");
        const hit = list.find((w) => norm(w.path) === norm(cwd));
        if (live && hit && !hit.isMain) setBranch(hit.branch ?? i18nT("openspec.schemaDetached", undefined, "(detached)"));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [cwd]);
  return branch;
}

function SelectField({
  label,
  help,
  testId,
  value,
  onChange,
  children,
}: {
  label: string;
  help: string;
  testId: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  const helpId = useId();
  return (
    <div>
      <label htmlFor={id} className={FIELD_LABEL}>
        {label}
      </label>
      <select
        id={id}
        aria-describedby={helpId}
        data-testid={testId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD_INPUT}
      >
        {children}
      </select>
      <p id={helpId} className={FIELD_HELP}>
        {help}
      </p>
    </div>
  );
}

function AffectedChanges({ affected }: { affected: string[] }) {
  return (
    <div data-testid="workflow-schema-affected">
      <p className={FIELD_LABEL}>
        {plural(affected.length, "openspec.schemaAffectsOne", "Affects {count} active change", "openspec.schemaAffectsMany", "Affects {count} active changes")}
      </p>
      {affected.length > 0 && (
        <ul className={`mt-1 ${FILE_LIST}`}>
          {affected.slice(0, MAX_NAMES).map((n) => (
            <li key={n} className="break-all">
              {n}
            </li>
          ))}
        </ul>
      )}
      {affected.length > MAX_NAMES && (
        <p className={FIELD_HELP}>{i18nT("openspec.schemaMore", { count: String(affected.length - MAX_NAMES) }, "and {count} more")}</p>
      )}
    </div>
  );
}

/**
 * Patch 2 adds a required `dependencies` declaration: changes without one go
 * back to planning until they declare. Only shown once the server reports who.
 * See change: add-openspec-change-dependencies.
 */
function DependenciesImpact({ status }: { status: OpenSpecWorkflowSchemaStatus }) {
  const undeclared = status.undeclaredChanges;
  if (status.generated !== "outdated" || !undeclared || undeclared.length === 0) return null;
  return (
    <p className={FIELD_HELP} data-testid="workflow-schema-dependencies-impact">
      {i18nT(
        "openspec.schemaDependenciesImpact",
        { undeclared: String(undeclared.length), affected: String(status.affectedChanges.length) },
        "This update adds a required dependencies declaration: {undeclared} of {affected} affected changes have none and return to planning until they declare their dependencies.",
      )}
    </p>
  );
}

function FilesBlock({ action, paths }: { action: WorkflowSchemaAction; paths: string[] }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-[var(--text-secondary)]">
        {action === "remove"
          ? i18nT("openspec.schemaFilesRemoved", undefined, "Files removed")
          : i18nT("openspec.schemaFilesWritten", undefined, "Files written")}
      </p>
      <ul className={`mt-1 ${FILE_LIST}`} data-testid="workflow-schema-paths">
        {paths.map((p) => (
          <li key={p} className="break-all">
            {p}
          </li>
        ))}
      </ul>
      {action === "enable" && (
        <p className={FIELD_HELP}>
          <Parts
            parts={richParts(i18nT("openspec.schemaGlobHelp", undefined, "The {star} stands for each active change that has no {file} yet."), {
              star: "*",
              file: PIN_FILE,
            })}
          />
        </p>
      )}
    </div>
  );
}

function DialogCallouts({ action, branch }: { action: WorkflowSchemaAction; branch: string | null }) {
  return (
    <>
      {branch !== null && (
        <Callout severity="info">
          <p data-testid="workflow-schema-branch">
            <Parts
              parts={richParts(i18nT("openspec.schemaBranchNote", undefined, "Files land on branch {branch}. The dashboard never commits."), {
                branch,
              })}
            />
          </p>
        </Callout>
      )}
      {action === "adopt" && (
        <Callout severity="warning">
          <p>
            {i18nT("openspec.schemaAdoptWarning", undefined, "Adopting regenerates pi-spec-driven from the package base: any hand customizations are discarded.")}
          </p>
        </Callout>
      )}
      {action === "remove" && (
        <Callout severity="warning">
          <p>{i18nT("openspec.schemaRemoveWarning", undefined, "Unmerged branches may still pin pi-spec-driven; they break once this removal lands.")}</p>
        </Callout>
      )}
    </>
  );
}

function WorkflowSchemaConfirmDialog({
  pending,
  status,
  onCancel,
  onConfirm,
}: {
  pending: PendingAction;
  status: OpenSpecWorkflowSchemaStatus;
  onCancel: () => void;
  onConfirm: (extra: { previousDefault?: string; pinTo?: string }) => void;
}) {
  const { cwd, action } = pending;
  const hasRecordedStamp = action === "update" && !isStampless(status);
  const stampless = action === "disable" && isStampless(status);
  const [previousDefault, setPreviousDefault] = useState(hasRecordedStamp ? KEEP_RECORDED : BUILTIN_DEFAULT_SCHEMA);
  const [pinTo, setPinTo] = useState(WORKFLOW_SCHEMA_NAME);
  const branch = useWorktreeBranch(cwd);
  const showPrev = needsPreviousDefault(action, status);

  return (
    <Dialog open onClose={onCancel} title={dialogTitle(action, status, baseName(cwd))} testId="workflow-schema-confirm">
      <div className="space-y-3 text-[var(--text-primary)]">
        <p className="break-all font-mono text-[11px] text-[var(--text-secondary)]">{cwd}</p>
        <p className="text-sm leading-relaxed">
          <Parts parts={dialogLead(action, status)} />
        </p>
        <DialogCallouts action={action} branch={branch} />
        {showPrev && (
          <SelectField
            label={i18nT("openspec.schemaPreviousDefault", undefined, "Previous default")}
            help={
              stampless
                ? i18nT("openspec.schemaPrevHelpStampless", undefined, "New changes use this schema after you disable pi-spec-driven.")
                : i18nT("openspec.schemaPrevHelp", undefined, "Recorded in the schema stamp. Disable switches new changes back to it.")
            }
            testId="workflow-schema-previous-default"
            value={previousDefault}
            onChange={setPreviousDefault}
          >
            {hasRecordedStamp && <option value={KEEP_RECORDED}>{i18nT("openspec.schemaKeepRecorded", undefined, "Keep recorded value")}</option>}
            {previousDefaultOptions(status).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </SelectField>
        )}
        {action === "pin" && (
          <SelectField
            label={i18nT("openspec.schemaPinTo", undefined, "Pin to")}
            help={i18nT("openspec.schemaPinHelp", undefined, "Each change keeps this schema whatever the default becomes.")}
            testId="workflow-schema-pin-target"
            value={pinTo}
            onChange={setPinTo}
          >
            <option value={WORKFLOW_SCHEMA_NAME}>{WORKFLOW_SCHEMA_NAME}</option>
            <option value={BUILTIN_DEFAULT_SCHEMA}>{BUILTIN_DEFAULT_SCHEMA}</option>
          </SelectField>
        )}
        {action === "update" && <AffectedChanges affected={status.affectedChanges} />}
        {action === "update" && <DependenciesImpact status={status} />}
        <FilesBlock action={action} paths={pathsFor(action, status)} />
      </div>
      <Dialog.Footer>
        <Dialog.Cancel onClick={onCancel} testId="workflow-schema-cancel" />
        <Dialog.Action
          intent={action === "remove" || action === "adopt" ? "danger" : "primary"}
          testId="workflow-schema-confirm-action"
          onClick={() =>
            onConfirm({
              ...(showPrev && previousDefault ? { previousDefault } : {}),
              ...(action === "pin" ? { pinTo } : {}),
            })
          }
        >
          {confirmLabel(action, status)}
        </Dialog.Action>
      </Dialog.Footer>
    </Dialog>
  );
}
