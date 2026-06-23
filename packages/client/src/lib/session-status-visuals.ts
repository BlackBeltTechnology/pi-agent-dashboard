/**
 * Shared session-status visual primitives used by `SessionCard` (left-gutter
 * dot/source-icon) and `FolderOpenSpecSection` linked-session rows.
 *
 * Single source of truth for:
 *   - status → bg-color palette
 *   - source → mdi icon + label
 *   - dotColor derivation (with optional chat-panel error/retry flags)
 *   - dotColor → text-color mirror used when the source icon doubles as the
 *     status indicator
 *   - icon-only pulse rule (folder pills do not get card-level pulse stripes)
 *
 * See change: add-session-status-to-folder-proposal-rows
 */

import { mdiConsoleLine, mdiRobotOutline, mdiApplicationOutline, mdiCodeTags } from "@mdi/js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

export const statusColors: Record<string, string> = {
  active: "bg-green-500",
  streaming: "bg-yellow-500 animate-pulse",
  idle: "bg-green-500",
  ended: "bg-[var(--bg-surface)]",
};

export const sourceBadgeColors: Record<string, string> = {
  tui: "text-blue-400",
  zed: "text-purple-400",
  tmux: "text-orange-400",
  dashboard: "text-blue-400",
  terminal: "text-cyan-400",
  unknown: "text-[var(--text-tertiary)]",
};

export const sourceIcons: Record<string, string> = {
  tui: mdiConsoleLine,
  dashboard: mdiRobotOutline,
  tmux: mdiApplicationOutline,
  zed: mdiCodeTags,
  terminal: mdiConsoleLine,
};

export const sourceLabels: Record<string, string> = {
  tui: "TUI",
  dashboard: "Headless",
  tmux: "tmux",
  zed: "Zed",
  terminal: "Terminal",
};

/**
 * Status-only dot color. Callers without chat-panel error/retry signals
 * (e.g. folder section) use this. Mirrors the `statusColors` palette with an
 * explicit fallback for unknown status.
 */
export function deriveDotColor(session: DashboardSession): string {
  if (session.resuming) return "bg-yellow-500 animate-pulse";
  return statusColors[session.status] ?? "bg-[var(--bg-surface)]";
}

/**
 * Full dot-color derivation as used by `SessionCard`. `hasError` and
 * `isRetrying` come from the chat panel; folder pills do NOT have these.
 */
export function deriveDotColorWithFlags(
  session: DashboardSession,
  flags: { hasError?: boolean; isRetrying?: boolean },
): string {
  if (session.resuming) return "bg-yellow-500 animate-pulse";
  if (flags.hasError) return "bg-red-500";
  if (flags.isRetrying) return "bg-amber-500 animate-pulse";
  return statusColors[session.status] ?? "bg-[var(--bg-surface)]";
}

/**
 * Mirror the bg-color into a text-color for use when the source icon doubles
 * as the status indicator. Ended sessions get a muted token — BUT only when
 * the dotColor was actually the ended palette (`bg-[var(--bg-surface)]`).
 * If resuming / hasError / isRetrying overrode the dotColor (yellow / red /
 * amber), honor the override so the icon matches the dot. Also defends
 * against arbitrary `bg-[var(...)]` tokens by only replacing leading
 * `bg-<palette>` forms.
 */
export function deriveIconStatusColor(
  dotColor: string,
  status: DashboardSession["status"],
): string {
  if (status === "ended" && dotColor.startsWith("bg-[var(--bg-surface)]")) {
    return "text-[var(--text-muted)]";
  }
  return dotColor.replace(/\bbg-(?!\[)/g, "text-");
}

/**
 * Icon-only pulse rule. Folder pills attach this directly to the icon's
 * className — they do NOT get card-level pulse stripes.
 */
export function pulseClassForStatus(session: DashboardSession): string {
  if (session.resuming) return "animate-pulse";
  if (session.status === "streaming") return "animate-pulse";
  return "";
}

/**
 * Status-tinted background color for the session card's left-gutter mosaic
 * rail. The rail is a decorative SVG mask carved over a flat coloured
 * background — this helper supplies the colour. Precedence mirrors
 * `deriveDotColorWithFlags` so dot, source-icon tint, and rail always agree.
 *
 * `isSelected === true` (and status !== ended) bumps the palette to the
 * brighter `-400` shade. The `ended` palette is muted and does NOT swap on
 * selection — selected ended cards already carry the blue card-level
 * highlight, and a brighter rail would compete with it.
 *
 * See change: add-session-card-status-mosaic-rail.
 */
export function deriveRailBgColor(
  session: DashboardSession,
  flags: { hasError?: boolean; isRetrying?: boolean },
  isSelected: boolean,
): string {
  // Slim, low-alpha vertical line. `/25` for unselected and `/50` for
  // selected keeps the colour a tint, not a block. Class strings are
  // written as literals so Tailwind's JIT picks them up.
  // See change: add-session-card-status-mosaic-rail.
  if (session.status === "ended") return "bg-[var(--bg-surface)]";
  if (session.resuming) return isSelected ? "bg-amber-400/65" : "bg-amber-500/40";
  if (flags.hasError) return isSelected ? "bg-red-400/65" : "bg-red-500/40";
  if (flags.isRetrying) return isSelected ? "bg-amber-400/65" : "bg-amber-500/40";
  if (session.status === "streaming") return isSelected ? "bg-amber-400/65" : "bg-amber-500/40";
  if (session.status === "active" || session.status === "idle") {
    return isSelected ? "bg-green-400/65" : "bg-green-500/40";
  }
  // Unknown status: fall back to muted.
  return "bg-[var(--bg-surface)]";
}

/**
 * Card-level state marker. Drives the `.card-stripes-fx` overlay color on the
 * sidebar `SessionCard` and the OpenSpec board's `BoardSessionRow`.
 *
 * @param hasWidgetBarPrompt true when the session has a pending PromptBus
 *   request whose component type is registered with `placement: "widget-bar"`.
 *   In that case the purple `card-input-stripes` class is suppressed — a
 *   widget-bar slot owns the prompt's render, not the chat.
 *   See change: fix-flows-plugin-polish (B1).
 */
export function getCardPulseClass(session: DashboardSession, hasWidgetBarPrompt = false): string {
  if (session.currentTool === "ask_user" && !hasWidgetBarPrompt) return "card-input-stripes";
  if (session.status === "streaming" || session.resuming) return "card-working-pulse";
  // Unread state — cyan scrolling stripes. Lower priority than the two above
  // so streaming/ask_user keep their stronger colors.
  // See change: session-card-unread-stripes.
  if (session.unread) return "card-unread-pulse";
  return "";
}

/**
 * Map the card's state marker class to the color class for its
 * `.card-stripes-fx` overlay, which paints the compositor-only scrolling
 * stripes behind card content.
 * See change: throttle-idle-ui-animations.
 */
const STRIPE_FX_CLASS: Record<string, string> = {
  "card-working-pulse": "card-stripes-running",
  "card-unread-pulse": "card-stripes-unread",
  "card-input-stripes": "card-stripes-input",
};
export function getCardStripeFxClass(pulseClass: string): string {
  return STRIPE_FX_CLASS[pulseClass] ?? "";
}

/**
 * Aggregate stripe class for a proposal card from its child sessions. Returns
 * the single most-urgent `card-stripes-*` class via precedence:
 *   any ask_user → card-stripes-input (purple, highest)
 *   else any streaming/resuming → card-stripes-running (yellow)
 *   else any unread → card-stripes-unread (cyan)
 *   else "" (no overlay — completion signalled elsewhere)
 * See change: port-session-card-state-visuals-to-openspec-board.
 */
export function deriveProposalCardState(sessions: DashboardSession[]): string {
  let hasRunning = false;
  let hasUnread = false;
  for (const s of sessions) {
    if (s.currentTool === "ask_user") return "card-stripes-input";
    if (s.status === "streaming" || s.resuming) hasRunning = true;
    else if (s.unread) hasUnread = true;
  }
  if (hasRunning) return "card-stripes-running";
  if (hasUnread) return "card-stripes-unread";
  return "";
}
