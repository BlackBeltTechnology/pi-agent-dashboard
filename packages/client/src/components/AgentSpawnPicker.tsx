/**
 * AgentSpawnPicker — split button for starting a new session with pi or a
 * configured ACP agent (WAI-ARIA APG Menu Button pattern).
 *
 * - No agents configured → renders the plain button EXACTLY as before (the
 *   caller passes today's content/classes), no menu, no extra DOM.
 * - Agents → main button spawns with the REMEMBERED agent for this folder
 *   (label names it); the chevron opens a radio menu (`pi` + agents). Choosing
 *   an item updates the folder's memory; it does not spawn.
 * - Keyboard: ArrowDown/Up/Home/End move, Enter/Space choose, Escape closes;
 *   focus returns to the chevron.
 *
 * See change: add-acp-session-driver (D16, mockup S1).
 */
import { mdiCheck, mdiChevronDown } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useAcpAgents } from "../hooks/useAcpAgents.js";
import { getRememberedAgent, rememberAgent } from "../lib/acp/agent-memory.js";
import { t as i18nT } from "../lib/i18n/i18n.js";

interface Props {
  cwd: string;
  /** Called with the chosen agent id, or `undefined` for pi. */
  onSpawn: (agent?: string) => void;
  disabled?: boolean;
  /** Today's button content (icon + "New Session"). */
  children: ReactNode;
  testId: string;
  /** Today's button classes (the plain button keeps them verbatim). */
  className: string;
  /** Today's title attribute. */
  title?: string;
}

type MenuKeyAction = { kind: "focus"; index: number } | { kind: "close" } | { kind: "choose" };

/** APG Menu Button keys → action (pure). */
function menuKeyAction(key: string, focused: number, count: number): MenuKeyAction | null {
  const wrap = (i: number): MenuKeyAction => ({ kind: "focus", index: (i + count) % count });
  switch (key) {
    case "ArrowDown":
      return wrap(focused + 1);
    case "ArrowUp":
      return wrap(focused - 1);
    case "Home":
      return wrap(0);
    case "End":
      return wrap(count - 1);
    case "Escape":
    case "Tab":
      return { kind: "close" };
    case "Enter":
    case " ":
      return { kind: "choose" };
    default:
      return null;
  }
}

export function AgentSpawnPicker({ cwd, onSpawn, disabled, children, testId, className, title }: Props) {
  const agents = useAcpAgents();
  const [current, setCurrent] = useState<string | undefined>(() => getRememberedAgent(cwd, agents));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLLIElement | null>>([]);

  // Re-resolve when the agent list or folder changes (a removed agent falls back to pi).
  useEffect(() => {
    setCurrent(getRememberedAgent(cwd, agents));
  }, [cwd, agents]);

  const items: Array<{ id: string | undefined; name: string; meta: string }> = [
    { id: undefined, name: "pi", meta: i18nT("acp.metaPi", undefined, "Default · flows, subagents, extensions") },
    ...agents.map((a) => ({ id: a.id, name: a.name, meta: i18nT("acp.metaAcp", undefined, "ACP agent") })),
  ];
  const checkedIndex = Math.max(0, items.findIndex((i) => i.id === current));

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    itemRefs.current[checkedIndex]?.focus();
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, checkedIndex]);

  if (agents.length === 0) {
    return (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSpawn(); }}
        disabled={disabled}
        data-testid={testId}
        className={className}
        title={title}
      >
        {children}
      </button>
    );
  }

  const currentName = items[checkedIndex]?.name ?? "pi";
  const choose = (id: string | undefined) => {
    setCurrent(id);
    rememberAgent(cwd, id);
    close(true);
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const focused = itemRefs.current.findIndex((el) => el === document.activeElement);
    const action = menuKeyAction(e.key, focused, items.length);
    if (!action) return;
    if (action.kind === "focus") {
      e.preventDefault();
      itemRefs.current[action.index]?.focus();
    } else if (action.kind === "close") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
    } else if (focused >= 0) {
      e.preventDefault();
      choose(items[focused]?.id);
    }
  };

  return (
    <div ref={rootRef} className="relative flex w-full" data-testid={`${testId}-split`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onSpawn(current); }}
        disabled={disabled}
        data-testid={testId}
        className={`${className} rounded-r-none border-r-0 min-w-0`}
        title={title}
      >
        <span className="flex min-w-0 items-center justify-center gap-1.5">
          {children}
          <span className="truncate font-normal" data-testid={`${testId}-agent`}>· {currentName}</span>
        </span>
      </button>
      <button
        ref={toggleRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={i18nT("acp.chooseAgent", undefined, "Choose agent for new session")}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        disabled={disabled}
        data-testid={`${testId}-chevron`}
        className={`${className} !w-11 sm:!w-8 shrink-0 rounded-l-none !px-0`}
      >
        <Icon path={mdiChevronDown} size={0.7} />
      </button>
      {open && (
        <ul
          role="menu"
          aria-label={i18nT("acp.agent", undefined, "Agent")}
          onKeyDown={onMenuKey}
          data-testid={`${testId}-menu`}
          className="absolute left-0 top-full z-30 mt-1 max-w-[calc(100vw-2rem)] min-w-[14rem] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1 shadow-lg"
        >
          {items.map((item, i) => (
            <li
              key={item.id ?? "pi"}
              ref={(el) => { itemRefs.current[i] = el; }}
              role="menuitemradio"
              aria-checked={i === checkedIndex}
              tabIndex={-1}
              data-agent={item.id ?? "pi"}
              onClick={(e) => { e.stopPropagation(); choose(item.id); }}
              className="focus-ring flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-[13px] text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] min-h-[44px] sm:min-h-0"
            >
              <span className="mt-0.5 w-4 shrink-0">{i === checkedIndex && <Icon path={mdiCheck} size={0.6} />}</span>
              <span className="flex min-w-0 flex-col">
                <span className="truncate font-bold">{item.name}</span>
                <span className="truncate text-[11px] text-[var(--text-secondary)]">{item.meta}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
