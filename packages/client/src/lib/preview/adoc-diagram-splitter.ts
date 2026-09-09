/**
 * Pure segment splitter for AsciiDoc rendered HTML (design D2).
 *
 * Asciidoctor in `safe: "secure"` mode drops bare `[mermaid]` / `[plantuml]` style names.
 * Only blocks with language annotations survive:
 *  1. `<code class="language-<lang>" data-lang="<lang>">`
 *  2. `<code class="language-<lang>">` (fallback when data-lang is absent)
 *  3. Plain `<pre>` blocks whose content starts with `@startuml` (PlantUML sentinel)
 *
 * Bare `[mermaid]` blocks without source/class/data-lang carry no surviving type info
 * and remain in raw segments.
 *
 * See change: diagram-rendering.
 */

type DiagramSegmentType = "mermaid" | "plantuml";

interface RawHtmlSegment {
  kind: "raw";
  html: string;
}

interface DiagramSegment {
  kind: "diagram";
  type: DiagramSegmentType;
  source: string;
}

export type AdocSegment = RawHtmlSegment | DiagramSegment;

function decodeHtmlEntities(str: string): string {
  const map: Record<string, string> = {
    "&gt;": ">",
    "&lt;": "<",
    "&quot;": '"',
    "&#39;": "'",
    "&#x27;": "'",
    "&amp;": "&",
  };
  return str.replace(/&(?:gt|lt|quot|#39|#x27|amp);/g, (m) => map[m] ?? m);
}

/**
 * Regex matching `<div class="listingblock">...</div>`.
 * Asciidoctor wraps code blocks in `<div class="listingblock"><div class="content"><pre>...`
 */
const LISTING_BLOCK_RE = /<div class="listingblock"[^>]*>[\s\S]*?<\/div>\s*<\/div>/g;

/**
 * Split rendered AsciiDoc HTML into an interleaved sequence of raw HTML segments
 * and diagram segments.
 */
export function splitAdocDiagramSegments(html: string): AdocSegment[] {
  const segments: AdocSegment[] = [];
  let lastIndex = 0;

  function pushRaw(raw: string) {
    if (!raw) return;
    const last = segments[segments.length - 1];
    if (last && last.kind === "raw") {
      last.html += raw;
    } else {
      segments.push({ kind: "raw", html: raw });
    }
  }

  for (const match of html.matchAll(LISTING_BLOCK_RE)) {
    const blockHtml = match[0];
    const matchIndex = match.index ?? 0;

    if (matchIndex > lastIndex) {
      pushRaw(html.slice(lastIndex, matchIndex));
    }

    const diagram = classifyListingBlock(blockHtml);
    if (diagram) {
      segments.push(diagram);
    } else {
      pushRaw(blockHtml);
    }

    lastIndex = matchIndex + blockHtml.length;
  }

  if (lastIndex < html.length) {
    pushRaw(html.slice(lastIndex));
  }

  return segments;
}

/**
 * Check if a `<div class="listingblock">` corresponds to a diagram block.
 */
function classifyListingBlock(blockHtml: string): DiagramSegment | null {
  // 1. Check for <code> element with data-lang or class="language-*"
  const codeMatch = /<code([^>]*)>([\s\S]*?)<\/code>/i.exec(blockHtml);
  if (codeMatch) {
    const attrs = codeMatch[1];
    const rawContent = codeMatch[2];

    let lang: string | null = null;
    const dataLangMatch = /data-lang="([^"]+)"/i.exec(attrs);
    if (dataLangMatch) {
      lang = dataLangMatch[1].toLowerCase();
    } else {
      const classMatch = /class="[^"]*language-([^"\s]+)[^"]*"/i.exec(attrs);
      if (classMatch) {
        lang = classMatch[1].toLowerCase();
      }
    }

    if (lang === "mermaid") {
      return {
        kind: "diagram",
        type: "mermaid",
        source: decodeHtmlEntities(rawContent).trim(),
      };
    }

    if (lang === "plantuml" || lang === "puml") {
      return {
        kind: "diagram",
        type: "plantuml",
        source: decodeHtmlEntities(rawContent).trim(),
      };
    }
  }

  // 2. Check for plain `<pre>` starting with `@startuml` (PlantUML sentinel)
  const preMatch = /<pre[^>]*>([\s\S]*?)<\/pre>/i.exec(blockHtml);
  if (preMatch) {
    const rawContent = preMatch[1];
    const decoded = decodeHtmlEntities(rawContent).trim();
    if (decoded.startsWith("@startuml")) {
      return {
        kind: "diagram",
        type: "plantuml",
        source: decoded,
      };
    }
  }

  return null;
}
