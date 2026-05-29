import React, { useState, useCallback, useRef, useEffect, useMemo, type ReactNode } from "react";
import { Icon } from "@mdi/react";
import { mdiFlash, mdiClipboardText, mdiWrench, mdiFolder, mdiFile, mdiPlay, mdiStop, mdiAlert, mdiConsole, mdiClose } from "@mdi/js";
import type { CommandInfo, ImageContent, FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useImagePaste } from "../hooks/useImagePaste.js";
import { ImagePreviewStrip } from "./ImagePreviewStrip.js";

/** Built-in pi commands available from the dashboard */
const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: "compact", description: "Compact session context", source: "builtin" },
  { name: "reload", description: "Reload extensions, skills, prompts, and themes", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
];

interface Props {
  commands: CommandInfo[];
  onSend: (text: string, images?: ImageContent[], delivery?: "steer" | "followUp") => void;
  onListFiles?: (query: string) => void;
  fileResults?: { query: string; files: FileEntry[] } | null;
  disabled?: boolean;
  sessionStatus?: "idle" | "streaming" | "ended";
  /**
   * True iff an LLM-provider auto-retry is in flight (pi-coding-agent
   * sleeping between attempts). Treated as "still working" for Stop/
   * Force-Stop visibility, since `sessionStatus` may briefly read `idle`
   * between retries.
   * See change: fix-provider-retry-infinite-loop.
   */
  retrying?: boolean;
  onAbort?: () => void;
  onForceKill?: () => void;
  pendingPrompt?: boolean;
  onCancelPending?: () => void;
  /** Current session id — used to reset history-navigation state on switch. */
  sessionId?: string;
  /** Controlled draft text. When provided, the textarea is controlled by the parent. */
  draft?: string;
  /** Parent callback for every text change (controlled mode). */
  onDraftChange?: (text: string) => void;
  /** Previously sent user prompts for this session, newest-first, pre-deduped. */
  history?: string[];
  /**
   * Controlled pending pasted images. When provided, the parent owns the
   * array (typically lifted to App keyed by sessionId so it survives route
   * changes and doesn't leak across sessions). When omitted, the hook falls
   * back to local state — used by tests and any caller that doesn't need
   * cross-route persistence.
   */
  images?: ImageContent[];
  /** Parent callback for every images-array change (controlled mode). */
  onImagesChange?: (next: ImageContent[]) => void;
}

const sourceIcons: Record<string, ReactNode> = {
  extension: <Icon path={mdiFlash} size={0.6} />,
  prompt: <Icon path={mdiClipboardText} size={0.6} />,
  skill: <Icon path={mdiWrench} size={0.6} />,
  builtin: <Icon path={mdiConsole} size={0.6} />,
};

type DropdownMode = "command" | "file" | null;

/**
 * Extract @ prefix from text before cursor.
 * Returns the query after @ if @ is at a token boundary, null otherwise.
 */
function extractAtQuery(text: string): string | null {
  const delimiters = new Set([" ", "\t", '"', "'"]);
  // Find last @ that's at a token boundary
  for (let i = text.length - 1; i >= 0; i--) {
    if (text[i] === "@") {
      if (i === 0 || delimiters.has(text[i - 1]!)) {
        return text.slice(i + 1);
      }
      return null;
    }
    // Stop if we hit a delimiter without finding @
    if (delimiters.has(text[i]!)) {
      return null;
    }
  }
  return null;
}

type StopState = "idle" | "aborting" | "killing";

export function CommandInput({ commands: externalCommands, onSend, onListFiles, fileResults, disabled, sessionStatus, retrying, onAbort, onForceKill, pendingPrompt, onCancelPending, sessionId, draft, onDraftChange, history, images, onImagesChange }: Props) {
  // Treat retry-sleep as "still working" for Stop/Force-Stop visibility.
  const isWorking = sessionStatus === "streaming" || retrying === true;
  // Merge server commands with built-in commands, avoiding duplicates
  const commands = useMemo(() => {
    const names = new Set(externalCommands.map((c) => c.name));
    const builtins = BUILTIN_COMMANDS.filter((c) => !names.has(c.name));
    return [...builtins, ...externalCommands];
  }, [externalCommands]);
  // Controlled when `draft` prop is provided, otherwise fall back to local state
  // (preserves backward-compat for callers/tests that don't pass `draft`).
  const isControlled = draft !== undefined;
  const [localText, setLocalText] = useState("");
  const text = isControlled ? (draft as string) : localText;
  const setText = useCallback((v: string) => {
    if (!isControlled) setLocalText(v);
    onDraftChange?.(v);
  }, [isControlled, onDraftChange]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [stopState, setStopState] = useState<StopState>("idle");

  // --- History recall (bash-style) ---
  const historyList = history ?? [];
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const savedDraftRef = useRef<string>("");
  // Ref to the *current* historyIndex for use inside handlers that shouldn't
  // trigger the state-reset effect when they themselves clear it.
  const historyIndexRef = useRef<number | null>(null);
  historyIndexRef.current = historyIndex;

  // Reset stop state when session stops streaming
  useEffect(() => {
    if (sessionStatus !== "streaming" && !retrying) setStopState("idle");
  }, [sessionStatus, retrying]);

  // Reset history-navigation state whenever the session changes.
  useEffect(() => {
    setHistoryIndex(null);
    savedDraftRef.current = "";
  }, [sessionId]);
  // Controlled when caller passes `images` (App lifts state per-session);
  // uncontrolled otherwise (legacy / tests).
  const { pendingImages, imageError, handlePaste, removeImage, clearImages } = useImagePaste(
    images !== undefined ? { images, onImagesChange } : undefined,
  );
  const [dismissed, setDismissed] = useState<string | null>(null); // text value when Escape was pressed
  const prevDropdownKeyRef = useRef<string>(""); // tracks mode+filter to reset selectedIndex
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFileQueryRef = useRef<string | null>(null);

  // --- Command autocomplete ---
  const isCommand = text.startsWith("/") && !text.includes("\n");
  const commandFilter = isCommand ? text.slice(1).toLowerCase() : "";

  const filteredCommands = isCommand
    ? commands.filter(
        (cmd) =>
          cmd.name.toLowerCase().includes(commandFilter) ||
          (cmd.description?.toLowerCase().includes(commandFilter) ?? false)
      )
    : [];

  // --- @ file autocomplete ---
  const cursorPos = inputRef.current?.selectionStart ?? text.length;
  const textBeforeCursor = text.slice(0, cursorPos);
  const atQuery = extractAtQuery(textBeforeCursor);
  const isAtMode = atQuery !== null;

  // Debounced file search
  useEffect(() => {
    if (!isAtMode || !onListFiles) {
      lastFileQueryRef.current = null;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      lastFileQueryRef.current = atQuery;
      onListFiles(atQuery);
    }, 150);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [atQuery, isAtMode, onListFiles]);

  // Determine dropdown items
  const fileItems = (isAtMode && fileResults && fileResults.query === lastFileQueryRef.current)
    ? fileResults.files
    : [];

  // Derive dropdown mode directly (no useEffect needed)
  // If user pressed Escape at the current text value, stay dismissed
  const isDismissed = dismissed === text;
  const dropdownMode: DropdownMode =
    isDismissed ? null
    : isCommand && filteredCommands.length > 0 ? "command"
    : isAtMode && fileItems.length > 0 ? "file"
    : null;

  const dropdownLength = dropdownMode === "command" ? filteredCommands.length
    : dropdownMode === "file" ? fileItems.length
    : 0;

  // Reset selectedIndex when dropdown mode or filter changes
  const dropdownKey = dropdownMode ? `${dropdownMode}:${commandFilter}` : "";
  if (dropdownKey !== prevDropdownKeyRef.current) {
    prevDropdownKeyRef.current = dropdownKey;
    if (selectedIndex !== 0) {
      setSelectedIndex(0);
    }
  }

  // --- Handlers ---

  // NOTE: `selectCommand` and `selectFile` are intentionally plain inner
  // functions (no `useCallback`). They call `setText`, which in controlled
  // mode wraps the parent's `onDraftChange` prop — a prop whose reference
  // changes on every session switch in App.tsx. A `useCallback` here would
  // freeze the first-render `setText` (and thus the first-render
  // `onDraftChange`), causing Tab/Enter/click selection to silently invoke
  // a stale handler after the user switches sessions. Keeping these as plain
  // closures reads the current render's `setText` every time, which is
  // correct and has no measurable render-perf cost (the dropdown items are
  // not memoized children). See change: fix-autocomplete-stale-closure.

  const selectCommand = (cmd: CommandInfo) => {
    const newText = `/${cmd.name} `;
    setText(newText);
    setDismissed(newText); // prevent dropdown from reopening for selected text
    inputRef.current?.focus();
  };

  const selectFile = (file: FileEntry) => {
    const query = atQuery ?? "";
    const beforeAt = textBeforeCursor.slice(0, textBeforeCursor.length - query.length - 1); // remove @query
    const afterCursor = text.slice(cursorPos);
    const filePath = file.path;
    const suffix = file.isDirectory ? "" : " ";
    const newText = `${beforeAt}@${filePath}${suffix}${afterCursor}`;
    setText(newText);
    setDismissed(newText); // prevent dropdown from reopening for selected text
    // Set cursor after the inserted path
    const newCursorPos = beforeAt.length + 1 + filePath.length + suffix.length;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      inputRef.current?.focus();
    });
  };

  const handleSend = useCallback((delivery?: "steer" | "followUp") => {
    if (text.trim()) {
      onSend(text.trim(), pendingImages.length > 0 ? pendingImages : undefined, delivery);
      clearImages();
      setText("");
      // Reset textarea height
      if (inputRef.current) {
        inputRef.current.style.height = "38px";
      }
    }
  }, [text, pendingImages, onSend, clearImages]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (dropdownMode) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => {
            const next = Math.min(i + 1, dropdownLength - 1);
            requestAnimationFrame(() => {
              // scrollIntoView is not implemented in jsdom — optional-call.
              (document.querySelector(`[data-dropdown-index="${next}"]`) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
            });
            return next;
          });
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          setSelectedIndex((i) => {
            const next = Math.max(i - 1, 0);
            requestAnimationFrame(() => {
              (document.querySelector(`[data-dropdown-index="${next}"]`) as HTMLElement | null)?.scrollIntoView?.({ block: "nearest" });
            });
            return next;
          });
          return;
        }
        if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
          e.preventDefault();
          if (dropdownMode === "command") {
            const cmd = filteredCommands[selectedIndex];
            if (cmd) selectCommand(cmd);
          } else if (dropdownMode === "file") {
            const file = fileItems[selectedIndex];
            if (file) selectFile(file);
          }
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setDismissed(text);
          return;
        }
      }

      // Cancel pending prompt on Escape
      if (e.key === "Escape" && pendingPrompt && onCancelPending) {
        e.preventDefault();
        onCancelPending();
        return;
      }

      // --- History recall (ArrowUp / ArrowDown / Escape in history mode) ---
      // Only activates when no dropdown is open and no prompt is pending.
      if (!pendingPrompt && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape")) {
        const ta = inputRef.current;
        // Escape while in history mode: restore the in-progress draft and exit.
        if (e.key === "Escape" && historyIndex !== null) {
          e.preventDefault();
          const restored = savedDraftRef.current;
          setText(restored);
          setHistoryIndex(null);
          if (ta) {
            requestAnimationFrame(() => {
              ta.setSelectionRange(restored.length, restored.length);
              // Re-run the auto-resize logic to match restored content.
              ta.style.height = "38px";
              ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
            });
          }
          return;
        }
        if (ta && historyList.length > 0 && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          // Entry gate: bare arrows activate history only when the input is
          // completely empty (no text, no pending images). Ctrl/Meta force
          // activation regardless of content. Once in history mode
          // (`historyIndex !== null`), bare arrows continue walking.
          // See change: history-nav-only-when-empty.
          const isForceHistory = e.ctrlKey || e.metaKey;
          const inHistoryMode = historyIndex !== null;
          const isEmpty = text === "" && pendingImages.length === 0;
          const historyEnabled = isForceHistory || inHistoryMode || isEmpty;
          if (e.key === "ArrowUp" && historyEnabled) {
            e.preventDefault();
            const nextIdx = historyIndex === null ? 0 : Math.min(historyIndex + 1, historyList.length - 1);
            if (historyIndex === null) {
              savedDraftRef.current = text;
            }
            const nextText = historyList[nextIdx] ?? "";
            setHistoryIndex(nextIdx);
            setText(nextText);
            requestAnimationFrame(() => {
              ta.setSelectionRange(nextText.length, nextText.length);
              ta.style.height = "38px";
              ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
            });
            return;
          }
          if (e.key === "ArrowDown" && historyIndex !== null) {
            e.preventDefault();
            if (historyIndex === 0) {
              const restored = savedDraftRef.current;
              setHistoryIndex(null);
              setText(restored);
              requestAnimationFrame(() => {
                ta.setSelectionRange(restored.length, restored.length);
                ta.style.height = "38px";
                ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
              });
            } else {
              const nextIdx = historyIndex - 1;
              const nextText = historyList[nextIdx] ?? "";
              setHistoryIndex(nextIdx);
              setText(nextText);
              requestAnimationFrame(() => {
                ta.setSelectionRange(nextText.length, nextText.length);
                ta.style.height = "38px";
                ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
              });
            }
            return;
          }
        }
      }

      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        // Alt+Enter / Option+Enter = followUp; Enter alone = steer (default).
        // Mirrors pi's TUI keyboard contract. See change: add-steering-message.
        const delivery = e.altKey ? "followUp" : "steer";
        handleSend(delivery);
      }
    },
    // Note: `selectCommand` / `selectFile` are intentionally omitted — they
    // are plain closures (see comment at their definition) and recomputed
    // every render anyway, so listing them would only cause unnecessary
    // handler-identity churn without affecting correctness.
    [dropdownMode, dropdownLength, filteredCommands, fileItems, selectedIndex, handleSend, setText, text, pendingPrompt, onCancelPending, historyIndex, historyList, pendingImages]
  );

  // Clipboard paste + preview-strip are delegated to the shared hook +
  // component (useImagePaste / ImagePreviewStrip) so the OpenSpec
  // Explore dialog can reuse the exact same behavior.

  return (
    <div className="border-t border-[var(--border-primary)] p-3 relative">
      {/* Autocomplete dropdown */}
      {dropdownMode === "command" && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl max-h-64 overflow-y-auto shadow-lg z-10">
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.name}
              data-dropdown-index={i}
              onClick={() => selectCommand(cmd)}
              className={`w-full px-3 py-2 min-h-[44px] md:min-h-0 text-left text-sm flex items-center gap-2 ${
                i === selectedIndex ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
              }`}
            >
              <span className="inline-flex">{sourceIcons[cmd.source] ?? <Icon path={mdiFlash} size={0.6} />}</span>
              <span className="font-mono text-blue-400">/{cmd.name}</span>
              {cmd.description && (
                <span className="text-[var(--text-tertiary)] truncate">{cmd.description}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {dropdownMode === "file" && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl max-h-64 overflow-y-auto shadow-lg z-10">
          {fileItems.map((file, i) => {
            const name = file.path.split("/").pop() ?? file.path;
            return (
              <button
                key={file.path}
                data-dropdown-index={i}
                onClick={() => selectFile(file)}
                className={`w-full px-3 py-2 min-h-[44px] md:min-h-0 text-left text-sm flex items-center gap-2 ${
                  i === selectedIndex ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="inline-flex"><Icon path={file.isDirectory ? mdiFolder : mdiFile} size={0.6} /></span>
                <span className="font-mono text-green-400">
                  {name}{file.isDirectory ? "/" : ""}
                </span>
                <span className="text-[var(--text-tertiary)] truncate">{file.path}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Pasted-image error banner + thumbnail strip (shared component). */}
      <ImagePreviewStrip images={pendingImages} error={imageError} onRemove={removeImage} />

      <div className="flex gap-2">
        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            // Any user-driven text change while navigating history exits history mode
            // (the user is now editing the recalled entry). We don't restore the saved
            // draft here — the edited text becomes the live draft.
            if (historyIndexRef.current !== null) {
              setHistoryIndex(null);
            }
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder="Message, /command, !shell, or @file..."
          /* Bridge-owned mid-turn queue: keep input enabled while the agent
             is streaming so further sends queue. Per the modified
             `optimistic-prompt` capability, disable only when pendingPrompt
             is in flight AND the agent is NOT streaming (idle-send case).
             See change: surface-mid-turn-prompt-queue. */
          disabled={disabled || (pendingPrompt && !isWorking)}
          rows={1}
          className="flex-1 bg-[var(--bg-tertiary)] rounded-lg px-4 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none disabled:opacity-50 resize-none"
          style={{ minHeight: "38px", maxHeight: "120px" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "38px";
            target.style.height = Math.min(target.scrollHeight, 120) + "px";
          }}
        />
        <button
          onClick={() => handleSend("steer")}
          /* Send button mirrors textarea: enabled during streaming so the
             user can queue another mid-turn message. */
          disabled={disabled || (pendingPrompt && !isWorking) || !text.trim()}
          className="p-2 bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed self-end"
          title="Send"
          data-testid="send-button"
        >
          <Icon path={mdiPlay} size={0.7} />
        </button>
        {(isWorking || pendingPrompt) && (onAbort || onCancelPending) && stopState === "idle" && (
          <button
            onClick={() => {
              if (pendingPrompt) {
                onCancelPending?.();
              } else {
                onAbort?.();
                if (onForceKill) setStopState("aborting");
              }
            }}
            className="p-2 bg-red-600 rounded-lg hover:bg-red-500 self-end"
            title="Stop"
            data-testid="stop-button"
          >
            <Icon path={mdiStop} size={0.7} />
          </button>
        )}
        {isWorking && stopState === "aborting" && onForceKill && (
          <button
            onClick={() => { onForceKill(); setStopState("killing"); }}
            className="p-2 bg-orange-600 rounded-lg hover:bg-orange-500 self-end animate-pulse"
            title="Force Stop — kill the process"
            data-testid="force-stop-button"
          >
            <Icon path={mdiAlert} size={0.7} />
          </button>
        )}
        {isWorking && stopState === "killing" && (
          <button
            disabled
            className="p-2 bg-orange-800 rounded-lg opacity-60 cursor-not-allowed self-end"
            title="Killing process..."
            data-testid="killing-button"
          >
            <Icon path={mdiStop} size={0.7} />
          </button>
        )}
      </div>
      {/* ImageLightbox is rendered inside ImagePreviewStrip now. */}
    </div>
  );
}
