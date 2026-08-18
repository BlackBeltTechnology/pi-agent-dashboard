# Fix command injection via workspace path in tmux session spawn

## Why

`buildTmuxCommand` (`packages/server/src/spawn-process/process-manager.ts`) builds a **shell string** and `spawnTmux` executes it with `execSync`:

```
tmux new-window -t pi-dashboard -c <cwd> "cd <cwd> && pi <flags>"
```

The inner command is interpolated into a **double-quoted** segment. `shellEscape` (same file) defends by wrapping values in single quotes — which is inert inside a double-quoted context: `/bin/sh` still performs command substitution (`$(…)`, backticks) and variable expansion (`$VAR`) there.

So a workspace whose absolute path contains a command substitution executes that substitution when a session is spawned into it. `cd ${safeCwd}` sits inside the quoted segment, so the escaping applied to it does not prevent this.

Reachability: spawning a tmux session for a given directory. Directories reach the dashboard through workspace configuration, `PI_WORKSPACES`, the path picker, and directory scanning — so the attacker-controlled input is "a directory that exists on disk with a crafted name", not a value the user types deliberately. `tmux` is the **default** mechanism on macOS and Linux (`selectMechanism`), so this is the common path, not an exotic one.

This is a pre-existing defect in shipped code. It is filed separately from the feature that fixes it so it is visible as a security fix rather than buried in a feature changelog.

## What Changes

- **`buildTmuxCommand` returns an argv array instead of a shell string.** The dashboard-side shell disappears, so the workspace path travels as a literal `-c <cwd>` argv element.
- **The redundant `cd <cwd> &&` prefix is dropped.** tmux's own `-c` flag already sets the pane's working directory. Removing the prefix is what actually closes this vulnerability — it is the only reason the path was inside the quoted pane command at all.
- **`spawnTmux` invokes the argv without a shell**, replacing the `execSync(cmd)` call.
- **`shellEscape` is RETAINED for the pane command.** tmux executes the `shell-command` argument through a shell of its own, so values interpolated into it (session flags, and the pi invocation once `select-pi-runtime-install` lands) must still be escaped — now in a clean context with no enclosing double quotes, where single-quoting is sound. An earlier draft of this proposal called for removing `shellEscape` from this path; that would have left flag values shell-interpreted inside the pane and is explicitly rejected.
- **`spawnWslTmux` is converted with it**, taking the pi invocation as a parameter so it can keep resolving `pi` inside the WSL namespace rather than embedding a host path.
- **The WSL path loses its own two shell layers.** `buildSafeArgv("wsl", …)` routes an
  *extensionless* command through `cmd.exe /d /s /c` on win32 (`packages/shared/src/platform/exec.ts`),
  cmd.exe expands `%VAR%` even inside double quotes, and treats `&` / `|` as
  separators in every *unquoted* segment — which is what `shellEscape`'s
  single-quoted output is, to cmd.exe. Bare `wsl <cmd>` then runs the command
  through WSL's default shell. The spelling becomes
  `buildSafeArgv("wsl.exe", …)` (an extension bypasses the cmd.exe branch) and the
  tmux argv is passed after `--exec`, which skips the WSL shell. Without this the
  Requirement below — which names the WSL-tmux mechanism — would not be met.
- **Regression test**: spawning into a directory whose name contains `$(…)`, backticks, `;`, quotes and spaces creates the session with the literal directory name and executes nothing extra; a session flag containing the same metacharacters reaches pi as one literal argument.

## Discipline Skills

- `security-hardening` — the change is a command-injection fix on an
  attacker-influenced input reaching a shell.
- `review-code` — non-trivial change to a shipped spawn path; review before commit.

## Capabilities

### Modified Capabilities

- `session-spawn`: adds the Requirement that tmux session spawning performs no shell interpretation of the workspace path.

## Impact

- **Fix vehicle**: **this change owns the argv conversion.** An earlier draft deferred it
  to `select-pi-runtime-install` (design D9), whose `tasks.md` 4.1/4.5 and migration
  step 3 still describe the same conversion — that duplication is resolved in this
  direction so a security fix is not gated on a feature. `select-pi-runtime-install`
  becomes a **dependant**: once this lands, its tmux work reduces to passing the
  registry-resolved argv into the `piInvocation` parameter introduced here. Updating
  that change's artifacts is a separate follow-up, not part of this change.
- **Behavioural change**: `buildTmuxCommand`'s return type changes from `string` to `string[]` and it gains a pi-invocation parameter; its existing tests in `packages/server/src/__tests__/process-manager.test.ts` assert on the returned string and are updated with it. Both call sites (`spawnTmux`, `spawnWslTmux`) change.

- **Two shell layers, only one removed**: the dashboard-side `execSync` shell is eliminated; tmux's own pane shell remains by design and is handled by escaping, not by removal. Conflating the two in either direction produces a wrong fix — this is recorded because both wrong versions were drafted before this one.
- **No change to which binary runs** — that is `select-pi-runtime-install`'s concern. This change alters only how the command is constructed and executed.
- **Out of scope**: auditing other `execSync` shell-string builders in the server for the same pattern. Worth doing; not folded in here to keep the fix reviewable.
