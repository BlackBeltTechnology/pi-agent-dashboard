# judo-modules: the two helper script sketches (documentation only)

Documentation for `judo-modules.md`, a judo-ng-style per-module team template (one teammate per Maven
module, in rank order). **Documentation only:** the plugin never scans, lists or starts anything under
`examples/` (`GET …/templates` does not show `judo-modules`), and it does not execute, install or reference the
scripts below. The template uses only the template features of the templates-hooks change (`spawn: lead`,
`autoDispatch: false`, a `TaskCompleted` hook) and no code of this plugin.

## Use it

1. Copy `judo-modules.md` to `<project>/.pi/teams/judo-modules.md` of a trusted project. The first start asks
   you to confirm its hook (see the README "Hooks" section).
2. Copy the two scripts below into the consuming repository as `scripts/verify-module.sh` and
   `scripts/team-verify-stamp.sh`, adapt the build command and the module layout, and make them executable.

## How it works

- Rank -> `blockedBy` is done by the lead from the playbook (the module rank is the roster order).
- A `TaskCompleted` hook may run only for the shared op-gate budget (12 s by default), so it cannot run
  `mvn verify`. The pattern is a verification **stamp**: the teammate runs `scripts/verify-module.sh <module>`
  in its own turn; the script runs the build and writes `<module>/target/.team-verify` with the hash of the
  module tree. The hook only compares that stamp with the current tree hash and exits 2 ("run
  scripts/verify-module.sh") when the stamp is missing or stale; the teammate verifies and completes again.
- Teammates run in the lead's cwd (one shared checkout) and never commit; the lead is the only committer.

## `scripts/verify-module.sh` (run by the teammate, in its own turn)

```bash
#!/usr/bin/env bash
# Usage: scripts/verify-module.sh <module>
# Runs the module build and, only when it passes, records the tree hash it verified.
set -euo pipefail
module="${1:?usage: verify-module.sh <module>}"
root="$(git rev-parse --show-toplevel)"
dir="$root/$module"
[[ "$module" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || { echo "not a module name: $module" >&2; exit 64; }
[ -d "$dir" ] || { echo "no such module: $module" >&2; exit 64; }

# The same hash the hook computes: tracked + untracked-but-not-ignored files of the module.
tree_hash() {
  (cd "$dir" && git ls-files -co --exclude-standard -z | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)
}

before="$(tree_hash)"
(cd "$root" && mvn -q -pl "$module" -am verify)
after="$(tree_hash)"
# A file that changed while the build ran invalidates the verification.
[ "$before" = "$after" ] || { echo "module changed during verification; run again" >&2; exit 1; }

mkdir -p "$dir/target"
printf '%s\n' "$after" > "$dir/target/.team-verify"
echo "verified $module ($after)"
```

## `scripts/team-verify-stamp.sh` (the `TaskCompleted` hook; fast, no build)

The hook receives the event JSON on stdin. Exit 0 allows the completion; exit 2 blocks it and stderr is
returned to the teammate as feedback.

```bash
#!/usr/bin/env bash
# Allows a task completion only when the module's verification stamp matches the current tree.
set -uo pipefail
event="$(cat)"
module="$(printf '%s' "$event" | jq -r '.task.title // empty')"   # the task is titled `<module>`
[[ "$module" =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ ]] || exit 0         # not a module task: nothing to check
root="$(git rev-parse --show-toplevel)"
dir="$root/$module"
[ -d "$dir" ] || exit 0

stamp="$dir/target/.team-verify"
current="$(cd "$dir" && git ls-files -co --exclude-standard -z | sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -d' ' -f1)"
if [ ! -f "$stamp" ] || [ "$(cat "$stamp")" != "$current" ]; then
  echo "module $module is not verified for its current files: run scripts/verify-module.sh $module, then complete the task again" >&2
  exit 2
fi
exit 0
```
