# __tests__/rebuild-scripts-gate.test.mjs — index

X5 fault injection: both `rebuild-restart.sh` and `rebuild-and-restart.sh` run the served-client gate between build and restart and abort NON-ZERO on refusal, with `npm`/`pi-dashboard` recording stubs on `PATH` plus a `node` stub that refuses the sync step — neither restart/reload stub is invoked. See change: add-served-build-coherence-and-hash-parity.
