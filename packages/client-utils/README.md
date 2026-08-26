# Pi Dashboard Client Utils

Small reusable React components, hooks, and helpers shared between the Pi Dashboard
shell and dashboard plugins.

## Install

```bash
npm install @blackbelt-technology/pi-dashboard-client-utils
```

Every entry is its own subpath export, so you pull in only what you use:

```ts
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { useMobile } from "@blackbelt-technology/pi-dashboard-client-utils/useMobile";
```

Includes portals and an escape-stack, popover/dialog/confirm primitives, a focus
trap, zoom/pan helpers, status presentation, and extension-UI slots. No markdown
stack — that stays in the shell.

## License

MIT — part of [pi-agent-dashboard](https://github.com/BlackBeltTechnology/pi-agent-dashboard).
