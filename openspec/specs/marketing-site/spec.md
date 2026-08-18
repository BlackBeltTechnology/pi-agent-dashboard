# Marketing Site

## Purpose

Defines the public marketing site: its source location, theming with no flash of unstyled content, the hero and storytelling animations, the argument sections (TUI versus GUI, remote delegation, a newcomer-friendly introduction), the features grid, a latest-release surface that auto-syncs, GitHub Pages deployment, a Playwright screenshot pipeline, and the performance and accessibility budgets it must meet.

## Requirements

### Requirement: Public marketing site source

The repository SHALL contain a self-contained marketing site at `/site/` built with Astro + Tailwind + MDX, producing a fully static output.

#### Scenario: Site builds independently of the main app

- **GIVEN** a fresh clone of the repository
- **WHEN** a developer runs `cd site && npm ci && npm run build`
- **THEN** the build succeeds without depending on the root workspace, the `packages/*` workspaces, or any main-app build artifacts
- **AND** output is written to `site/dist/` as static HTML/CSS/JS assets

#### Scenario: Site declares "Pi blue" design tokens as CSS variables

- **GIVEN** the site's Tailwind configuration and `global.css`
- **WHEN** the stylesheet loads
- **THEN** every `pi-*` Tailwind color resolves through a CSS variable of
  the form `rgb(var(--pi-xxx) / <alpha-value>)` so opacity utilities still
  work, and both `:root` (light) and `:root.dark` declare a complete set of
  these variables covering bg, surface, surface-alt, border, fg, muted,
  accent, accent2, success, and warn

### Requirement: Theme selector with System / Light / Dark and no FOUC

The site SHALL support a System / Light / Dark theme selector with
pre-paint resolution of the initial theme.

#### Scenario: First paint matches the resolved theme

- **GIVEN** a visitor with `localStorage.pi-theme` unset and an OS set to
  dark mode
- **WHEN** they load the site for the first time
- **THEN** an inlined script in `<head>` resolves the theme to "dark" and
  sets `class="dark"` on `<html>` before any stylesheet parses, so no
  flash of light content appears

#### Scenario: Explicit choice is persisted across reloads

- **GIVEN** a visitor who clicks the Light option in the theme toggle
- **WHEN** they reload the page
- **THEN** `<html>` does not carry the `dark` class and
  `localStorage.pi-theme` is `"light"`

#### Scenario: System mode tracks OS changes live

- **GIVEN** a visitor in System mode
- **WHEN** they toggle their OS color-scheme preference while the page is
  open
- **THEN** the site's theme updates to match without a reload

#### Scenario: Hero and feature mockups swap per theme

- **GIVEN** a visitor switches between light and dark modes
- **WHEN** the hero animation and feature bento grid re-render
- **THEN** each dashboard mockup image flips between a dark-themed PNG
  (under `site/public/screenshots/desktop/`) and a light-themed PNG
  (under `site/public/screenshots/desktop-light/`) via CSS-driven
  visibility (`dark:block` / `dark:hidden`) so the mockups always match
  the active theme

### Requirement: Storytelling hero animation

The site SHALL render an animated hero that crossfades through multiple dashboard states to showcase the product visually.

#### Scenario: Hero cycles through 4 states

- **GIVEN** a user visits the site on a device that does not set `prefers-reduced-motion: reduce`
- **WHEN** the page loads
- **THEN** the hero mockup displays one of four dashboard states (sessions, chat, flows, mobile) and transitions to the next state every 6 seconds with a crossfade, slight scale, and translateY motion

#### Scenario: Hero respects reduced motion

- **GIVEN** a user with `prefers-reduced-motion: reduce` set
- **WHEN** the page loads
- **THEN** the hero freezes on the first state, the background hue does not shift, and card pulse animations are disabled

#### Scenario: Hero pauses on hover

- **GIVEN** the hero animation is cycling
- **WHEN** the user hovers the mockup on a pointer device, or touches it on a touch device
- **THEN** the state-cycle timer pauses until the pointer leaves or the touch ends

### Requirement: Why section articulates TUI-vs-GUI and remote-delegation arguments

The site SHALL include a "Why" section with two dedicated cards, one for each of the two core arguments the project makes against a pure-TUI workflow.

#### Scenario: Information-density card is present

- **GIVEN** a user scrolls to the Why section
- **WHEN** the section renders
- **THEN** one card explicitly argues that a graphical interface increases information density compared to a TUI and that the size of information can reflect its importance

#### Scenario: Remote-delegation card is present

- **GIVEN** a user scrolls to the Why section
- **WHEN** the section renders
- **THEN** the second card explicitly argues that pi sessions can run on a remote server and be controlled from mobile devices, without requiring SSH, tmux, or a laptop

### Requirement: Features bento grid

The site SHALL present the product's features as a bento-style grid with
asymmetric sizing that covers all of the dashboard's headline features.

#### Scenario: Features rendered from data

- **GIVEN** a feature list declared in `site/src/content/features.ts`
- **WHEN** the Features section renders
- **THEN** the `BentoGrid` component reads that list and renders a responsive 12-column grid where each card's column/row span is driven by the data entry

#### Scenario: Grid rows have no gaps

- **GIVEN** the bento grid's feature entries
- **WHEN** the sum of `col-span` values per grid row is computed
- **THEN** every row's declared spans total exactly 12 so that CSS grid
  auto-placement leaves no empty cells

#### Scenario: Embedded code-server / VS Code feature is included

- **GIVEN** the features list
- **WHEN** it is rendered
- **THEN** there is a dedicated card for the embedded editor / code-server
  integration, with its own screenshot and copy describing lazy-start and
  per-workspace behavior

#### Scenario: Every feature card has accessible imagery

- **GIVEN** any feature card that embeds a screenshot
- **WHEN** the card is rendered
- **THEN** the `<img>` has a descriptive `alt` attribute that names the feature

### Requirement: Newcomer-friendly "What is pi?" introduction

The site SHALL include an introductory section between the hero and the
big-idea section that explains what pi is for visitors unfamiliar with it.

#### Scenario: Hero subhead links to the explainer

- **GIVEN** the rendered hero
- **WHEN** a visitor reads the subhead
- **THEN** the word "pi" is an in-page link that jumps to the explainer
  section

#### Scenario: Explainer covers CLI, session, and non-replacement of TUI

- **GIVEN** the "What is pi?" section
- **WHEN** it renders
- **THEN** it describes pi as an open-source coding-agent CLI, introduces
  the term "session", and explicitly states that the dashboard does not
  replace the TUI but runs alongside it

### Requirement: Ambient mission-graph background

The site SHALL render an ambient, non-figurative animated background that
visually encodes the project's mission (many agents → bridged events → any
device).

#### Scenario: Graph is pure SVG and respects reduced motion

- **GIVEN** the rendered site
- **WHEN** the MissionGraph component is inspected
- **THEN** it is a single inline SVG styled by CSS (no additional JS
  shipped) and, under `prefers-reduced-motion: reduce`, all of its
  animations (edge flow, node twinkle, ping rings) are disabled

#### Scenario: Graph retints with the theme

- **GIVEN** a visitor switches between light and dark mode
- **WHEN** the MissionGraph re-renders
- **THEN** its node, edge, and ping colors follow the `--pi-accent` /
  `--pi-accent2` CSS variables so the graph reads correctly on both
  backgrounds

### Requirement: Kraken-brain animated backdrop on the hero

The hero section SHALL render an animated canvas backdrop layer composed
of a glowing brain core, eight undulating tentacles, marching dashed
bezier curves, and binary data streams. The backdrop SHALL be tinted
from the site's `--pi-accent` / `--pi-accent2` tokens so it reads
correctly in both light and dark themes, SHALL be subtle enough that
foreground copy stays readable, and SHALL NOT obscure the body-level
MissionGraph or the page's atmospheric backdrop.

#### Scenario: Backdrop adopts the site's indigo/violet palette

- **GIVEN** the hero is rendered
- **WHEN** the kraken backdrop's CSS custom properties are inspected
- **THEN** every `--kb-*` token is derived from `--pi-accent`,
  `--pi-accent2`, or `--pi-bg`, and switching `<html class="dark">`
  on/off retints the canvas (brain colormap, tentacle hues, halo,
  stream digits) without a page reload via a `MutationObserver`

#### Scenario: Backdrop sits behind copy without blocking MissionGraph

- **GIVEN** a visitor on the hero
- **WHEN** the layer stack is inspected
- **THEN** the kraken canvas mounts inside `<section class="isolate">`
  at `-z-20`, has no opaque background scrim, has
  `pointer-events: none`, and its bottom edge fades out via
  `mask-image: linear-gradient(...)` so the body's MissionGraph SVG and
  page bg show through smoothly with no visible horizontal cut

#### Scenario: Brain heartbeat pulse with zoom and alpha

- **GIVEN** the kraken canvas is animating
- **WHEN** the brain layer is observed across one 1.5 s period
- **THEN** it scales and fades following a lub-DUB Gaussian heartbeat
  waveform (two pulses per period, the second roughly twice as strong)
  layered over a slow ~3.7 s breath sine, producing organic "alive"
  motion rather than a simple sine fade

#### Scenario: Tentacle tips reach toward the cursor

- **GIVEN** a visitor moves the cursor inside the hero
- **WHEN** each tentacle is updated per frame
- **THEN** the tip displaces toward the smoothed cursor position with
  a `u³` falloff (anchor end immobile, tip flexes most), capped at
  ~75 × scale px, with the effect easing in/out as the cursor
  enters/leaves the canvas bounds

#### Scenario: Tip-vs-dashed-line collisions emit electric sparks

- **GIVEN** a tentacle tip is reaching for the cursor
- **WHEN** the tip enters proximity (≤ 14 × scale px) of any sampled
  point on a dashed bezier curve
- **THEN** a spark particle is spawned at the contact midpoint (subject
  to a 0.5 s per-(tentacle, path) cooldown), drawn additively with a
  hot-white core, an indigo halo expanding from 4 to 20 px, and 4–5
  deterministic crackle filaments, fading to nothing within 360–600 ms

#### Scenario: Backdrop adapts to performance via dynamic DPR

- **GIVEN** the kraken canvas is animating
- **WHEN** the rolling 60-frame FPS average drops below 30
- **THEN** the device-pixel-ratio is reduced by 0.25 (down to a 0.5
  floor), the offscreen layers are rebuilt at the new resolution, and a
  3-second cooldown prevents oscillation; window resize resets the DPR
  to its initial value

#### Scenario: Reduced-motion users see no canvas animation

- **GIVEN** a visitor with `prefers-reduced-motion: reduce`
- **WHEN** the kraken canvas is rendered
- **THEN** the canvas opacity is forced to 0 via CSS (`@media
  (prefers-reduced-motion: reduce) { .kraken-backdrop canvas {
  opacity: 0 !important; } }`) and no `requestAnimationFrame` loop is
  scheduled

#### Scenario: Brain image is host-resolved and luminance-keyed

- **GIVEN** the kraken backdrop initialises
- **WHEN** the brain PNG (`<BASE_URL>/kraken-brain.png`) loads
- **THEN** the renderer walks the pixel buffer once setting
  `r=g=b=alpha=max(r,g,b)` so the brain is a pure greyscale silhouette,
  and a radial colormap from `--kb-brain-1` → `--kb-brain-2` →
  `--kb-brain-3` is composited via `source-in` so the brain colour is
  100 % theme-token-driven

### Requirement: Scroll-triggered reveal animations

Cards, section headings, and key content blocks SHALL animate into view
when they enter the viewport, with staggered timing and reduced-motion
support.

#### Scenario: Elements reveal on first intersection

- **GIVEN** any element tagged with `data-reveal`
- **WHEN** the user scrolls and the element crosses into the viewport
- **THEN** the `.is-visible` class is added and a 700 ms CSS transition
  runs (opacity, translate, scale, blur) to bring it in

#### Scenario: Reveals do not re-fire on scroll-back

- **GIVEN** an element that has already been revealed
- **WHEN** the user scrolls it out of and back into the viewport
- **THEN** the observer does not re-observe the element and the element
  remains statically visible

#### Scenario: Reduced-motion users see no animation

- **GIVEN** a visitor with `prefers-reduced-motion: reduce`
- **WHEN** the page loads
- **THEN** every `[data-reveal]` element is visible immediately with no
  transform, blur, or transition

### Requirement: Playwright screenshot pipeline

The repository SHALL provide a scripted, re-runnable screenshot pipeline that captures every feature panel at desktop and mobile viewports.

#### Scenario: Pipeline runs end-to-end from a single command

- **GIVEN** a developer has installed dependencies in `/site`
- **WHEN** they run `npm run screenshots` from the repo root
- **THEN** the script starts a temporary dashboard server with a temp HOME, seeds it with demo fixtures, opens every route at each viewport with Playwright, writes PNGs to `site/public/screenshots/{desktop,mobile}/`, and shuts down the server

#### Scenario: Demo data is injected via existing REST or on-disk session files

- **GIVEN** the seeding step of the pipeline
- **WHEN** fixtures are applied
- **THEN** no new server-only flag or code path is required; all seeding uses existing REST endpoints or direct writes to `~/.pi/agent/sessions/` within the temp HOME

#### Scenario: Screenshots cover all named routes

- **GIVEN** the routes listed in `design.md`'s screenshot table
- **WHEN** the pipeline finishes
- **THEN** every listed route has a PNG at the expected path under `site/public/screenshots/`, at the declared viewport dimensions

### Requirement: Latest-release surface with auto-sync

The site SHALL prominently surface the latest published GitHub release
(version tag, publish date, per-platform downloads) and keep that
surface in sync without manual editing.

#### Scenario: Download section renders per-platform cards

- **GIVEN** a successful build with at least a cached release in
  `site/src/data/latest-release.json`
- **WHEN** the rendered page is inspected
- **THEN** there is a `#download` section that shows the release tag,
  publish date, links to release notes and the releases index, and three
  platform cards (macOS / Linux / Windows), each with a primary download
  button sized by the classifier (DMG for macOS, AppImage for Linux,
  Installer .exe for Windows) and any additional assets tucked into a
  collapsible “Other downloads” accordion

#### Scenario: Hero CTA reflects the current version

- **GIVEN** a successful build with a resolved release
- **WHEN** the hero renders
- **THEN** its primary CTA label is “Download <tag> →” and its href is
  the in-page anchor `#download`

#### Scenario: Build survives API outage via committed cache

- **GIVEN** the GitHub API is unreachable (timeout, 403, or 5xx)
- **WHEN** the site builds
- **THEN** `github-release.ts` falls back to
  `site/src/data/latest-release.json` and the Download section still
  renders the last known release with no HTML difference to the visitor

#### Scenario: Release publish updates the committed cache

- **GIVEN** a maintainer publishes a new GitHub release
- **WHEN** the `sync-release-version` workflow runs
- **THEN** it writes the latest release metadata to
  `site/src/data/latest-release.json` and, if the content changed,
  commits the file back to `main` with a message of the form
  `chore(site): sync latest-release.json to <tag>`

#### Scenario: Release event rebuilds and redeploys the site

- **GIVEN** the deploy-site workflow
- **WHEN** a GitHub release is published
- **THEN** the workflow runs via its `release: { types: [published] }`
  trigger, builds the site with fresh release data, and publishes via
  `actions/deploy-pages@v4`

### Requirement: GitHub Pages deployment via GitHub Actions

The repository SHALL deploy the marketing site to GitHub Pages using the modern `actions/deploy-pages` workflow, without using a `gh-pages` branch.

#### Scenario: Deploy workflow triggers on site changes

- **GIVEN** a commit to `main` that modifies any file under `site/**` or the deploy workflow itself
- **WHEN** the workflow runs
- **THEN** it builds the site, uploads the output as a Pages artifact, and deploys it via `actions/deploy-pages`

#### Scenario: Deploy workflow can be run manually

- **GIVEN** a maintainer needs to redeploy without a source change
- **WHEN** they trigger `workflow_dispatch` on the site-deploy workflow
- **THEN** the workflow runs to completion and publishes the current `main` content

#### Scenario: Custom-domain ready but not active

- **GIVEN** the site at v1 is served from `username.github.io/pi-agent-dashboard`
- **WHEN** a maintainer later acquires `pi-dashboard.dev`
- **THEN** the swap requires only adding a `site/public/CNAME` file and DNS records — no workflow or build changes

### Requirement: Performance and accessibility budgets

The site SHALL ship minimal JavaScript and meet accessibility baselines.

#### Scenario: JavaScript bundle budget

- **GIVEN** a successful site build
- **WHEN** the total gzipped size of `site/dist/**/*.js` is measured
- **THEN** it does not exceed 50 KB

#### Scenario: Lighthouse mobile targets

- **GIVEN** a Lighthouse mobile audit of the deployed site
- **WHEN** the audit completes
- **THEN** Performance, Accessibility, Best Practices, and SEO each score at least 95
