# research/agent-bash-sandboxing.md — index

Research, explore-only, no change/impl. Isolates arbitrary-bash file/dir access (path-gate: read/write/edit only). Layers: just-bash, srt (seatbelt/bwrap), AgentFS, container/VM. Hybrid: bash → srt policy + path-gate grants; violation → ask → retry. → see `research/agent-bash-sandboxing.md.AGENTS.md`
