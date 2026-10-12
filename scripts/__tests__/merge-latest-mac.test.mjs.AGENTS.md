# __tests__/merge-latest-mac.test.mjs — index

Covers test-plan U6 for `merge-latest-mac.py`: the `minimumSystemVersion` update gate survives the arm64 + x64 merge, every arch DMG stays in `files[]`, extra legs are consumed, and a LEG-ASYMMETRIC injection (or a value disagreement) is REJECTED in both glob orders rather than silently inheriting from whichever file the glob yielded first. Skips when python3/pyyaml is absent. See change: upgrade-electron-runtime.
