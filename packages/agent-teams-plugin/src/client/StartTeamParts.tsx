/**
 * Presentational parts of `StartTeamDialog` (lazy module; no requests): the template
 * list with its states, one template row, and the hook-confirmation step. Template
 * names, descriptions, validation messages and hook commands come from files on disk,
 * so they are only ever React text children — never markup, never an attribute value
 * other than the radio's `value` / test id.
 * See change: add-agent-teams-templates-hooks.
 */
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { type ReactElement, useEffect, useId, useRef } from "react";
import type { HooksUntrustedDetails, TemplateSummary } from "../shared/protocol.js";
import { useLazyT } from "./lazy-i18n.js";
import { START_TABLES } from "./start-i18n.js";

const PILL = "rounded-full border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[11px] text-[var(--text-primary)]";

export type Listing = { status: "loading" } | { status: "error" } | { status: "ready"; templates: TemplateSummary[] };

export const startable = (tpl: TemplateSummary): boolean => tpl.trusted && tpl.valid;

const SOURCE_KEY: Record<TemplateSummary["source"], string> = {
  user: "template.sourceUser",
  project: "template.sourceProject",
  bundled: "template.sourceBundled",
};

/** Why a template cannot be started, as a string-table key; `undefined` when it can. */
const reasonKeyOf = (tpl: TemplateSummary): string | undefined => (!tpl.trusted ? "template.untrusted" : !tpl.valid ? "template.invalid" : undefined);

const issuesOf = (tpl: TemplateSummary): string => (tpl.valid ? "" : tpl.errors.map((e) => e.message ?? e.code).join("; "));

function TemplateItem({ tpl, checked, onPick }: { tpl: TemplateSummary; checked: boolean; onPick: () => void }): ReactElement {
  const t = useLazyT(START_TABLES);
  const reasonId = useId();
  const ok = startable(tpl);
  const reasonKey = reasonKeyOf(tpl);
  const detail = issuesOf(tpl);
  const memberCount = tpl.members?.length ?? 0;
  return (
    <li>
      <label className={`flex items-start gap-2 rounded border p-2 text-sm ${checked ? "border-[var(--accent-primary)]" : "border-[var(--border-secondary)]"} ${ok ? "cursor-pointer" : "cursor-not-allowed opacity-70"}`}>
        <input type="radio" name="agent-team-template" value={tpl.name} checked={checked} disabled={!ok} onChange={() => ok && onPick()} aria-describedby={reasonKey ? reasonId : undefined} data-testid={`start-template-${tpl.name}`} className="mt-1" />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold text-[var(--text-primary)] [overflow-wrap:anywhere]">{tpl.name}</span>
            <span className={PILL}>{t(SOURCE_KEY[tpl.source])}</span>
            {tpl.hasHooks ? <span className={PILL}>{t("template.hasHooks")}</span> : null}
            {memberCount > 0 ? <span className="text-[12px] text-[var(--text-secondary)]">{t("template.members", { count: memberCount })}</span> : null}
          </span>
          {tpl.description ? <span className="mt-0.5 block text-[12px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">{tpl.description}</span> : null}
          {reasonKey ? (
            <span id={reasonId} data-testid={`start-template-reason-${tpl.name}`} className="mt-0.5 block text-[12px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">
              {detail ? `${t(reasonKey)} — ${detail}` : t(reasonKey)}
            </span>
          ) : null}
        </span>
      </label>
    </li>
  );
}

export interface TemplateListProps {
  listing: Listing;
  selected: string | undefined;
  onPick: (name: string) => void;
  onRetry: () => void;
}

/** The loading / failed / empty / list states of the template field. */
export function TemplateList({ listing, selected, onPick, onRetry }: TemplateListProps): ReactElement | null {
  const t = useLazyT(START_TABLES);
  if (listing.status === "loading") {
    return (
      <p role="status" className="m-0 text-sm text-[var(--text-secondary)]">
        {t("dialog.templatesLoading")}
      </p>
    );
  }
  if (listing.status === "error") {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <p role="alert" data-testid="start-templates-error" className="m-0 text-sm text-[var(--tint-red-fg)]">
          {t("dialog.templatesFailed")}
        </p>
        <button type="button" onClick={onRetry} data-testid="start-templates-retry" className="rounded border border-[var(--border-primary)] px-3 py-1 text-xs font-semibold text-[var(--text-primary)]">
          {t("dialog.retry")}
        </button>
      </div>
    );
  }
  if (listing.templates.length === 0) return <p className="m-0 text-sm text-[var(--text-secondary)]">{t("dialog.templatesEmpty")}</p>;
  return (
    <ul className="m-0 flex max-h-[40vh] list-none flex-col gap-1.5 overflow-y-auto p-0" data-testid="start-template-list">
      {listing.templates.map((tpl) => (
        <TemplateItem key={`${tpl.source}:${tpl.name}`} tpl={tpl} checked={selected === tpl.name} onPick={() => onPick(tpl.name)} />
      ))}
    </ul>
  );
}

function HookCommand({ command }: { command: HooksUntrustedDetails["commands"][number] }): ReactElement {
  const t = useLazyT(START_TABLES);
  const eventKey = `hooks.event.${command.event}`;
  const known = t(eventKey) !== eventKey;
  const timeout = command.timeoutMs === undefined ? "" : ` · ${t("hooks.timeout", { ms: command.timeoutMs })}`;
  return (
    <li className="flex flex-col gap-1">
      <span className="text-[12px] text-[var(--text-secondary)] [overflow-wrap:anywhere]">
        {known ? t(eventKey) : command.event}
        {timeout}
      </span>
      <code data-testid="start-hook-command" className="block whitespace-pre-wrap rounded bg-[var(--bg-tertiary)] p-2 font-mono text-xs text-[var(--text-primary)] [overflow-wrap:anywhere]">
        {command.command}
      </code>
    </li>
  );
}

export interface HooksStepProps {
  details: HooksUntrustedDetails;
  /** The commands changed since the user last confirmed. */
  changed: boolean;
  error: string | undefined;
  busy: boolean;
  onAllow: () => void;
  onDeny: () => void;
}

/** Step 2: the exact commands, the fingerprint, and the choice. "Do not allow" takes focus on open. */
export function HooksStep({ details, changed, error, busy, onAllow, onDeny }: HooksStepProps): ReactElement {
  const t = useLazyT(START_TABLES);
  const denyRef = useRef<HTMLButtonElement>(null);
  useEffect(() => denyRef.current?.focus(), []);
  return (
    <div className="flex flex-col gap-3" data-testid="start-hooks-step">
      <p className="m-0 text-sm text-[var(--text-primary)]">{t("hooks.explain")}</p>
      {changed ? (
        <p role="alert" data-testid="start-hooks-changed" className="m-0 text-sm text-[var(--tint-red-fg)]">
          {t("hooks.changed")}
        </p>
      ) : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="start-hooks-list">
        {details.commands.map((c, i) => (
          <HookCommand key={i} command={c} />
        ))}
      </ul>
      <p className="m-0 text-[12px] text-[var(--text-secondary)] [overflow-wrap:anywhere]" data-testid="start-hooks-fingerprint">
        {t("hooks.fingerprint", { hash: details.hash })}
      </p>
      {error ? (
        <p role="alert" data-testid="start-error" className="m-0 text-sm text-[var(--tint-red-fg)]">
          {error}
        </p>
      ) : null}
      <Dialog.Footer>
        <button type="button" ref={denyRef} onClick={onDeny} disabled={busy} data-testid="start-hooks-deny" className="inline-flex min-h-[44px] items-center justify-center rounded border border-[var(--border-primary)] px-3 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-50 sm:min-h-[36px]">
          {t("hooks.deny")}
        </button>
        <Dialog.Action onClick={onAllow} disabled={busy} testId="start-hooks-allow">
          {busy ? t("dialog.starting") : t("hooks.allow")}
        </Dialog.Action>
      </Dialog.Footer>
    </div>
  );
}
