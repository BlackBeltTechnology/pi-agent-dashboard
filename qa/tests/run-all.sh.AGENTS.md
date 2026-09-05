# run-all.sh — index

Bash QA suite runner. Sources nvm, runs the ordered `TESTS` list (currently `01-install` … `15-omit-dev-build`; the list is the source of truth, not this row), detects SKIP via first-line `SKIP:` prefix, tallies PASS/FAIL, prints summary box, exits 1 on any FAIL.
