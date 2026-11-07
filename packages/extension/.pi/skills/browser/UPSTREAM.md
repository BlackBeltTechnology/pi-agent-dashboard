# Upstream provenance — `browser` skill

The `references/web.md` and `references/electron.md` files are vendored
snapshots of upstream `agent-browser` skill content. The Pi Dashboard
addenda appended to `web.md` and the "Worked example: Pi Dashboard"
section in `electron.md` are project-specific and not from upstream.

**Not vendored — do not overwrite on refresh:**
`references/own-browser.md` and `scripts/check-panerelay.sh` are authored
for this repo (the Panerelay / own-logged-in-browser recipe).
`references/challenge.md` is authored for this repo too — the pause / resume
discipline for interactive anti-bot challenges. None of them has an upstream
counterpart.

| Field                  | Value                                                              |
|------------------------|--------------------------------------------------------------------|
| Upstream repo          | https://github.com/vercel-labs/agent-browser                       |
| Upstream tag           | `v0.41.2`                                                          |
| Upstream commit SHA    | `d52a5e90c372ec4710c69adc3837ac14bbd852aa`                         |
| `agent-browser` CLI    | `0.41.2`                                                           |
| Source-of-truth files  | `skills/agent-browser/SKILL.md` (discovery stub) + CLI-served `core` and `electron` skills |
| Capture commands       | `agent-browser skills get core --full`<br>`agent-browser skills get electron` |
| Refreshed              | `2026-11-07`                                                       |
| License                | Apache-2.0 (see [`LICENSE`](LICENSE))                              |

## How to refresh

When upstream releases a new `agent-browser` version with material changes
to the `core` or `electron` skills, refresh the vendored content:

```bash
# 1. Install / upgrade upstream
npm install -g agent-browser@latest
agent-browser --version

# 2. Capture
agent-browser skills get core --full > /tmp/core.md
agent-browser skills get electron     > /tmp/electron.md

# 3. Diff against the vendored copies (in this directory)
diff <(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' /tmp/core.md)     references/web.md
diff <(awk 'BEGIN{n=0} /^---$/{n++; next} n>=2{print}' /tmp/electron.md) references/electron.md

# 4. If meaningful, replace the vendored bodies and update the table above.
#    Preserve the Pi Dashboard addenda (after the first `---` separator
#    in web.md, and the "Worked example: Pi Dashboard" section in
#    electron.md). Update the LICENSE file if the upstream license text
#    has changed. Leave own-browser.md, challenge.md and
#    check-panerelay.sh untouched.

# 5. Re-verify the authored recipe against the new CLI, then bump
#    `verifiedAgainstCli` in SKILL.md frontmatter:
#    bash scripts/check-panerelay.sh
```

The CLI version is the source of truth for the content; the upstream tag
SHA is recorded so a future maintainer can also fetch the static
`skills/agent-browser/SKILL.md` discovery stub at the same revision.
