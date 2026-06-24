# pi-doc-engine

Self-contained Docker image wrapping the vendored Python document engine. The TS
facade (`packages/document-converter`) is the only caller. No host Python.

## Build

```bash
./build-image.sh                      # pi-doc-engine:$(cat IMAGE_VERSION)
IMAGE_TAG=pi-doc-engine:dev ./build-image.sh
```

Build context = this directory. A guard fails the build if any vendored `*.py`
references a `~/Documents` / source-skill path.

## Invocation contract (stdin/stdout JSON)

One request object on **stdin**, one response object on **stdout**, exit code
signals success.

```bash
docker run --rm -i \
  -v "$WORKDIR:$WORKDIR" -w "$WORKDIR" \
  -e GEMINI_API_KEY \
  pi-doc-engine:0.1.0 < request.json > response.json
```

- All paths in the request/response are **container paths**. The facade bind-mounts
  a work dir and rewrites host→container paths before calling.
- `GEMINI_API_KEY` is injected at `docker run` time only (never baked). Absent →
  styled diagrams fall back to mmdc.

### Request

```json
{ "command": "<name>", "...": "params" }
```

| command | params | result |
|---|---|---|
| `convertToMarkdown` | `input`, `output?`, `ocr{mode,engine,codes[]}`, `tables` | `{markdown, output}` |
| `renderDocx` | `input`, `output`, `template?`, `templatesDir?`, `language?`, `nano_banana{enabled,style}?`, `cacheDir?` | `{output}` |
| `renderPdf` | `input`, `output`, `pageSize?`, `template?` | `{output}` |
| `extractForEdit` | `input`, `output` | `{output, meta}` |
| `mergeBack` | `original`, `edited`, `output`, `meta?` | `{output}` |
| `fillFrontmatter` | `paths[]`, `mode?`, `config?`, `language?`, `set[]?`, `apply?` | `{stdout}` |
| `profileTables` | `paths[]`, `apply?`, `percentile?`, `smoothing?` | `{stdout}` |

OCR `codes[]` are **per-engine** codes (EasyOCR `hu`, Tesseract `hun`). The TS
facade maps canonical language names → codes before calling, so a wrong code can
never silently produce empty OCR.

### Response

```json
{ "ok": true,  "...": "result fields" }
{ "ok": false, "error": { "code": "INGEST_FAILED", "message": "...", "stderr": "..." } }
```

Exit codes: `0` ok · `1` engine error · `2` bad/unknown request. The facade maps
non-zero exits + the `error.code` to typed errors.

## Vendored sources

See `VENDOR.md` for upstream paths, versions, and refresh procedure.
