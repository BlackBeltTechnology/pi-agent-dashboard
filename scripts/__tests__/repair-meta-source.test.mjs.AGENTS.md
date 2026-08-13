# __tests__/repair-meta-source.test.mjs — index

Vitest unit tests for repair-meta-source.mjs. Asserts source:"dashboard" → cleaned (other fields preserved), source:"tui"/"cli"/"tmux"/absent → kept, malformed JSON counted as errors, idempotent re-run, --dry-run modifies nothing.
