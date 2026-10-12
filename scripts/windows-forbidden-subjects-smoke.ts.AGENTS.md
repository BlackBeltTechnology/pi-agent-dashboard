# windows-forbidden-subjects-smoke.ts — index

Windows-only smoke (`_smoke.yml` Windows leg): `forbiddenGrantSubjects()` lists host `%SystemRoot%`, no `/`-rooted or `\etc|usr|var` junk; skips off Windows. See change: surface-denial-remedy-in-previews (test-plan #E24).
