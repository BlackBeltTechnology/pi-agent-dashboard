# i18n Audit — Hooks

## Summary

| Metric | Count |
|--------|-------|
| **Total untranslated strings** | **37** |
| **Files affected** | **14** |
| **Files with `import { t }` from i18n** | **0 / 53** |
| **Files with `i18nT` usage** | **0 / 53** |

Every affected file has **zero** i18n imports. Strings are set via `setError()`, `throw new Error()`, or direct state assignment — all raw English, all reachable by users as toast/status/error text.

---

## Untranslated Strings Table

| file:line | category | string | fileHasI18nImport |
|---|---|---|---|
| `useInstalledPackages.ts:23` | error | `"Failed to fetch installed packages"` | no |
| `useInstalledPackages.ts:27` | error | `"Network error"` | no |
| `usePiCoreVersions.ts:38` | error | `"Failed to fetch pi core versions"` | no |
| `usePiCoreVersions.ts:42` | error | `"Network error"` | no |
| `useMainSpecsReader.ts:7` | error | `"Failed to fetch directory"` | no |
| `useMainSpecsReader.ts:8` | error | `"Expected a directory"` | no |
| `useMainSpecsReader.ts:15` | error | `"Failed to fetch file"` | no |
| `useMainSpecsReader.ts:16` | error | `"Expected a file"` | no |
| `useMainSpecsReader.ts:65` | other | `"*No specs found.*"` | no |
| `useMainSpecsReader.ts:72` | error | `"Failed to load specs"` | no |
| `useToolFullResult.ts:32` | error | `"result evicted"` | no |
| `useToolFullResult.ts:32` | error | `"failed to load full output"` | no |
| `useToolFullResult.ts:38` | error | `"failed to load full output"` | no |
| `usePackageSearch.ts:38` | error | `"Search failed"` | no |
| `usePackageSearch.ts:42` | error | `"Network error"` | no |
| `useSessionDiff.ts:30` | error | `"Unknown error"` | no |
| `useSessionDiff.ts:33` | error | `"Failed to fetch diff data"` | no |
| `useRecommendedExtensions.ts:35` | error | `"Failed to fetch recommended extensions"` | no |
| `useRecommendedExtensions.ts:39` | error | `"Network error"` | no |
| `useArchiveListing.ts:28` | error | `"Failed to fetch archive"` | no |
| `useArchiveListing.ts:36` | error | `"Failed to fetch archive"` | no |
| `useOpenSpecReader.ts:38` | error | `"Failed to fetch file"` | no |
| `useOpenSpecReader.ts:39` | error | `"Expected a file"` | no |
| `useOpenSpecReader.ts:46` | error | `"Failed to fetch directory"` | no |
| `useOpenSpecReader.ts:47` | error | `"Expected a directory"` | no |
| `useOpenSpecReader.ts:113` | error | `"Failed to load"` | no |
| `usePiResources.ts:35` | error | `"Failed to fetch pi resources"` | no |
| `usePiResources.ts:39` | error | `"Network error"` | no |
| `useMessageHandler.ts:673` | error | `"Resume failed"` | no |
| `useMessageHandler.ts:691` | status | `"Started a fresh session."` | no |
| `useMessageHandler.ts:711` | error | `"+Session failed"` | no |
| `useMessageHandler.ts:758` | error | `"SPAWN_ERROR"` | no |
| `useAsyncAction.ts:52` | toast | `"Still working in the background…"` | no |
| `useImagePaste.ts:100` | toast | `` `Unsupported image type: ${mimeType}. Use JPEG, PNG, GIF, or WebP.` `` | no |
| `useImagePaste.ts:139` | toast | `` `Unsupported image type: ${file.type \|\| "unknown"}. Use JPEG, PNG, GIF, or WebP.` `` | no |
| `useImagePaste.ts:111` | toast | `"Image too large (max 10MB)"` | no |
| `useImagePaste.ts:116` | toast | `"Failed to read image"` | no |

---

## Pattern Taxonomy

| Pattern | Occurrences | Files |
|---|---|---|
| `setError(body.error ?? "...")` | 11 | useInstalledPackages, usePiCoreVersions, useMainSpecsReader, usePackageSearch, useSessionDiff, useRecommendedExtensions, useArchiveListing, useOpenSpecReader, usePiResources |
| `setError(err.message ?? "...")` | 9 | useInstalledPackages, usePiCoreVersions, usePackageSearch, useSessionDiff, useRecommendedExtensions, useArchiveListing, useOpenSpecReader, usePiResources |
| `throw new Error("...")` | 8 | useMainSpecsReader, useOpenSpecReader |
| `setSpawnResult({ message: msg.message ?? "..." })` | 2 | useMessageHandler |
| `setResumeErrors(... msg.message ?? "...")` | 1 | useMessageHandler |
| `setImageError("...")` | 4 | useImagePaste (1 template + 1 literal × 2 variants each) |
| Direct const assignment | 2 | useAsyncAction (`STILL_WORKING`), useMessageHandler (`"+Session failed"`) |
| Error code literal | 1 | useMessageHandler (`"SPAWN_ERROR"`) |

---

## How to Fix

Two approaches, additive:

### A) Import `t()` in each file
```ts
import { t } from "../lib/i18n.js";
```
Then wrap every string:
```ts
setError(body.error ?? t("hook.installedPackages.fetchFailed", undefined, "Failed to fetch installed packages"));
```

### B) Add an `i18nT()` re-export (already used in components)
If the hook runs inside React, use `useI18n()`. For mount-effect hooks, use the standalone `t()`.

Note: `useAsyncAction.ts` needs special treatment — it defines a module-level constant `STILL_WORKING` used as default in the WS fallback. Either import `t()` at module level or accept it via `opts.stillWorkingToast`.
