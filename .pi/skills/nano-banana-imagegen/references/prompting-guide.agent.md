# prompting-guide.md — index

Pull-only condensed map. Source: .pi/skills/nano-banana-imagegen/references/prompting-guide.md. Prompt concern → technique + example tokens.

## Prompt Structure
- Layered approach — most→least important: `[Subject] + [Action/State] + [Setting/Context] + [Style] + [Technical Details] + [Negative Constraints]`.
- Prompt length — 10-20 words simple concepts/icons; 30-60 words most cases; 80+ complex scenes. Gemini handles long prompts; prefer specific.

## Key Components
- Subject — specific beats generic ("fluffy golden retriever puppy with floppy ears" > "a dog").
- Action/state — actions ("running", "reading a book"), states ("sleeping peacefully", "glowing softly"), emotions ("joyful expression").
- Setting/context — location ("cozy coffee shop"), time ("golden hour", "starry night"), atmosphere ("warm and inviting", "mysterious and moody").

## Style and Aesthetic
- Artistic styles — name style + technique tokens: photorealistic (DSLR, 85mm, shallow DOF), illustration (flat design), watercolor (soft washes), oil painting, anime (cel shaded), minimalist (negative space), retro (neon, synthwave), editorial.
- Artist references — "in the style of Studio Ghibli", "Art Deco", "Dutch Golden Age", "Bauhaus"; beware copyright.
- Color palettes — named ("earth tones", "pastel"), hex ("teal #0e3b46"), mood-based ("warm sunset colors").

## Technical Specifications
- Composition — framing ("close-up portrait", "wide establishing shot"), angle ("bird's eye view", "low angle"), rule of thirds, symmetry.
- Lighting — golden hour (warm/romantic), blue hour (cool/calm), harsh midday (high contrast), soft diffused (commercial), chiaroscuro (moody/artistic), backlit/rim (silhouette), studio (controlled).
- Aspect ratio — square 1:1, wide 16:9, vertical 9:16, ultra-wide 21:9. Quality — "high resolution", "4K quality", "professional quality", "sharp focus".

## Common Patterns
- Brand guide — template: brand guidelines (primary/secondary hex, style, exclusions) + image requirements.
- Scene description — foreground/midground/background layers + lighting/mood/style.
- Product shot — `[product] on [surface]` + lighting, camera angle, background, commercial style.
- Character — description (physical/clothing/expression) + pose/action + setting + art style/color palette.

## Negative Guidance
- State exclusions explicitly — `NO dark backgrounds, NO neon colors, NO text overlays, NO watermarks, NO borders, NO cartoonish style`.
- Per use case — professional "no casual/no cluttered", children "no scary/dark/violent", minimalist "no busy patterns/gradients", corporate "no playful/neon/informal".

## Iterative Refinement
- Passes — 1) broad concept ("A mountain landscape at sunset"), 2) add specifics, 3) style + quality indicators.
- Editing iterations — refine via `npx @the-focus-ai/nano-banana "make sunset colors more vibrant" --file v1.png --output v2.png`.

## References
- Google AI docs — Gemini API image generation (ai.google.dev/gemini-api/docs/image-generation), Responsible AI. Prompting resources — Google prompt engineering guide, Gemini cookbook (github.com/google-gemini/cookbook).
- Style study — photography/illustration/art-history vocabulary; collect reference images. Examples — `examples/` templates; `prompts/` real-world cases.

## Quick Reference Card
- Structure — `[Subject]+[Action]+[Setting]+[Style]+[Technical]+[Exclusions]`. Must-haves — specific subject, style reference, what to avoid (NO ...).
- Quality boosters — lighting description, composition guidance, professional indicators. Mistakes — too vague, conflicting styles, missing negative guidance, forgetting framing.
