import { mdiContentCopy } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useZoomPan } from "../../hooks/useZoomPan.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { type RuleId, repairMermaid } from "../../lib/preview/mermaid-repair.js";
import { CopyButton } from "../primitives/CopyButton.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
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
// DOMPurify strips HTML inside <foreignObject> which Mermaid uses for labels.
// Since the SVG is generated client-side by Mermaid (not from user input),
// we use a lightweight sanitizer that strips dangerous elements/attributes
// while preserving foreignObject content.

function sanitizeMermaidSvg(svg: string): string {
  // Remove <script> tags and on* event attributes
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\bon\w+\s*=\s*["'][^"']*["']/gi, "");
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

// Fallback ramp for environments where getComputedStyle returns empty custom
// properties (e.g. jsdom under test). In the browser the vars are always set.
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
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.querySelector("parsererror")) return svg;

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

/** One render attempt: render → sanitize → colorize, then drop any error node mermaid left in the DOM. */
async function renderOnce(mermaid: MermaidApi, id: string, code: string, resolved: string): Promise<string> {
  try {
    const result = await mermaid.render(id, code);
    // Sanitize → colorize once, before caching, so the cached SVG is the
    // final injected markup (no per-React-render DOMParser cost). Accents
    // resolve live for the current theme.
    const clean = sanitizeMermaidSvg(result.svg);
    return colorizeDefaultNodes(
      clean,
      resolveAccents(),
      resolveVar("--text-primary", resolved === "dark" ? "#e5e7eb" : "#111827"),
    );
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

function ErrorView({ code, message }: { code: string; message: string }) {
  return (
    <div className="rounded-md overflow-hidden mb-2">
      <div className="text-xs text-red-400 px-3 py-1.5 bg-red-900/20">
        {i18nT("status.failedToRenderMermaidDiagram", undefined, "Failed to render Mermaid diagram:")} {message}
      </div>
      <pre className="bg-[var(--bg-code)] rounded-b-md p-4 overflow-x-auto text-sm">
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
  idPrefix,
  code,
  outcome,
  showOriginal,
  onToggle,
}: {
  idPrefix: string;
  code: string;
  outcome: Extract<MermaidOutcome, { kind: "repaired" }> | null;
  showOriginal: boolean;
  onToggle: () => void;
}) {
  if (!outcome) return null;
  return (
    <>
      <div
        data-testid="mermaid-repair-badge"
        className="flex flex-wrap items-center gap-1.5 mt-2 text-xs text-[var(--text-secondary)]"
      >
        <span>{i18nT("preview.mermaid.autoFixed", undefined, "Auto-fixed:")}</span>
        {outcome.applied.map((rule) => {
          const description = i18nT(`preview.mermaid.rule.${rule}`, undefined, RULE_DESCRIPTIONS[rule]);
          return (
            <React.Fragment key={rule}>
              <code
                data-testid="mermaid-repair-rule"
                aria-describedby={`${idPrefix}-${rule}`}
                title={description}
                className="px-1 rounded bg-[var(--bg-code)] text-[var(--text-primary)]"
              >
                {rule}
              </code>
              <span id={`${idPrefix}-${rule}`} className="sr-only">
                {description}
              </span>
            </React.Fragment>
          );
        })}
        <button
          type="button"
          aria-pressed={showOriginal}
          onClick={onToggle}
          className="px-1.5 py-0.5 rounded hover:bg-[var(--bg-surface)] hover:text-[var(--text-primary)] underline-offset-2 hover:underline"
        >
          {i18nT("preview.mermaid.showOriginal", undefined, "Show original")}
        </button>
        <CopyButton
          getText={() => outcome.code}
          icon={<Icon path={mdiContentCopy} size={0.6} />}
          title={i18nT("preview.mermaid.copyFixed", undefined, "Copy fixed source")}
          testId="mermaid-copy-fixed"
        />
      </div>
      {showOriginal && <ErrorView code={code} message={outcome.error} />}
    </>
  );
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

export const MermaidBlock = React.memo(function MermaidBlock({ code, complete = true }: Props) {
  const reactId = useId();
  const { resolved, themeName } = useThemeContext();
  // Composite identity: accent palettes differ per named theme, so cache and
  // re-render must key on both the named theme and its light/dark resolution.
  const themeId = `${themeName}:${resolved}`;
  const key = cacheKey(code, themeId);
  const { outcome, svg, repaired, showOriginal, toggleShowOriginal } = useMermaidOutcome(
    code,
    themeId,
    key,
    resolved,
    complete,
  );
  const [focused, setFocused] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
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

  // Click-outside and Escape to deactivate
  useEffect(() => {
    if (!focused) return;
    function onClickOutside(e: MouseEvent) {
      if (viewportRef.current && !viewportRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setFocused(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [focused]);

  if (outcome?.kind === "error") {
    return <ErrorView code={code} message={outcome.message} />;
  }

  if (!svg) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--text-muted)] text-sm">
        {i18nT("status.loadingDiagram", undefined, "Loading diagram…")}
      </div>
    );
  }

  const borderColor = focused
    ? "border-blue-500/60"
    : "border-[var(--border-subtle)]";

  const toggleOriginal = () => {
    setFocused(false); // the hidden viewport must not keep zoom focus
    toggleShowOriginal();
  };

  // Badge + original view render as siblings BEFORE `.mermaid-diagram`, so its
  // structure (first child div = viewport, only svg = the diagram) is unchanged.
  return (
    <>
      <RepairBadge
        idPrefix={`mermaid-rule-${reactId.replace(/:/g, "")}`}
        code={code}
        outcome={repaired}
        showOriginal={showOriginal}
        onToggle={toggleOriginal}
      />
      <div className="mermaid-diagram relative my-2">
        {/* Viewport: clips zoomed/panned content. Hidden (not unmounted) while the
            original is shown, so zoom/pan state survives the toggle. */}
        <div
          ref={viewportRef}
          hidden={showOriginal}
          className={`relative overflow-hidden rounded-md border ${borderColor} bg-[var(--bg-surface)] transition-colors`}
          style={{
            touchAction: focused ? "none" : "auto",
            cursor: focused ? (zoom.scale > initialScale ? "grab" : "default") : "pointer",
            height: VIEWPORT_HEIGHT_CSS,
          }}
          onClick={() => { if (!focused) setFocused(true); }}
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
            />
          )}
          {!focused && (
            <div className="absolute inset-0 z-10 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity bg-black/10 rounded-md">
              <span className="text-xs text-[var(--text-secondary)] bg-[var(--bg-surface)]/90 px-2 py-1 rounded shadow">
                {i18nT("common.clickToZoomPan", undefined, "Click to zoom & pan")}
              </span>
            </div>
          )}
          {/* Inner wrapper with zoom transform */}
          <div
            className="mermaid-diagram-inner origin-top-left"
            style={{
              transform: `translate(${zoom.translateX}px, ${zoom.translateY}px) scale(${zoom.scale})`,
              transformOrigin: "0 0",
            }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </div>
      </div>
    </>
  );
});
