---
name: jj-workspace-fold-back
description: >
  Fold the current jj workspace's commits back onto trunk and push them
  via `jj git push --bookmark`. NEVER invokes `git commit`, `git merge`,
  or any other mutating git command. Default flavor preserves the agent's
  commit history (no squash) and pushes to a feature bookmark. Refuses to
  run on conflicts, dirty git index, empty working copy, or non-colocated
  repos. Use when: an agent has finished work in a `.shadow/<name>/`
  workspace and wants to land the changes on trunk; user says "fold back",
  "merge workspace", "ship the agent's work", "push the workspace", "land
  the changes".
license: MIT
metadata:
  source: pi-agent-dashboard / add-jj-workspace-plugin
  version: "1.0"
---

# Fold a jj workspace back onto trunk

> ⚠️ **This skill never invokes `git commit` or `git merge`.**
> A new commit appears on `main` (or the target trunk bookmark) because
> `jj git push` translates jj history into git refs. The result is identical
> to a normal git commit — but the operation that produced it is jj-native
> and safe in colocated repos.

## When to use this

Only run this skill when:

- The current cwd is a jj workspace (typically `.shadow/<name>/`).
- The parent repo is **jj-colocated** (`.jj/` and `.git/` side by side at the repo root).
- The agent has finished its work and you want it on trunk.

If any of those are wrong, stop and address that first.

## Refusal preconditions (the skill checks all four)

```bash
# 1. Repo must be jj-colocated
test -d .jj && test -d "$(jj workspace root)/.git" || \
  { echo "Not a jj-colocated repo. Aborting."; exit 1; }

# 2. No unresolved conflicts
[ -z "$(jj resolve --list 2>/dev/null)" ] || \
  { echo "Unresolved conflicts. Run 'jj resolve' first."; exit 1; }

# 3. Working copy must not be empty
[ -n "$(jj diff -r @ 2>/dev/null)" ] || \
  { echo "Working copy is empty. Nothing to fold back."; exit 1; }

# 4. Git index must be clean (see "Why dirty index is fatal" below)
git diff --cached --quiet || \
  { echo "Git index is dirty. See refusal message below."; exit 1; }
```

### Why a dirty git index is fatal here

The git index is invisible to jj — jj has no concept of staging. If `jj
rebase` runs while the index has staged blobs, the rebase silently leaves
those blobs pointing at content that no longer matches any commit jj knows
about. The user later runs `git commit` (instinctively, to "include" their
staged work) and creates a git-only commit that jj has never seen,
bifurcating history.

When you encounter a dirty index, **do not auto-fix it**. Tell the user:

```
The git index has staged changes. In a jj-colocated repo, the staging
area is invisible to jj — staged content cannot be folded back. Pick one:

  ❌ Don't:  git stash         (forbidden — corrupts jj history)

  ✓  Safe:   git reset         Clears the index. Files on disk are
                               untouched. jj's view is unchanged because
                               jj never reads the index.

  ✓  jj way: jj new -m "WIP"   Set the current work aside as a real
                               jj change. Then start fresh on top.
                               (`jj edit <change-id>` returns to it later.)
```

Then exit the skill. Re-invoke after the user has resolved it.

## Default flavor: preserve commit history

This is the default and what the dashboard's "Fold back" button invokes
unless the user explicitly chooses another mode.

```bash
WORKSPACE_NAME="$(basename "$(pwd)")"   # e.g. "agent-1"
TRUNK="$(jj log -r 'trunk()' -T 'change_id.short()' --no-graph --limit 1 --no-pager)"
TRUNK_BOOKMARK="$(jj bookmark list -T 'name ++ \"\\n\"' --no-pager | grep -E '^(main|master|trunk)$' | head -1)"

# Step 1: capture pre-rebase op id so we can roll back on conflict
PRE_OP="$(jj op log -T 'id.short() ++ \"\\n\"' --limit 1 --no-pager | head -1)"

# Step 2: bookmark the workspace tip with the workspace's own name
#         (Decision 13: bookmark name == workspace name verbatim)
if jj bookmark list -T 'name ++ "\n"' --no-pager | grep -qx "$WORKSPACE_NAME"; then
  echo "Bookmark '$WORKSPACE_NAME' already exists. Refusing to clobber."
  exit 1
fi
jj bookmark create "$WORKSPACE_NAME" -r @

# Step 3: rebase the workspace onto trunk
if ! jj rebase -d "$TRUNK_BOOKMARK" -s "$WORKSPACE_NAME"; then
  echo "Rebase failed. Restoring pre-rebase state."
  jj op restore "$PRE_OP"
  exit 1
fi

# Step 4: check for conflicts after rebase
if [ -n "$(jj resolve --list)" ]; then
  echo "Rebase produced conflicts. Restoring pre-rebase state."
  echo "Files with conflicts:"
  jj resolve --list
  jj op restore "$PRE_OP"
  exit 1
fi

# Step 5: push via jj (the only git-touching operation in this skill)
jj git push --bookmark "$WORKSPACE_NAME"
echo "Folded back '$WORKSPACE_NAME' onto $TRUNK_BOOKMARK and pushed."
```

## Optional flavor: squash to one commit (`mode: squash`)

Use only when the user explicitly requests it. Loses intermediate history.

```bash
# After Step 2 (bookmark created), but before Step 3:
jj new -A "$TRUNK_BOOKMARK" -m "$(jj log -r '@-' -T 'description' --no-graph --no-pager --limit 1)"
jj squash --from "$WORKSPACE_NAME..@-"
jj git push --bookmark "$WORKSPACE_NAME"
```

## Optional flavor: open a PR instead (`mode: pr`)

Requires the `gh` CLI installed and authenticated.

```bash
jj git push --bookmark "$WORKSPACE_NAME"
gh pr create --base "$TRUNK_BOOKMARK" --head "$WORKSPACE_NAME" \
  --title "$(jj log -r @ -T 'description.first_line()' --no-graph --no-pager --limit 1)" \
  --body "Folded back from jj workspace $WORKSPACE_NAME"
```

## Direct trunk push is gated by config

If the user asks to push directly to `main` / `master` / `trunk`,
check the plugin config first:

```bash
ALLOW_DIRECT="$(jq -r '.plugins.jj.allowDirectTrunkPush // false' "$HOME/.pi/dashboard/config.json")"
if [ "$ALLOW_DIRECT" != "true" ] && echo "$WORKSPACE_NAME" | grep -qE '^(main|master|trunk)$'; then
  echo "Direct trunk push is disabled (allowDirectTrunkPush=false)."
  echo "Use a feature bookmark instead, or enable in plugin settings."
  exit 1
fi
```

## After successful fold-back

The agent's commits are now on the remote. The workspace can be cleaned up
via the dashboard's "Forget workspace" button (which refuses if there's
still unfolded work) or:

```bash
jj workspace forget "$WORKSPACE_NAME"
rm -rf "$(jj workspace root)/.shadow/$WORKSPACE_NAME"
```

## Recovery

`jj op restore <op-id>` undoes any operation. `jj op log` lists recent
operations with their ids. If anything goes wrong, op restore is the
escape hatch.
