# Security review — widen-containment-to-resolved-checkout

`security-hardening` pass over the WIDENING (task 1.2). Enumerates, per git state,
what becomes readable and what MUST stay unreadable. This list IS the parameter
table for tasks 4.2–4.7 (test ids in parentheses).

`<C>` = the state's own checkout, `<S>` = superproject, `<H>` = bare hub,
`<E>` = the directory holding a `--separate-git-dir` git dir.

| state | cwd | anchors after binding | new reach | one path that MUST stay unreadable |
|---|---|---|---|---|
| normal | `<C>` | `<C>` | — | `/etc/passwd` (E21) |
| normalSubdir | `<C>/a/b/c` | `<C>` | own checkout root | sibling outside `<C>` (E21) |
| worktree | `<C>/…/wt` | wt, main | own wt root | a path outside both wt and main (E21); an unrelated repo via unbound `core.worktree` (E20) |
| submodule | `<S>/models/sub/…` | submodule | **+ own checkout** | `<S>/.env` (E15) |
| submoduleWorktree | wt of submodule | subwt, submodule | **+ own wt, + submodule** | `<S>/.git/modules/models/x` (E16) |
| bare | `<C>` (bare) | none | none (cwd-only) | `<C>/../…` (E19) |
| bareWorktree | wt of `<H>` | barewt | **+ own checkout** | `<H>`'s parent (E18) |
| separateGitDir | `<C>/…` | `<C>` | **+ own checkout** | `<E>/x` (E17) |
| dotGitNamedCheckout | `<C>` (`app.git`) | `<C>` | — (already widened) | `/etc/passwd` (E21) |
| nonRepo | plain dir | none | none (cwd-only) | anything outside (E21) |

Every "must stay unreadable" cell is an assertion; every "+" cell is a positive
control in the same test. No state gains reach outside checkouts its own
repository owns.

## Unbound `core.worktree` (the attack this change closes)

A repository-local `core.worktree` is user-controlled and returned VERBATIM by
the resolver. It is dropped unless the candidate re-resolves to the same
`commonDir`, is its own `thisCheckout`, and is not under the common dir
(`isBoundCheckout`). Measured: `<repo>/.git/x` is rejected by the `.git`-segment
test AND stays rejected with that test bypassed, because git reports it as its
own toplevel (E9). E20 covers `/` and an unrelated checkout.

## Accepted residual vectors (out of threat model)

Recorded here rather than silently omitted:

- **Planted `.git` gitfile / gitdir symlink.** A directory containing a `.git`
  FILE pointing at the repository's real gitdir re-resolves to the same canonical
  `commonDir` and therefore binds. Reaching it requires filesystem WRITE access
  in the target directory — strictly stronger than the config-only
  (`git config core.worktree`) capability this change closes. Not rejected;
  would be a separate change if that capability model is revisited.
- **In-cwd symlink is layer-1 allowed.** Pre-existing (layer 1 is logical, layer
  2 is realpath); deliberately NOT asserted as a new invariant (X7 note).

## Fail-closed summary

Probe timeout, git unresolvable, non-repository, bare cwd, realpath failure, and
`"unknown"` bareness all degrade to fewer anchors or no anchors — never to a
derived or wider one. Covered by X1, X4, X5, X5b, X6, P1.
