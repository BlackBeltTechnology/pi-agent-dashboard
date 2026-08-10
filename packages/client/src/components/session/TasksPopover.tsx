/**
 * Popover listing every parseable task from an attached change's tasks.md,
 * grouped by heading, with native checkboxes. Optimistic toggle with 409
 * refetch fallback.
 *
 * Rendered via `DialogPortal` (matches other card dialogs). Keyboard:
 *   Esc      — close
 *   ↑ / ↓    — move focus between checkboxes
 *   Space    — toggle focused checkbox (browser native behavior)
 */
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import {
  toggleTask as apiToggleTask,
  fetchTasks,
  LineMismatchError,
  type OpenSpecTask,
  type TasksPayload,
} from "../../lib/openspec/openspec-tasks-api.js";
import { DialogPortal } from "../primitives/DialogPortal.js";

interface Props {
  cwd: string;
  change: string;
  onClose: () => void;
}

export function TasksPopover({ cwd, change, onClose }: Props) {
  const [payload, setPayload] = useState<TasksPayload | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  // Per-task in-flight target state (for optimistic rendering).
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoadError(null);
      try {
        const p = await fetchTasks(cwd, change, signal);
        setPayload(p);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setLoadError(err?.message ?? "failed to load tasks");
      }
    },
    [cwd, change],
  );

  useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  // Esc closes.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const grouped = useMemo(() => {
    if (!payload) return [];
    const map = new Map<string, OpenSpecTask[]>();
    for (const t of payload.tasks) {
      const key = t.group || "(ungrouped)";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    // Order inside each group: unticked first, then ticked (matches "what's left?" scan).
    for (const arr of map.values()) {
      arr.sort((a, b) => Number(a.done) - Number(b.done) || a.line - b.line);
    }
    return Array.from(map.entries());
  }, [payload]);

  async function onToggle(task: OpenSpecTask) {
    if (pending[task.id] !== undefined) return;
    const target = !task.done;
    setPending((p) => ({ ...p, [task.id]: target }));
    setBanner(null);
    try {
      await apiToggleTask(cwd, change, task.id, target, task.line);
      // Refetch so line numbers stay accurate relative to the source-of-truth file.
      await load();
    } catch (err: any) {
      if (err instanceof LineMismatchError) {
        setBanner("File changed — please try again");
        await load();
      } else {
        setBanner(err?.message ?? "toggle failed");
      }
    } finally {
      setPending((p) => {
        const next = { ...p };
        delete next[task.id];
        return next;
      });
    }
  }

  const listRef = useRef<HTMLDivElement>(null);

  function moveFocus(delta: 1 | -1) {
    const container = listRef.current;
    if (!container) return;
    const boxes = Array.from(
      container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    );
    const idx = boxes.findIndex((b) => b === document.activeElement);
    const next = Math.max(0, Math.min(boxes.length - 1, (idx === -1 ? 0 : idx) + delta));
    boxes[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      moveFocus(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveFocus(-1);
    }
  }

  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        onClick={onClose}
        data-testid="tasks-popover-backdrop"
      >
        <div
          className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md shadow-xl w-[min(560px,92vw)] max-h-[80vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={onKeyDown}
          data-testid="tasks-popover"
        >
          <div className="px-3 py-2 border-b border-[var(--border-primary)] flex items-center justify-between">
            <span className="text-[11px] text-[var(--text-secondary)]">
              {i18nT("openspec.tasks", undefined, "Tasks —")} <span className="text-blue-400">{change}</span>
            </span>
            <button
              onClick={onClose}
              className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-blue-400"
              data-testid="tasks-popover-close"
            >
              {i18nT("common.close", undefined, "Close")}
            </button>
          </div>
          {banner && (
            <div
              data-testid="tasks-popover-banner"
              className="px-3 py-1 text-[10px] text-amber-400 border-b border-[var(--border-primary)] bg-amber-500/10"
            >
              {banner}
            </div>
          )}
          <div ref={listRef} className="overflow-y-auto flex-1 p-2">
            {loadError && (
              <div className="text-[11px] text-red-400" data-testid="tasks-popover-error">
                {loadError}
              </div>
            )}
            {!payload && !loadError && (
              <div className="text-[11px] text-[var(--text-muted)]">{i18nT("common.loading2", undefined, "Loading…")}</div>
            )}
            {payload && payload.tasks.length === 0 && (
              <div className="text-[11px] text-[var(--text-muted)]">{i18nT("openspec.noTasks", undefined, "No tasks.")}</div>
            )}
            {grouped.map(([group, tasks]) => (
              <div key={group} className="mb-2" data-testid={`tasks-group-${group}`}>
                <div className="text-[10px] uppercase tracking-wide text-[var(--text-muted)] mb-1">
                  {group}
                </div>
                {tasks.map((t) => {
                  const displayDone = pending[t.id] ?? t.done;
                  return (
                    <label
                      key={`${t.id}-${t.line}`}
                      className="flex items-start gap-2 py-0.5 text-[11px] cursor-pointer hover:bg-[var(--bg-hover)] rounded px-1"
                      data-testid={`task-row-${t.id}`}
                    >
                      <input
                        type="checkbox"
                        checked={displayDone}
                        onChange={() => onToggle(t)}
                        disabled={pending[t.id] !== undefined}
                        data-testid={`task-checkbox-${t.id}`}
                        className="mt-[2px]"
                      />
                      <span
                        className={
                          displayDone
                            ? "text-[var(--text-muted)] line-through"
                            : "text-[var(--text-primary)]"
                        }
                      >
                        <span className="text-[var(--text-muted)] mr-1">{t.id}</span>
                        {t.text}
                      </span>
                    </label>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DialogPortal>
  );
}
