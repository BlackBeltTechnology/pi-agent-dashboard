/**
 * "Apply fix to file" for a repaired mermaid diagram: re-read the file, locate
 * the block by ordinal, verify it is exactly what the preview rendered, show a
 * line diff, and only then write it back (mtime-guarded). Anything off — block
 * not found / changed, 404, 409 — writes nothing and offers a reload; other
 * failures write nothing further and show the error.
 *
 * The locator (and `unified`/`remark-parse`) is imported lazily on first click.
 *
 * See change: add-preview-apply-fix-to-file (design D2, D5, D6).
 */
import { DialogPortal } from "@blackbelt-technology/pi-dashboard-client-utils/DialogPortal";
import { useEscapeDismiss } from "@blackbelt-technology/pi-dashboard-client-utils/escape-stack";
import { mdiFileReplaceOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { diffLines } from "diff";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import type { MermaidSourceInfo } from "../../lib/preview/mermaid-source-context.js";

interface Props {
  source: MermaidSourceInfo;
  /** Ordinal of this block among the file's mermaid blocks. */
  ordinal: number;
  /** The source the preview rendered (the displayed original). */
  originalCode: string;
  /** The repaired (rule- or AI-fixed) source to persist. */
  fixedSource: string;
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "confirm"; before: string; after: string; content: string; mtime: number }
  | { kind: "writing"; before: string; after: string; content: string; mtime: number }
  | { kind: "changed" }
  | { kind: "not-applicable" }
  | { kind: "error"; message: string };

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** `/api/file/md-read` + `/api/file/write` share the guard; both take cwd + path. */
function mdReadUrl(s: MermaidSourceInfo): string {
  return `${getApiBase()}/api/file/md-read?cwd=${encodeURIComponent(s.cwd)}&path=${encodeURIComponent(s.path)}`;
}

/**
 * Re-read → locate → verify → splice. Resolves to the next phase; never throws
 * and never writes (the write happens only after the user confirms).
 */
async function planApply(
  read: (url: string) => Promise<Response>,
  source: MermaidSourceInfo,
  ordinal: number,
  originalCode: string,
  fixedSource: string,
): Promise<Phase | { kind: "failed"; error: unknown }> {
  try {
    const res = await read(mdReadUrl(source));
    if (res.status === 404) return { kind: "changed" };
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return { kind: "failed", error: body?.error ?? `HTTP ${res.status}` };
    const { content, mtime } = body.data ?? {};
    if (typeof content !== "string" || typeof mtime !== "number") return { kind: "failed", error: "unexpected response" };
    const loc = await import("../../lib/preview/mermaid-block-locator.js");
    const located = loc.locateMermaidBlock(content, source.kind, ordinal, { expectedCount: source.expectedCount });
    if (!located.ok) return { kind: located.reason === "not-found" ? "changed" : "not-applicable" };
    // Same block as the preview rendered? Otherwise the file changed under us.
    if (!loc.verifyMermaidBlock(located, originalCode)) return { kind: "changed" };
    const spliced = located.replace(fixedSource);
    if (spliced === null) return { kind: "not-applicable" };
    return { kind: "confirm", before: located.value, after: fixedSource, content: spliced, mtime };
  } catch (e) {
    return { kind: "failed", error: e };
  }
}

/** Unchanged runs longer than `2 * context` collapse to their edges (whole-file diffs). */
function visibleLines(lines: string[], pi: number, count: number, context: number | undefined): Array<string | null> {
  if (context === undefined || lines.length <= 2 * context) return lines;
  const head = pi === 0 ? [] : lines.slice(0, context);
  const tail = pi === count - 1 ? [] : lines.slice(-context);
  return [...head, null, ...tail];
}

function DiffRow({ line, kind }: { line: string | null; kind: "added" | "removed" | "same" }) {
  if (line === null) {
    return (
      <div aria-hidden="true" className="select-none text-[var(--text-muted)]">
        …
      </div>
    );
  }
  const cls =
    kind === "added"
      ? "bg-[var(--severity-success-bg)] text-[var(--severity-success-fg)]"
      : kind === "removed"
        ? "bg-[var(--severity-error-bg)] text-[var(--severity-error-fg)]"
        : "text-[var(--text-secondary)]";
  const mark = kind === "added" ? "+" : kind === "removed" ? "-" : " ";
  const sr =
    kind === "added"
      ? i18nT("preview.mermaid.applyDiffAdded", undefined, "Added:")
      : kind === "removed"
        ? i18nT("preview.mermaid.applyDiffRemoved", undefined, "Removed:")
        : null;
  return (
    <div data-diff={kind} className={`whitespace-pre-wrap break-all ${cls}`}>
      {sr ? <span className="sr-only">{sr} </span> : null}
      <span aria-hidden="true" className="select-none pr-2">
        {mark}
      </span>
      {line}
    </div>
  );
}

export function DiffView({ before, after, context }: { before: string; after: string; context?: number }) {
  const parts = diffLines(before, after);
  return (
    <pre
      data-testid="mermaid-apply-diff"
      className="max-h-[50vh] overflow-auto rounded-md border border-[var(--border-subtle)] bg-[var(--bg-code)] p-2 text-xs font-mono"
    >
      {parts.flatMap((part, pi) => {
        const kind = part.added ? "added" : part.removed ? "removed" : "same";
        const lines = visibleLines(part.value.replace(/\n$/, "").split("\n"), pi, parts.length, kind === "same" ? context : undefined);
        return lines.map((line, li) => <DiffRow key={`${pi}:${li}`} line={line} kind={kind} />);
      })}
    </pre>
  );
}

export function ConfirmDialog({
  path,
  before,
  after,
  writing,
  onConfirm,
  onCancel,
  title,
  body,
  diffContext,
}: {
  path: string;
  before: string;
  after: string;
  writing: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** Overrides (markup repair reuses this dialog for a whole-file diff). */
  title?: string;
  body?: string;
  diffContext?: number;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEscapeDismiss(true, onCancel);
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  // Keep Tab inside the dialog (aria-modal does not trap focus by itself).
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab") return;
    const focusables = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), [href], [tabindex]:not([tabindex='-1'])") ?? [],
    );
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <DialogPortal>
      {/* z-lightbox (70): the dialog opens from inside FilePreviewOverlay (raw z-70, earlier in the DOM),
          so it must sit on that tier or the overlay covers it. */}
      <div className="fixed inset-0 z-lightbox flex items-center justify-center bg-black/60" onClick={onCancel}>
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          data-testid="mermaid-apply-dialog"
          className="mx-4 w-full max-w-2xl rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-4 shadow-xl"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
        >
          <h2 id={titleId} className="mb-1 text-base font-semibold text-[var(--text-primary)]">
            {title ?? i18nT("preview.mermaid.applyDialogTitle", undefined, "Apply fix to file?")}
          </h2>
          <p className="mb-3 break-all font-mono text-[11px] text-[var(--text-muted)]">{path}</p>
          <p className="mb-2 text-xs text-[var(--text-tertiary)]">
            {body ??
              i18nT(
                "preview.mermaid.applyDialogBody",
                undefined,
                "Only this diagram's content is replaced. Review the change before writing.",
              )}
          </p>
          <DiffView before={before} after={after} context={diffContext} />
          <div className="mt-3 flex justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={writing}
              data-testid="mermaid-apply-cancel"
              className="focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 text-[12px] text-[var(--text-primary)] disabled:opacity-60"
            >
              {i18nT("common.cancel", undefined, "Cancel")}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={writing}
              aria-busy={writing}
              data-testid="mermaid-apply-confirm"
              className="focus-ring tap-target rounded-md bg-[var(--accent-blue)] px-3 text-[12px] text-white disabled:opacity-60"
            >
              {writing
                ? i18nT("preview.mermaid.applyWriting", undefined, "Writing…")
                : i18nT("preview.mermaid.applyConfirm", undefined, "Write to file")}
            </button>
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}

export function MermaidApplyFix({ source, ordinal, originalCode, fixedSource }: Props) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const buttonRef = useRef<HTMLButtonElement>(null);
  const hintId = useId();
  const dirty = source.isDirty === true;
  const markupBlocked = source.markupRepairActive === true;
  const inFlight = useRef(false);
  // Opted out of the access-grant dialog (md-read mints no remedy: its scope guard only 403s).
  const { fetch: previewFetch } = usePreviewFetch();

  const fail = useCallback((e: unknown) => {
    setPhase({
      kind: "error",
      message: i18nT("preview.mermaid.applyError", { error: errMessage(e) }, "Could not apply fix: {error}"),
    });
  }, []);

  const start = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "reading" });
    try {
      const plan = await planApply(previewFetch, source, ordinal, originalCode, fixedSource);
      if (plan.kind === "failed") fail(plan.error);
      else setPhase(plan);
    } finally {
      inFlight.current = false;
    }
  }, [previewFetch, source, ordinal, originalCode, fixedSource, fail]);

  const cancel = useCallback(() => {
    if (inFlight.current) return; // a write in flight is not cancellable
    setPhase({ kind: "idle" });
    // The dialog unmounts with this render; hand focus back to the trigger.
    queueMicrotask(() => buttonRef.current?.focus());
  }, []);

  const confirm = useCallback(async () => {
    if (phase.kind !== "confirm" || inFlight.current) return;
    inFlight.current = true;
    const held = phase;
    setPhase({ ...held, kind: "writing" });
    try {
      const res = await fetch(`${getApiBase()}/api/file/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: source.cwd, path: source.path, content: held.content, mtime: held.mtime }),
      });
      if (res.status === 409) {
        setPhase({ kind: "changed" });
        return;
      }
      const body = await res.json().catch(() => null);
      if (res.status === 200 && body?.success) {
        setPhase({ kind: "idle" });
        source.reload();
        return;
      }
      fail(body?.error ?? `HTTP ${res.status}`);
    } catch (e) {
      fail(e);
    } finally {
      inFlight.current = false;
    }
  }, [phase, source, fail]);

  const showDialog = phase.kind === "confirm" || phase.kind === "writing";

  return (
    <div data-testid="mermaid-apply-fix" className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => void start()}
        disabled={dirty || markupBlocked || phase.kind === "reading" || showDialog}
        aria-busy={phase.kind === "reading"}
        aria-describedby={dirty || markupBlocked ? hintId : undefined}
        data-testid="mermaid-apply-fix-button"
        className="focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 tap-target text-[12px] text-[var(--text-primary)] disabled:opacity-60"
      >
        <Icon path={mdiFileReplaceOutline} size={0.6} aria-hidden="true" />
        {phase.kind === "reading"
          ? i18nT("preview.mermaid.applyReading", undefined, "Reading file…")
          : i18nT("preview.mermaid.applyToFile", undefined, "Apply fix to file")}
      </button>
      {dirty || markupBlocked ? (
        <span id={hintId} className="text-xs text-[var(--text-secondary)]">
          {markupBlocked
            ? i18nT("markupRepair.diagramBlocked", undefined, "Apply the markup fix first")
            : i18nT("preview.mermaid.applyDirtyHint", undefined, "Save or discard edits first")}
        </span>
      ) : null}
      {phase.kind === "changed" ? (
        <span role="status" className="inline-flex items-center gap-2 text-xs text-[var(--severity-warning-fg)]">
          {i18nT("preview.mermaid.applyChanged", undefined, "File changed — reload")}
          <button
            type="button"
            onClick={() => {
              setPhase({ kind: "idle" });
              source.reload();
            }}
            data-testid="mermaid-apply-reload"
            className="focus-ring tap-target rounded-md px-2 text-[12px] text-[var(--text-primary)] underline underline-offset-2"
          >
            {i18nT("preview.mermaid.applyReload", undefined, "Reload")}
          </button>
        </span>
      ) : null}
      {phase.kind === "not-applicable" ? (
        <span role="status" className="text-xs text-[var(--severity-warning-fg)]">
          {i18nT("preview.mermaid.applyNotApplicable", undefined, "This fix cannot be applied to this block")}
        </span>
      ) : null}
      {phase.kind === "error" ? (
        <span role="status" className="text-xs text-[var(--severity-error-fg)]">
          {phase.message}
        </span>
      ) : null}
      {phase.kind === "confirm" || phase.kind === "writing" ? (
        <ConfirmDialog
          path={source.path}
          before={phase.before}
          after={phase.after}
          writing={phase.kind === "writing"}
          onConfirm={() => void confirm()}
          onCancel={cancel}
        />
      ) : null}
    </div>
  );
}
