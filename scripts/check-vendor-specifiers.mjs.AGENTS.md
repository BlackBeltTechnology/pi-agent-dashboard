# check-vendor-specifiers.mjs — index

Static specifier guard for the vendored relay, run by the ship gate + CI.

Every import under `relay/vendor/` must resolve from the published package alone: a Node builtin, a dependency declared in `packages/browser-plugin/package.json`, or a `./`/`../` relative path. Absolute paths and non-`node:` schemes (`file:`, `https:`) are rejected — the spec allows none of them. Anything else resolves only through a monorepo-only alias layer.

WHY NOT A NAMESPACE ALLOWLIST. The old design resolved `@isomorphic/*` / `@utils/wsServer` through tsconfig `paths`. A guard rejecting exactly those prefixes would pass a future upstream refresh introducing `@protocol/` or `@injected/` — a new instance of the same bug. This asks the real question: builtin or declared dependency?

SCOPE is all of `relay/vendor/`, not just `playwright-core/`, because the rewritten imports resolve INTO `shims/`. It parses import syntax (static `import` + dynamic `import()` / `require()`), never greps text — `NOTICE` and `AGENTS.md` legitimately name the old specifiers in prose.

Also catches a refresh that re-copied upstream and skipped the patch script (X4).

Exports `checkVendorSpecifiers`, `declaredDependencies`, `dynamicSpecifiers`, `isLocalRelative`, `packageNameOf`, `BUILTINS`, `PLUGIN_PKG_REL`, `REPO_ROOT`, `VENDOR_REL`. Exit non-zero naming every offending file + specifier.

See change: fix-browser-plugin-vendor-specifier-resolution (D4.2).
