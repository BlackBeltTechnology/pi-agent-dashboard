/**
 * AgentSpawnPicker — split button for starting a new session with pi or a
 * configured ACP agent (WAI-ARIA APG Menu Button pattern).
 *
 * - The chevron ALWAYS renders. Its menu holds the agent radios (only when ACP
 *   agents exist) plus the spawn model · thinking chip (disabled while an ACP
 *   agent is selected). See change: add-spawn-model-choice (D7).
 * - Main button spawns with the REMEMBERED agent for this folder (label names it
 *   when agents exist) and, for pi, the folder's effective model choice
 *   (remembered ?? Settings default). Choosing in the menu updates the folder's
 *   memory; it does not spawn.
 * - Keyboard: ArrowDown/Up/Home/End move, Enter/Space choose, Escape closes;
 *   focus returns to the chevron. The chip item focuses its own trigger, which
 *   opens its own popover.
 *
 * See change: add-acp-session-driver (D16, mockup S1).
 */
import { mdiCheck, mdiChevronDown } from "@mdi/js";
import { Icon } from "@mdi/react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useAcpAgents } from "../hooks/useAcpAgents.js";
import { getRememberedAgent, rememberAgent } from "../lib/acp/agent-memory.js";
import { t as i18nT } from "../lib/i18n/i18n.js";
import { getEffectiveSpawnChoice, type SpawnChoice } from "../lib/spawn/spawn-choice-memory.js";
import { SpawnChoiceChip } from "./spawn/SpawnChoiceChip.js";

interface Props {
  cwd: string;
  /**
   * Called with the chosen agent id (`undefined` = pi) and, for pi, the folder's
   * effective model choice (omitted when empty).
   */
  onSpawn: (agent?: string, choice?: SpawnChoice) => void;
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

type MenuItem = { kind: "agent"; id: string | undefined; name: string; meta: string } | { kind: "choice" };

/** Mousedown inside the chip's portaled model panel must not close the menu. */
function inModelPanel(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-testid="model-dropdown"]') !== null;
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

  const agentItems: MenuItem[] =
    agents.length === 0
      ? []
      : [
          { kind: "agent", id: undefined, name: "pi", meta: i18nT("acp.metaPi", undefined, "Default · flows, subagents, extensions") },
          ...agents.map((a): MenuItem => ({ kind: "agent", id: a.id, name: a.name, meta: i18nT("acp.metaAcp", undefined, "ACP agent") })),
        ];
  const items: MenuItem[] = [...agentItems, { kind: "choice" }];
  const checkedIndex = Math.max(0, agentItems.findIndex((i) => i.kind === "agent" && i.id === current));
  const currentName = agentItems[checkedIndex]?.kind === "agent" ? (agentItems[checkedIndex] as { name: string }).name : "pi";

  const focusItem = useCallback((index: number) => {
    const el = itemRefs.current[index];
    if (!el) return;
    if (el.dataset.item === "choice") el.querySelector<HTMLElement>("button")?.focus();
    else el.focus();
  }, []);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    focusItem(agentItems.length > 0 ? checkedIndex : 0);
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node) && !inModelPanel(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
    // biome-ignore lint/correctness/useExhaustiveDependencies: focus once per open / checked change
  }, [open, checkedIndex]);

  const choose = (id: string | undefined) => {
    setCurrent(id);
    rememberAgent(cwd, id);
    close(true);
  };

  const spawn = () => {
    if (current) {
      onSpawn(current);
      return;
    }
    const choice = getEffectiveSpawnChoice(cwd);
    if (choice.model || choice.thinkingLevel) onSpawn(undefined, choice);
    else onSpawn();
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    const focused = itemRefs.current.findIndex((el) => el?.contains(document.activeElement));
    const action = menuKeyAction(e.key, focused, items.length);
    if (!action) return;
    if (action.kind === "focus") {
      e.preventDefault();
      focusItem(action.index);
    } else if (action.kind === "close") {
      if (e.key === "Escape") e.preventDefault();
      close(e.key === "Escape");
    } else {
      const item = items[focused];
      // The chip trigger handles Enter/Space natively (opens its popover).
      if (item?.kind === "agent") {
        e.preventDefault();
        choose(item.id);
      }
    }
  };

  return (
    <div ref={rootRef} className="relative flex w-full" data-testid={`${testId}-split`}>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); spawn(); }}
        disabled={disabled}
        data-testid={testId}
        className={`${className} rounded-r-none border-r-0 min-w-0`}
        title={title}
      >
        <span className="flex min-w-0 items-center justify-center gap-1.5">
          {children}
          {agents.length > 0 && (
            <span className="truncate font-normal" data-testid={`${testId}-agent`}>· {currentName}</span>
          )}
        </span>
      </button>
      <button
        ref={toggleRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={
          agents.length > 0
            ? i18nT("acp.chooseAgent", undefined, "Choose agent for new session")
            : i18nT("spawnChoice.chooseModel", undefined, "Choose model for new session")
        }
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          // APG menu button: ArrowDown/Up open the menu (Enter/Space click natively).
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        disabled={disabled}
        data-testid={`${testId}-chevron`}
        className={`${className} !w-11 sm:!w-8 shrink-0 rounded-l-none !px-0`}
      >
        <Icon path={mdiChevronDown} size={0.7} />
      </button>
      {open && (
        <ul
          role="menu"
          aria-label={i18nT("spawnChoice.newSessionMenu", undefined, "New session options")}
          onKeyDown={onMenuKey}
          data-testid={`${testId}-menu`}
          className="absolute left-0 top-full z-30 mt-1 max-w-[calc(100vw-2rem)] min-w-[14rem] rounded-xl border border-[var(--border-secondary)] bg-[var(--bg-secondary)] p-1 shadow-lg"
        >
          {items.map((item, i) =>
            item.kind === "agent" ? (
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
            ) : (
              <li
                key="model-choice"
                ref={(el) => { itemRefs.current[i] = el; }}
                role="menuitem"
                aria-label={i18nT("spawnChoice.modelThinking", undefined, "Model · thinking")}
                data-item="choice"
                onClick={(e) => e.stopPropagation()}
                className={`flex flex-col gap-1 rounded-lg px-2 py-1.5 ${agentItems.length > 0 ? "mt-1 border-t border-[var(--border-secondary)] pt-2" : ""}`}
              >
                <span className="text-[11px] text-[var(--text-secondary)]">
                  {i18nT("spawnChoice.modelThinking", undefined, "Model · thinking")}
                </span>
                <SpawnChoiceChip cwd={cwd} disabled={current !== undefined} testId={`${testId}-model-choice`} />
              </li>
            ),
          )}
        </ul>
      )}
    </div>
  );
}
