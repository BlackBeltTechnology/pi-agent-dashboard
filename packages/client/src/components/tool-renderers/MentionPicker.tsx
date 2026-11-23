import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { normalizeUnderCwd } from "../../lib/util/normalize-path.js";

interface Props {
  /** The mention the user clicked (shown in the title). */
  mention: string;
  /** Absolute candidate paths, in server order. */
  candidates: string[];
  cwd: string;
  /** The user's choice — the ONLY way a file opens from this picker. */
  onPick: (path: string) => void;
  /** Escape or backdrop click: nothing opens. */
  onClose: () => void;
}

/**
 * Chooser for a mention that matched several files (or was refused as a guess), design D3 of rich-chat-links.
 * A modal listbox in a portal, so the link element itself is never touched. Keyboard: ↑/↓/Home/End move,
 * Enter picks, Escape closes. Opens nothing unless the user picks.
 */
export function MentionPicker({ mention, candidates, cwd, onPick, onClose }: Props) {
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  useEffect(() => listRef.current?.focus(), []);

  const title = i18nT("chat.link.pickTitle", { mention }, "Choose a file for {mention}");
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = candidates.length - 1;
    switch (e.key) {
      case "ArrowDown":
        setActive((i) => Math.min(i + 1, last));
        break;
      case "ArrowUp":
        setActive((i) => Math.max(i - 1, 0));
        break;
      case "Home":
        setActive(0);
        break;
      case "End":
        setActive(last);
        break;
      case "Enter":
        onPick(candidates[active]);
        break;
      case "Escape":
        onClose();
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div data-testid="mention-picker-backdrop" className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className="max-w-[min(90vw,40rem)] rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-2 text-xs text-[var(--text-primary)] shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-2 pb-1 text-[var(--text-muted)]">{title}</div>
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label={title}
          aria-activedescendant={`mention-picker-opt-${active}`}
          onKeyDown={onKeyDown}
          className="m-0 max-h-[50vh] list-none overflow-y-auto p-0 outline-none"
        >
          {candidates.map((c, i) => (
            <li
              key={c}
              id={`mention-picker-opt-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => onPick(c)}
              className={`cursor-pointer break-all rounded px-2 py-1 ${i === active ? "bg-[var(--bg-surface)]" : ""}`}
            >
              {normalizeUnderCwd(c, cwd)}
            </li>
          ))}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
