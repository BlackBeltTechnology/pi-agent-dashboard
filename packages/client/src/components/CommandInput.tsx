import type { CommandInfo, FileEntry, ImageContent, ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlert, mdiClipboardText, mdiClose, mdiConsole, mdiFile, mdiFlash, mdiFolder, mdiPlay, mdiStop, mdiStopCircleOutline, mdiWeb, mdiWrench } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImagePaste } from "../hooks/useImagePaste.js";
import { usePopoverFlip } from "../hooks/usePopoverFlip.js";
import type { ChatMessage } from "../lib/event-reducer.js";
import { extractRecentUrls } from "../lib/extract-urls.js";
import { useI18n } from "../lib/i18n.js";
import { ImagePreviewStrip } from "./ImagePreviewStrip.js";

/** Built-in pi commands available from the dashboard */
const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: "compact", description: "Compact session context", source: "builtin" },
  { name: "reload", description: "Reload extensions, skills, prompts, and themes", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
];

/**
 * Dashboard-local slash commands. Intercepted by the composer before the
 * send pipeline — NEVER round-trip through the bridge or reach pi. Merged
 * into the `/`-autocomplete dropdown alongside `BUILTIN_COMMANDS`.
 * See change: render-file-previews.
 */
export const DASHBOARD_LOCAL_COMMANDS: CommandInfo[] = [
  { name: "view", description: "Preview a file or URL inline", source: "builtin" },
];

/**
 * Parse `/view <arg>` text into a `ViewTarget`. Returns null if the text
 * is not a well-formed view command (no arg, multi-token arg, or bare
 * non-URL/non-@ token). Pure for testing.
 * See change: render-file-previews.
 */
export function parseViewCommand(
  text: string,
  currentCwd: string | undefined,
): ViewTarget | null {
  const trimmed = text.trim();
  if (trimmed !== "/view" && !trimmed.startsWith("/view ")) return null;
  const rest = trimmed === "/view" ? "" : trimmed.slice("/view ".length).trim();
  if (rest === "") return null;
  // Reject multi-token args.
  if (/\s/.test(rest)) return null;
  if (rest.startsWith("@")) {
    if (!currentCwd) return null;
    const p = rest.slice(1);
    if (!p) return null;
    return { kind: "file", cwd: currentCwd, path: p };
  }
  if (/^https?:\/\//.test(rest)) {
    return { kind: "url", url: rest };
  }
  return null;
}

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
  /** Graceful stop: finish the current turn, then end the session cleanly. */
  onStopAfterTurn?: () => void;
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
  /**
   * Current session's cwd. Used to construct `{ kind: "file", cwd, path }`
   * ViewTargets when the user submits `/view @<path>`. When undefined the
   * `/view @<path>` form is a no-op (URL form still works).
   * See change: render-file-previews.
   */
  currentCwd?: string;
  /**
   * Dashboard-local `/view` handler. When the user submits `/view <arg>`,
   * the composer parses the arg and calls `onViewLocal(target)` instead of
   * `onSend`. Never reaches the bridge.
   * See change: render-file-previews.
   */
  onViewLocal?: (target: ViewTarget) => void;
  /**
   * Open an inline interactive terminal card in the chat stream (same path as
   * bare `!!`). When omitted, the terminal button is not rendered.
   * See change: add-inline-terminal-card.
   */
  onOpenInlineTerminal?: () => void;
  /**
   * Current session's messages — source for the `@`-autocomplete URL pool
   * (via `extractRecentUrls`). Omit to disable URL surfacing.
   * See change: render-file-previews.
   */
  sessionMessages?: ChatMessage[];
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

export function CommandInput({ commands: externalCommands, onSend, onListFiles, fileResults, disabled, sessionStatus, retrying, onAbort, onForceKill, onStopAfterTurn, pendingPrompt, onCancelPending, sessionId, draft, onDraftChange, history, images, onImagesChange, currentCwd, onViewLocal, onOpenInlineTerminal, sessionMessages }: Props) {
  const { t } = useI18n();
  // Treat retry-sleep as "still working" for Stop/Force-Stop visibility.
  const isWorking = sessionStatus === "streaming" || retrying === true;
  // Merge server commands with built-in + dashboard-local commands, avoiding duplicates.
  const commands = useMemo(() => {
    const names = new Set(externalCommands.map((c) => c.name));
    const builtins = BUILTIN_COMMANDS.filter((c) => !names.has(c.name));
    const dashLocal = DASHBOARD_LOCAL_COMMANDS.filter((c) => !names.has(c.name) && !builtins.some((b) => b.name === c.name));
    return [...builtins, ...dashLocal, ...externalCommands];
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

  // Graceful stop-after-turn optimistic pill. Cleared once the session is no
  // longer streaming (next agent_end / session_removed flips status).
  // See change: adopt-pi-071-072-073-features.
  const [stopAfterTurnRequested, setStopAfterTurnRequested] = useState(false);
  useEffect(() => {
    if (sessionStatus !== "streaming") setStopAfterTurnRequested(false);
  }, [sessionStatus]);
  // Reset across session switches — CommandInput is reused, so a new session
  // must not inherit the previous session's optimistic pill state.
  useEffect(() => {
    setStopAfterTurnRequested(false);
  }, [sessionId]);

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
  const composerRef = useRef<HTMLDivElement>(null);
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

  // URL pool from the current session's chat history (memoized over message
  // list reference). Filtered by `atQuery` substring (URL or host).
  // See change: render-file-previews.
  const allUrls = useMemo(
    () => (sessionMessages ? extractRecentUrls(sessionMessages) : []),
    [sessionMessages],
  );
  const urlItems = useMemo(() => {
    if (!isAtMode) return [];
    const q = (atQuery ?? "").toLowerCase();
    if (allUrls.length === 0) return [];
    if (q === "") return allUrls;
    return allUrls.filter((u) => {
      if (u.toLowerCase().includes(q)) return true;
      try {
        return new URL(u).hostname.toLowerCase().includes(q);
      } catch {
        return false;
      }
    });
  }, [isAtMode, atQuery, allUrls]);

  // Derive dropdown mode directly (no useEffect needed)
  // If user pressed Escape at the current text value, stay dismissed
  const isDismissed = dismissed === text;
  const dropdownMode: DropdownMode =
    isDismissed ? null
    : isCommand && filteredCommands.length > 0 ? "command"
    : isAtMode && (fileItems.length > 0 || urlItems.length > 0) ? "file"
    : null;

  const dropdownLength = dropdownMode === "command" ? filteredCommands.length
    : dropdownMode === "file" ? (fileItems.length + urlItems.length)
    : 0;

  // Flip the autocomplete dropdown above/below the composer based on viewport
  // space; clamp height so it never runs off-screen. See change:
  // fix-popover-viewport-flip.
  const { flipUp: ddFlipUp, maxHeight: ddMaxHeight } = usePopoverFlip(composerRef, {
    open: dropdownMode !== null,
  });

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

  // Insert a URL entry from the `@` dropdown. Replaces `@<query>` with the
  // URL verbatim — no leading `@`. See change: render-file-previews.
  const selectUrl = (url: string) => {
    const query = atQuery ?? "";
    const beforeAt = textBeforeCursor.slice(0, textBeforeCursor.length - query.length - 1); // remove `@<query>`
    const afterCursor = text.slice(cursorPos);
    const newText = `${beforeAt}${url} ${afterCursor}`;
    setText(newText);
    setDismissed(newText);
    const newCursorPos = beforeAt.length + url.length + 1;
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(newCursorPos, newCursorPos);
      inputRef.current?.focus();
    });
  };

  const localizedCommandDescription = (cmd: CommandInfo) => {
    if (cmd.source !== "builtin") return cmd.description;
    switch (cmd.name) {
      case "compact":
        return t("command.compactDescription", undefined, cmd.description);
      case "reload":
        return t("command.reloadDescription", undefined, cmd.description);
      case "new":
        return t("command.newDescription", undefined, cmd.description);
      case "view":
        return t("command.previewDescription", undefined, cmd.description);
      default:
        return cmd.description;
    }
  };

  const handleSend = useCallback((delivery?: "steer" | "followUp") => {
    const trimmed = text.trim();
    if (!trimmed) return;
    // Dashboard-local `/view` interception. Parse the arg and dispatch to
    // `onViewLocal`; NEVER call `onSend`. Empty/malformed `/view` is a no-op
    // (draft preserved). See change: render-file-previews.
    if (trimmed === "/view" || trimmed.startsWith("/view ")) {
      const target = parseViewCommand(trimmed, currentCwd);
      if (target && onViewLocal) {
        onViewLocal(target);
        clearImages();
        setText("");
        if (inputRef.current) inputRef.current.style.height = "38px";
      }
      // No target → silent no-op (preserve draft).
      return;
    }
    onSend(trimmed, pendingImages.length > 0 ? pendingImages : undefined, delivery);
    clearImages();
    setText("");
    if (inputRef.current) {
      inputRef.current.style.height = "38px";
    }
  }, [text, pendingImages, onSend, clearImages, currentCwd, onViewLocal, setText]);

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
            // Combined index: files first, URLs after.
            if (selectedIndex < fileItems.length) {
              const file = fileItems[selectedIndex];
              if (file) selectFile(file);
            } else {
              const url = urlItems[selectedIndex - fileItems.length];
              if (url) selectUrl(url);
            }
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
    <div ref={composerRef} className="border-t border-[var(--border-primary)] p-3 relative">
      {/* Autocomplete dropdown */}
      {dropdownMode === "command" && (
        <div
          style={{ maxHeight: ddMaxHeight }}
          className={`absolute left-3 right-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl overflow-y-auto shadow-lg z-10 ${
            ddFlipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
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
                <span className="text-[var(--text-tertiary)] truncate">{localizedCommandDescription(cmd)}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {dropdownMode === "file" && (
        <div
          style={{ maxHeight: ddMaxHeight }}
          className={`absolute left-3 right-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl overflow-y-auto shadow-lg z-10 ${
            ddFlipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
        >
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
          {urlItems.map((url, i) => {
            const idx = fileItems.length + i;
            let host = url;
            try { host = new URL(url).hostname; } catch { /* keep raw */ }
            return (
              <button
                key={`url:${url}`}
                data-dropdown-index={idx}
                onClick={() => selectUrl(url)}
                className={`w-full px-3 py-2 min-h-[44px] md:min-h-0 text-left text-sm flex items-center gap-2 ${
                  idx === selectedIndex ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
                }`}
              >
                <span className="inline-flex"><Icon path={mdiWeb} size={0.6} /></span>
                <span className="font-mono text-cyan-400">{host}</span>
                <span className="text-[var(--text-tertiary)] truncate">{url}</span>
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
          placeholder={t("command.placeholder", undefined, "Message, /command, !shell, or @file...")}
          /* Bridge-owned mid-turn queue: keep input enabled while the agent
             is streaming so further sends queue. Per the modified
             `optimistic-prompt` capability, disable only when pendingPrompt
             is in flight AND the agent is NOT streaming (idle-send case).
             See change: surface-mid-turn-prompt-queue. */
          disabled={disabled || (pendingPrompt && !isWorking)}
          rows={1}
          className="focus-ring flex-1 bg-[var(--bg-tertiary)] rounded-lg px-4 py-2 text-sm text-[var(--text-primary)] placeholder-gray-500 border border-[var(--border-secondary)] disabled:opacity-50 resize-none"
          style={{ minHeight: "38px", maxHeight: "120px" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "38px";
            target.style.height = Math.min(target.scrollHeight, 120) + "px";
          }}
        />
        {onOpenInlineTerminal && (
          <button
            onClick={() => onOpenInlineTerminal()}
            disabled={disabled}
            className="p-2 bg-[var(--bg-tertiary)] rounded-lg hover:bg-[var(--bg-surface)] disabled:opacity-50 disabled:cursor-not-allowed self-end"
            title={t("command.inlineTerminal", undefined, "Open inline terminal")}
            data-testid="open-inline-terminal-button"
          >
            <Icon path={mdiConsole} size={0.7} />
          </button>
        )}
        <button
          onClick={() => handleSend("steer")}
          /* Send button mirrors textarea: enabled during streaming so the
             user can queue another mid-turn message. */
          disabled={disabled || (pendingPrompt && !isWorking) || !text.trim()}
          className="focus-ring flex items-center justify-center min-w-[44px] min-h-[44px] bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed self-end"
          title={t("command.send", undefined, "Send")}
          aria-label={t("command.send", undefined, "Send")}
          data-testid="send-button"
        >
          <Icon path={mdiPlay} size={0.7} />
        </button>
        {isWorking && onStopAfterTurn && stopState === "idle" && !pendingPrompt && (
          stopAfterTurnRequested ? (
            <span
              className="flex items-center gap-1 px-2 self-end text-xs text-[var(--text-muted)]"
              data-testid="stop-after-turn-pill"
            >
              <Icon path={mdiStopCircleOutline} size={0.6} />
              {t("command.stoppingAfterTurn", undefined, "stopping after this turn…")}
            </span>
          ) : (
            <button
              onClick={() => { onStopAfterTurn(); setStopAfterTurnRequested(true); }}
              className="p-2 bg-[var(--bg-tertiary)] rounded-lg hover:bg-[var(--bg-secondary)] self-end"
              title={t("command.stopAfterTurn", undefined, "Stop after turn — finish this turn, then end cleanly")}
              data-testid="stop-after-turn-button"
            >
              <Icon path={mdiStopCircleOutline} size={0.7} />
            </button>
          )
        )}
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
            title={t("command.stop", undefined, "Stop")}
            data-testid="stop-button"
          >
            <Icon path={mdiStop} size={0.7} />
          </button>
        )}
        {isWorking && stopState === "aborting" && onForceKill && (
          <button
            onClick={() => { onForceKill(); setStopState("killing"); }}
            className="p-2 bg-orange-600 rounded-lg hover:bg-orange-500 self-end animate-pulse"
            title={t("command.forceStop", undefined, "Force Stop - kill the process")}
            data-testid="force-stop-button"
          >
            <Icon path={mdiAlert} size={0.7} />
          </button>
        )}
        {isWorking && stopState === "killing" && (
          <button
            disabled
            className="p-2 bg-orange-800 rounded-lg opacity-60 cursor-not-allowed self-end"
            title={t("command.killing", undefined, "Killing process...")}
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
