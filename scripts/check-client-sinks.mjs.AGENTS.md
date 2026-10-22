# check-client-sinks.mjs — index

Client sink guard, run by ci.yml (`Client sink guard` step) + the ship-it 4.4 gate. Parses browser-side source with the TypeScript compiler (comments / strings never match). Roots: `packages/client/src`, `packages/client-utils/src`, `packages/*-plugin/src/client`, `packages/dashboard-plugin-runtime/src` (minus `src/server/**`), `packages/team-app/src`; tests skipped.

Rule sets: `nav` — `window.open(`, `location.assign/replace(`, `location =`, `.href/.src/.action =`, `setAttribute("href"|"src"|"action")`, JSX `href={expr}` on intrinsic `<a>`; `html` — `dangerouslySetInnerHTML`, `srcDoc`/`srcdoc`, `.innerHTML/.outerHTML/.srcdoc =`, `insertAdjacentHTML`, `document.write`, `createContextualFragment`, `setHTMLUnsafe`, `eval(`, `new Function/Worker/SharedWorker(`, and a wrap-only policy-helper import (`trustedMermaidParse` → MermaidBlock only, `trustedStaticSvg` → team-app `ui/icons.tsx` only).

File allowlist: `lib/nav/safe-navigation.tsx`, `lib/security/trusted-types.ts`, runtime `src/safe-navigation.tsx`. Per-line exemption `// client-sinks: allow — <reason>` (or `{/* … */}`) directly above; a reason-less annotation is itself a violation. CLI `[--rules nav,html] [--report] [root]`; exit non-zero iff ≥1 violation. Exports `analyzeClientSinks(root, {ruleSets})`, `RULE_SETS`, `REPO_ROOT`. See change: harden-client-sinks.
