# ui-plan — restyle-inline-terminal-button

| Surface | Tokens | States |
|---|---|---|
| Settings-row terminal chip | `--border-secondary` border, `--text-tertiary` fg, `--bg-hover` hover bg, `--text-primary` hover fg, `--focus-ring` outline | default · hover · focus-visible · disabled (opacity .5) |
| Input row | unchanged (`--bg-tertiary` card, `--accent-solid` Send) | — |

Geometry: 30 px high, `rounded-lg`, `px-2`, `gap-1`, icon `size 0.55`, `text-[11px]` — same as `delivery-control`.
Verified in mockup: Base dark, Base light, Dracula dark; 760 px and 380 px containers.
