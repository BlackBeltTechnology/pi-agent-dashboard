# check-mockups.mjs — index

Advisory mock check `--base <rev> [--strict]` (`npm run check:mockups`): new mock-root entries must be live (`<yyyy-mm-dd-slug>/mock.tsx`) or a dir with `STATIC.md`; loose `.html` always reported. Exports `mockEntries`, `mockFindings`. Exit 0 unless `--strict`. Ship-it 4.4 wiring is a follow-up. See change: add-mock-site-exact-env.
