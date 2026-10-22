# cwd-verdict.ts — index

`resolveCwdVerdict(cwd, resolution, {known, rerunAlways?})`: the ONE post-verdict `cwd`-plane re-run (real path now, exists, `.git`/ungrantable, canonical sessions∪pins; allow-always re-runs full guard; allow-once needs real path == verdict subject). `createCwdHold(deps)` builds per-plugin `holdCwdDenial`: trusted gate, closed origin set, never prompts for missing/`.git`/ungrantable, returns a decision not a token. See change: harden-plugin-cwd-admission.

Known set now includes workspace folders. `rerunAlways` of the file-exists site is `admitRouteCwd` (releases its token). See change: core-file-cwd-admission.
