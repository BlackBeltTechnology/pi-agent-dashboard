# DOX — packages/untrusted-content-guard

Files in this directory. One row per file. See change: add-untrusted-content-guard.

| File | Purpose |
|------|---------|
| `README.md` | Package docs. Settings table (`untrusted-content-guard` key; project layer only when trusted), per-layer threat model, detection limits (visible text, file-borne taint gap), tool self-declaration (`details.untrusted` + `Symbol.for("pi.untrusted-content-guard")` registry), attribution. |
| `package.json` | `@blackbelt-technology/pi-untrusted-content-guard`. `pi.extensions: ["src/extension.ts"]`, `pi-package` keyword. Sole runtime dep `htmlparser2`. Listed in `.github/workflows/publish.yml` allowlist. |
| `tsconfig.json` | Extends `../../tsconfig.base.json`; `rootDir: src`. |
| `vitest.config.ts` | Package vitest config (registered in root `vitest.config.ts` `test.projects`). node env, forks, `maxWorkers: PARALLEL_MAX_WORKERS` (shared target; required — a default differs from sibling projects and aborts the root run), 30 s timeout (P1 perf). |
