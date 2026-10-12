/**
 * Relation + origin visual encoding (tokens only). Relation = colour + line
 * style + word; origin = node shape (+ green ring for project). Never colour
 * alone (WCAG 1.4.1). See change: add-skill-atlas-screen (mockups/ui-plan.md).
 */
import type { SkillLinkType, SkillOrigin } from "../shared/types.js";

export const RELATION_TYPES: readonly SkillLinkType[] = ["references", "bundle", "shares-tool"];

export const RELATION_STYLE: Record<SkillLinkType, { color: string; dash?: string; labelKey: string; label: string }> = {
  references: { color: "var(--accent-blue)", labelKey: "relReferences", label: "references" },
  bundle: { color: "var(--accent-purple)", dash: "5 4", labelKey: "relBundle", label: "same package" },
  "shares-tool": { color: "var(--accent-orange)", dash: "1.5 3", labelKey: "relSharesTool", label: "shares a tool" },
};

export const ORIGIN_TYPES: readonly SkillOrigin[] = ["project", "global", "package"];

export const ORIGIN_STYLE: Record<SkillOrigin, { glyph: string; labelKey: string; label: string; /** Static tint-triple classes (Tailwind must see literals). */ pill: string }> = {
  project: { glyph: "◆", labelKey: "originProject", label: "Project", pill: "bg-[var(--tint-green-bg)] text-[var(--tint-green-fg)] border-[var(--tint-green-border)]" },
  global: { glyph: "●", labelKey: "originGlobal", label: "Global", pill: "bg-[var(--tint-purple-bg)] text-[var(--tint-purple-fg)] border-[var(--tint-purple-border)]" },
  package: { glyph: "■", labelKey: "originPackage", label: "Package", pill: "bg-[var(--tint-orange-bg)] text-[var(--tint-orange-fg)] border-[var(--tint-orange-border)]" },
};

/** Short package label (drops the first-party scope prefixes). */
export const shortPkg = (pkg?: string): string =>
  pkg ? pkg.replace("@blackbelt-technology/", "").replace(/^pi-dashboard-/, "") : "";
