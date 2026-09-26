# research/oci-cwd-delegation.md — index

Research dossier. Explore-mode, no change / no impl. OCI image from CWD (crane/oras/umoci/buildah, daemon-free) → remote "mount" = overlay (Linux) or extract+mtree (portable) → changes back as one layer with whiteouts. Verdict: layer-as-checkpoint fine, layer-as-build anti-pattern; 4-layer split L0 deps/L1 HEAD/L2 dirty/L3 ignored-wanted + lease model; fork checkpoint (OCI/kopia) vs live-sync (Mutagen). 5 open questions. → see `research/oci-cwd-delegation.md.AGENTS.md`
