import { MERMAID_SVG_PROFILE } from "@blackbelt-technology/pi-dashboard-shared/sanitize-profiles.js";
import {
  mdiAlertCircleOutline,
  mdiAutoFix,
  mdiContentCopy,
  mdiCreationOutline,
  mdiLoading,
  mdiRefresh,
} from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useZoomPan } from "../../hooks/useZoomPan.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { trustedMermaidParse, trustedSanitizedHtml } from "../../lib/security/trusted-types.js";
import type { RuleId } from "../../lib/preview/mermaid-repair.js";
import { useMermaidRepairClientConfig } from "../../lib/preview/mermaid-repair-config.js";
import { useMermaidSourceContext } from "../../lib/preview/mermaid-source-context.js";
import { copyText } from "../../lib/util/clipboard.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
import { MermaidApplyFix } from "./MermaidApplyFix.js";
import { mermaidConfig } from "./mermaid-config.js";
import { computeFitScale, VIEWPORT_HEIGHT_CSS } from "./mermaid-fit.js";
import { ZoomControls } from "./ZoomControls.js";

let mermaidIdCounter = 0;

// ── Module-level outcome cache ──────────────────────────────────────────────
// Survives component unmount/remount so re-mounted MermaidBlocks display the
// final outcome instantly — no "Loading diagram…" flash, no re-render and no
// re-repair. Failed renders are deterministic for a given (code, theme), so
// errors are cached too. Keyed on the ORIGINAL code. Cleared globally when
// mermaid is re-initialized for another theme.
// See change: add-mermaid-auto-repair (design D3).
export type MermaidOutcome =
  | { kind: "ok"; svg: string }
  /** Rendered from repaired source: `code` is the source as rendered, `error` the original render error. */
  | { kind: "repaired"; svg: string; code: string; applied: RuleId[]; error: string }
  | { kind: "error"; message: string };

export const _outcomeCache = new Map<string, MermaidOutcome>();

// Page-lifetime cache of SUCCESSFUL AI repairs, keyed `code \0 configuredModel`.
// Holds theme-independent source only (the render goes through _outcomeCache);
// failures are never cached. See change: add-mermaid-ai-repair (design D6).
export const _aiFixCache = new Map<string, { fixedCode: string; model: string }>();

// Cache identity is the composite theme id (`<themeName>:<resolved>`), not just
// light/dark: accent palettes differ per named theme, so colorized output must
// cache separately for e.g. dracula-dark vs nord-dark even though both resolve
// to "dark". See change: colorize-mermaid-default-nodes.
function cacheKey(code: string, themeId: string): string {
  return `${code}\0${themeId}`;
}

// ── Mermaid code sanitisation ───────────────────────────────────────────────
// LLMs often produce mermaid code with minor issues that cause parse errors.
// We fix the most common problems before handing the code to mermaid.render().

function sanitizeMermaidCode(raw: string): string {
  let code = raw.trim();

  // Decode HTML entities — react-markdown/rehype may encode special chars
  // inside code blocks (e.g. --> becomes --&gt;)
  code = code
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Remove common leading indentation (dedent) — mermaid is whitespace-sensitive
  const lines = code.split("\n");
  const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
  if (nonEmptyLines.length > 1) {
    // Skip the first line (diagram type declaration) when computing indent
    const bodyLines = nonEmptyLines.slice(1);
    const minIndent = bodyLines.reduce((min, line) => {
      const match = line.match(/^(\s+)/);
      return match ? Math.min(min, match[1].length) : min;
    }, Infinity);
    if (minIndent > 0 && minIndent < Infinity) {
      code = lines
        .map((line, i) => (i === 0 ? line : line.slice(Math.min(minIndent, line.search(/\S|$/)))))
        .join("\n");
    }
  }

  return code;
}

// ── SVG sanitisation ────────────────────────────────────────────────────────
// Mermaid source is untrusted (agent / file content) and the SVG is injected
// via dangerouslySetInnerHTML, so the SVG is sanitized with DOMPurify as the
// LAST step of `renderOnce` (after colorize, so no later mutation can
// reintroduce active content). `HTML_INTEGRATION_POINTS` keeps the HTML inside
// <foreignObject> labels (`<br>` line breaks); without it DOMPurify strips it.
// Fails closed: an unsupported DOMPurify (no DOM → returns input unchanged)
// throws, which routes through the normal render-failure / repair path.
// See change: sanitize-untrusted-rendered-content.

export async function sanitizeMermaidSvg(svg: string): Promise<string> {
  const DOMPurify = (await import("dompurify")).default;
  if (DOMPurify.isSupported !== true) throw new Error("sanitizer unavailable: DOMPurify has no DOM support");
  // Config shared with the `pi-sanitized-html` policy (`mermaid` profile). See change: harden-client-sinks.
  return DOMPurify.sanitize(svg, MERMAID_SVG_PROFILE);
}

// ── Default-node colorization ───────────────────────────────────────────────
// Mermaid's stock themes give every un-authored node the same pale fill. We
// tint each default node with a hue from the active theme's accent palette so
// diagrams read as structured, on-brand color. Author-colored nodes (inline
// style contains `fill:`) are left untouched — explicit color always wins.

const ACCENT_VARS = [
  "--accent-blue",
  "--accent-green",
  "--accent-yellow",
  "--accent-red",
  "--accent-purple",
  "--accent-orange",
] as const;

// TEST-ONLY fallback ramp, used when getComputedStyle returns empty custom
// properties (jsdom). In the browser the vars are always set: `:root` and every
// THEMES palette define the six accents and --text-primary as #hex, which
// `mermaid-accent-guard.test.ts` enforces (and `rgba()` below parses hex only).
// Documented as an exception in ui-contract.md.
// See change: retro-ux-chat-rendering (design D2).
const FALLBACK_ACCENTS = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#a855f7", "#f97316"];

const TINT = 0.08; // soft accent wash over the node background
const BORDER_ALPHA = 0.85; // full-ish accent border carries node identity

function resolveVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return val || fallback;
}

/** Read the 6 accent hexes for the current theme, live via getComputedStyle. */
function resolveAccents(): string[] {
  return ACCENT_VARS.map((v, i) => resolveVar(v, FALLBACK_ACCENTS[i]));
}

/** Deterministic djb2 string hash → stable per-node palette index. */
export function hashId(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

/** Convert #rgb / #rrggbb to an rgba() string at the given alpha. */
export function rgba(hex: string, alpha: number): string {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function setLabelColor(g: Element, color: string): void {
  // Flowchart labels are HTML spans inside <foreignObject>; class-diagram labels
  // are SVG <text>/<tspan>. Set the appropriate color property on each.
  g.querySelectorAll(".nodeLabel").forEach((el) => {
    (el as unknown as { style: CSSStyleDeclaration }).style.color = color;
  });
  g.querySelectorAll("text, tspan").forEach((el) => {
    el.setAttribute("fill", color);
  });
}

/**
 * Post-process a rendered mermaid SVG: tint default (un-authored) flowchart and
 * class-diagram nodes with the accent palette. A node is "authored" when its
 * shape's inline `style` contains `fill:` — those are skipped.
 */
export function colorizeDefaultNodes(svg: string, accents: string[], textColor: string): string {
  if (typeof DOMParser === "undefined" || accents.length === 0) return svg;
  // The parse input is mermaid's own output, wrapped by the wrap-only
  // `pi-mermaid-parse` policy (inert DOMParser document; the final sanitize
  // still runs before injection). See change: harden-client-sinks (D5).
  const parse = (src: string) =>
    new DOMParser().parseFromString(trustedMermaidParse(src) as string, "image/svg+xml").documentElement;
  const malformed = (el: Element | null) => !el || el.nodeName === "parsererror" || el.querySelector("parsererror") !== null;
  let root = parse(svg);
  // mermaid emits HTML void tags inside <foreignObject> labels unclosed
  // (`one<br>two`), which is not well-formed XML: close them and retry once.
  // See change: sanitize-untrusted-rendered-content.
  if (malformed(root)) root = parse(svg.replace(/<(br|hr|wbr)\b([^>]*?)(?<!\/)>/gi, "<$1$2/>"));
  if (malformed(root)) return svg;

  root.querySelectorAll("g.node, g.classGroup").forEach((g) => {
    const shape = g.querySelector("rect.label-container, polygon, circle, path, rect");
    if (!shape) return;
    const style = shape.getAttribute("style") || "";
    if (/fill\s*:/.test(style)) return; // authored → skip

    const hue = accents[hashId(g.id) % accents.length];
    const fill = rgba(hue, TINT);
    const border = rgba(hue, BORDER_ALPHA);
    const prefix = style && !style.trim().endsWith(";") ? `${style};` : style;
    shape.setAttribute("style", `${prefix}fill:${fill};stroke:${border};stroke-width:1.5px`);
    // Class-diagram shapes carry the color as a `fill` attribute too — override
    // it so it doesn't fight the style wash.
    if (shape.hasAttribute("fill")) shape.setAttribute("fill", fill);
    setLabelColor(g, textColor);
  });

  return new XMLSerializer().serializeToString(root);
}

// ── Serialized render queue ─────────────────────────────────────────────────
// Mermaid uses global state and cannot handle concurrent render() calls.
// We serialize all renders through a single promise chain.

let renderQueue: Promise<void> = Promise.resolve();
let lastInitTheme: string | null = null;

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Failed to render diagram";
}

type MermaidApi = typeof import("mermaid").default;

/** One render attempt: render → colorize → sanitize (last), then drop any error node mermaid left in the DOM. */
async function renderOnce(mermaid: MermaidApi, id: string, code: string, resolved: string): Promise<string> {
  try {
    const result = await mermaid.render(id, code);
    // Colorize → sanitize once, before caching, so the cached SVG is the
    // final injected markup (no per-React-render DOMParser cost). Colorize
    // runs first on mermaid's well-formed XML (its `image/svg+xml` re-parse
    // would fail on DOMPurify's HTML serialization); sanitize is last. Accents
    // resolve live for the current theme.
    const colored = colorizeDefaultNodes(
      result.svg,
      resolveAccents(),
      // Test-only fallback literals (see FALLBACK_ACCENTS above).
      resolveVar("--text-primary", resolved === "dark" ? "#e5e7eb" : "#111827"),
    );
    return await sanitizeMermaidSvg(colored);
  } finally {
    document.getElementById(`d${id}`)?.remove();
  }
}

/**
 * Second attempt after the original render failed with `original`: apply
 * rule-based repair and render once more as `<id>-r`. Every failure path
 * (no rule applies, repair throws, retry throws) yields the ORIGINAL error.
 */
async function renderRepaired(
  mermaid: MermaidApi,
  id: string,
  normalized: string,
  resolved: string,
  original: string,
): Promise<MermaidOutcome> {
  try {
    // Lazy: the rule set (~10 KB) is only needed once a render has failed.
    // See change: add-mermaid-ai-repair (entry-chunk size guard).
    const { repairMermaid } = await import("../../lib/preview/mermaid-repair.js");
    const repaired = repairMermaid(normalized);
    if (repaired.applied.length === 0) return { kind: "error", message: original };
    const svg = await renderOnce(mermaid, `${id}-r`, repaired.code, resolved);
    return { kind: "repaired", svg, code: repaired.code, applied: repaired.applied, error: original };
  } catch {
    return { kind: "error", message: original };
  }
}

/**
 * Render the original source; on failure apply rule-based repair and retry
 * once with id `<id>-r`. Both attempts run inside one queued job. Never
 * rejects: failures resolve to an `error` outcome carrying the ORIGINAL
 * attempt's message. See change: add-mermaid-auto-repair (design D1).
 */
async function renderMermaid(id: string, code: string, resolved: string): Promise<MermaidOutcome> {
  return new Promise<MermaidOutcome>((resolve) => {
    renderQueue = renderQueue.then(async () => {
      let mermaid: MermaidApi;
      let normalized: string;
      try {
        mermaid = (await import("mermaid")).default;
        if (lastInitTheme !== resolved) {
          mermaid.initialize(mermaidConfig(resolved));
          _outcomeCache.clear();
          lastInitTheme = resolved;
        }
        normalized = sanitizeMermaidCode(code);
      } catch (err) {
        resolve({ kind: "error", message: errorMessage(err) });
        return;
      }

      try {
        resolve({ kind: "ok", svg: await renderOnce(mermaid, id, normalized, resolved) });
      } catch (err) {
        resolve(await renderRepaired(mermaid, id, normalized, resolved, errorMessage(err)));
      }
    });
  });
}

// ── Component ───────────────────────────────────────────────────────────────

interface Props {
  code: string;
  /**
   * Whether the fenced ```mermaid block is closed in the source. While a
   * diagram is still streaming the closing fence is absent, the `code` prop
   * grows token-by-token, and every growth would otherwise trigger a render
   * attempt against incomplete source — producing parse-error/loading flicker.
   * Defaults to `true` so non-streaming callers render immediately; streaming
   * callers (MarkdownContent) pass `false` until the fence closes so render
   * happens exactly once, when the code checksum is final.
   */
  complete?: boolean;
  /**
   * Index of this diagram among the mermaid blocks of its on-disk file (stamped
   * by `remarkMermaidOrdinal`, or the AsciiDoc segment index; `0` for `.mmd`).
   * With a `MermaidSourceContext` it enables "Apply fix to file" on a repaired
   * diagram. Absent in chat and for raw-HTML blocks. See change: add-preview-apply-fix-to-file.
   */
  ordinal?: number;
}

// ── Zoom control buttons ────────────────────────────────────────────────────


// ── Component ───────────────────────────────────────────────────────────────

const RULE_DESCRIPTIONS: Record<RuleId, string> = {
  R1: "Removed invisible characters or a stray leading \"mermaid\" line",
  R2: "Renamed a participant whose name is a reserved keyword",
  R3: "Balanced unclosed or surplus sequence blocks",
  R4: "Quoted an edge label",
  R5: "Quoted a node label containing special characters",
  R6: "Simplified an ER attribute type",
  R7: "Replaced ; and # inside quoted labels",
};

/** Text button that copies `getText()`; label flips to "Copied" for 1.5 s. */
function CopySourceButton({ getText }: { getText: () => string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const onClick = async () => {
    if (!(await copyText(getText()))) return;
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setCopied(false);
    }, 1500);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="mermaid-copy-source"
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 tap-target text-[12px] text-[var(--text-primary)]"
    >
      <Icon path={mdiContentCopy} size={0.6} aria-hidden="true" />
      {copied
        ? i18nT("preview.mermaid.copied", undefined, "Copied")
        : i18nT("preview.mermaid.copySource", undefined, "Copy source")}
    </button>
  );
}

/**
 * Error-severity callout (headline, original error in mono, optional "Copy
 * source") followed by the raw source. Used for an unrenderable diagram and
 * for the "show original" view of a repaired one.
 * See change: retro-ux-chat-rendering (design D1, spec mermaid-diagram).
 */
function ErrorView({
  code,
  message,
  headline,
  copyable = true,
  actions,
  notes,
}: {
  code: string;
  message: string;
  headline: string;
  copyable?: boolean;
  /** Extra buttons in the callout's action bar (the AI repair control). */
  actions?: React.ReactNode;
  /** Text under the action bar (disclosure line, failure status). */
  notes?: React.ReactNode;
}) {
  return (
    <div className="mb-2" data-testid="mermaid-error">
      <div className="flex gap-2 rounded-md border border-[var(--severity-error-border)] bg-[var(--severity-error-bg)] p-3 text-sm text-[var(--severity-error-fg)]">
        <Icon path={mdiAlertCircleOutline} size={0.8} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <strong className="font-semibold">{headline}</strong>
          <code className="mt-0.5 block whitespace-pre-wrap break-words font-mono text-xs">{message}</code>
          {copyable || actions ? (
            <div className={actions ? "mt-2 flex flex-wrap items-center gap-2" : "mt-2"}>
              {actions}
              {copyable ? <CopySourceButton getText={() => code} /> : null}
            </div>
          ) : null}
          {notes}
        </div>
      </div>
      <pre className="mt-1 bg-[var(--bg-code)] rounded-md p-4 overflow-x-auto text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}

/**
 * Auto-fixed badge row (applied rule codes, show-original toggle, copy-fixed),
 * followed by the original source + original error while toggled on.
 * See change: add-mermaid-auto-repair (D4).
 */
function RepairBadge({
  code,
  outcome,
  showOriginal,
  onToggle,
}: {
  code: string;
  outcome: Extract<MermaidOutcome, { kind: "repaired" }> | null;
  showOriginal: boolean;
  onToggle: () => void;
}) {
  if (!outcome) return null;
  return (
    <>
      <div data-testid="mermaid-repair-badge" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--severity-info-border)] bg-[var(--severity-info-bg)] px-1.5 py-0.5 text-[11px] text-[var(--severity-info-fg)]">
          <Icon path={mdiAutoFix} size={0.5} aria-hidden="true" />
          {i18nT("preview.mermaid.autoFixed", undefined, "Auto-fixed")}
        </span>
        {outcome.applied.map((rule, i) => (
          <React.Fragment key={rule}>
            {i > 0 ? (
              <span aria-hidden="true" className="text-xs text-[var(--text-secondary)]">
                ·
              </span>
            ) : null}
            <span data-testid="mermaid-repair-rule" data-rule={rule} className="text-xs text-[var(--text-secondary)]">
              {i18nT(`preview.mermaid.rule.${rule}`, undefined, RULE_DESCRIPTIONS[rule])}
            </span>
          </React.Fragment>
        ))}
        <button
          type="button"
          aria-pressed={showOriginal}
          onClick={onToggle}
          className="focus-ring rounded-md px-2 tap-target text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline underline-offset-2"
        >
          {i18nT("preview.mermaid.showOriginal", undefined, "Show original")}
        </button>
        <CopyButton
          getText={() => outcome.code}
          icon={<Icon path={mdiContentCopy} size={0.6} aria-hidden="true" />}
          title={i18nT("preview.mermaid.copyFixed", undefined, "Copy fixed source")}
          testId="mermaid-copy-fixed"
        />
      </div>
      {showOriginal && (
        <ErrorView
          code={code}
          message={outcome.error}
          headline={i18nT("preview.mermaid.originalError", undefined, "Original render error")}
          copyable={false}
        />
      )}
    </>
  );
}

type AiState =
  | { kind: "idle" }
  | { kind: "pending" }
  | { kind: "fixed"; fixedCode: string; model: string }
  | { kind: "failed"; reason: string };

/**
 * "Fix with AI" control inside the error callout: secondary button (idle /
 * pending / retry) + a visible provider disclosure linked by aria-describedby
 * + a role="status" failure line. See change: add-mermaid-ai-repair.
 */
function useAiControls(state: AiState, model: string, onFix: () => void) {
  const discId = useId();
  const pending = state.kind === "pending";
  const failed = state.kind === "failed";
  const label = pending
    ? i18nT("preview.mermaid.aiPending", undefined, "Fixing with AI…")
    : failed
      ? i18nT("preview.mermaid.aiRetry", undefined, "Retry AI fix")
      : i18nT("preview.mermaid.aiFix", undefined, "Fix with AI");
  const actions = (
    <button
      type="button"
      onClick={onFix}
      disabled={pending}
      aria-busy={pending}
      aria-describedby={discId}
      data-testid="mermaid-ai-fix"
      className="focus-ring inline-flex items-center gap-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] px-3 tap-target text-[12px] text-[var(--text-primary)] disabled:opacity-60"
    >
      <Icon
        path={pending ? mdiLoading : failed ? mdiRefresh : mdiCreationOutline}
        size={0.6}
        className={pending ? "animate-spin" : undefined}
        aria-hidden="true"
      />
      {label}
    </button>
  );
  const notes = (
    <>
      <p id={discId} className="mt-1 text-xs">
        {i18nT(
          "preview.mermaid.aiDisclosure",
          { model },
          "The diagram source and the error are sent to {model} to attempt a fix.",
        )}
      </p>
      {failed ? (
        <p role="status" className="mt-1 text-xs">
          {i18nT("preview.mermaid.aiFailed", { reason: state.reason }, "AI fix failed: {reason}")}
        </p>
      ) : null}
    </>
  );
  return { actions, notes };
}

/**
 * AI-fixed badge row (purple tint pill naming the model, show-original toggle,
 * copy-fixed), then the original source + error while toggled on.
 * See change: add-mermaid-ai-repair.
 */
function AiBadge({
  model,
  originalCode,
  originalError,
  fixedSource,
  showOriginal,
  onToggle,
}: {
  model: string;
  originalCode: string;
  originalError: string;
  fixedSource: string;
  showOriginal: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <div data-testid="mermaid-ai-badge" className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mt-2">
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--tint-purple-border)] bg-[var(--tint-purple-bg)] px-1.5 py-0.5 text-[11px] text-[var(--tint-purple-fg)]">
          <Icon path={mdiCreationOutline} size={0.5} aria-hidden="true" />
          {i18nT("preview.mermaid.aiFixed", undefined, "AI-fixed")} · {model}
        </span>
        <button
          type="button"
          aria-pressed={showOriginal}
          onClick={onToggle}
          className="focus-ring rounded-md px-2 tap-target text-[12px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:underline underline-offset-2"
        >
          {i18nT("preview.mermaid.showOriginal", undefined, "Show original")}
        </button>
        <CopyButton
          getText={() => fixedSource}
          icon={<Icon path={mdiContentCopy} size={0.6} aria-hidden="true" />}
          title={i18nT("preview.mermaid.copyFixed", undefined, "Copy fixed source")}
          testId="mermaid-copy-fixed"
        />
      </div>
      {showOriginal && (
        <ErrorView
          code={originalCode}
          message={originalError}
          headline={i18nT("preview.mermaid.originalError", undefined, "Original render error")}
          copyable={false}
        />
      )}
    </>
  );
}

/** Badge row above the diagram: AI-fixed pill when an AI fix is shown, else the rule-repair badge (if any). */
function DiagramBadge({
  code,
  aiFixed,
  originalOutcome,
  outcome,
  repaired,
  showOriginal,
  onToggle,
}: {
  code: string;
  aiFixed: { model: string; fixedCode: string } | null;
  originalOutcome: MermaidOutcome | null;
  outcome: MermaidOutcome | null;
  repaired: Extract<MermaidOutcome, { kind: "repaired" }> | null;
  showOriginal: boolean;
  onToggle: () => void;
}) {
  if (!aiFixed) return <RepairBadge code={code} outcome={repaired} showOriginal={showOriginal} onToggle={onToggle} />;
  return (
    <AiBadge
      model={aiFixed.model}
      originalCode={code}
      originalError={originalOutcome?.kind === "error" ? originalOutcome.message : ""}
      fixedSource={outcome?.kind === "repaired" ? outcome.code : aiFixed.fixedCode}
      showOriginal={showOriginal}
      onToggle={onToggle}
    />
  );
}

/**
 * Ask the server for a fix and ACCEPT it only if it renders (same queued render
 * + sanitize path as any diagram). Resolves to the new state plus the rendered
 * outcome on success; `null` when aborted.
 */
async function requestValidatedFix(
  code: string,
  error: string,
  resolved: string,
  renderId: string,
  signal: AbortSignal,
): Promise<{ state: AiState; rendered?: MermaidOutcome } | null> {
  try {
    const { repairMermaidWithAi } = await import("../../lib/api/mermaid-repair-api.js");
    const res = await repairMermaidWithAi(code, error, signal);
    if (signal.aborted) return null;
    const rendered = await renderMermaid(renderId, res.code, resolved);
    if (signal.aborted) return null;
    if (rendered.kind === "error") {
      const reason = i18nT("preview.mermaid.aiNotRenderable", undefined, "the returned diagram did not render either.");
      return { state: { kind: "failed", reason } };
    }
    return { state: { kind: "fixed", fixedCode: res.code, model: res.model }, rendered };
  } catch (err) {
    if (signal.aborted) return null;
    return { state: { kind: "failed", reason: err instanceof Error ? err.message : String(err) } };
  }
}

/**
 * On-demand AI repair state for one diagram. A successful, rendered fix is
 * cached for the page lifetime. State is keyed on `code + configured model`,
 * so a source/model change discards it; the request is aborted on unmount or
 * key change. See change: add-mermaid-ai-repair (design D3, D6).
 */
function useAiRepair(
  code: string,
  themeId: string,
  resolved: string,
  originalOutcome: MermaidOutcome | null,
  cfg: { enabled: boolean; model?: string },
) {
  const model = cfg.model ?? "";
  const aiKey = `${code}\0${model}`;
  const [held, setHeld] = useState<{ key: string; state: AiState } | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const idBase = useId().replace(/:/g, "");

  // Cleanup-only effect: aborts the in-flight request when the key changes or on unmount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: aiKey is the intentional re-run trigger, not a read
  useEffect(
    () => () => {
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [aiKey],
  );

  const failedOriginal = originalOutcome?.kind === "error" ? originalOutcome : null;
  const cached = cfg.enabled && failedOriginal ? _aiFixCache.get(aiKey) : undefined;
  let state: AiState = { kind: "idle" };
  if (held && held.key === aiKey) state = held.state;
  else if (cached) state = { kind: "fixed", fixedCode: cached.fixedCode, model: cached.model };

  const start = () => {
    if (!failedOriginal || abortRef.current) return;
    const ac = new AbortController();
    abortRef.current = ac;
    setHeld({ key: aiKey, state: { kind: "pending" } });
    void requestValidatedFix(code, failedOriginal.message, resolved, `mermaid-${idBase}-ai${mermaidIdCounter++}`, ac.signal)
      .then((out) => {
        if (!out || ac.signal.aborted) return;
        if (out.state.kind === "fixed" && out.rendered) {
          _outcomeCache.set(cacheKey(out.state.fixedCode, themeId), out.rendered);
          _aiFixCache.set(aiKey, { fixedCode: out.state.fixedCode, model: out.state.model });
        }
        setHeld({ key: aiKey, state: out.state });
      })
      .finally(() => {
        if (abortRef.current === ac) abortRef.current = null;
      });
  };

  return { state, start, offer: cfg.enabled && failedOriginal !== null, model };
}

/**
 * Contain-fit scale of `svg` in the viewport `el`, or null while the viewport
 * has no size: a hidden viewport (show original) reports 0×0, for which
 * computeFitScale answers 1 and would re-seed an untouched view.
 */
function measureFitScale(el: HTMLElement, svg: string): number | null {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return null;
  // clientWidth/Height are layout sizes: unaffected by the zoom transform (unlike getBoundingClientRect).
  const node = el.querySelector("svg") as unknown as SVGSVGElement | null;
  const measured = node && node.clientWidth > 0 && node.clientHeight > 0 ? { w: node.clientWidth, h: node.clientHeight } : null;
  return computeFitScale(svg, r.width, r.height, measured);
}

/**
 * Render-outcome state for one diagram: seeded from the module cache, then
 * (once `complete`) rendered — with repair on failure — and cached.
 */
function useMermaidOutcome(code: string, themeId: string, key: string, resolved: string, complete: boolean) {
  const reactId = useId();
  const [outcome, setOutcome] = useState<MermaidOutcome | null>(() => _outcomeCache.get(key) ?? null);
  const cancelledRef = useRef(false);
  const prevCodeRef = useRef<string | null>(null);
  const prevThemeRef = useRef<string | null>(null);
  const svg = outcome && outcome.kind !== "error" ? outcome.svg : null;

  useEffect(() => {
    // Defer rendering until the fenced block is closed. While streaming, `code`
    // grows each token; rendering incomplete source only flickers parse errors.
    // Once the fence closes the checksum is final, so we render exactly once.
    if (!complete) {
      return;
    }
    // Skip re-render if code and theme haven't changed
    if (prevCodeRef.current === code && prevThemeRef.current === themeId && svg) {
      return;
    }
    prevCodeRef.current = code;
    prevThemeRef.current = themeId;

    cancelledRef.current = false;

    // Cache hit (ok, repaired or deterministic error) skips render and repair
    // and shows the result immediately, avoiding any loading flicker.
    const cached = _outcomeCache.get(key);
    if (cached) {
      setOutcome(cached);
      return;
    }

    // Don't clear an existing diagram — keep showing it while re-rendering.
    setOutcome((prev) => (prev?.kind === "error" ? null : prev));

    const id = `mermaid-${reactId.replace(/:/g, "")}-${mermaidIdCounter++}`;

    // renderMermaid never rejects: every failure resolves to an `error` outcome.
    void renderMermaid(id, code, resolved).then((result) => {
      _outcomeCache.set(key, result);
      if (cancelledRef.current) return;
      if (result.kind === "error") console.warn("[MermaidBlock] render failed:", result.message, "\nCode:", code);
      setOutcome(result);
    });

    return () => {
      cancelledRef.current = true;
    };
  }, [code, themeId, key, resolved, complete]);

  const repaired = outcome?.kind === "repaired" ? outcome : null;
  // "Show original" is tied to the outcome identity (code + theme): a new
  // source or theme closes it without an effect. See change: add-mermaid-auto-repair (D4).
  const [showOriginalFor, setShowOriginalFor] = useState<string | null>(null);
  const showOriginal = repaired !== null && showOriginalFor === key;
  const toggleShowOriginal = () => setShowOriginalFor(showOriginal ? null : key);
  return { outcome, svg, repaired, showOriginal, toggleShowOriginal };
}

/**
 * Which diagram the block shows: the original (with rule repair) or, once the
 * user's AI fix was accepted, the fixed source — which renders through the
 * normal outcome path under ITS OWN source, so a theme change re-renders it
 * without a new request. See change: add-mermaid-ai-repair.
 */
function useDiagramView(code: string, themeId: string, key: string, resolved: string, complete: boolean) {
  const orig = useMermaidOutcome(code, themeId, key, resolved, complete);
  const aiCfg = useMermaidRepairClientConfig();
  const ai = useAiRepair(code, themeId, resolved, orig.outcome, aiCfg);
  const fixedCode = ai.state.kind === "fixed" ? ai.state.fixedCode : "";
  const fixedKey = cacheKey(fixedCode, themeId);
  const fixedView = useMermaidOutcome(fixedCode, themeId, fixedKey, resolved, complete && fixedCode !== "");
  const aiActive = ai.state.kind === "fixed" && fixedView.outcome?.kind !== "error";
  const aiControls = useAiControls(ai.state, ai.model, ai.start);
  const [aiShowOriginalFor, setAiShowOriginalFor] = useState<string | null>(null);
  const view = aiActive ? fixedView : orig;
  const showOriginal = aiActive ? aiShowOriginalFor === fixedKey : orig.showOriginal;
  return {
    orig,
    /** The accepted AI fix (model + source) while it is the displayed diagram. */
    aiFixed: aiActive && ai.state.kind === "fixed" ? ai.state : null,
    /** `ErrorView` slots for the AI repair control (empty when not offered). */
    errorSlots: ai.offer ? { actions: aiControls.actions, notes: aiControls.notes } : {},
    outcome: view.outcome,
    svg: view.svg,
    repaired: aiActive ? null : orig.repaired,
    showOriginal,
    toggleShowOriginal: aiActive
      ? () => setAiShowOriginalFor(showOriginal ? null : fixedKey)
      : orig.toggleShowOriginal,
  };
}

export const MermaidBlock = React.memo(function MermaidBlock({ code, complete = true, ordinal }: Props) {
  const { resolved, themeName } = useThemeContext();
  const fileSource = useMermaidSourceContext();
  // Composite identity: accent palettes differ per named theme, so cache and
  // re-render must key on both the named theme and its light/dark resolution.
  const themeId = `${themeName}:${resolved}`;
  const key = cacheKey(code, themeId);
  const { orig, aiFixed, errorSlots, outcome, svg, repaired, showOriginal, toggleShowOriginal } = useDiagramView(
    code,
    themeId,
    key,
    resolved,
    complete,
  );
  // Final injection value from `pi-sanitized-html` (`mermaid` profile). A
  // sanitizer failure → error view; raw SVG is never injected.
  const trustedSvg = React.useMemo(() => {
    if (!svg) return null;
    try {
      return { ok: true as const, html: trustedSanitizedHtml(svg, "mermaid") };
    } catch (err) {
      return { ok: false as const, message: errorMessage(err) };
    }
  }, [svg]);
  const [focused, setFocused] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const refocusViewportRef = useRef(false);
  // Contain-fit scale, measured against the fixed-height viewport once the SVG
  // is known; the hook clamps it into [min,max] and re-seeds until user input.
  // See change: fix-markdown-remount-storm (D4).
  const [fit, setFit] = useState(1);
  const { state: zoom, handlers, zoomIn, zoomOut, reset, initialScale } = useZoomPan({ initialScale: fit });


  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!svg || !el) return;
    const measure = () => {
      const scale = measureFitScale(el, svg);
      if (scale !== null) setFit(scale);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [svg]);

  // Attach non-passive wheel listener only when focused
  useEffect(() => {
    if (!focused) return;
    const el = viewportRef.current;
    if (!el) return;
    const wheelHandler = handlers.onWheel as EventListener;
    el.addEventListener("wheel", wheelHandler, { passive: false });
    return () => el.removeEventListener("wheel", wheelHandler);
  }, [handlers.onWheel, svg, focused]);

  // After Escape deactivates the diagram, keep keyboard focus on the viewport.
  useEffect(() => {
    if (focused || !refocusViewportRef.current) return;
    refocusViewportRef.current = false;
    viewportRef.current?.focus();
  }, [focused]);

  // Click-outside and Escape to deactivate
  useEffect(() => {
    if (!focused) return;
    function onClickOutside(e: MouseEvent) {
      if (viewportRef.current && !viewportRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // Escape pressed on an unrelated control elsewhere on the page is not ours.
        const active = document.activeElement;
        const vp = viewportRef.current;
        if (active && active !== document.body && vp && !vp.contains(active)) return;
        // The zoom buttons unmount on deactivation, dropping focus to <body>; the
        // effect below moves it to the viewport once they are gone.
        refocusViewportRef.current = true;
        setFocused(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [focused]);

  if (outcome?.kind === "error" || trustedSvg?.ok === false) {
    return (
      <ErrorView
        code={code}
        message={outcome?.kind === "error" ? outcome.message : (trustedSvg as { message: string }).message}
        headline={i18nT("preview.mermaid.errorHeadline", undefined, "This diagram could not be rendered.")}
        {...errorSlots}
      />
    );
  }

  if (!svg || !trustedSvg?.ok) {
    return (
      <div role="status" className="flex items-center justify-center gap-2 py-8 text-[var(--text-secondary)] text-sm">
        <Icon path={mdiLoading} size={0.7} className="animate-spin" aria-hidden="true" />
        {i18nT("preview.mermaid.rendering", undefined, "Rendering diagram…")}
      </div>
    );
  }

  const borderColor = focused ? "border-[var(--focus-ring)]" : "border-[var(--border-subtle)]";

  const toggleOriginal = () => {
    setFocused(false); // the hidden viewport must not keep zoom focus
    toggleShowOriginal();
  };

  // The repaired source worth persisting: the AI fix (itself possibly rule-repaired
  // on top) or the rule repair. See change: add-preview-apply-fix-to-file.
  const fixedSource = aiFixed
    ? outcome?.kind === "repaired"
      ? outcome.code
      : aiFixed.fixedCode
    : (repaired?.code ?? null);

  // Badge + original view render as siblings BEFORE `.mermaid-diagram`, so its
  // structure (first child div = viewport, only svg = the diagram) is unchanged.
  return (
    <>
      <DiagramBadge
        code={code}
        aiFixed={aiFixed}
        originalOutcome={orig.outcome}
        outcome={outcome}
        repaired={repaired}
        showOriginal={showOriginal}
        onToggle={toggleOriginal}
      />
      {fileSource && ordinal !== undefined && fixedSource !== null ? (
        <MermaidApplyFix source={fileSource} ordinal={ordinal} originalCode={code} fixedSource={fixedSource} />
      ) : null}
      <div className="mermaid-diagram relative my-2">
        {/* Viewport: clips zoomed/panned content. Hidden (not unmounted) while the
            original is shown, so zoom/pan state survives the toggle. */}
        <div
          ref={viewportRef}
          hidden={showOriginal}
          tabIndex={0}
          role="group"
          aria-label={i18nT(
            "preview.mermaid.viewportName",
            undefined,
            "Diagram. Press Enter to zoom and pan, Escape to leave.",
          )}
          className={`group focus-ring relative overflow-hidden rounded-md border ${borderColor} bg-[var(--bg-surface)] transition-colors`}
          style={{
            touchAction: focused ? "none" : "auto",
            cursor: focused ? (zoom.scale > initialScale ? "grab" : "default") : "pointer",
            height: VIEWPORT_HEIGHT_CSS,
          }}
          onClick={() => { if (!focused) setFocused(true); }}
          onKeyDown={(e) => {
            // Enter on the viewport itself activates; tabbing through never does,
            // and Enter on a zoom button inside it is that button's own click.
            if (e.key === "Enter" && e.target === e.currentTarget && !focused) setFocused(true);
          }}
          onPointerDown={focused ? handlers.onPointerDown : undefined}
          onPointerMove={focused ? handlers.onPointerMove : undefined}
          onPointerUp={focused ? handlers.onPointerUp : undefined}
          onTouchMove={focused ? handlers.onTouchMove as unknown as React.TouchEventHandler : undefined}
          onTouchEnd={focused ? handlers.onTouchEnd : undefined}
          onDoubleClick={focused ? handlers.onDoubleClick : undefined}
        >
          {focused && (
            <ZoomControls
              onZoomIn={zoomIn}
              onZoomOut={zoomOut}
              onReset={reset}
              scale={zoom.scale}
              initialScale={initialScale}
              labels={{
                zoomIn: i18nT("preview.mermaid.zoomIn", undefined, "Zoom in"),
                zoomOut: i18nT("preview.mermaid.zoomOut", undefined, "Zoom out"),
                reset: i18nT("preview.mermaid.zoomReset", undefined, "Reset zoom"),
              }}
            />
          )}
          {!focused && (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute top-2 right-2 z-10 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-tertiary)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            >
              {i18nT("preview.mermaid.zoomHint", undefined, "Enter or click to zoom")}
            </span>
          )}
          {/* Inner wrapper with zoom transform */}
          <div
            className="mermaid-diagram-inner origin-top-left"
            style={{
              transform: `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.scale})`,
              transformOrigin: "0 0",
            }}
            // client-sinks: allow — trusted via pi-sanitized-html (mermaid profile)
            dangerouslySetInnerHTML={{ __html: trustedSvg.html }}
          />
        </div>
      </div>
    </>
  );
});
