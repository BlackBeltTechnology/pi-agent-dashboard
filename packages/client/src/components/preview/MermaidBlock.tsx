import React, { useEffect, useId, useRef, useState } from "react";
import { useZoomPan } from "../../hooks/useZoomPan.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { useThemeContext } from "../settings/ThemeProvider.js";
import { ZoomControls } from "./ZoomControls.js";

let mermaidIdCounter = 0;

// ── Module-level SVG cache ──────────────────────────────────────────────────
// Survives component unmount/remount so re-mounted MermaidBlocks can display
// instantly without a "Loading diagram…" flash or re-calling mermaid.render().
export const _svgCache = new Map<string, string>();

// ── Module-level error cache ────────────────────────────────────────────────
// Failed renders are deterministic for a given (code, theme): the same invalid
// source always fails the same way. Caching the error message lets a re-mounted
// or re-rendered MermaidBlock show the error instantly instead of replaying
// "Loading diagram…" → render → error, which flickers on every parent update.
export const _errorCache = new Map<string, string>();

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

async function renderMermaid(
  id: string,
  code: string,
  resolved: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    renderQueue = renderQueue.then(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (lastInitTheme !== resolved) {
          const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
          mermaid.initialize({
            startOnLoad: false,
            theme: resolved === "dark" ? "dark" : "default",
            suppressErrorRendering: true,
            fontFamily,
            fontSize: 16,
            themeVariables: { fontFamily, fontSize: "16px" },
            flowchart: { useMaxWidth: true, htmlLabels: true },
            sequence: {
              useMaxWidth: true,
              actorFontFamily: fontFamily,
              messageFontFamily: fontFamily,
              noteFontFamily: fontFamily,
            },
            gantt: { useMaxWidth: true },
          });
          _svgCache.clear();
          _errorCache.clear();
          lastInitTheme = resolved;
        }
        const sanitized = sanitizeMermaidCode(code);
        const result = await mermaid.render(id, sanitized);
        // Sanitize → colorize once, before caching, so the cached SVG is the
        // final injected markup (no per-React-render DOMParser cost). Accents
        // resolve live for the current theme.
        const clean = sanitizeMermaidSvg(result.svg);
        const colorized = colorizeDefaultNodes(
          clean,
          resolveAccents(),
          resolveVar("--text-primary", resolved === "dark" ? "#e5e7eb" : "#111827"),
        );
        resolve(colorized);
        // Clean up any leftover error elements mermaid injects into the DOM
        const errorEl = document.getElementById("d" + id);
        if (errorEl) errorEl.remove();
      } catch (err) {
        reject(err);
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

export const MermaidBlock = React.memo(function MermaidBlock({ code, complete = true }: Props) {
  const reactId = useId();
  const { resolved, themeName } = useThemeContext();
  // Composite identity: accent palettes differ per named theme, so cache and
  // re-render must key on both the named theme and its light/dark resolution.
  const themeId = `${themeName}:${resolved}`;
  const [svg, setSvg] = useState<string | null>(() => _svgCache.get(cacheKey(code, themeId)) ?? null);
  const [error, setError] = useState<string | null>(() => _errorCache.get(cacheKey(code, themeId)) ?? null);
  const [focused, setFocused] = useState(false);
  const cancelledRef = useRef(false);
  const prevCodeRef = useRef<string | null>(null);
  const prevThemeRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const { state: zoom, handlers, zoomIn, zoomOut, reset } = useZoomPan();

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

    // Check caches — a hit (success or deterministic error) skips render and
    // shows the result immediately, avoiding any loading flicker.
    const key = cacheKey(code, themeId);
    const cached = _svgCache.get(key);
    if (cached) {
      setError(null);
      setSvg(cached);
      return;
    }
    const cachedError = _errorCache.get(key);
    if (cachedError) {
      setError(cachedError);
      return;
    }

    // Don't clear existing SVG — keep showing the old diagram while re-rendering
    setError(null);

    const id = `mermaid-${reactId.replace(/:/g, "")}-${mermaidIdCounter++}`;

    renderMermaid(id, code, resolved).then(
      (result) => {
        _svgCache.set(key, result);
        if (!cancelledRef.current) setSvg(result);
      },
      (err) => {
        const msg = err instanceof Error ? err.message : "Failed to render diagram";
        _errorCache.set(key, msg);
        if (!cancelledRef.current) {
          console.warn("[MermaidBlock] render failed:", msg, "\nCode:", code);
          setError(msg);
        }
      },
    );

    return () => {
      cancelledRef.current = true;
    };
  }, [code, themeId, resolved, complete]);

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

  if (error) {
    return (
      <div className="rounded-md overflow-hidden mb-2">
        <div className="text-xs text-red-400 px-3 py-1.5 bg-red-900/20">
          {i18nT("status.failedToRenderMermaidDiagram", undefined, "Failed to render Mermaid diagram:")} {error}
        </div>
        <pre className="bg-[var(--bg-code)] rounded-b-md p-4 overflow-x-auto text-sm">
          <code>{code}</code>
        </pre>
      </div>
    );
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

  return (
    <div className="mermaid-diagram relative my-2">
      {/* Viewport: clips zoomed/panned content */}
      <div
        ref={viewportRef}
        className={`relative overflow-hidden rounded-md border ${borderColor} bg-[var(--bg-surface)] transition-colors`}
        style={{
          touchAction: focused ? "none" : "auto",
          cursor: focused ? (zoom.scale > 1 ? "grab" : "default") : "pointer",
          minHeight: 120,
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
  );
});
