"""Regression tests for `convert-pdf` output-path resolution (issue #507).

`inputs` is `nargs='+'`, so a *positional* output path is greedily swallowed
into `inputs` and `output` stays `None` — `renderPdf` then always failed with
`File not found: <output>.pdf`. These tests pin both halves of the fix:

  * `engine_cli.cmd_render_pdf` passes the output through an unambiguous flag,
    and the REAL parser must read it back as `args.output`;
  * the documented positional form (`convert-pdf in.docx out.pdf`) resolves
    without stealing a genuine batch input.

Pure stdlib + monkeypatch; no docling, no Docker. Run:

    python -m pytest packages/document-converter/engine/tests -q
"""
import sys
from pathlib import Path

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))

import engine_cli  # noqa: E402
from document_converter.cli import build_parser, resolve_pdf_output  # noqa: E402


def _parse(argv):
    return build_parser().parse_args(argv)


# --- the reported bug: engine_cli -> CLI round trip ------------------------


def test_render_pdf_argv_parses_to_the_requested_output(monkeypatch):
    """#507 repro: the output path must survive the argv round trip."""
    captured = {}

    def fake_run_dc(args):
        captured["args"] = args

    monkeypatch.setattr(engine_cli, "_run_dc", fake_run_dc)

    result = engine_cli.cmd_render_pdf(
        {"input": "/abs/doc.docx", "output": "/abs/doc.pdf", "pageSize": "a4"}
    )

    args = _parse(captured["args"])
    inputs, output = resolve_pdf_output(args.inputs, args.output, args.output_dir)

    assert inputs == ["/abs/doc.docx"]
    assert output == "/abs/doc.pdf"
    assert args.page_size == "a4"
    assert result["output"] == "/abs/doc.pdf"


def test_render_pdf_output_without_pdf_suffix_still_survives(monkeypatch):
    """The flag is extension-agnostic — callers pass arbitrary paths."""
    captured = {}
    monkeypatch.setattr(engine_cli, "_run_dc", lambda args: captured.setdefault("args", args))

    engine_cli.cmd_render_pdf({"input": "/abs/doc.md", "output": "/abs/out/report"})

    args = _parse(captured["args"])
    inputs, output = resolve_pdf_output(args.inputs, args.output, args.output_dir)
    assert inputs == ["/abs/doc.md"]
    assert output == "/abs/out/report"


# --- documented positional form -------------------------------------------


def test_documented_positional_form_yields_an_output():
    args = _parse(["convert-pdf", "in.docx", "out.pdf"])
    assert resolve_pdf_output(args.inputs, args.output, args.output_dir) == (
        ["in.docx"],
        "out.pdf",
    )


def test_single_input_keeps_derived_output():
    args = _parse(["convert-pdf", "in.docx"])
    assert resolve_pdf_output(args.inputs, args.output, args.output_dir) == (["in.docx"], None)


# --- batch forms must NOT lose their last input ---------------------------


def test_two_non_pdf_inputs_stay_a_batch():
    args = _parse(["convert-pdf", "a.md", "b.adoc"])
    assert resolve_pdf_output(args.inputs, args.output, args.output_dir) == (
        ["a.md", "b.adoc"],
        None,
    )


def test_output_dir_keeps_every_positional_as_input():
    args = _parse(["convert-pdf", "a.md", "b.pdf", "--output-dir", "./pdfs"])
    assert resolve_pdf_output(args.inputs, args.output, args.output_dir) == (
        ["a.md", "b.pdf"],
        None,
    )


def test_an_existing_pdf_tail_is_an_input_not_an_output(tmp_path):
    existing = tmp_path / "b.pdf"
    existing.write_bytes(b"%PDF-1.4\n")
    args = _parse(["convert-pdf", "a.md", str(existing)])
    assert resolve_pdf_output(args.inputs, args.output, args.output_dir) == (
        ["a.md", str(existing)],
        None,
    )


def test_explicit_flag_beats_a_pdf_tail():
    args = _parse(["convert-pdf", "a.md", "b.pdf", "--output", "chosen.pdf"])
    assert resolve_pdf_output(args.inputs, args.output, args.output_dir) == (
        ["a.md", "b.pdf"],
        "chosen.pdf",
    )
