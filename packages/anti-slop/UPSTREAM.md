# Upstream provenance

This package adapts rules from an upstream MIT-licensed skill repository. The
pin below is the exact commit the current skills were distilled from. A refresh
is a diff against this pin, not a re-read.

- Repository: https://github.com/Leonxlnx/taste-skill
- Commit: `18dfc928b135629e0eddfdd445a06400d04ed439`
- Date: 2026-10-08
- License: MIT (`LICENSE` at the pinned commit, Copyright (c) 2026 Leonxlnx)

Adapted upstream skills (directory → upstream `name:` → package skill):

| Upstream dir | Upstream `name:` | Package skill |
|---|---|---|
| `skills/taste-skill` | `design-taste-frontend` | `anti-slop-frontend`, `anti-slop-redesign` |
| `skills/redesign-skill` | `redesign-existing-projects` | `anti-slop-redesign` |
| `skills/image-to-code-skill` | `image-to-code` | `anti-slop-image-direction` |
| `skills/imagegen-frontend-web` | `imagegen-frontend-web` | `anti-slop-image-direction` |
| `skills/brandkit` | `brandkit` | `anti-slop-brandkit` |

Not adapted: `brutalist-skill`, `minimalist-skill`, `soft-skill`,
`gpt-tasteskill`, `stitch-skill`, `imagegen-frontend-mobile`, `output-skill`,
`taste-skill-v1`.

What we change on the way in, for every row below:

- Only countable or binary rules survive. Prose taste becomes an override note.
- Stack coupling (Next RSC, `next/image`, Motion, GSAP) is removed.
- Generated images are **direction, not source** (upstream `image-to-code`
  treats them as the source of truth; we invert that).
- All skills are advisory under `frontend-mockup-loop`, never a gate.

## Section map

Every upstream section of each adapted skill is listed. Target is a package
skill (plus section) or `dropped: <reason>`.

### taste-skill

| Upstream section | Target |
|---|---|
| §0 Brief inference (0.A signals, 0.B Design Read, 0.C one question, 0.D anti-default) | `anti-slop-frontend` § Design Read and surface profile |
| §1 The three dials (1.A inference, 1.B presets, 1.C how dials drive output) | `anti-slop-frontend` § The three dials |
| §2 Brief → design system map | dropped: design-system choice is owned by frontend-mockup-loop GROUND/CONTRACT, not a countable tell |
| §3 Default architecture & conventions (stack, state, icons, emoji, responsive, dependency check) | `anti-slop-frontend` § A5 (icon family only); rest dropped: stack coupling |
| §4.1 Typography | `anti-slop-frontend` § A2 |
| §4.2 Color calibration | `anti-slop-frontend` § A1 |
| §4.3 Layout diversification | `anti-slop-frontend` § B3 |
| §4.4 Materiality, shadows, cards | dropped: prose taste with no countable threshold |
| §4.5 Interactive UI states | `anti-slop-frontend` § A6 |
| §4.6 Data & form patterns | `anti-slop-frontend` § A6 (form contrast, label above input) |
| §4.7 Layout discipline | `anti-slop-frontend` § B1 (hero) and § B7 (nav, marketing only) |
| §4.8 Image & visual asset strategy | `anti-slop-frontend` § A5 |
| §4.9 Content density | dropped: covered by the DENSITY dial, no countable rule |
| §4.10 Quotes & testimonials | `anti-slop-frontend` § A4 (fake data) |
| §4.11 Page theme lock | `anti-slop-frontend` § Theme parity (T1-T3) |
| §5 Context-aware proactivity (5.A-5.C GSAP skeletons) | dropped: GSAP code skeletons are stack coupling, out of scope |
| §5.D Forbidden animation patterns | `anti-slop-frontend` § A7 |
| §6.A Hardware acceleration | `anti-slop-frontend` § A8 |
| §6.B Reduced motion | `anti-slop-frontend` § A7 |
| §6.C Dark mode | `anti-slop-frontend` § Theme parity (T1-T3) |
| §6.D Core Web Vitals targets | dropped: measured by Lighthouse, a performance gate outside this advisory suite |
| §6.E DOM cost | `anti-slop-frontend` § A8 |
| §6.F Z-index restraint | `anti-slop-frontend` § A8 |
| §7 Dial definitions | `anti-slop-frontend` § The three dials |
| §8 Dark mode protocol (token strategy, no prescribed colors, default mode, test both modes) | `anti-slop-frontend` § Theme parity (T1-T3) |
| §9.A-9.E AI tells (visual, type, layout, content, external resources) | `anti-slop-frontend` § A1-A5 |
| §9.F Production-test tells | `anti-slop-frontend` § B5 |
| §9.G Em-dash ban | `anti-slop-frontend` § A3 |
| §10 Reference vocabulary | dropped: naming glossary, no rule to check |
| §11.A Detect the mode | `anti-slop-redesign` § 1 Declare the mode |
| §11.B Audit before touching | `anti-slop-redesign` § 2 Audit before edit |
| §11.C Preservation rules | `anti-slop-redesign` § Never change silently |
| §11.D Modernisation levers | `anti-slop-redesign` § 3 Levers in priority order |
| §11.E Targeted evolution vs full redesign | `anti-slop-redesign` § 1 Declare the mode |
| §11.F What never changes silently | `anti-slop-redesign` § Never change silently |
| §12 Block library | dropped: a component-library contract, out of scope |
| §13 Out of scope (declares dashboards out of scope) | dropped: we serve `product-ui` via the surface profile instead |
| §14 Final pre-flight check | `anti-slop-frontend` § Mechanical pre-flight |
| Appendix A Install commands per design system | dropped: stack coupling |
| Appendix B Canonical sources | dropped: frontend-mockup-loop GROUND owns external sources |
| Appendix C Apple Liquid Glass approximation | dropped: platform-specific recipe, not a tell |

### redesign-skill

| Upstream section | Target |
|---|---|
| How this works (scan, diagnose, fix) | `anti-slop-redesign` § Procedure |
| Design audit: typography, color, layout, interactivity, content, components, iconography | `anti-slop-redesign` § 2 Audit before edit (tells checked via `anti-slop-frontend` Part A/B) |
| Design audit: code quality | dropped: code review is owned by `review-code`, not a design tell |
| Design audit: strategic omissions | `anti-slop-redesign` § 2 Audit before edit (missing states) |
| Upgrade techniques (type, layout, motion, surface) | `anti-slop-redesign` § 3 Levers in priority order |
| Fix priority | `anti-slop-redesign` § 3 Levers in priority order |
| Rules (keep stack, do not break functionality, check deps) | `anti-slop-redesign` § Rules |

### image-to-code-skill

| Upstream section | Target |
|---|---|
| Core directive: image-first design to code | `anti-slop-image-direction` § Direction, not source (inverted: images are direction, not source of truth) |
| §1 Active baseline configuration | `anti-slop-image-direction` § 1 Plan (dials come from the `anti-slop-frontend` Design Read) |
| §2 Mandatory image-first rule | dropped: image direction is opt-in here, never mandatory |
| §3 Generate enough images rule | `anti-slop-image-direction` § 1 Plan (one image per section, count stated up front) |
| §4 Codex-specific section image rule | dropped: agent-runtime specific |
| §5 Do not crop old images rule | `anti-slop-image-direction` § 2 Generate (one fresh image per section) |
| §6 Fresh re-generation rule | `anti-slop-image-direction` § 2 Generate (re-generation needs a new confirm) |
| §7 Optional detail / extraction image rule | dropped: extra paid images beyond one per section |
| §8 Clean analysis standard | `anti-slop-image-direction` § 3 Analyze |
| §9 Deep image analysis requirement | `anti-slop-image-direction` § 3 Analyze |
| §10 Image-first workflow | `anti-slop-image-direction` § Procedure |
| §11 When to trigger image generation first | `anti-slop-image-direction` § When it applies |
| §12 Combinatorial variation engine | `anti-slop-image-direction` § Variation axes |
| §13 Website reference rule | `anti-slop-image-direction` § 2 Generate (prompt describes, never quotes) |
| §14 Hero minimalism rules | `anti-slop-frontend` § B1 |
| §15 Responsive first-view rule | `anti-slop-frontend` § B1 |
| §16 Anti-nested-box rule | dropped: no countable threshold upstream |
| §17 Reduce micro-UI clutter rule | `anti-slop-frontend` § B5 |
| §18 Section image generation rule | `anti-slop-image-direction` § 2 Generate |
| §19 Website image system rule | `anti-slop-image-direction` § 3 Analyze (consistency across images) |
| §20 Fixed media frame rule | dropped: implementation detail for image-as-source, which we do not do |
| §21 Text extraction rule | `anti-slop-image-direction` § Direction, not source (image text is a placeholder, never transcribed) |
| §22 Typography extraction rule | `anti-slop-image-direction` § 3 Analyze (type character) |
| §23 Spacing extraction rule | `anti-slop-image-direction` § 3 Analyze (spacing rhythm) |
| §24 Button / component extraction rule | dropped: pixel extraction treats the image as source |
| §25 Color extraction rule | `anti-slop-image-direction` § 3 Analyze (palette hex) |
| §26 Design-to-code copy discipline | `anti-slop-image-direction` § Direction, not source |
| §27 Anti-drift implementation rule | dropped: drift from the image is allowed; the loop gates win |
| §28 Missing detail resolution | `anti-slop-image-direction` § 4 Hand-off |
| §29 Anti-AI-slop rules | `anti-slop-frontend` § A1-A5, B3 |
| §30 Typography-first discipline | `anti-slop-frontend` § A2 |
| §31 Section rhythm rule | `anti-slop-frontend` § B3 |
| §32 Density & spacing discipline | `anti-slop-frontend` § The three dials (DENSITY) |
| §33 Default section packs | dropped: page templates, not tells |
| §34 Multi-image consistency rule | `anti-slop-image-direction` § 3 Analyze |
| §35 Clarity check | `anti-slop-image-direction` § Verification |
| §36 Response behavior | dropped: agent-runtime chat format |
| §37 Example interpretations | dropped: examples, no rule |
| §38 Final goal | dropped: restates the directive |

### imagegen-frontend-web

| Upstream section | Target |
|---|---|
| Hard output rule (images only, no code) | dropped: our output is a direction brief plus mockup, not images only |
| Hero composition bias | `anti-slop-image-direction` § Variation axes (composition anchor) |
| Core directive: art direction | `anti-slop-image-direction` § Direction, not source |
| §1 Active baseline configuration, brief-to-direction mapping | `anti-slop-image-direction` § 1 Plan |
| §2 Variation engine: theme, background, type, hero, section system, components, motion | `anti-slop-image-direction` § Variation axes |
| §2 Composition anchor, background mode, CTA variation, hero scale | `anti-slop-image-direction` § Variation axes |
| §2 Narrative spine, second-read moment | dropped: narrative prose with no countable check |
| §3 Frontend reference rule | `anti-slop-image-direction` § 2 Generate |
| §4 Hero minimalism rules | `anti-slop-frontend` § B1 |
| §5 Image count & page slicing | `anti-slop-image-direction` § 1 Plan (one image per section) |
| §6 Creativity escalation rule | dropped: no countable threshold |
| §7 Image-first art direction | dropped: image direction is opt-in here, never first by default |
| §8 Anti-AI-slop rules | `anti-slop-image-direction` § 2 Generate (Part A bans in every prompt) |
| §9 Typography-first discipline | `anti-slop-frontend` § A2 |
| §10 Section rhythm rule | `anti-slop-frontend` § B3 |
| §11 Component execution guidelines | dropped: component recipes, not tells |
| §12 Density & spacing discipline | `anti-slop-frontend` § The three dials (DENSITY) |
| §13 Color & material rules | `anti-slop-frontend` § A1 |
| §14 Image / media direction | `anti-slop-image-direction` § 3 Analyze |
| §15 Default site packs | dropped: page templates, not tells |
| §16 Multi-image consistency rule | `anti-slop-image-direction` § 3 Analyze |
| §17 Clarity check | `anti-slop-image-direction` § Verification |
| §18 Extra creativity & implementation edge | dropped: prose taste with no countable check |
| §19 Response behavior | dropped: agent-runtime chat format |
| §20 Example interpretations | dropped: examples, no rule |
| §21 Final goal | dropped: restates the directive |

### brandkit

| Upstream section | Target |
|---|---|
| Brandkit image generation skill (role) | `anti-slop-brandkit` § When it applies |
| Reference style DNA | `anti-slop-brandkit` § 2 Generate (prompt style) |
| Core principle | `anti-slop-brandkit` § Proposal, not identity |
| Default output | `anti-slop-brandkit` § 2 Generate (one board image) |
| Brand strategy first | `anti-slop-brandkit` § 1 Plan (strategy before image) |
| Logo generation standard | `anti-slop-brandkit` § Proposal, not identity (logos are concepts) |
| Logo concept methods (monogram, product action, metaphor, negative space, geometry) | `anti-slop-brandkit` § 3 Brief (logo concept rationale) |
| Board composition DNA | `anti-slop-brandkit` § 2 Generate |
| Default 3 × 3 panel system | `anti-slop-brandkit` § 2 Generate (3×3 board) |
| 2 × 3 reference-style layout | dropped: one board layout is enough; variants only on request |
| Visual modes (dark developer, product, nature, security, editorial, luxury, voice, cultural) | dropped: preset aesthetics; the Design Read picks the mood |
| Premium detail language | dropped: prose taste with no countable check |
| Text rules | `anti-slop-brandkit` § 2 Generate (image text is a placeholder) |
| Tagline style | dropped: copywriting, not a tell |
| Image direction | `anti-slop-brandkit` § 3 Brief (image direction line) |
| Mockup direction | `anti-slop-brandkit` § 2 Generate |
| Color discipline | `anti-slop-brandkit` § 3 Brief (palette) and `anti-slop-frontend` § A1 |
| Anti-generic rules | `anti-slop-brandkit` § 2 Generate (Part A bans in the prompt) |
| Reference usage | dropped: uploaded-reference handling, not used |
| Prompt template | `anti-slop-brandkit` § 2 Generate |
| Final output standard | `anti-slop-brandkit` § Verification |

## Refresh procedure

1. Clone upstream and diff the adapted skills against the pin:

   ```bash
   git clone https://github.com/Leonxlnx/taste-skill /tmp/taste-skill
   cd /tmp/taste-skill
   git diff <pinned-commit>..<new-sha> -- \
     skills/taste-skill skills/redesign-skill skills/image-to-code-skill \
     skills/imagegen-frontend-web skills/brandkit
   ```

2. Re-check `LICENSE` at `<new-sha>`. Stop if it is no longer MIT.
3. For each changed upstream section, update the matching package skill or
   mark the row `dropped: <reason>`. Add rows for new sections. No row may be
   empty or `TBD`.
4. Update `Commit` and `Date` above, and the short SHA in every suite skill's
   `metadata.adapted_from`.
5. Keep the `anti-slop-frontend` `description:` byte-identical (digest-pinned
   in `scripts/__tests__/skill-frontmatter.test.mjs`).
6. Run `npx vitest run scripts/__tests__/anti-slop-suite-contract.test.mjs`.
