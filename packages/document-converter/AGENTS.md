# DOX — packages/document-converter

Files in this directory. One row per source file.

| File | Purpose |
|------|---------|
| `README.md` | Package overview. TS facade over Dockerized Python engine `pi-doc-engine`. Only doc-conversion surface; callers never touch Python/docling/pandoc/nano-banana. Ingest PDF/DOCX/PPTX/XLSX → provenance-stamped Markdown (feeds kb). Produce Markdown → templated DOCX/PDF, diagrams, round-trip edit/merge. Export `createDocumentConverter`. Engine Docker-quarantined. |
| `engine/README.md` | pi-doc-engine Docker image wrapping vendored Python engine. TS facade only caller, no host Python. Build `./build-image.sh` → `pi-doc-engine:$(cat IMAGE_VERSION)`; `IMAGE_TAG=… ./build-image.sh`. Build guard fails on vendored `*.py` `~/Documents` path refs. Invocation contract: one JSON request stdin, one JSON response stdout, exit-code signals success. |
| `engine/VENDOR.md` | Vendored engine provenance record. Committed copy of Python doc-processing engine; `pi-doc-engine` image builds only from copy. Sources table: vendored path, upstream source, version, copy date, anchor-file sha256. Refresh by re-copy from upstream + update record. Upstream not under git → sha256 + date establish traceability. |
| `vitest.config.ts` | Vitest config. include `src/**/__tests__/**/*.test.ts`. node env, forks pool, maxWorkers 50%. |
| `.pi/skills/document-converter/SKILL.md` | NL-triggered document conversion. Ingest PDF/DOCX/PPTX/XLSX→md for kb; produce md→DOCX/PDF templated. Routes to packages/document-converter facade. See change: document-converter. |
