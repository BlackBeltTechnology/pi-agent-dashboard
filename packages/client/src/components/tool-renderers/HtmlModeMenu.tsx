/**
 * The chevron + menu beside an `.html` / `.htm` file link in the dashboard transcript (rich-chat-links D10):
 * Rendered / Static (no scripts) / Source. An icon-only sibling button (never nested in the link button), not
 * draggable, excluded from selection / copy (no text node), `aria-label`led, keyboard-operable through the shared
 * `MenuPopover` (first item focused, Escape closes + refocuses the trigger).
 */
import { mdiChevronDown } from "@mdi/js";
import { useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MenuItem, MenuPopover } from "../editor-pane/MenuPopover.js";

/** How an HTML link opens from the menu; a plain click on the link is none of these. */
export type HtmlOpenMode = "rendered" | "static" | "source";

const MODES: Array<{ mode: HtmlOpenMode; key: string; fallback: string }> = [
  { mode: "rendered", key: "chat.link.mode.rendered", fallback: "Rendered" },
  { mode: "static", key: "chat.link.mode.static", fallback: "Static (no scripts)" },
  { mode: "source", key: "chat.link.mode.source", fallback: "Source" },
];

/** Mounted by `FileLink` only for an eligible link, so an ordinary link carries no per-link element or state. */
export function HtmlModeMenu({ path, onPick }: { path: string; onPick: (mode: HtmlOpenMode) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        data-testid="link-html-menu-trigger"
        aria-label={i18nT("chat.link.openModes", { name: path }, "Open {name} as…")}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        draggable={false}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const el = e.currentTarget;
          setAnchor((cur) => (cur ? null : el));
        }}
        className="inline-flex shrink-0 select-none items-center bg-transparent border-0 p-0 ml-[0.125em] align-[-0.125em] cursor-pointer text-[var(--text-muted)] hover:text-[var(--link)]"
        style={{ font: "inherit", userSelect: "none" }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="1em" height="1em" className="fill-current">
          <path d={mdiChevronDown} />
        </svg>
      </button>
      {anchor && (
        <MenuPopover anchorEl={anchor} label={i18nT("chat.link.openModesMenu", undefined, "Open as")} testId="link-html-menu" onClose={() => setAnchor(null)}>
          {MODES.map(({ mode, key, fallback }) => (
            <MenuItem
              key={mode}
              testId={`link-html-mode-${mode}`}
              label={i18nT(key, undefined, fallback)}
              onSelect={() => {
                setAnchor(null);
                onPick(mode);
              }}
            />
          ))}
        </MenuPopover>
      )}
    </>
  );
}
