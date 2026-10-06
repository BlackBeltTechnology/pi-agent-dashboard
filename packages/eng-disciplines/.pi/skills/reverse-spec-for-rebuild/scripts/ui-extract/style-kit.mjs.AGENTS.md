# .pi/skills/reverse-spec-for-rebuild/scripts/ui-extract/style-kit.mjs — index

`style-kit.mjs <app> <adapter> <kit-job.json> <outDir>` → `style-kit.json` + `.css`; `buildKit(files, job)`: colour/font tokens (uses + ≤5 distinct cites), size/radius scales, job components (absent selector throws), app CSS tokenized; invalid declarations dropped (`parseDecls`), helpers `blockEnd`/`blockItem`/`countDecl`. See change: promote-ui-extraction.
