/** Inline SVG line sample for a relation type (colour + dash). See change: add-skill-atlas-screen. */
import type React from "react";
import type { SkillLinkType } from "../shared/types.js";
import { RELATION_STYLE } from "./relation-style.js";

export function RelationGlyph({ type }: { type: SkillLinkType }): React.ReactElement {
  const s = RELATION_STYLE[type];
  return (
    <svg width="22" height="6" aria-hidden="true" className="shrink-0">
      <line x1="1" y1="3" x2="21" y2="3" stroke={s.color} strokeWidth="2.5" strokeDasharray={s.dash} strokeLinecap="round" />
    </svg>
  );
}
