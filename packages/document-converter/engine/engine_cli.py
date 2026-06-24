#!/usr/bin/env python3
"""pi-doc-engine command boundary.

The ONLY entry the TypeScript facade invokes. Contract:

  stdin  : one JSON request  {"command": "<name>", ...params}
  stdout : one JSON response  {"ok": true, ...} | {"ok": false, "error": {...}}
  exit   : 0 on success, non-zero on failure (TS maps to typed errors)

All paths in requests/responses are CONTAINER paths. The TS facade bind-mounts a
work dir and rewrites host paths to container paths before calling.

Commands:
  convertToMarkdown  ingest any format -> Markdown body (docling). TS stamps provenance.
  renderDocx         Markdown -> templated DOCX (document_converter; styled-diagram pre-pass).
  renderPdf          Markdown|DOCX -> PDF (document_converter convert-pdf).
  extractForEdit     DOCX -> editable Markdown (+ document_meta.xml).
  mergeBack          original DOCX + edited Markdown -> merged DOCX.
  fillFrontmatter    fill/refresh YAML frontmatter across files (frontmatter_filler).
  profileTables      inject table_profiles into frontmatter (markdown_table_profiler).
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(ENGINE_DIR))

# ---------------------------------------------------------------------------
# Error envelope
# ---------------------------------------------------------------------------


class EngineError(Exception):
    """Carries a stable error code + optional captured stderr."""

    def __init__(self, code: str, message: str, stderr: str = "", exit_code: int = 1):
        super().__init__(message)
        self.code = code
        self.message = message
        self.stderr = stderr
        self.exit_code = exit_code


def _ok(**payload) -> dict:
    return {"ok": True, **payload}


# ---------------------------------------------------------------------------
# Ingest: any format -> Markdown (docling)
# ---------------------------------------------------------------------------

# Canonical OCR engine name -> docling options class. The TS facade already maps
# canonical language NAMES to per-engine CODES, so this only routes the engine.
_OCR_ENGINES = {"easyocr", "tesseract", "rapidocr", "ocrmac"}


def _build_pipeline_options(ocr: dict, tables: str):
    from docling.datamodel.pipeline_options import PdfPipelineOptions

    opts = PdfPipelineOptions()
    mode = (ocr or {}).get("mode", "auto")
    engine = (ocr or {}).get("engine", "easyocr").lower()
    codes = (ocr or {}).get("codes") or []  # already per-engine codes from TS

    if engine not in _OCR_ENGINES:
        raise EngineError("OCR_ENGINE_UNKNOWN", f"unknown OCR engine: {engine}")

    # tables: off escape hatch for huge PDFs that hang TableFormer
    opts.do_table_structure = tables != "off"

    # native-first: auto WITHOUT an explicit language set does not init OCR
    # (digital PDFs extract via native text; avoids loading an OCR engine).
    if mode == "off" or (mode == "auto" and not codes):
        opts.do_ocr = False
        return opts

    opts.do_ocr = True
    # force == full-page OCR; auto == native-first (docling only OCRs bitmap regions)
    from docling.datamodel.pipeline_options import (
        EasyOcrOptions,
        TesseractOcrOptions,
        RapidOcrOptions,
    )

    force = mode == "force"
    if engine == "easyocr":
        opts.ocr_options = EasyOcrOptions(lang=codes or ["en"], force_full_page_ocr=force)
    elif engine == "tesseract":
        opts.ocr_options = TesseractOcrOptions(lang=codes or ["eng"], force_full_page_ocr=force)
    elif engine == "rapidocr":
        opts.ocr_options = RapidOcrOptions(force_full_page_ocr=force)
    elif engine == "ocrmac":
        from docling.datamodel.pipeline_options import OcrMacOptions

        opts.ocr_options = OcrMacOptions(lang=codes or ["en-US"], force_full_page_ocr=force)
    return opts


def cmd_convert_to_markdown(req: dict) -> dict:
    src = Path(req["input"])
    if not src.exists():
        raise EngineError("INPUT_NOT_FOUND", f"input not found: {src}")
    ocr = req.get("ocr") or {}
    tables = req.get("tables", "on")

    try:
        from docling.document_converter import DocumentConverter, PdfFormatOption
        from docling.datamodel.base_models import InputFormat
    except Exception as e:  # noqa: BLE001
        raise EngineError("DOCLING_UNAVAILABLE", f"docling import failed: {e}")

    pipeline_options = _build_pipeline_options(ocr, tables)
    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)
        }
    )
    try:
        result = converter.convert(str(src))
        markdown = result.document.export_to_markdown()
    except Exception as e:  # noqa: BLE001
        raise EngineError("INGEST_FAILED", f"docling conversion failed: {e}", traceback.format_exc())

    out = req.get("output")
    if out:
        Path(out).write_text(markdown, encoding="utf-8")
    return _ok(markdown=markdown, output=out)


# ---------------------------------------------------------------------------
# Styled-diagram pre-pass (nano-banana, md5 cache, mmdc fallback)
# ---------------------------------------------------------------------------

_MERMAID_BLOCK = re.compile(r"```mermaid\n(.*?)\n```", re.DOTALL)


def _render_styled_diagrams(md_path: Path, style: str, cache_dir: Path) -> Path:
    """Replace each ```mermaid block with a cached <md5>.png, generating misses
    via nano-banana CLI; fall back to mmdc per-diagram on any failure. Returns a
    rewritten temp .md placed IN THE SAME DIR so relative image paths resolve."""
    text = md_path.read_text(encoding="utf-8")
    cache_dir.mkdir(parents=True, exist_ok=True)
    have_key = bool(os.environ.get("GEMINI_API_KEY"))

    def _replace(m: re.Match) -> str:
        source = m.group(1)
        digest = hashlib.md5(source.encode("utf-8")).hexdigest()
        png = cache_dir / f"{digest}.png"
        if not png.exists():
            generated = False
            if have_key and style:
                generated = _nano_banana(source, style, png)
            if not generated:
                _mmdc(source, png)  # fallback; raises on hard failure
        rel = os.path.relpath(png, md_path.parent)
        return f"![diagram]({rel})"

    rewritten = _MERMAID_BLOCK.sub(_replace, text)
    tmp = md_path.with_suffix(".styled.md")
    tmp.write_text(rewritten, encoding="utf-8")
    return tmp


def _nano_banana(source: str, style: str, png: Path) -> bool:
    """Best-effort styled render. Returns True on success, False to trigger mmdc."""
    styles_yaml = ENGINE_DIR / "nano-banana-styles.yaml"
    # Prompt = the diagram source (describes the content) + the named STYLE block
    # appended after it, matching the nano-banana-styles.yaml contract.
    prompt = source
    try:
        import yaml  # type: ignore

        if styles_yaml.exists():
            doc = yaml.safe_load(styles_yaml.read_text(encoding="utf-8")) or {}
            name = style or doc.get("default")
            spec = (doc.get("styles") or {}).get(name) or {}
            if spec.get("prompt"):
                prompt = f"{source}\n\n{spec['prompt']}"
            if spec.get("negative"):
                prompt = f"{prompt}\n\nAVOID: {spec['negative']}"
    except Exception:  # noqa: BLE001
        pass
    try:
        proc = subprocess.run(
            ["npx", "@the-focus-ai/nano-banana", "generate", "-o", str(png), prompt],
            capture_output=True,
            text=True,
            timeout=180,
        )
        return proc.returncode == 0 and png.exists()
    except Exception:  # noqa: BLE001
        return False


def _mmdc(source: str, png: Path) -> None:
    blk = png.with_suffix(".mmd")
    blk.write_text(source, encoding="utf-8")
    env = dict(os.environ)
    # Use the baked headless shell; never the host Chrome.
    shell = os.environ.get("PUPPETEER_EXECUTABLE_PATH")
    proc = subprocess.run(
        ["mmdc", "-i", str(blk), "-o", str(png), "-b", "white", "-w", "1400", "-s", "2"],
        capture_output=True,
        text=True,
        env=env,
    )
    if proc.returncode != 0 or not png.exists():
        raise EngineError("MMDC_FAILED", "mermaid render failed", proc.stderr)


# ---------------------------------------------------------------------------
# Produce: DOCX / PDF via document_converter CLI
# ---------------------------------------------------------------------------


def _run_dc(args: list[str]) -> subprocess.CompletedProcess:
    cmd = [sys.executable, "-m", "document_converter.cli", *args]
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=str(ENGINE_DIR))
    if proc.returncode != 0:
        raise EngineError("PRODUCE_FAILED", f"document_converter exited {proc.returncode}", proc.stderr, proc.returncode)
    return proc


def cmd_render_docx(req: dict) -> dict:
    inp = Path(req["input"])
    out = req["output"]
    nano = req.get("nano_banana") or {}
    src_md = inp
    if nano.get("enabled"):
        cache_dir = Path(req.get("cacheDir") or (inp.parent / ".mermaid-cache"))
        src_md = _render_styled_diagrams(inp, nano.get("style", ""), cache_dir)

    args = ["convert", str(src_md), out]
    if req.get("template"):
        args += ["--template-name", req["template"]]
    if req.get("templatesDir"):
        args += ["--templates-dir", req["templatesDir"]]
    if req.get("language"):
        args += ["--language", req["language"]]
    if req.get("noToc"):
        args += ["--no-update-fields"]
    args += ["--non-interactive"]
    _run_dc(args)
    return _ok(output=out)


def cmd_render_pdf(req: dict) -> dict:
    inp = Path(req["input"])
    out = req["output"]
    args = ["convert-pdf", str(inp), out]
    if req.get("pageSize"):
        args += ["--page-size", req["pageSize"]]
    if req.get("template"):
        args += ["--template", req["template"]]
    _run_dc(args)
    return _ok(output=out)


def cmd_extract_for_edit(req: dict) -> dict:
    out = req["output"]
    args = ["extract", req["input"], out, "--include-meta"]
    _run_dc(args)
    meta = str(Path(out).with_name("document_meta.xml"))
    return _ok(output=out, meta=meta)


def cmd_merge_back(req: dict) -> dict:
    out = req["output"]
    args = ["merge", req["original"], req["edited"], out]
    if req.get("meta"):
        args += ["--meta", req["meta"]]
    _run_dc(args)
    return _ok(output=out)


# ---------------------------------------------------------------------------
# Frontmatter tooling
# ---------------------------------------------------------------------------


def cmd_fill_frontmatter(req: dict) -> dict:
    args = [sys.executable, str(ENGINE_DIR / "frontmatter_filler" / "fill.py"), *req["paths"]]
    if req.get("apply", True):
        args.append("--apply")
    if req.get("mode"):
        args += ["--mode", req["mode"]]
    if req.get("config"):
        args += ["--config", req["config"]]
    if req.get("language"):
        args += ["--language", req["language"]]
    for kv in req.get("set", []):
        args += ["--set", kv]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise EngineError("FILL_FAILED", "frontmatter fill failed", proc.stderr, proc.returncode)
    return _ok(stdout=proc.stdout)


def cmd_profile_tables(req: dict) -> dict:
    args = [sys.executable, str(ENGINE_DIR / "markdown_table_profiler" / "profile.py"), *req["paths"]]
    args.append("--apply" if req.get("apply", True) else "--dry-run")
    if req.get("percentile") is not None:
        args += ["--percentile", str(req["percentile"])]
    if req.get("smoothing"):
        args += ["--smoothing", req["smoothing"]]
    proc = subprocess.run(args, capture_output=True, text=True)
    if proc.returncode != 0:
        raise EngineError("PROFILE_FAILED", "table profile failed", proc.stderr, proc.returncode)
    return _ok(stdout=proc.stdout)


# ---------------------------------------------------------------------------
# Dispatch
# ---------------------------------------------------------------------------

_COMMANDS = {
    "convertToMarkdown": cmd_convert_to_markdown,
    "renderDocx": cmd_render_docx,
    "renderPdf": cmd_render_pdf,
    "extractForEdit": cmd_extract_for_edit,
    "mergeBack": cmd_merge_back,
    "fillFrontmatter": cmd_fill_frontmatter,
    "profileTables": cmd_profile_tables,
}


def main() -> int:
    try:
        req = json.load(sys.stdin)
    except Exception as e:  # noqa: BLE001
        json.dump({"ok": False, "error": {"code": "BAD_REQUEST", "message": str(e)}}, sys.stdout)
        return 2

    command = req.get("command")
    handler = _COMMANDS.get(command)
    if handler is None:
        json.dump(
            {"ok": False, "error": {"code": "UNKNOWN_COMMAND", "message": f"unknown command: {command}"}},
            sys.stdout,
        )
        return 2

    try:
        result = handler(req)
        json.dump(result, sys.stdout)
        return 0
    except EngineError as e:
        json.dump(
            {"ok": False, "error": {"code": e.code, "message": e.message, "stderr": e.stderr}},
            sys.stdout,
        )
        return e.exit_code
    except Exception as e:  # noqa: BLE001
        json.dump(
            {"ok": False, "error": {"code": "INTERNAL", "message": str(e), "stderr": traceback.format_exc()}},
            sys.stdout,
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
