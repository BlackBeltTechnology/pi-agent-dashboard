# release-revoke/SKILL.md — index

`release-revoke` skill. Reverts a release: deletes GitHub Release, removes git tag (local + origin), `npm deprecate`s the version (never unpublish), optionally `git revert`s the `chore(release): vX.Y.Z` commit. Each step gated by AskUserQuestion.
