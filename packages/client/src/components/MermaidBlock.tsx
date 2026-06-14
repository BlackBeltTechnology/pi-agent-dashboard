import React, { useEffect, useRef, useState, useId } from "react";
import { useThemeContext } from "./ThemeProvider.js";
import { useZoomPan } from "../hooks/useZoomPan.js";
import { ZoomControls } from "./ZoomControls.js";
import { t as i18nT } from "../lib/i18n";

let mermaidIdCounter = 0;

// ── Module-level SVG cache ──────────────────────────────────────────────────
// Survives component unmount/remount so re-mounted MermaidBlocks can display
// instantly without a "Loading diagram…" flash or re-calling mermaid.render().
export const _svgCache = new Map<string, string>();

function cacheKey(code: string, theme: string): string {
  return `${code}\0${theme}`;
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

// ── Serialized render queue ─────────────────────────────────────────────────
// Mermaid uses global state and cannot handle concurrent render() calls.
// We serialize all renders through a single promise chain.

let renderQueue: Promise<void> = Promise.resolve();
let lastInitTheme: string | null = null;

async function renderMermaid(
  id: string,
  code: string,
  theme: string,
): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    renderQueue = renderQueue.then(async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (lastInitTheme !== theme) {
          const fontFamily = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
          mermaid.initialize({
            startOnLoad: false,
            theme: theme === "dark" ? "dark" : "default",
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
          lastInitTheme = theme;
        }
        const sanitized = sanitizeMermaidCode(code);
        const result = await mermaid.render(id, sanitized);
        resolve(result.svg);
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
}

// ── Zoom control buttons ────────────────────────────────────────────────────


// ── Component ───────────────────────────────────────────────────────────────

export const MermaidBlock = React.memo(function MermaidBlock({ code }: Props) {
  const reactId = useId();
  const { resolved: theme } = useThemeContext();
  const [svg, setSvg] = useState<string | null>(() => _svgCache.get(cacheKey(code, theme)) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const cancelledRef = useRef(false);
  const prevCodeRef = useRef<string | null>(null);
  const prevThemeRef = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const { state: zoom, handlers, zoomIn, zoomOut, reset } = useZoomPan();

  useEffect(() => {
    // Skip re-render if code and theme haven't changed
    if (prevCodeRef.current === code && prevThemeRef.current === theme && svg) {
      return;
    }
    prevCodeRef.current = code;
    prevThemeRef.current = theme;

    cancelledRef.current = false;
    // Don't clear existing SVG — keep showing the old diagram while re-rendering
    setError(null);

    // Check cache — if hit, use cached SVG and skip render
    const key = cacheKey(code, theme);
    const cached = _svgCache.get(key);
    if (cached) {
      setSvg(cached);
      return;
    }

    const id = `mermaid-${reactId.replace(/:/g, "")}-${mermaidIdCounter++}`;

    renderMermaid(id, code, theme).then(
      (result) => {
        _svgCache.set(key, result);
        if (!cancelledRef.current) setSvg(result);
      },
      (err) => {
        if (!cancelledRef.current) {
          const msg = err instanceof Error ? err.message : "Failed to render diagram";
          console.warn("[MermaidBlock] render failed:", msg, "\nCode:", code);
          setError(msg);
        }
      },
    );

    return () => {
      cancelledRef.current = true;
    };
  }, [code, theme]);

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
          {i18nT("auto.failed_to_render_mermaid_diagram", undefined, "Failed to render Mermaid diagram:")} {error}
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
        {i18nT("auto.loading_diagram", undefined, "Loading diagram…")}
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
              {i18nT("auto.click_to_zoom_pan", undefined, "Click to zoom & pan")}
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
          dangerouslySetInnerHTML={{ __html: sanitizeMermaidSvg(svg) }}
        />
      </div>
    </div>
  );
});
