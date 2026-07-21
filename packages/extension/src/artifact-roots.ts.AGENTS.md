# artifact-roots.ts — index

Artifact-root allowlist for Fix B bridge image inlining. `resolveArtifactRoots({homedir,env,realpathSync})` → realpath'd roots: `~/.agent-browser/tmp` + `AGENT_BROWSER_SCREENSHOT_DIR`. `isUnderArtifactRoot(absPath,roots,realpathSync)` → realpath containment check, rejects symlink escapes + missing files. Pure; fs/env injected. Gates inlining so tools cannot disclose arbitrary local images by echoing paths. See change: inline-agent-screenshot-artifacts.
