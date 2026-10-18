/**
 * Document-level notice for a markup repair (markdown M2/M3, AsciiDoc A1/A2):
 * lists each repair with its original-source line, toggles "view original rendering",
 * and — only where the file identity is provided (`MermaidSourceContext`, i.e. a
 * live-session cwd) — offers a diff-confirmed, conflict-safe "Apply markup fix to file".
 *
 * Apply: `md-read` → verify the file is unchanged since display (md: content byte-equal;
 * adoc: mtime equal to the render response's) → whole-file diff → `POST /api/file/write`
 * with the read mtime → `reload`. Any mismatch / 409 writes nothing and offers a reload.
 *
 * See change: add-md-adoc-markup-repair (design D5).
 */
import type { MarkupRepair, MarkupRepairResult } from "@blackbelt-technology/pi-dashboard-shared/markup-repair/types.js";
import { mdiWrenchOutline } from "@mdi/js";
import { Icon } from "@mdi/react";
import { useCallback, useId, useRef, useState } from "react";
import { usePreviewFetch } from "../../lib/access-grants/preview-provenance.js";
import { getApiBase } from "../../lib/api/api-context.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type MermaidSourceInfo, useMermaidSourceContext } from "../../lib/preview/mermaid-source-context.js";
import { ConfirmDialog } from "./MermaidApplyFix.js";

export interface MarkupRepairApply {
  /** md: the content the preview rendered (byte-equal verify). */
  displayed?: string;
  /** adoc: the `mtime` the render response carried. */
  renderMtime?: number;
  /** The SAME repair function the display used. */
  repair: (source: string) => MarkupRepairResult;
}

interface Props {
  repairs: MarkupRepair[];
  viewOriginal: boolean;
  onToggleOriginal: () => void;
  apply?: MarkupRepairApply;
}

type Phase =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "confirm"; before: string; after: string; mtime: number }
  | { kind: "writing"; before: string; after: string; mtime: number }
  | { kind: "changed" }
  | { kind: "error"; message: string };

const errMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Re-read → verify unchanged since display → repair. Resolves to the next phase; never
 * throws and never writes (the write happens only after the user confirms).
 */
async function planApply(
  read: (url: string) => Promise<Response>,
  source: MermaidSourceInfo,
  apply: MarkupRepairApply,
): Promise<Phase | { kind: "failed"; error: unknown }> {
  try {
    const url = `${getApiBase()}/api/file/md-read?cwd=${encodeURIComponent(source.cwd)}&path=${encodeURIComponent(source.path)}`;
    const res = await read(url);
    if (res.status === 404) return { kind: "changed" };
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) return { kind: "failed", error: body?.error ?? `HTTP ${res.status}` };
    const { content, mtime } = body.data ?? {};
    if (typeof content !== "string" || typeof mtime !== "number") return { kind: "failed", error: "unexpected response" };
    const unchanged =
      apply.displayed !== undefined ? content === apply.displayed : apply.renderMtime !== undefined && mtime === apply.renderMtime;
    if (!unchanged) return { kind: "changed" };
    const repaired = apply.repair(content);
    if (repaired.repairs.length === 0) return { kind: "changed" };
    return { kind: "confirm", before: content, after: repaired.source, mtime };
  } catch (e) {
    return { kind: "failed", error: e };
  }
}

function repairText(r: MarkupRepair): string {
  switch (r.rule) {
    case "A1":
      return i18nT("markupRepair.repair.A1", { line: r.line }, "Rendered bare [mermaid] block as a diagram (line {line})");
    case "A2":
      return i18nT("markupRepair.repair.A2", { line: r.line }, "Closed unterminated block (line {line})");
    case "M2":
      return i18nT("markupRepair.repair.M2", { line: r.line }, "Closed fence with mismatched closer (line {line})");
    default:
      return i18nT("markupRepair.repair.M3", { line: r.line }, "Closed unterminated fence (line {line})");
  }
}

export function MarkupRepairBanner({ repairs, viewOriginal, onToggleOriginal, apply }: Props) {
  const source: MermaidSourceInfo | null = useMermaidSourceContext();
  const { fetch: previewFetch } = usePreviewFetch();
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const inFlight = useRef(false);
  const hintId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const dirty = source?.isDirty === true;

  const fail = useCallback((e: unknown) => {
    setPhase({
      kind: "error",
      message: i18nT("markupRepair.applyError", { error: errMessage(e) }, "Could not apply markup fix: {error}"),
    });
  }, []);

  const start = useCallback(async () => {
    if (!source || !apply || inFlight.current) return;
    inFlight.current = true;
    setPhase({ kind: "reading" });
    try {
      const plan = await planApply(previewFetch, source, apply);
      if (plan.kind === "failed") fail(plan.error);
      else setPhase(plan);
    } finally {
      inFlight.current = false;
    }
  }, [source, apply, previewFetch, fail]);

  const cancel = useCallback(() => {
    if (inFlight.current) return;
    setPhase({ kind: "idle" });
    queueMicrotask(() => buttonRef.current?.focus());
  }, []);

  const confirm = useCallback(async () => {
    if (!source || phase.kind !== "confirm" || inFlight.current) return;
    inFlight.current = true;
    const held = phase;
    setPhase({ ...held, kind: "writing" });
    try {
      const res = await fetch(`${getApiBase()}/api/file/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: source.cwd, path: source.path, content: held.after, mtime: held.mtime }),
      });
      if (res.status === 409) return setPhase({ kind: "changed" });
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

  const canApply = source !== null && apply !== undefined;
  const showDialog = phase.kind === "confirm" || phase.kind === "writing";

  return (
    <div
      role="status"
      data-testid="markup-repair-banner"
      className="mb-3 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 py-2 text-xs text-[var(--text-secondary)]"
    >
      <div className="flex items-start gap-2">
        <Icon path={mdiWrenchOutline} size={0.7} aria-hidden="true" className="mt-0.5 shrink-0 text-[var(--severity-warning-fg)]" />
        <div className="min-w-0 flex-1">
          <span className="font-medium text-[var(--text-primary)]">
            {i18nT("markupRepair.title", undefined, "Markup auto-fixed")}
          </span>
          <ul className="mt-1 list-none space-y-0.5 p-0">
            {repairs.map((r) => (
              <li key={`${r.rule}:${r.line}`} data-testid="markup-repair-item" data-rule={r.rule}>
                {repairText(r)}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          aria-pressed={viewOriginal}
          onClick={onToggleOriginal}
          data-testid="markup-repair-view-original"
          className="focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 text-[12px] text-[var(--text-primary)] aria-pressed:bg-[var(--bg-hover)]"
        >
          {i18nT("markupRepair.viewOriginal", undefined, "View original rendering")}
        </button>
        {canApply ? (
          <button
            ref={buttonRef}
            type="button"
            onClick={() => void start()}
            disabled={dirty || phase.kind === "reading" || showDialog}
            aria-busy={phase.kind === "reading"}
            aria-describedby={dirty ? hintId : undefined}
            data-testid="markup-repair-apply"
            className="focus-ring tap-target rounded-md border border-[var(--border-secondary)] bg-[var(--bg-secondary)] px-3 text-[12px] text-[var(--text-primary)] disabled:opacity-60"
          >
            {phase.kind === "reading"
              ? i18nT("markupRepair.applyReading", undefined, "Reading file…")
              : i18nT("markupRepair.apply", undefined, "Apply markup fix to file")}
          </button>
        ) : null}
        {dirty ? (
          <span id={hintId} className="text-xs text-[var(--text-secondary)]">
            {i18nT("markupRepair.applyDirtyHint", undefined, "Save or discard edits first")}
          </span>
        ) : null}
        {phase.kind === "changed" ? (
          <span role="alert" data-testid="markup-repair-changed" className="inline-flex items-center gap-2 text-[var(--severity-warning-fg)]">
            {i18nT("markupRepair.changed", undefined, "File changed — reload")}
            <button
              type="button"
              onClick={() => {
                setPhase({ kind: "idle" });
                source?.reload();
              }}
              className="focus-ring tap-target rounded-md px-2 text-[12px] text-[var(--text-primary)] underline underline-offset-2"
            >
              {i18nT("markupRepair.reload", undefined, "Reload")}
            </button>
          </span>
        ) : null}
        {phase.kind === "error" ? (
          <span role="alert" className="text-[var(--severity-error-fg)]">
            {phase.message}
          </span>
        ) : null}
      </div>
      {source && (phase.kind === "confirm" || phase.kind === "writing") ? (
        <ConfirmDialog
          path={source.path}
          before={phase.before}
          after={phase.after}
          writing={phase.kind === "writing"}
          onConfirm={() => void confirm()}
          onCancel={cancel}
          title={i18nT("markupRepair.dialogTitle", undefined, "Apply markup fix to file?")}
          body={i18nT("markupRepair.dialogBody", undefined, "Only the repaired lines change. Review the change before writing.")}
          diffContext={3}
        />
      ) : null}
    </div>
  );
}
