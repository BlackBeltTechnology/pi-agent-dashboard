/**
 * DOMPurify configurations shared by the server sanitizers and the client's
 * `pi-sanitized-html` Trusted Types policy (change: harden-client-sinks, D5).
 *
 * One definition per profile, so the client re-sanitizes server-rendered HTML
 * with exactly the configuration the server used (defense in depth), and the
 * Mermaid config lives outside `MermaidBlock.tsx` (no component import from
 * the policy module). Plain data — no DOMPurify import here.
 */

/** Profile names accepted by the sanitized-HTML policy. */
export type SanitizeProfile = "mermaid" | "asciidoc" | "katex" | "eml" | "docx" | "diagram-svg";

/** DOMPurify config subset used by the profiles (structurally compatible with `dompurify.Config`). */
export interface PurifyProfileConfig {
  USE_PROFILES?: { html?: boolean; svg?: boolean; svgFilters?: boolean; mathMl?: boolean };
  ADD_TAGS?: string[];
  ADD_ATTR?: string[];
  FORBID_TAGS?: string[];
  FORBID_ATTR?: string[];
  HTML_INTEGRATION_POINTS?: Record<string, boolean>;
  WHOLE_DOCUMENT?: boolean;
  FORCE_BODY?: boolean;
}

/**
 * Mermaid SVG: SVG + filters + HTML, `<foreignObject>` as an HTML integration
 * point so label HTML (`<br>`) survives; form controls and embeds forbidden.
 * See change: sanitize-untrusted-rendered-content.
 */
export const MERMAID_SVG_PROFILE: PurifyProfileConfig = {
  USE_PROFILES: { svg: true, svgFilters: true, html: true },
  ADD_TAGS: ["foreignObject"],
  HTML_INTEGRATION_POINTS: { foreignobject: true, "annotation-xml": true },
  FORBID_TAGS: ["form", "input", "button", "textarea", "select", "iframe", "object", "embed"],
};

/** AsciiDoc HTML (server `sanitizeAdocHtml`); pair with {@link keepColWidthStyleOnly}. */
export const ASCIIDOC_PROFILE: PurifyProfileConfig = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["style", "form", "input", "button", "textarea", "select"],
};

const COL_WIDTH_STYLE_RE = /^\s*width:\s*[\d.]+%?;?\s*$/;

/**
 * `uponSanitizeAttribute` hook for the AsciiDoc profile: `style` survives only
 * as asciidoctor's own `<col style="width: N%;">` column widths. Module-scope
 * so `removeHook` matches by identity.
 */
export function keepColWidthStyleOnly(
  node: { nodeName: string },
  data: { attrName: string; attrValue: string; keepAttr: boolean },
): void {
  if (data.attrName !== "style") return;
  const tag = node.nodeName.toLowerCase();
  if ((tag !== "col" && tag !== "colgroup") || !COL_WIDTH_STYLE_RE.test(data.attrValue)) data.keepAttr = false;
}

/** E-mail body (server `sanitizeBody`, which adds `RETURN_DOM`). */
export const EML_PROFILE: PurifyProfileConfig = {
  WHOLE_DOCUMENT: false,
  // FORCE_BODY keeps a leading `<style>` from being hoisted to <head> + dropped.
  FORCE_BODY: true,
  ADD_TAGS: ["style"],
  ADD_ATTR: ["target"],
};

/** DOCX → HTML (server mammoth path). */
export const DOCX_PROFILE: PurifyProfileConfig = {
  FORBID_TAGS: ["script", "style"],
};

/** Server-rendered PlantUML / Kroki diagram SVG. */
export const DIAGRAM_SVG_PROFILE: PurifyProfileConfig = {
  USE_PROFILES: { svg: true, svgFilters: true },
  FORBID_TAGS: ["foreignObject", "script", "style"],
  FORBID_ATTR: ["onclick", "onload", "onerror", "onmouseover", "onmouseout"],
};

/** KaTeX output (HTML spans with inline style + MathML) and AsciiDoc HTML carrying it. */
export const KATEX_PROFILE: PurifyProfileConfig = {
  USE_PROFILES: { html: true, svg: true, mathMl: true },
};

/** Catch-all for the enforce-mode `default` policy (non-SVG HTML). */
export const DEFAULT_HTML_PROFILE: PurifyProfileConfig = {
  USE_PROFILES: { html: true, svg: true, svgFilters: true, mathMl: true },
};

export const SANITIZE_PROFILES: Readonly<Record<SanitizeProfile, PurifyProfileConfig>> = {
  mermaid: MERMAID_SVG_PROFILE,
  asciidoc: ASCIIDOC_PROFILE,
  katex: KATEX_PROFILE,
  eml: EML_PROFILE,
  docx: DOCX_PROFILE,
  "diagram-svg": DIAGRAM_SVG_PROFILE,
};
