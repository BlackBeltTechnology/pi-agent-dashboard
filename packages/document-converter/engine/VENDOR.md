# Vendored engine provenance

This directory carries a **committed copy** of the Python document-processing
engine. The `pi-doc-engine` Docker image builds **only** from this copy. No
runtime path references `~/Documents` or any home directory.

"Keep Python, wrap in TS": these are vendored verbatim, not paraphrased. Refresh
by re-copying from the upstream sources below and updating this record.

## Sources

| Vendored path | Upstream source | Version | Copied | sha256 (anchor file) |
|---|---|---|---|---|
| `document_converter/` | `~/Documents/.gemini/skills/document-conversion/src/document_converter/` | pyproject `0.6.0` / `__init__.__version__` `0.5.0` | 2026-06-24 | `pyproject.toml` `b905795412a59482a1d09e3e69ded12d4f85f7691547d68cdd3179883360d2c1` |
| `frontmatter_filler/fill.py` | `~/Documents/.agents/skills/frontmatter-filler/scripts/fill.py` | mtime 2026-04-22 (no version tag) | 2026-06-24 | `574e13c8e21068d2f88ecc9d0414fce54a28019a7ffb69ad83e2f870f5d93fa2` |
| `markdown_table_profiler/profile.py` | `~/Documents/.agents/skills/markdown-table-profiler/scripts/profile.py` | mtime 2026-04-22 (no version tag) | 2026-06-24 | `a0501eb8b54ba60c8e8f703427155450994cc41d920f62df451e85a91fe1c3a6` |

None of the upstream sources are under git, so commit hashes are unavailable;
anchor-file sha256 + copy date establish traceability.

## Runtime dependencies (installed by the image, NOT vendored as source)

- `document_converter` (pyproject): `pypandoc>=1.11`, `python-docx>=1.0.0`, `Pillow>=10.0.0`
- `frontmatter_filler/fill.py` (PEP 723 inline): `ruamel.yaml>=0.18`
- `markdown_table_profiler/profile.py` (PEP 723 inline): none
- Ingest engine: `docling` (+ OCR engines), installed via pip in the Dockerfile
- System tooling: `pandoc`, Gotenberg, `@mermaid-js/mermaid-cli` (mmdc),
  chrome-headless-shell, `@the-focus-ai/nano-banana`

## Excluded from vendoring

`__pycache__/`, `*.pyc`, `.venv/`, `tests/`, `examples/`, `hooks/`, `workflows/`
— not needed to build or run the engine inside the image.

## Engine command boundary

`engine/engine_cli.py` is the **only** entry the TypeScript facade invokes. It
reads one JSON request on stdin, dispatches to the vendored modules + docling,
writes one JSON response on stdout, and maps failures to non-zero exit codes.
See `engine/engine_cli.py` for the contract.
