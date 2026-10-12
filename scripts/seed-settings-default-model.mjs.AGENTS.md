# seed-settings-default-model.mjs — index

Seeds pi `settings.json` with SPLIT `defaultProvider`+`defaultModel` so faux is the startup default (pi 0.84 no longer resolves a combined `defaultModel`). Exports pure `mergeDefaultModel(cfg)→{cfg,changed}` (gated on absent `defaultProvider`; splits a combined `defaultModel` on FIRST `/`; else pins `faux`/`faux-1`) + `seedFile(path)` (missing→`{}`, unparseable→untouched exit 0, writes+logs only on change). Called by `docker/test-entrypoint.sh`. See change: split-faux-seed-default-provider.
