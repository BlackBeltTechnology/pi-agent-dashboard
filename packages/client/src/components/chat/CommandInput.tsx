import type { CommandInfo, FileEntry, ImageContent, ModelInfo, ViewTarget } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { mdiAlertOctagon, mdiClipboardText, mdiConsole, mdiDotsHorizontal, mdiEyeOutline, mdiFile, mdiFileDocumentOutline, mdiFlag, mdiFlash, mdiFolder, mdiImageOutline, mdiPlaylistPlus, mdiPlus, mdiSendVariant, mdiStop, mdiStopCircleOutline, mdiWeb, mdiWrench } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useImagePaste } from "../../hooks/useImagePaste.js";
import { usePopoverFlip } from "../../hooks/usePopoverFlip.js";
import type { ChatMessage } from "../../lib/chat/event-reducer.js";
import { extractRecentUrls } from "../../lib/preview/extract-urls.js";
import { useI18n } from "../../lib/i18n/i18n.js";
import { ImagePreviewStrip } from "../preview/ImagePreviewStrip.js";
import { ModelSelector } from "../settings/ModelSelector.js";
import { ThinkingLevelSelector } from "../settings/ThinkingLevelSelector.js";

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

  // --- Toolbar model/thinking chips (relocated from StatusBar) ---
  // See change: redesign-prompt-input.
  /** Selected model label (`"provider/id"`). */
  model?: string;
  /** Available models for the selected session. */
  models?: ModelInfo[];
  /** Favorite model labels, forwarded to ModelSelector. */
  favorites?: string[];
  /** Toggle a model favorite; forwarded to ModelSelector. */
  onToggleFavorite?: (label: string, makeFavorite: boolean) => void;
  /** Current thinking level. */
  thinkingLevel?: string;
  /** Select a model (`"provider/id"`). When omitted the model chip is hidden. */
  onSelectModel?: (model: string) => void;
  /** Select a thinking level. When omitted the thinking chip is hidden. */
  onSelectThinkingLevel?: (level: string) => void;
  /** Re-request the model list; forwarded to ModelSelector's footer refresh. */
  onRefreshModels?: () => void;
  /**
   * Context-window usage for the focus-revealed footer indicator. Rendered
   * only when `contextWindow > 0` and `tokens` is available client-side.
   * See change: redesign-prompt-input.
   */
  contextUsage?: { tokens: number | null; contextWindow?: number };
}

const sourceIcons: Record<string, ReactNode> = {
  extension: <Icon path={mdiFlash} size={0.6} />,
  prompt: <Icon path={mdiClipboardText} size={0.6} />,
  skill: <Icon path={mdiWrench} size={0.6} />,
  builtin: <Icon path={mdiConsole} size={0.6} />,
};

/** Human-readable group headers for the grouped `/` menu (by command source). */
const SOURCE_GROUP_LABEL: Record<string, string> = {
  builtin: "Built-in",
  extension: "Extensions",
  skill: "Skills",
  prompt: "Prompts",
};

/** Argument hints for commands the dashboard controls; shown in the `/` menu. */
const COMMAND_ARG_HINT: Record<string, string> = {
  view: "<@file | url>",
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

/** Minimum bare-leaf length before a walk-backed `list_files` request fires. */
export const MIN_FILE_QUERY_LEN = 3;

/**
 * Whether an `@`-mention query should issue a walk-backed `list_files` request.
 * A bare `@` (empty query) lists top-level entries; a slashed query is scoped
 * cheaply by its prefix; a bare leaf must reach the minimum length before the
 * walk fires (short 1–2 char leaves flood the walk for little signal).
 * See change: split-editor-workspace (spec: file-autocomplete).
 */
export function shouldWalkFileQuery(query: string): boolean {
  if (query.length === 0) return true; // bare @ → top-level listing
  if (query.includes("/")) return true; // scoped by prefix → cheap walk
  return query.length >= MIN_FILE_QUERY_LEN;
}

type StopState = "idle" | "aborting" | "killing";

export function CommandInput({ commands: externalCommands, onSend, onListFiles, fileResults, disabled, sessionStatus, retrying, onAbort, onForceKill, onStopAfterTurn, pendingPrompt, onCancelPending, sessionId, draft, onDraftChange, history, images, onImagesChange, currentCwd, onViewLocal, onOpenInlineTerminal, sessionMessages, model, models, favorites, onToggleFavorite, thinkingLevel, onSelectModel, onSelectThinkingLevel, onRefreshModels, contextUsage }: Props) {
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

  // --- v2 composer state (see change: redesign-prompt-input) ---
  // Delivery mode surfaces the hidden Enter(steer)/Alt+Enter(followUp)
  // contract as a visible Steer|Queue control. Default "steer".
  const [deliveryMode, setDeliveryMode] = useState<"steer" | "queue">("steer");
  // Footer hint line is revealed on focus / first keystroke so the resting
  // footprint stays lean (design D4).
  const [focused, setFocused] = useState(false);
  // ＋ attach menu + mobile ⋯ overflow popovers.
  const [attachOpen, setAttachOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const attachRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  const { pendingImages, imageError, handlePaste, removeImage, clearImages, addFiles } = useImagePaste(
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
    // Min-length guard: a 1–2 char bare leaf issues no walk; the dropdown keeps
    // the last valid result or nothing. See change: split-editor-workspace.
    if (!shouldWalkFileQuery(atQuery)) return;
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
        // Alt+Enter / Option+Enter = followUp always. Plain Enter follows the
        // visible Steer|Queue control (Queue = followUp, Steer = steer).
        // Mirrors pi's TUI keyboard contract. See change: add-steering-message,
        // redesign-prompt-input.
        const delivery = e.altKey || deliveryMode === "queue" ? "followUp" : "steer";
        handleSend(delivery);
      }
    },
    // Note: `selectCommand` / `selectFile` are intentionally omitted — they
    // are plain closures (see comment at their definition) and recomputed
    // every render anyway, so listing them would only cause unnecessary
    // handler-identity churn without affecting correctness.
    [dropdownMode, dropdownLength, filteredCommands, fileItems, urlItems, selectedIndex, handleSend, setText, text, pendingPrompt, onCancelPending, historyIndex, historyList, pendingImages, deliveryMode]
  );

  // Close ＋ attach / ⋯ overflow popovers on outside click.
  useEffect(() => {
    if (!attachOpen && !overflowOpen) return;
    function onDown(e: MouseEvent) {
      if (attachOpen && attachRef.current && !attachRef.current.contains(e.target as Node)) setAttachOpen(false);
      if (overflowOpen && overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [attachOpen, overflowOpen]);

  // ＋ menu actions, each wired to an EXISTING composer path.
  const handleAttachImage = useCallback(() => {
    setAttachOpen(false);
    fileInputRef.current?.click();
  }, []);
  const handleAttachFile = useCallback(() => {
    setAttachOpen(false);
    // Reuse the `@` file-mention flow: seed `@` at a token boundary so the
    // existing autocomplete (which only matches `@` after whitespace/start)
    // opens reliably even when the draft is non-empty.
    const needsSep = text.length > 0 && !/\s$/.test(text);
    setText(`${text}${needsSep ? " " : ""}@`);
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [text, setText]);
  const handlePreviewInline = useCallback(() => {
    setAttachOpen(false);
    // Reuse the `/view` local-interception path. `/view` must be the whole
    // line, so only auto-seed when the draft is empty — never clobber an
    // in-progress draft (data-loss guard).
    if (text.trim().length === 0) setText("/view ");
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [text, setText]);

  // Clipboard paste + preview-strip are delegated to the shared hook +
  // component (useImagePaste / ImagePreviewStrip) so the OpenSpec
  // Explore dialog can reuse the exact same behavior.

  // --- Morphing action button (send → stop → force-stop) ---
  // One button whose glyph/behaviour derive from state, replacing the old
  // four-button cluster. See change: redesign-prompt-input.
  const pendingIdle = pendingPrompt === true && !isWorking;
  const canStop = !!(onAbort || onCancelPending);
  let actionButton: ReactNode;
  if (isWorking && stopState === "aborting" && onForceKill) {
    actionButton = (
      <button
        onClick={() => { onForceKill(); setStopState("killing"); }}
        className="focus-ring flex items-center justify-center min-w-[44px] min-h-[44px] bg-orange-600 rounded-lg hover:bg-orange-500 self-end animate-pulse motion-reduce:animate-none"
        title={t("command.forceStop", undefined, "Force Stop - kill the process")}
        aria-label={t("command.forceStop", undefined, "Force Stop - kill the process")}
        data-testid="force-stop-button"
      >
        <Icon path={mdiAlertOctagon} size={0.8} />
      </button>
    );
  } else if (isWorking && stopState === "killing") {
    actionButton = (
      <button
        disabled
        className="flex items-center justify-center min-w-[44px] min-h-[44px] bg-orange-800 rounded-lg opacity-60 cursor-not-allowed self-end"
        title={t("command.killing", undefined, "Killing process...")}
        aria-label={t("command.killing", undefined, "Killing process...")}
        data-testid="killing-button"
      >
        <Icon path={mdiStop} size={0.8} />
      </button>
    );
  } else if ((isWorking || pendingIdle) && canStop) {
    actionButton = (
      <button
        onClick={() => {
          if (pendingPrompt) {
            onCancelPending?.();
          } else {
            onAbort?.();
            if (onForceKill) setStopState("aborting");
          }
        }}
        className="focus-ring flex items-center justify-center min-w-[44px] min-h-[44px] bg-red-600 rounded-lg hover:bg-red-500 self-end"
        title={pendingIdle ? t("command.cancelPending", undefined, "Cancel") : t("command.stop", undefined, "Stop")}
        aria-label={pendingIdle ? t("command.cancelPending", undefined, "Cancel") : t("command.stop", undefined, "Stop")}
        data-testid="stop-button"
      >
        <Icon path={mdiStop} size={0.8} />
      </button>
    );
  } else {
    actionButton = (
      <button
        onClick={() => handleSend(deliveryMode === "queue" ? "followUp" : "steer")}
        disabled={disabled || pendingIdle || !text.trim()}
        className="focus-ring flex items-center justify-center min-w-[44px] min-h-[44px] bg-blue-600 rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed self-end"
        title={t("command.send", undefined, "Send")}
        aria-label={t("command.send", undefined, "Send")}
        data-testid="send-button"
      >
        <Icon path={mdiSendVariant} size={0.8} />
      </button>
    );
  }

  // Stop-after-turn slim secondary affordance (beside the action button).
  const showStopAfterTurn = isWorking && onStopAfterTurn && stopState === "idle" && !pendingPrompt;
  const stopAfterTurnNode = !showStopAfterTurn ? null : stopAfterTurnRequested ? (
    <span
      className="flex items-center gap-1 px-2 self-end text-xs text-[var(--text-muted)]"
      data-testid="stop-after-turn-pill"
    >
      <Icon path={mdiStopCircleOutline} size={0.6} />
      {t("command.stoppingAfterTurn", undefined, "stopping after this turn…")}
    </span>
  ) : (
    <button
      onClick={() => { onStopAfterTurn?.(); setStopAfterTurnRequested(true); }}
      className="focus-ring flex items-center gap-1 self-end px-2 h-[30px] rounded-lg text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
      title={t("command.stopAfterTurn", undefined, "Stop after turn — finish this turn, then end cleanly")}
      aria-label={t("command.stopAfterTurn", undefined, "Stop after turn")}
      data-testid="stop-after-turn-button"
    >
      <Icon path={mdiStopCircleOutline} size={0.6} />
      <span className="hidden @[30rem]:inline">{t("command.afterTurn", undefined, "after turn")}</span>
    </button>
  );

  // Delivery segmented control (Steer | Queue) — shared desktop + overflow.
  const deliveryControl = (
    <div
      className="inline-flex rounded-lg overflow-hidden border border-[var(--border-secondary)] h-[30px]"
      data-testid="delivery-control"
      role="group"
      aria-label={t("command.deliveryMode", undefined, "Delivery mode")}
    >
      <button
        type="button"
        onClick={() => setDeliveryMode("steer")}
        aria-pressed={deliveryMode === "steer"}
        data-testid="delivery-steer"
        className={`inline-flex items-center gap-1 px-2 text-[11px] ${deliveryMode === "steer" ? "bg-[color-mix(in_srgb,var(--accent-primary)_18%,transparent)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"}`}
      >
        <Icon path={mdiFlag} size={0.5} />{t("command.steer", undefined, "Steer")}
      </button>
      <button
        type="button"
        onClick={() => setDeliveryMode("queue")}
        aria-pressed={deliveryMode === "queue"}
        data-testid="delivery-queue"
        className={`inline-flex items-center gap-1 px-2 text-[11px] ${deliveryMode === "queue" ? "bg-[color-mix(in_srgb,var(--accent-purple)_20%,transparent)] text-[var(--text-primary)]" : "text-[var(--text-tertiary)] hover:bg-[var(--bg-hover)]"}`}
      >
        <Icon path={mdiPlaylistPlus} size={0.5} />{t("command.queue", undefined, "Queue")}
      </button>
    </div>
  );

  const terminalButton = onOpenInlineTerminal ? (
    <button
      onClick={() => onOpenInlineTerminal()}
      disabled={disabled}
      className="focus-ring inline-flex items-center justify-center w-[34px] h-[30px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50 disabled:cursor-not-allowed"
      title={t("command.inlineTerminal", undefined, "Open inline terminal")}
      aria-label={t("command.inlineTerminal", undefined, "Open inline terminal")}
      data-testid="open-inline-terminal-button"
    >
      <Icon path={mdiConsole} size={0.7} />
    </button>
  ) : null;

  const thinkingChip = onSelectThinkingLevel ? (
    <ThinkingLevelSelector
      current={thinkingLevel}
      onSelect={onSelectThinkingLevel}
      supportedLevels={models?.find((m) => `${m.provider}/${m.id}` === model)?.supportedThinkingLevels}
    />
  ) : null;

  const footerVisible = focused || text.trim().length > 0 || pendingImages.length > 0;
  const ctxWindow = contextUsage?.contextWindow ?? 0;
  const ctxTokens = contextUsage?.tokens ?? null;
  const ctxLeftPct = ctxWindow > 0 && ctxTokens != null
    ? Math.max(0, Math.min(100, Math.round(100 - (ctxTokens / ctxWindow) * 100)))
    : null;

  return (
    <div
      ref={composerRef}
      data-testid="composer-root"
      className="border-t border-[var(--border-primary)] p-3 relative"
    >
      {/* Autocomplete dropdown — grouped by source with badges + arg hints. */}
      {dropdownMode === "command" && (
        <div
          style={{ maxHeight: ddMaxHeight }}
          className={`absolute left-3 right-3 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl overflow-y-auto shadow-lg z-10 ${
            ddFlipUp ? "bottom-full mb-1" : "top-full mt-1"
          }`}
          data-testid="command-dropdown"
        >
          {filteredCommands.map((cmd, i) => {
            const prevSource = i > 0 ? filteredCommands[i - 1]?.source : undefined;
            const showHeader = cmd.source !== prevSource;
            return (
              <React.Fragment key={cmd.name}>
                {showHeader && (
                  <div className="px-3 pt-2 pb-1 text-[9px] uppercase tracking-wider text-[var(--text-muted)] bg-[var(--bg-code)]">
                    {SOURCE_GROUP_LABEL[cmd.source] ?? cmd.source}
                  </div>
                )}
                <button
                  data-dropdown-index={i}
                  onClick={() => selectCommand(cmd)}
                  className={`w-full px-3 py-2 min-h-[44px] md:min-h-0 text-left text-sm flex items-center gap-2 ${
                    i === selectedIndex ? "bg-[var(--bg-tertiary)]" : "hover:bg-[var(--bg-hover)]"
                  }`}
                >
                  <span className="inline-flex">{sourceIcons[cmd.source] ?? <Icon path={mdiFlash} size={0.6} />}</span>
                  <span className="font-mono text-blue-400">/{cmd.name}</span>
                  {COMMAND_ARG_HINT[cmd.name] && (
                    <span className="font-mono text-[var(--text-muted)] text-xs">{COMMAND_ARG_HINT[cmd.name]}</span>
                  )}
                  <span className="ml-auto flex items-center gap-2 min-w-0">
                    {cmd.description && (
                      <span className="text-[var(--text-tertiary)] truncate">{localizedCommandDescription(cmd)}</span>
                    )}
                    <span className="text-[9px] px-1.5 py-0.5 rounded border border-[var(--border-secondary)] text-[var(--text-tertiary)] uppercase flex-shrink-0">{cmd.source}</span>
                  </span>
                </button>
              </React.Fragment>
            );
          })}
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

      {/* Hidden file input for the ＋ attach-image entry (same path as paste). */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="attach-file-input"
        onChange={(e) => {
          if (e.target.files && e.target.files.length > 0) addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {/* One unified bordered card: attachments → textarea → inner toolbar. */}
      <div
        data-testid="composer-card"
        className={`@container bg-[var(--bg-tertiary)] border rounded-xl px-2.5 pt-2 pb-1.5 transition-colors ${
          focused ? "border-[color-mix(in_srgb,var(--accent-primary)_60%,transparent)]" : "border-[var(--border-secondary)]"
        }`}
      >
        {/* Pasted-image error banner + thumbnail strip (attachments row). */}
        <ImagePreviewStrip images={pendingImages} error={imageError} onRemove={removeImage} />

        <textarea
          ref={inputRef}
          value={text}
          onChange={(e) => {
            if (historyIndexRef.current !== null) {
              setHistoryIndex(null);
            }
            setText(e.target.value);
          }}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={t("command.placeholder", undefined, "Message, /command, !shell, or @file...")}
          /* Bridge-owned mid-turn queue: keep input enabled while the agent
             is streaming so further sends queue. Disable only when a prompt
             is in flight AND the agent is NOT streaming (idle-send case). */
          disabled={disabled || pendingIdle}
          rows={1}
          className="focus-ring block w-full bg-transparent px-1.5 py-1 text-sm text-[var(--text-primary)] placeholder-gray-500 resize-none outline-none"
          style={{ minHeight: "38px", maxHeight: "120px" }}
          onInput={(e) => {
            const target = e.target as HTMLTextAreaElement;
            target.style.height = "38px";
            target.style.height = Math.min(target.scrollHeight, 120) + "px";
          }}
        />

        {/* Inner toolbar. */}
        <div className="flex items-center gap-1.5 pt-1">
          {/* ＋ attach menu. */}
          <div className="relative" ref={attachRef}>
            <button
              type="button"
              onClick={() => setAttachOpen((v) => !v)}
              disabled={disabled}
              className="focus-ring inline-flex items-center justify-center w-[34px] h-[30px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] disabled:opacity-50"
              title={t("command.attach", undefined, "Attach")}
              aria-label={t("command.attach", undefined, "Attach")}
              aria-haspopup="menu"
              aria-expanded={attachOpen}
              data-testid="attach-button"
            >
              <Icon path={mdiPlus} size={0.85} />
            </button>
            {attachOpen && (
              <div
                className="absolute left-0 bottom-full mb-2 w-56 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl overflow-hidden shadow-lg z-20"
                role="menu"
                data-testid="attach-menu"
              >
                <button role="menuitem" onClick={handleAttachImage} data-testid="attach-image" className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-left">
                  <Icon path={mdiImageOutline} size={0.7} /><span>{t("command.attachImage", undefined, "Attach image")}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)]">⌘V</span>
                </button>
                <button role="menuitem" onClick={handleAttachFile} data-testid="attach-file" className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-left">
                  <Icon path={mdiFileDocumentOutline} size={0.7} /><span>{t("command.attachFile", undefined, "Attach file")}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)]">@ path</span>
                </button>
                <button role="menuitem" onClick={handlePreviewInline} data-testid="attach-preview" className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] text-left">
                  <Icon path={mdiEyeOutline} size={0.7} /><span>{t("command.previewInline", undefined, "Preview inline")}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-muted)]">/view</span>
                </button>
              </div>
            )}
          </div>

          {/* Model chip. */}
          {onSelectModel && (
            <ModelSelector
              current={model}
              models={models}
              onSelect={onSelectModel}
              onRefresh={onRefreshModels}
              favorites={favorites}
              onToggleFavorite={onToggleFavorite}
            />
          )}

          {/* Thinking + delivery + terminal — desktop inline; folded into ⋯ on mobile. */}
          <span className="hidden @[44rem]:inline-flex">{thinkingChip}</span>
          <span className="hidden @[44rem]:inline-flex">{deliveryControl}</span>

          <span className="flex-1" />

          {/* Mobile overflow (⋯) hosts thinking / delivery / terminal. */}
          <div className="relative @[44rem]:hidden" ref={overflowRef}>
            <button
              type="button"
              onClick={() => setOverflowOpen((v) => !v)}
              className="focus-ring inline-flex items-center justify-center w-[34px] h-[30px] rounded-lg text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
              title={t("command.more", undefined, "More")}
              aria-label={t("command.more", undefined, "More")}
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              data-testid="overflow-button"
            >
              <Icon path={mdiDotsHorizontal} size={0.7} />
            </button>
            {overflowOpen && (
              <div
                className="absolute right-0 bottom-full mb-2 flex flex-col gap-2 p-2 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl shadow-lg z-20"
                role="menu"
                data-testid="overflow-menu"
              >
                {thinkingChip}
                {deliveryControl}
                {terminalButton}
              </div>
            )}
          </div>

          {/* Terminal — desktop only (mobile via ⋯). */}
          <span className="hidden @[44rem]:inline-flex">{terminalButton}</span>

          {stopAfterTurnNode}
          {actionButton}
        </div>
      </div>

      {/* Focus-revealed footer hint line + context-left indicator. */}
      {footerVisible && (
        <div
          className="flex items-center flex-wrap gap-x-1 gap-y-0.5 px-1 pt-2 text-[11px] text-[var(--text-muted)]"
          data-testid="composer-footer"
        >
          <span><kbd className="font-mono text-[10px] text-[var(--text-secondary)]">⏎</kbd> {t("command.hintSend", undefined, "send")}</span>
          <span className="opacity-50 mx-1">·</span>
          <span><kbd className="font-mono text-[10px] text-[var(--text-secondary)]">⇧⏎</kbd> {t("command.hintNewline", undefined, "newline")}</span>
          <span className="opacity-50 mx-1">·</span>
          <span><kbd className="font-mono text-[10px] text-[var(--text-secondary)]">/</kbd> {t("command.hintCommands", undefined, "commands")}</span>
          <span className="opacity-50 mx-1">·</span>
          <span><kbd className="font-mono text-[10px] text-[var(--text-secondary)]">@</kbd> {t("command.hintFiles", undefined, "files")}</span>
          <span className="opacity-50 mx-1">·</span>
          <span><kbd className="font-mono text-[10px] text-[var(--text-secondary)]">!</kbd> {t("command.hintShell", undefined, "shell")}</span>
          {ctxLeftPct != null && (
            <span className="ml-auto flex items-center gap-1.5" data-testid="composer-context-left" title={t("command.contextLeft", undefined, "Context window remaining")}>
              <span className="inline-block w-14 h-1 rounded bg-[var(--bg-surface)] overflow-hidden">
                <span className={`block h-full rounded ${ctxLeftPct < 20 ? "bg-orange-500" : "bg-green-500"}`} style={{ width: `${ctxLeftPct}%` }} />
              </span>
              {ctxLeftPct}% {t("command.context", undefined, "context")}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
