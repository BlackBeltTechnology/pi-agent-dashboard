# DOX — docker/fixtures/sample-git/craft

craft-web e2e fixtures (tests/e2e/craft-web-editor.spec.ts ROWS). Each is copied into the session's git fixture before every test. No git-lfs. See change: extend-craft-web-to-all-apps (D9).

| File | Purpose |
|------|---------|
| `budget.xlsx` | 2 116 B. Hand-made OOXML workbook WITH `xl/styles.xml` (GridCraft blocks on "no styles part" without it). Sheet "Budget" A1:B4, `SUM` in B4. GridCraft row edits C2. |
| `doc.pdf` | 602 B. Hand-made PDF 1.4 with a valid xref table (a PDF without one opens as "damaged and repaired"). PdfCraft row. |
| `mag.designcraft` | 832 093 B. DesignCraft 0.9.0 web save (spike harness): `mimetype`, `meta.json`, `document.json`, `assets/19.png`, `assets/33.png`. |
| `mix.scraftz` | 414 016 B. SoundCraft session "Midnight Groove" (derived from a SoundCraft 0.8.0 web save, audio tracks reduced to one synthetic `Audio Files/tone.wav`). |
| `plan.dxf` | 172 B. Minimal ASCII DXF R12: ENTITIES with one LINE and one CIRCLE (r 20). CADCraft row draws CIRCLE 10,10 r 5. |
