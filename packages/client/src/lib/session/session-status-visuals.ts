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

import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";
import {
  mdiApplicationOutline,
  mdiCircle,
  mdiCircleHalfFull,
  mdiCircleOutline,
  mdiCloseCircle,
  mdiCodeTags,
  mdiConsoleLine,
  mdiInformationOutline,
  mdiRobotOutline,
} from "@mdi/js";
import { t } from "../i18n/i18n.js";

export const statusColors: Record<string, string> = {
  active: "bg-[var(--status-idle)]",
  streaming: "bg-[var(--status-working)] animate-pulse",
  idle: "bg-[var(--status-idle)]",
  ended: "bg-[var(--bg-surface)]",
};

/**
 * True when the session is blocked on the chat-routed `ask_user` tool — i.e.
 * `currentTool === "ask_user"` and the pending prompt is NOT owned by a
 * widget-bar slot. Drives the dedicated `--status-needs-you` color. Mirrors
 * the suppression rule in `getCardPulseClass`.
 * See change: improve-dashboard-attention-routing.
 */
export function isChatRoutedAskUser(
  session: DashboardSession,
  hasWidgetBarPrompt = false,
): boolean {
  // Ended sessions never "need you" even if currentTool lingers as ask_user.
  return (
    session.status !== "ended" &&
    session.currentTool === "ask_user" &&
    !hasWidgetBarPrompt
  );
}

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
  dashboard: t("common.headless", undefined, "Headless"),
  tmux: "tmux",
  zed: "Zed",
  terminal: t("common.terminal", undefined, "Terminal"),
};

/**
 * Status-only dot color. Callers without chat-panel error/retry signals
 * (e.g. folder section) use this. Mirrors the `statusColors` palette with an
 * explicit fallback for unknown status.
 */
export function deriveDotColor(session: DashboardSession): string {
  if (session.resuming) return "bg-[var(--status-working)] animate-pulse";
  return statusColors[session.status] ?? "bg-[var(--bg-surface)]";
}

/**
 * Full dot-color derivation as used by `SessionCard`. `hasError` and
 * `isRetrying` come from the chat panel; folder pills do NOT have these.
 */
export function deriveDotColorWithFlags(
  session: DashboardSession,
  flags: { hasError?: boolean; isRetrying?: boolean; hasWidgetBarPrompt?: boolean; hasNotice?: boolean },
): string {
  // Precedence (highest → lowest): error > ask_user (chat-routed) >
  // resuming/retry > notice (only-reasoning) > streaming/active/idle > ended.
  // See change: improve-dashboard-attention-routing.
  if (flags.hasError) return "bg-[var(--status-error)]";
  if (isChatRoutedAskUser(session, flags.hasWidgetBarPrompt)) return "bg-[var(--status-needs-you)]";
  if (session.resuming) return "bg-[var(--status-working)] animate-pulse";
  if (flags.isRetrying) return "bg-[var(--status-working)] animate-pulse";
  // Non-error notice: distinct info color, never the error red.
  // See change: fix-gemini-subagent-silent-tool-schema-failure.
  if (flags.hasNotice) return "bg-[var(--status-notice)]";
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
  // Convert the LEADING `bg-` → `text-`, including arbitrary `bg-[var(...)]`
  // tokens. Anchored to the start so a `bg-` substring inside a token name
  // (e.g. `--bg-surface`) is not rewritten. The ended muted case is handled by
  // the early return above.
  return dotColor.replace(/^bg-/, "text-");
}

/**
 * Non-hue status channel: a shape per state so the card is distinguishable
 * without relying on color (WCAG 2.2 §1.4.1) and survives reduced-motion.
 * Precedence mirrors `deriveDotColorWithFlags`.
 *   needs-you = filled ● · working = half ◐ · idle = ring ○ · error = ✕
 * See change: improve-dashboard-attention-routing.
 */
export type StatusShape = "needs-you" | "working" | "idle" | "error" | "notice" | "ended";

export function deriveStatusShape(
  session: DashboardSession,
  flags: { hasError?: boolean; isRetrying?: boolean; hasWidgetBarPrompt?: boolean; hasNotice?: boolean } = {},
): StatusShape {
  if (flags.hasError) return "error";
  if (isChatRoutedAskUser(session, flags.hasWidgetBarPrompt)) return "needs-you";
  if (session.resuming || flags.isRetrying || session.status === "streaming") return "working";
  // Non-error notice: only-reasoning terminal (session is idle when set).
  // See change: fix-gemini-subagent-silent-tool-schema-failure.
  if (flags.hasNotice) return "notice";
  if (session.status === "active" || session.status === "idle") return "idle";
  return "ended";
}

/** mdi path per shape. `ended` has no shape marker (returns null). */
export const statusShapeIcon: Record<StatusShape, string | null> = {
  "needs-you": mdiCircle,
  working: mdiCircleHalfFull,
  idle: mdiCircleOutline,
  error: mdiCloseCircle,
  notice: mdiInformationOutline,
  ended: null,
};

/**
 * Count chat-routed `ask_user` (blocked-on-you) sessions in a folder. Excludes
 * sessions whose pending prompt is widget-bar-placed (per `isWidgetBar`).
 * Pure helper so the rollup count is unit-testable without the plugin hook.
 * See change: improve-dashboard-attention-routing.
 */
export function countNeedsYou(
  sessions: DashboardSession[],
  isWidgetBar: (sessionId: string) => boolean = () => false,
): number {
  let n = 0;
  for (const s of sessions) {
    if (isChatRoutedAskUser(s, isWidgetBar(s.id))) n++;
  }
  return n;
}

/**
 * Collapsed-folder status rollup: count the folder's non-ended sessions by the
 * two ambient states (`working`, `idle`). The `needs-you` state is deliberately
 * excluded — it is surfaced separately by the clickable `FolderNeedsYouPill`
 * (which owns the widget-bar probe). `ended` sessions are excluded too. Pure so
 * the rollup is unit-testable without rendering.
 * See change: condense-collapsed-folder-header.
 */
export function countStatusRollup(
  sessions: DashboardSession[],
): { working: number; idle: number } {
  let working = 0;
  let idle = 0;
  for (const s of sessions) {
    const shape = deriveStatusShape(s);
    if (shape === "working") working++;
    else if (shape === "idle") idle++;
  }
  return { working, idle };
}

/**
 * Opt-in urgency sort: float `ask_user` (blocked-on-you) sessions to the top
 * of a folder's active list. Stable — relative order within the blocked group
 * and within the rest group is preserved. Pure + unit-testable.
 * See change: improve-dashboard-attention-routing.
 */
export function floatAskUserFirst(
  sessions: DashboardSession[],
  isWidgetBar: (sessionId: string) => boolean = () => false,
): DashboardSession[] {
  const blocked: DashboardSession[] = [];
  const rest: DashboardSession[] = [];
  for (const s of sessions) {
    if (isChatRoutedAskUser(s, isWidgetBar(s.id))) blocked.push(s);
    else rest.push(s);
  }
  return blocked.length === 0 ? sessions : [...blocked, ...rest];
}

/** Session ids of chat-routed `ask_user` sessions (rollup target order). */
export function needsYouSessionIds(
  sessions: DashboardSession[],
  isWidgetBar: (sessionId: string) => boolean = () => false,
): string[] {
  return sessions.filter((s) => isChatRoutedAskUser(s, isWidgetBar(s.id))).map((s) => s.id);
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
  flags: { hasError?: boolean; isRetrying?: boolean; hasWidgetBarPrompt?: boolean; hasNotice?: boolean },
  isSelected: boolean,
): string {
  // Slim, low-alpha vertical line. `/25` for unselected and `/50` for
  // selected keeps the colour a tint, not a block. Class strings are
  // written as literals so Tailwind's JIT picks them up.
  // See change: add-session-card-status-mosaic-rail.
  // Precedence (highest → lowest): error > ask_user (chat-routed) >
  // resuming/retry > streaming > active/idle > ended/unknown. Token tints use
  // `color-mix` (40% unselected, 65% selected) written as literal class strings
  // so Tailwind's JIT scans them.
  // See change: improve-dashboard-attention-routing.
  if (flags.hasError) {
    return isSelected
      ? "bg-[color-mix(in_srgb,var(--status-error)_65%,transparent)]"
      : "bg-[color-mix(in_srgb,var(--status-error)_40%,transparent)]";
  }
  if (isChatRoutedAskUser(session, flags.hasWidgetBarPrompt)) {
    return isSelected
      ? "bg-[color-mix(in_srgb,var(--status-needs-you)_65%,transparent)]"
      : "bg-[color-mix(in_srgb,var(--status-needs-you)_40%,transparent)]";
  }
  if (session.resuming || flags.isRetrying || session.status === "streaming") {
    return isSelected
      ? "bg-[color-mix(in_srgb,var(--status-working)_65%,transparent)]"
      : "bg-[color-mix(in_srgb,var(--status-working)_40%,transparent)]";
  }
  // Non-error notice rail tint. See change:
  // fix-gemini-subagent-silent-tool-schema-failure.
  if (flags.hasNotice) {
    return isSelected
      ? "bg-[color-mix(in_srgb,var(--status-notice)_65%,transparent)]"
      : "bg-[color-mix(in_srgb,var(--status-notice)_40%,transparent)]";
  }
  if (session.status === "active" || session.status === "idle") {
    return isSelected
      ? "bg-[color-mix(in_srgb,var(--status-idle)_65%,transparent)]"
      : "bg-[color-mix(in_srgb,var(--status-idle)_40%,transparent)]";
  }
  // Ended / unknown status: muted surface (no shade swap on selection).
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
