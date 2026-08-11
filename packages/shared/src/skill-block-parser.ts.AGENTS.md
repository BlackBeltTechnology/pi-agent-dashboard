# skill-block-parser.ts — index

Single source of truth for pi's `<skill name location>…</skill>` envelope. Exports `SkillBlock`, `BuildSkillBlockArgs`, `parseSkillBlock`, `buildSkillBlock`, `condenseForFirstMessage`. `buildSkillBlock` byte-identical to pi's `_expandSkillCommand`; `parseSkillBlock` strips `References are relative to` preamble. `condenseForFirstMessage` returns `/skill:name args` slash form.
