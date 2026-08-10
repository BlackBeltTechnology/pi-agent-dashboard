# Discovery prompt (capability clustering)

Fill {PLACEHOLDERS}. Model: @compact is fine. Read-only.

---

You are mapping a code target into OpenSpec CAPABILITY boundaries so each can be
spec'd independently.

TARGET: {TARGET_DIR}

STEP 1 — Read the directory's per-file record: run `kb agents {TARGET_DIR}` (or
read {TARGET_DIR}/AGENTS.md) for the one-line purpose of each file. Use
`kb_search --doc-type agents "<topic>"` to find related rows. Fall back to `ls`
+ grep only if the tree misses.

STEP 2 — Cluster files into capabilities. A capability is a distinct
behavioral unit (usually 1-4 closely-related files that together implement one
externally-observable behavior). Prefer the granularity of existing
`openspec/specs/<cap>/` names (kebab-case, behavior-scoped, e.g. `ws-ping-pong`,
`server-cors`, `force-kill-handler`). One file may host more than one capability;
one capability may span files — cluster by BEHAVIOR, not by file.

AVOID over-fragmentation: do NOT emit several capabilities that all share the
SAME single source file (e.g. five capabilities all pointing at client.ts). If
one file hosts many behaviors, prefer ONE capability for that file (or split
only when a behavior clearly has its own file set). Redundant same-file
capabilities would spawn duplicate generators reading identical code.

STEP 3 — For each capability, note whether `openspec/specs/<capability>/spec.md`
already exists (check the filesystem).

Output STRICT JSON ONLY (no prose, no code fence):
{
  "target": "{TARGET_DIR}",
  "capabilities": [
    {
      "capability": "<kebab-case-name>",
      "purpose_hint": "<one line: the externally-observable behavior>",
      "files": ["<path>", "..."],
      "existing_spec": <true|false>
    }
  ]
}
