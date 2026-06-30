/**
 * Instructions page — the editable scoped-markdown surface.
 *
 * Bounded file picker (left) + controlled Monaco markdown buffer (right) with a
 * dirty-gated Save Bar. Self-contained save contract: this page owns its own
 * dirty/save state and does NOT thread into the global SettingsPanel save
 * fan-out (design Decision #1). Optimistic concurrency via mtime — a stale
 * write returns 409 and surfaces a conflict banner.
 *
 * Scope:
 *   - `cwd` present → directory scope. Reads + writes resolve against `cwd`.
 *   - `cwd` absent  → global scope (~/.pi/agent). Reads via `/api/file/md-read`
 *     (gated by the same `isWritableMdTarget` guard as write + candidates), so
 *     global scope works through one symmetric security model.
 *
 * See change: directory-settings-page-and-scoped-md-editing.
 */
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import { fileKind } from "@blackbelt-technology/pi-dashboard-shared/file-kind.js";
import type {
  FileWriteResponse,
  MdCandidate,
} from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { ApiResponse } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useCallback, useEffect, useRef, useState } from "react";
import { getApiBase } from "../../lib/api-context.js";
import { t as i18nT } from "../../lib/i18n";
import { FilePicker } from "./FilePicker.js";
// The lazy Monaco mount + mtime formatting live in InstructionsEditorPane.
import { InstructionsEditorPane } from "./InstructionsEditorPane.js";

interface Props {
  cwd?: string;
}

interface Message {
  type: "success" | "error";
  text: string;
}

/** Build the scoped markdown read URL; global scope omits `cwd`. */
function fileReadUrl(cwd: string | undefined, absPath: string): string {
  const base = `${getApiBase()}/api/file/md-read?path=${encodeURIComponent(absPath)}`;
  return cwd ? `${base}&cwd=${encodeURIComponent(cwd)}` : base;
}

export function InstructionsPage({ cwd }: Props) {
  const [selected, setSelected] = useState<MdCandidate | null>(null);
  const [loadedContent, setLoadedContent] = useState<string>("");
  const [loadedMtime, setLoadedMtime] = useState<number | null>(null);
  const [buffer, setBuffer] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // Pending file switch awaiting discard confirmation (dirty guard).
  const [pendingSwitch, setPendingSwitch] = useState<MdCandidate | null>(null);

  const dirty = buffer !== loadedContent;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  // Monotonic load token. Each `loadCandidate` bumps it; a slower in-flight read
  // whose token is stale is discarded, so clicking file A then B can never let
  // A's late response overwrite B's buffer. See change (CodeRabbit): out-of-order reads.
  const loadSeqRef = useRef(0);

  // Hard exits (tab close / reload) while dirty → native prompt.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // Load a candidate's content into the buffer.
  const loadCandidate = useCallback(
    (candidate: MdCandidate) => {
      const seq = ++loadSeqRef.current;
      const isStale = () => seq !== loadSeqRef.current;
      setSelected(candidate);
      setLoading(true);
      setReadError(null);
      setConflict(false);
      setMessage(null);
      fetch(fileReadUrl(cwd, candidate.path))
        .then((res) => res.json() as Promise<ApiResponse<{ content?: string; mtime?: number }>>)
        .then((body) => {
          if (isStale()) return; // a newer load superseded this one
          if (!body.success || typeof body.data?.content !== "string") {
            setReadError(body.success ? "File is not readable as text" : body.error ?? "Failed to load file");
            setLoadedContent("");
            setBuffer("");
            setLoadedMtime(null);
            return;
          }
          setLoadedContent(body.data.content);
          setBuffer(body.data.content);
          setLoadedMtime(body.data.mtime ?? null);
        })
        .catch((err) => {
          if (isStale()) return;
          setReadError(err?.message ?? "Network error");
          setLoadedContent("");
          setBuffer("");
          setLoadedMtime(null);
        })
        .finally(() => {
          if (!isStale()) setLoading(false);
        });
    },
    [cwd],
  );

  // Default selection: AGENTS.md if present (directory scope), else first.
  const handleCandidatesLoaded = useCallback(
    (candidates: MdCandidate[]) => {
      if (selected || candidates.length === 0) return;
      const preferred =
        candidates.find((c) => c.relPath === "AGENTS.md") ?? candidates[0];
      loadCandidate(preferred);
    },
    [selected, loadCandidate],
  );

  // Picker click: guard with a confirm when the buffer is dirty.
  const handleSelect = useCallback(
    (candidate: MdCandidate) => {
      if (candidate.path === selected?.path) return;
      if (dirtyRef.current) {
        setPendingSwitch(candidate);
        return;
      }
      loadCandidate(candidate);
    },
    [selected, loadCandidate],
  );

  const confirmSwitch = useCallback(() => {
    const next = pendingSwitch;
    setPendingSwitch(null);
    if (next) loadCandidate(next);
  }, [pendingSwitch, loadCandidate]);

  const handleDiscard = useCallback(() => {
    setBuffer(loadedContent);
    setConflict(false);
    setMessage(null);
  }, [loadedContent]);

  // POST the buffer. Returns the parsed response so callers can chain.
  const postWrite = useCallback(
    async (mtime: number) => {
      if (!selected) return null;
      const res = await fetch(`${getApiBase()}/api/file/write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(cwd ? { cwd } : {}),
          path: selected.path,
          content: buffer,
          mtime,
        }),
      });
      const body = (await res.json()) as FileWriteResponse;
      return { status: res.status, body };
    },
    [cwd, selected, buffer],
  );

  // Apply a write response to state. `handle409` routes a stale-mtime response
  // into the conflict banner (Save) vs. treating it as a plain error (Overwrite).
  const applyWriteOutcome = useCallback(
    (result: { status: number; body: FileWriteResponse }, handle409: boolean) => {
      const { status, body } = result;
      if (status === 200 && body.success && body.data) {
        setLoadedContent(buffer);
        setLoadedMtime(body.data.mtime);
        setConflict(false);
        setMessage({ type: "success", text: i18nT("auto.saved", undefined, "Saved") });
        return;
      }
      if (handle409 && status === 409) {
        setConflict(true);
        setMessage(null);
        return;
      }
      setMessage({
        type: "error",
        text: body.success ? "Write failed" : body.error ?? `Save failed (${status})`,
      });
    },
    [buffer],
  );

  const handleSave = useCallback(async () => {
    if (!selected || loadedMtime === null || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const result = await postWrite(loadedMtime);
      if (result) applyWriteOutcome(result, true);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }, [selected, loadedMtime, saving, postWrite, applyWriteOutcome]);

  // Conflict resolution — reload disk content, replacing the buffer.
  const reloadFromDisk = useCallback(() => {
    if (selected) loadCandidate(selected);
  }, [selected, loadCandidate]);

  // Conflict resolution — re-fetch the fresh mtime, then overwrite with it.
  const overwriteAnyway = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const readRes = await fetch(fileReadUrl(cwd, selected.path));
      const readBody = (await readRes.json()) as ApiResponse<{ mtime?: number }>;
      const freshMtime = readBody.success ? readBody.data?.mtime : undefined;
      if (typeof freshMtime !== "number") {
        setMessage({ type: "error", text: "Could not read current file state" });
        return;
      }
      const result = await postWrite(freshMtime);
      if (result) applyWriteOutcome(result, false);
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Network error" });
    } finally {
      setSaving(false);
    }
  }, [selected, saving, cwd, postWrite, applyWriteOutcome]);

  const editable = selected ? fileKind(selected.path).editable : false;

  return (
    <div className="flex flex-col md:flex-row h-full min-h-0" data-testid="instructions-page">
      <FilePicker
        cwd={cwd}
        selectedPath={selected?.path ?? null}
        onSelect={handleSelect}
        onLoaded={handleCandidatesLoaded}
      />

      {/* Editor pane */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0">
        {!selected ? (
          <div className="p-4 text-sm text-[var(--text-tertiary)]">
            {i18nT("auto.select_a_file_to_edit", undefined, "Select a file to edit")}
          </div>
        ) : (
          <InstructionsEditorPane
            selected={selected}
            dirty={dirty}
            loadedMtime={loadedMtime}
            conflict={conflict}
            saving={saving}
            loading={loading}
            readError={readError}
            errorText={message?.type === "error" ? message.text : null}
            buffer={buffer}
            editable={editable}
            onChangeBuffer={setBuffer}
            onReload={reloadFromDisk}
            onOverwrite={overwriteAnyway}
            onDiscard={handleDiscard}
            onSave={handleSave}
          />
        )}
      </div>

      {/* Unsaved-changes guard on file switch */}
      {pendingSwitch && (
        <Confirm
          open
          testId="instructions-switch-confirm"
          intent="danger"
          title={i18nT("auto.discard_unsaved_changes", undefined, "Discard unsaved changes?")}
          message={i18nT(
            "auto.discard_unsaved_to_file",
            undefined,
            `Discard unsaved changes to ${selected?.relPath ?? "this file"}?`,
          )}
          confirmLabel={i18nT("auto.discard", undefined, "Discard")}
          onConfirm={confirmSwitch}
          onClose={() => setPendingSwitch(null)}
        />
      )}
    </div>
  );
}
