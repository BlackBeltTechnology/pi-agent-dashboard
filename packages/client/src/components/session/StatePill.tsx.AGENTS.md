# StatePill.tsx — index

Color-coded OpenSpec ChangeState pill (`PLANNING`=zinc, `READY`=blue, `IMPLEMENTING`=amber, `COMPLETE`=green) rendered next to `📋 <name>` badge. Hidden when attached change absent from OpenSpec data. `[data-theme="light"] [data-testid="state-pill"][data-state="…"]` overrides in `index.css` swap fg to 700-shade per state with slightly stronger tint for AA contrast on `--bg-tertiary`. See change: light-mode-pill-contrast.
