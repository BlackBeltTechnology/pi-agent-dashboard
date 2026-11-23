import { mdiHelpCircleOutline, mdiLock } from "@mdi/js";
import type React from "react";
import { useRef, useState } from "react";
import { useLocation } from "wouter";
import { type ResolveMentionOptions, type ResolveMentionResult, resolveFileMention } from "../../lib/api/resolve-mention-api.js";
import type { LinkEntry } from "../../lib/chat/link-resolution-store.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { buildEditorUrl } from "../../lib/nav/route-builders.js";
import { fileIcon } from "../../lib/preview/file-icon.js";
import { resolveLinkOrigin } from "../../lib/util/link-origin.js";
import { normalizeUnderCwd } from "../../lib/util/normalize-path.js";
import { useLinkResolution } from "../chat/LinkResolutionProvider.js";
import { FilePreviewOverlay } from "../preview/FilePreviewOverlay.js";
import { useOptionalSplitWorkspace } from "../split/SplitWorkspaceContext.js";
import { HtmlModeMenu, type HtmlOpenMode } from "./HtmlModeMenu.js";
import { LinkIconSlot } from "./LinkIconSlot.js";
import { MentionPicker } from "./MentionPicker.js";
import type { ToolContext } from "./types.js";
import { useFileOpenRouting } from "./useFileOpenRouting.js";

interface Props {
  path: string;
  line?: number;
  col?: number;
  /** Token marked absolute (POSIX `/`, decoded `file://`, Windows drive). */
  absolute?: boolean;
  context: ToolContext;
  children: React.ReactNode;
}

/**
 * Clickable file reference rendered inside tool output and prose. Opens the
 * editor pane for the link's session; with no live split it deep-links to the
 * session editor route, and only with no `sessionId` falls back to the inline
 * read-only preview overlay (via the shared {@link useFileOpenRouting} hook).
 *
 * Resolution is LAZY: the link renders synchronously; on click the client asks
 * the server to resolve the mention against the real filesystem
 * ({@link resolveFileMention}) and opens the server-resolved path.
 *
 * Worktree sessions (D4): an absolute link rooted in the parent checkout is
 * first probed at its re-rooted worktree candidate ({@link resolveLinkOrigin});
 * a non-null probe is the open target, `null` falls back to the ORIGINAL path
 * (opened as the parent-checkout file), and a failed probe request takes the
 * offline fallback (never read as "copy absent"). Otherwise the server-resolved
 * path is opened as-is — no client re-root on top of it.
 *
 * Open target: `normalizeUnderCwd(resolved, cwd)` — a cwd-relative tab for an
 * in-cwd file, an absolute-path tab for anything else (incl. `outside: true`,
 * which was never statted: the pane's read gate shows the grant prompt / load
 * error, so such a link is NOT marked not-found).
 *
 * Outcomes:
 *  - resolved (or `outside`) → open the pane / deep link / overlay as above.
 *  - null      → inline not-found affordance (strikethrough/disabled), NO open (G1).
 *  - request FAILS (network/5xx) → fall back to today's client-side open (D5) —
 *    a failure is NOT treated as absent.
 *
 * {@link resolveLinkOrigin} also feeds the render-time tooltip and the D5
 * fallback open target.
 *
 * Transcript links (inside a `LinkResolutionProvider`, rich-chat-links D1): the SAME button and text, plus a
 * fixed 1em icon slot (file-type glyph, `aria-hidden`, no text) and a pre-confirmed state — `data-link-state`,
 * colour/decoration, tooltip and the slot glyph — applied after first paint without touching box metrics.
 * A click ALWAYS resolves anew (`recover: true` + the producing tool's `toolCwd`); the cached state is a hint
 * only. A mention with several candidates opens a {@link MentionPicker}. Without the provider none of this runs.
 *
 * See change: unify-file-link-openability, fix-worktree-link-origin,
 * server-side-file-mention-resolution, fix-file-link-editor-routing, rich-chat-links.
 */
/**
 * D4: resolve `path`, probing the re-rooted worktree `candidate` first when it differs. A non-null, contained
 * probe wins; `null` falls through to the original path. A rejected request propagates (offline fallback).
 */
async function resolveWithWorktreeProbe(
  cwd: string,
  path: string,
  candidate: string,
  opts?: ResolveMentionOptions,
): Promise<ResolveMentionResult> {
  if (candidate !== path) {
    const probe = await resolveFileMention(cwd, candidate, opts);
    if (probe.resolved !== null && !probe.outside) return probe;
  }
  return resolveFileMention(cwd, path, opts);
}

type LinkState = LinkEntry["state"] | "unknown";

const HTML_FILE = /\.html?$/i;

type SplitApi = NonNullable<ReturnType<typeof useOptionalSplitWorkspace>>;

/** Open in the split by mode: Source → the read-only `source:` tab, Static → the toggle seeded at Static, else a plain open. */
function openInPane(ws: SplitApi, target: string, line: number | undefined, mode?: HtmlOpenMode, resolved = target): void {
  if (mode === "source") ws.openSourceTab(resolved);
  else if (mode === "static") ws.openInSplit(target, line, undefined, { htmlMode: "static" });
  else ws.openInSplit(target, line);
}

/** The re-rooted worktree candidate of an absolute link, when it differs from the typed path. */
const reRootedOrigin = (absolute: boolean | undefined, origin: string, path: string): string | undefined =>
  absolute && origin !== path ? origin : undefined;

/** The HTML open-mode menu shows for `.html` / `.htm` links of the same-session transcript only (design D10). */
const showsHtmlMenu = (transcript: boolean, splitLive: boolean, path: string): boolean => transcript && splitLive && HTML_FILE.test(path);

/** The offline fallback may open in the pane: a relative link always, an absolute one only for an explicit mode. */
const fallsBackToPane = (absolute: boolean | undefined, mode?: HtmlOpenMode): boolean => !absolute || mode !== undefined;

/** Slot glyph + tone: lock = gated, question mark = ambiguous, else the editor pane's file-type icon. */
function linkGlyph(path: string, state: LinkState): { glyph: string; tone: string } {
  if (state === "gated") return { glyph: mdiLock, tone: "text-[var(--text-muted)]" };
  if (state === "ambiguous") return { glyph: mdiHelpCircleOutline, tone: "text-[var(--text-muted)]" };
  const icon = fileIcon(path);
  return { glyph: icon.iconPath, tone: icon.colorClass };
}

/** Tooltip: names the file a click opens — the real path for a tool-dir / fuzzy hit (D4/D6), else the link's own. */
function linkTitle(a: {
  linkState: LinkState;
  notFound: boolean;
  entry: { resolved?: string } | undefined;
  cwd: string | undefined;
  resolved: string;
  titleSuffix: string;
}): string {
  const { linkState, entry, resolved, titleSuffix } = a;
  if (a.notFound || linkState === "missing") return `Not found: ${resolved}${titleSuffix}`;
  const real = entry?.resolved && (linkState === "found" || linkState === "recovered") ? normalizeUnderCwd(entry.resolved, a.cwd) : resolved;
  if (linkState === "recovered") return i18nT("chat.link.recovered", { path: `${real}${titleSuffix}` }, "Resolved to {path}");
  if (linkState === "ambiguous") return i18nT("chat.link.ambiguous", undefined, "Several files match: click to choose");
  if (linkState === "gated") return i18nT("chat.link.gated", { path: `${resolved}${titleSuffix}` }, "Outside the session folders: {path}");
  return `Preview ${real}${titleSuffix}`;
}

function linkClass(dead: boolean, notFound: boolean, recovered: boolean): string {
  const base = "bg-transparent border-0 p-0 m-0 font-inherit";
  if (dead) return `${base} text-[var(--link)]/60 line-through ${notFound ? "cursor-not-allowed" : "cursor-pointer"}`;
  return `${base} text-[var(--link)] hover:underline cursor-pointer${recovered ? " underline decoration-dotted underline-offset-2" : ""}`;
}

export function FileLink({ path, line, col, absolute, context, children }: Props) {
  const { cwd, openFile, hostManaged, previewTarget, closePreview } =
    useFileOpenRouting(context);
  const [notFound, setNotFound] = useState(false);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const [, navigate] = useLocation();
  const btnRef = useRef<HTMLButtonElement>(null);

  // Render-time client re-rooting: tooltip target + the D5 offline-fallback
  // open target ONLY. The authoritative open target is the server-resolved
  // path (see handleClick); this is never layered on top of it (D4).
  const origin = resolveLinkOrigin(cwd, path, absolute);
  const openTarget = absolute ? origin : path;

  // Transcript only: pre-confirmed state (`active` is false without a LinkResolutionProvider).
  const { active, entry } = useLinkResolution({
    sessionId: context.sessionId,
    cwd,
    mention: path,
    toolCwd: context.toolCwd,
    reRooted: reRootedOrigin(absolute, origin, path),
    settled: context.linkSettled !== false,
    ref: btnRef,
  });
  const linkState = entry?.state ?? "unknown";
  const resolveOpts: ResolveMentionOptions | undefined = active ? { recover: true, toolCwd: context.toolCwd } : undefined;

  // The editor pane is live for this session (relative AND absolute links open in it).
  const ws = useOptionalSplitWorkspace();
  const sessionId = context.sessionId;
  const splitLive = !!ws && !!sessionId && ws.sessionId === sessionId;

  // HTML open-mode menu: same-session transcript links to .html / .htm only (design D10).
  const htmlMenu = showsHtmlMenu(active, splitLive, path);

  // D5 offline fallback: today's client-side open (cwd-relative split tab or preview).
  const openViaFallback = (mode?: HtmlOpenMode) => {
    if (splitLive && ws && fallsBackToPane(absolute, mode)) {
      openInPane(ws, openTarget, line, mode); // openTarget === path for a relative link
      return;
    }
    void openFile(openTarget, line);
  };

  // Open the server-resolved (or user-picked) absolute path: cwd-relative tab in-cwd, absolute tab otherwise.
  const openResolved = (resolved: string, mode?: HtmlOpenMode) => {
    if (!cwd) return;
    const target = normalizeUnderCwd(resolved, cwd);
    if (splitLive && ws) {
      openInPane(ws, target, line, mode, resolved);
    } else if (sessionId) {
      navigate(buildEditorUrl(sessionId, target, line)); // no live split: deep-link the pane route
    } else {
      void openFile(resolved, line); // no session context: preview overlay
    }
  };

  const closePicker = () => {
    setCandidates(null);
    btnRef.current?.focus();
  };

  const openLink = async (mode?: HtmlOpenMode) => {
    if (notFound && !active) return; // already resolved to absent (transcript links always ask again: the file may exist now)
    // No cwd → nothing to resolve against; keep the legacy client-side open.
    if (!cwd) {
      openViaFallback(mode);
      return;
    }
    try {
      // Send the token's processed `path` (normalized: `file://` + diff prefix
      // already stripped), not the verbatim label text (D1).
      const result = await resolveWithWorktreeProbe(cwd, path, absolute ? origin : path, resolveOpts);
      if (result.resolved === null) {
        if (result.state === "ambiguous" && result.candidates?.length) {
          setNotFound(false);
          setCandidates(result.candidates); // several matches: the user picks, nothing opens yet
          return;
        }
        setNotFound(true); // G1: inline not-found, make NO open call
        return;
      }
      setNotFound(false);
      openResolved(result.resolved, mode);
    } catch {
      // D5: a transport failure (NOT a null result) → client-side fallback.
      openViaFallback(mode);
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    return openLink();
  };



  const resolved = origin;
  const titleSuffix = line ? `:${line}${col ? `:${col}` : ""}` : "";
  const dead = notFound || linkState === "missing";
  const { glyph, tone } = linkGlyph(path, linkState);

  return (
    <>
    <button
      ref={btnRef}
      type="button"
      onClick={handleClick}
      title={linkTitle({ linkState, notFound, entry, cwd, resolved, titleSuffix })}
      aria-disabled={notFound}
      data-not-found={notFound ? "true" : undefined}
      data-link-state={active ? linkState : undefined}
      // Not draggable + user-select:text so a click-drag that starts on or
      // crosses the link extends the text selection (a <button> otherwise
      // swallows the drag and excludes its label from the selection). A
      // plain click still opens; native click-vs-drag suppression handles it.
      draggable={false}
      // Inline-only styling, no padding/margin so native text selection
      // across the link boundary is preserved (D8). Once resolved-absent the
      // link is struck through + dimmed and no longer opens (G1).
      // A pre-confirmed `missing` strikes through but stays clickable: a click re-resolves (D1).
      // `--link` is mode-aware; the raw `blue-400` it replaces failed the 3:1
      // floor on `--bg-code` in every light theme.
      // See change: repair-tool-error-surfaces (test-plan #F8).
      className={linkClass(dead, notFound, linkState === "recovered")}
      style={{ font: "inherit", userSelect: "text" }}
    >
      {active && <LinkIconSlot glyph={glyph} tone={tone} />}
      {children}
    </button>
    {htmlMenu && <HtmlModeMenu path={path} onPick={(mode) => void openLink(mode)} />}
    {candidates && cwd && <MentionPicker mention={path} candidates={candidates} cwd={cwd} onPick={(p) => { setCandidates(null); openResolved(p); }} onClose={closePicker} />}
    {!hostManaged && previewTarget && (
      <FilePreviewOverlay
        cwd={previewTarget.cwd}
        path={previewTarget.path}
        line={previewTarget.line}
        onClose={closePreview}
      />
    )}
    </>
  );
}
