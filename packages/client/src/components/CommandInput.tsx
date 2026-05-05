import React, { useState, useCallback, useRef, useEffect, useLayoutEffect, useMemo, type ReactNode } from "react";
import ContentEditable from "react-contenteditable";
import { Icon } from "@mdi/react";
import { mdiFlash, mdiClipboardText, mdiWrench, mdiFolder, mdiFile, mdiStop, mdiAlert, mdiConsole, mdiClose, mdiSend } from "@mdi/js";
import type { CommandInfo, ImageContent, FileEntry } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import { useImagePaste } from "../hooks/useImagePaste.js";
import { ImagePreviewStrip } from "./ImagePreviewStrip.js";
import { useMobile } from "../hooks/useMobile.js";
import { getPlainTextCursor, setPlainTextCursor, plainToSafeHtml, safeHtmlToPlain } from "./contenteditable-utils.js";

/** Built-in pi commands available from the dashboard */
const BUILTIN_COMMANDS: CommandInfo[] = [
  { name: "compact", description: "Compact session context", source: "builtin" },
  { name: "reload", description: "Reload extensions, skills, prompts, and themes", source: "builtin" },
  { name: "new", description: "Start a new session", source: "builtin" },
];

interface Props {
  commands: CommandInfo[];
  onSend: (text: string, images?: ImageContent[]) => void;
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
  /** Controlled draft text. When provided, the input is controlled by the parent. */
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

/**
 * Caret-on-first-line predicate: returns true iff `selectionStart` sits at or
 * before the first `\n` (so `ArrowUp` would have nowhere to go natively).
 * Always false when there is a non-empty selection.
 */
export function isCaretOnFirstLine(selectionStart: number, selectionEnd: number, value: string): boolean {
  if (selectionStart !== selectionEnd) return false;
  const firstNewline = value.indexOf("\n");
  if (firstNewline === -1) return true;
  return selectionStart <= firstNewline;
}

/**
 * Caret-on-last-line predicate: returns true iff `selectionStart` sits at or
 * after the position following the last `\n` (so `ArrowDown` would have
 * nowhere to go natively). Always false when there is a non-empty selection.
 */
export function isCaretOnLastLine(selectionStart: number, selectionEnd: number, value: string): boolean {
  if (selectionStart !== selectionEnd) return false;
  const lastNewline = value.lastIndexOf("\n");
  if (lastNewline === -1) return true;
  return selectionStart >= lastNewline + 1;
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
  const isControlled = draft !== undefined;
  const [localText, setLocalText] = useState("");
  const text = isControlled ? (draft as string) : localText;
  const setText = useCallback((v: string) => {
    if (!isControlled) setLocalText(v);
    onDraftChange?.(v);
  }, [isControlled, onDraftChange]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [stopState, setStopState] = useState<StopState>("idle");
  const isMobile = useMobile();

  // Track whether iOS software keyboard is covering the safe area.
  const [keyboardUp, setKeyboardUp] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;
    const onResize = () => {
      const vh = window.visualViewport!.height;
      const wh = window.innerHeight;
      setKeyboardUp(vh < wh - 50);
    };
    window.visualViewport.addEventListener("resize", onResize);
    window.visualViewport.addEventListener("scroll", onResize);
    onResize();
    return () => {
      window.visualViewport?.removeEventListener("resize", onResize);
      window.visualViewport?.removeEventListener("scroll", onResize);
    };
  }, []);

  // --- History recall (bash-style) ---
  const historyList = history ?? [];
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const savedDraftRef = useRef<string>("");
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

  // --- Image paste ---
  const { pendingImages, imageError, handlePaste, removeImage, clearImages } = useImagePaste(
    images !== undefined ? { images, onImagesChange } : undefined,
  );
  const [dismissed, setDismissed] = useState<string | null>(null);
  const prevDropdownKeyRef = useRef<string>("");

  // DOM ref to the contenteditable element (via react-contenteditable's innerRef)
  const editableRef = useRef<HTMLElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFileQueryRef = useRef<string | null>(null);

  // --- IME composition guard ---
  const isComposingRef = useRef(false);

  // --- Imperatively set contentEditable="plaintext-only" ---
  // react-contenteditable unconditionally sets contentEditable={true} in render.
  // Only override when enabled; when disabled, respect the library's contentEditable=false.
  useLayoutEffect(() => {
    const el = editableRef.current;
    if (!el) return;
    if (!isDisabled && el.getAttribute("contenteditable") !== "plaintext-only") {
      el.setAttribute("contenteditable", "plaintext-only");
    } else if (isDisabled && el.getAttribute("contenteditable") !== "false") {
      el.setAttribute("contenteditable", "false");
    }
  });

  // --- Auto-resize ---
  const resizeInput = useCallback(() => {
    const el = editableRef.current;
    if (!el) return;
    el.style.height = "40px";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }, []);

  useLayoutEffect(() => {
    const el = editableRef.current;
    if (el) {
      resizeInput();
    }
  }, [text, pendingImages, resizeInput]);

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

  // --- @ file autocomplete (cursor-aware) ---
  // Get cursor position in plaintext via text-node walker.
  // editableRef may be null during initial render (innerRef not yet set).
  const cursorPos = editableRef.current ? (getPlainTextCursor(editableRef.current) ?? text.length) : text.length;
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

  const selectCommand = (cmd: CommandInfo) => {
    const newText = `/${cmd.name} `;
    setText(newText);
    setDismissed(newText);
    editableRef.current?.focus();
  };

  const selectFile = (file: FileEntry) => {
    const el = editableRef.current;
    if (!el) return;
    const curPos = getPlainTextCursor(el) ?? text.length;
    const query = atQuery ?? "";
    const beforeAt = text.slice(0, curPos - query.length - 1); // remove @query
    const afterCursor = text.slice(curPos);
    const filePath = file.path;
    const suffix = file.isDirectory ? "" : " ";
    const newText = `${beforeAt}@${filePath}${suffix}${afterCursor}`;
    setText(newText);
    setDismissed(newText);
    // Set cursor after the inserted path
    const newCursorPos = beforeAt.length + 1 + filePath.length + suffix.length;
    requestAnimationFrame(() => {
      if (el) {
        el.focus();
        setPlainTextCursor(el, newCursorPos);
      }
    });
  };

  const handleSend = useCallback(() => {
    if (text.trim()) {
      onSend(text.trim(), pendingImages.length > 0 ? pendingImages : undefined);
      clearImages();
      setText("");
      // Reset height
      if (editableRef.current) {
        editableRef.current.style.height = "40px";
      }
    }
  }, [text, pendingImages, onSend, clearImages, setText]);

  // --- ContentEditable onChange → plaintext ---
  const handleChange = useCallback(
    (evt: { target: { value: string } }) => {
      if (historyIndexRef.current !== null) {
        setHistoryIndex(null);
      }
      const plain = safeHtmlToPlain(evt.target.value);
      setText(plain);
    },
    [setText],
  );

  // --- onBeforeInput: intercept Enter/Shift+Enter ---
  const handleBeforeInput = useCallback(
    (e: React.FormEvent<HTMLDivElement> & { inputType?: string }) => {
      resizeInput();

      if (e.inputType === "insertParagraph") {
        // Enter pressed — send on desktop, let through on mobile.
        // Never send during IME composition.
        if (!isMobile && !isComposingRef.current) {
          e.preventDefault();
          handleSend();
        }
        return;
      }
      // insertLineBreak (Shift+Enter) — let browser handle it naturally
    },
    [isMobile, handleSend, resizeInput],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (dropdownMode) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSelectedIndex((i) => {
            const next = Math.min(i + 1, dropdownLength - 1);
            requestAnimationFrame(() => {
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
            if (cmd && !isComposingRef.current) selectCommand(cmd);
          } else if (dropdownMode === "file") {
            const file = fileItems[selectedIndex];
            if (file && !isComposingRef.current) selectFile(file);
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
      if (!pendingPrompt && (e.key === "ArrowUp" || e.key === "ArrowDown" || e.key === "Escape")) {
        const el = editableRef.current;
        // Escape while in history mode: restore the in-progress draft and exit.
        if (e.key === "Escape" && historyIndex !== null) {
          e.preventDefault();
          const restored = savedDraftRef.current;
          setText(restored);
          setHistoryIndex(null);
          requestAnimationFrame(() => {
            if (el) {
              el.focus();
              setPlainTextCursor(el, restored.length);
              resizeInput();
            }
          });
          return;
        }
        if (el && historyList.length > 0 && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
          const selPos = getPlainTextCursor(el) ?? text.length;
          // For first-line detection, treat cursor at position 0 as first line
          const isOnFirstLine = isCaretOnFirstLine(selPos, selPos, text);
          const isOnLastLine = isCaretOnLastLine(selPos, selPos, text);

          if (e.key === "ArrowUp" && isOnFirstLine) {
            e.preventDefault();
            const nextIdx = historyIndex === null ? 0 : Math.min(historyIndex + 1, historyList.length - 1);
            if (historyIndex === null) {
              savedDraftRef.current = text;
            }
            const nextText = historyList[nextIdx] ?? "";
            setHistoryIndex(nextIdx);
            setText(nextText);
            requestAnimationFrame(() => {
              if (el) {
                el.focus();
                setPlainTextCursor(el, nextText.length);
                resizeInput();
              }
            });
            return;
          }
          if (e.key === "ArrowDown" && historyIndex !== null && isOnLastLine) {
            e.preventDefault();
            if (historyIndex === 0) {
              const restored = savedDraftRef.current;
              setHistoryIndex(null);
              setText(restored);
              requestAnimationFrame(() => {
                if (el) {
                  el.focus();
                  setPlainTextCursor(el, restored.length);
                  resizeInput();
                }
              });
            } else {
              const nextIdx = historyIndex - 1;
              const nextText = historyList[nextIdx] ?? "";
              setHistoryIndex(nextIdx);
              setText(nextText);
              requestAnimationFrame(() => {
                if (el) {
                  el.focus();
                  setPlainTextCursor(el, nextText.length);
                  resizeInput();
                }
              });
            }
            return;
          }
        }
      }

      // Enter on desktop — send (fallback for browsers without beforeinput)
      if (e.key === "Enter" && !e.shiftKey && !isMobile && !isComposingRef.current) {
        e.preventDefault();
        handleSend();
      }
    },
    [dropdownMode, dropdownLength, filteredCommands, fileItems, selectedIndex, handleSend, setText, text, pendingPrompt, onCancelPending, historyIndex, historyList, isMobile, resizeInput],
  );

  // --- Keyboard-safe HTML for contenteditable ---
  const safeHtml = plainToSafeHtml(text);
  const isDisabled = disabled || pendingPrompt;
  const placeholder = "Message, /command, !shell, or @file...";

  return (
    <div className="border-t border-[var(--border-primary)] p-3 relative" style={{ paddingBottom: keyboardUp ? '0.75rem' : 'calc(0.75rem + env(safe-area-inset-bottom, 0px))' }}>
      {/* Autocomplete dropdown */}
      {dropdownMode === "command" && (
        <div className="absolute bottom-full left-3 right-3 mb-1 bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-xl max-h-64 overflow-y-auto shadow-lg z-10">
          {filteredCommands.map((cmd, i) => (
            <button
              key={cmd.name}
              data-dropdown-index={i}
              onMouseDown={(e) => e.preventDefault()}
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
                onMouseDown={(e) => e.preventDefault()}
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

      {/* Pasted-image error banner + thumbnail strip. */}
      <ImagePreviewStrip images={pendingImages} error={imageError} onRemove={removeImage} />

      <style>{`
        [data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: #6b7280;
          pointer-events: none;
        }
      `}</style>

      <div className="flex gap-2">
        <ContentEditable
          key={`ce-${dropdownMode ?? 'none'}`}
          innerRef={editableRef}
          html={safeHtml}
          disabled={isDisabled}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          onBeforeInput={handleBeforeInput}
          onCompositionStart={() => { isComposingRef.current = true; }}
          onCompositionEnd={() => { isComposingRef.current = false; }}
          onDrop={(e) => {
            // Prevent rich-text drag-and-drop from inserting HTML.
            // Image pastes are already handled by useImagePaste.
            e.preventDefault();
          }}
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          enterKeyHint="send"
          role="textbox"
          aria-multiline="true"
          aria-placeholder={placeholder}
          aria-disabled={isDisabled}
          data-placeholder={text.length === 0 ? placeholder : ""}
          data-testid="command-input"
          className="flex-1 bg-[var(--bg-tertiary)] rounded-lg px-4 py-1.5 text-base text-[var(--text-primary)] border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none disabled:opacity-50 resize-none overflow-y-auto whitespace-pre-wrap break-words"
          style={{ minHeight: "40px", maxHeight: "120px" }}
          tagName="div"
        />
        <button
          onClick={handleSend}
          disabled={isDisabled || !text.trim()}
          className="p-2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] active:bg-[var(--bg-tertiary)] active:scale-95 rounded-lg disabled:opacity-30 disabled:cursor-not-allowed self-center transition-all"
          title="Send"
          data-testid="send-button"
        >
          <Icon path={mdiSend} size={0.65} />
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
            className="p-2 text-[var(--text-secondary)] hover:text-red-400 hover:bg-[var(--bg-hover)] active:bg-[var(--bg-tertiary)] active:scale-95 rounded-lg self-center transition-all"
            title="Stop"
            data-testid="stop-button"
          >
            <Icon path={mdiStop} size={0.65} />
          </button>
        )}
        {isWorking && stopState === "aborting" && onForceKill && (
          <button
            onClick={() => { onForceKill(); setStopState("killing"); }}
            className="p-2 text-[var(--text-secondary)] hover:text-orange-400 hover:bg-[var(--bg-hover)] active:bg-[var(--bg-tertiary)] active:scale-95 rounded-lg self-center animate-pulse transition-all"
            title="Force Stop — kill the process"
            data-testid="force-stop-button"
          >
            <Icon path={mdiAlert} size={0.65} />
          </button>
        )}
        {isWorking && stopState === "killing" && (
          <button
            disabled
            className="p-2 text-[var(--text-tertiary)] rounded-lg opacity-40 cursor-not-allowed self-center"
            title="Killing process..."
            data-testid="killing-button"
          >
            <Icon path={mdiStop} size={0.65} />
          </button>
        )}
      </div>
    </div>
  );
}
