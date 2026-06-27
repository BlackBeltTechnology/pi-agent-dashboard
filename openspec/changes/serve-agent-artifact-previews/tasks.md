## 1. Artifact-root allowlist

- [ ] 1.1 Add `packages/server/src/lib/artifact-roots.ts` exporting `artifactRoots(): string[]` — realpath of `path.join(os.homedir(), ".agent-browser", "tmp")` AND `process.env.AGENT_BROWSER_SCREENSHOT_DIR` when set (the env var `agent-browser` itself honors — NOT `AGENT_BROWSER_TMP`); cached; drop entries whose realpath throws (missing dir). Note in the doc-comment: `--screenshot-dir` CLI flag is uncovered (A1, best-effort).
- [ ] 1.2 Export `IMAGE_EXTS` (or reuse the client's set server-side) for the layer-③ image gate.

## 2. Wire the artifact anchor into `/api/file/raw`

- [ ] 2.1 In `/api/file/raw`, keep the session-cwd gate (`allSessions.some(s => s.cwd === cwd)`) and the cwd/git-root containment (layers ①/②).
- [ ] 2.2 Add layer ③: if not allowed by ①/②, allow when `realpath(resolved)` is within any `artifactRoots()` entry AND `IMAGE_EXTS.has(ext)`. **A realpath/ENOENT failure here SHALL be caught and treated as "not contained" (fall through), so a missing/deleted artifact yields the normal 404 from `fs.stat`, not a 500 (A3, D7).** Reject otherwise with the unchanged `"path outside working directory"`.
- [ ] 2.3 Do NOT add the artifact anchor to `/api/file` or `/api/file/render`.

## 3. Tests

- [ ] 3.1 New `file-artifact-serving.test.ts`: (a) image under the artifact root → 200 with image content-type; (b) non-image file under the artifact root → 403; (c) `..`/symlink escaping the artifact root → 403; (d) path outside cwd AND outside artifact root → 403; (e) missing artifact root dir → behaves as no extra anchor (cwd-only); (f) **deleted image whose path is inside the artifact root → 404 `"not found"`, NOT 500 (A3).**
- [ ] 3.2 Confirm `/api/file` and `/api/file/render` still reject artifact-root paths (anchor not leaked to them).
- [ ] 3.3 `npm test 2>&1 | tee /tmp/pi-test.log` green; `grep -nE 'FAIL|Error|✗' /tmp/pi-test.log` empty.

## 4. Dependency note

- [ ] 4.1 If `git-root-file-containment` has landed, route layer ③ through its `isAllowed(resolved, { anchors })` helper by passing artifact roots as anchors + the image predicate; otherwise inline the layered check and reconcile when that change merges.
