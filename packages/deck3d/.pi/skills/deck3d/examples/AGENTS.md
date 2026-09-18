# DOX — packages/deck3d/.pi/skills/deck3d/examples

Worked example proving the tune loop (change: add-deck3d-presentation-package).

| File | Purpose |
|------|---------|
| `AGENTS.md` | This file. |
| `fixture.md` | Two-slide Markdown deck (`flowchart LR` with a `{{LLM}}` node). |
| `deck.json` | Parsed IR with three overrides: `slides["agens-munkafolyamat"].mode = light`, `nodes["agens-munkafolyamat/L"].shape = diamond`, and a vendored `brain` prop with `role: node:L`. `parse` reproduces it byte-for-byte. |
| `snapshot-before.png` | Slide 1 before the overrides (dark mode, hexagon LLM node). |
| `snapshot-after.png` | Slide 1 after the overrides (light mode, diamond LLM node). |
