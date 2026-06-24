"""Engine-internal unit tests: styled-diagram md5 cache + mmdc fallback.

These cover logic that lives below the TS↔engine JSON boundary (the TS suite
mocks the boundary and cannot reach it). Pure stdlib + monkeypatch; no docling,
no Docker. Run:

    python -m pytest packages/document-converter/engine/tests -q
"""
import hashlib
import sys
from pathlib import Path

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))

import engine_cli  # noqa: E402

MERMAID_DOC = "intro\n\n```mermaid\ngraph TD; A-->B\n```\n\noutro\n"


def _write_md(tmp_path: Path) -> Path:
    md = tmp_path / "doc.md"
    md.write_text(MERMAID_DOC, encoding="utf-8")
    return md


def test_cache_hit_skips_generation(tmp_path, monkeypatch):
    md = _write_md(tmp_path)
    cache = tmp_path / ".mermaid-cache"
    cache.mkdir()
    # Pre-seed the cache with the exact md5 key.
    digest = hashlib.md5("graph TD; A-->B".encode()).hexdigest()
    (cache / f"{digest}.png").write_bytes(b"PNG")

    calls = {"nano": 0, "mmdc": 0}
    monkeypatch.setattr(engine_cli, "_nano_banana", lambda *a, **k: calls.__setitem__("nano", calls["nano"] + 1) or True)
    monkeypatch.setattr(engine_cli, "_mmdc", lambda *a, **k: calls.__setitem__("mmdc", calls["mmdc"] + 1))

    out = engine_cli._render_styled_diagrams(md, "ros-3d", cache)

    assert calls == {"nano": 0, "mmdc": 0}  # cache hit -> neither called
    text = out.read_text(encoding="utf-8")
    assert f"{digest}.png" in text
    assert "```mermaid" not in text


def test_cache_miss_generates_via_nano_banana(tmp_path, monkeypatch):
    md = _write_md(tmp_path)
    cache = tmp_path / ".mermaid-cache"
    monkeypatch.setenv("GEMINI_API_KEY", "k")

    def fake_nano(source, style, png):
        png.write_bytes(b"PNG")
        return True

    calls = {"mmdc": 0}
    monkeypatch.setattr(engine_cli, "_nano_banana", fake_nano)
    monkeypatch.setattr(engine_cli, "_mmdc", lambda *a, **k: calls.__setitem__("mmdc", calls["mmdc"] + 1))

    engine_cli._render_styled_diagrams(md, "ros-3d", cache)
    assert calls["mmdc"] == 0  # nano-banana succeeded; no fallback


def test_falls_back_to_mmdc_when_nano_fails(tmp_path, monkeypatch):
    md = _write_md(tmp_path)
    cache = tmp_path / ".mermaid-cache"
    monkeypatch.setenv("GEMINI_API_KEY", "k")

    monkeypatch.setattr(engine_cli, "_nano_banana", lambda *a, **k: False)

    def fake_mmdc(source, png):
        png.write_bytes(b"PNG")

    fallback = {"n": 0}
    monkeypatch.setattr(engine_cli, "_mmdc", lambda s, p: (fallback.__setitem__("n", fallback["n"] + 1), fake_mmdc(s, p)))

    engine_cli._render_styled_diagrams(md, "ros-3d", cache)
    assert fallback["n"] == 1  # fell back to mmdc exactly once


def test_missing_key_uses_mmdc(tmp_path, monkeypatch):
    md = _write_md(tmp_path)
    cache = tmp_path / ".mermaid-cache"
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)

    nano = {"n": 0}
    monkeypatch.setattr(engine_cli, "_nano_banana", lambda *a, **k: nano.__setitem__("n", nano["n"] + 1) or True)
    monkeypatch.setattr(engine_cli, "_mmdc", lambda s, p: p.write_bytes(b"PNG"))

    engine_cli._render_styled_diagrams(md, "ros-3d", cache)
    assert nano["n"] == 0  # no key -> nano-banana never attempted, mmdc used


def test_unknown_command_envelope():
    import io
    import json

    monkey_stdin = io.StringIO(json.dumps({"command": "nope"}))
    out = io.StringIO()
    old_in, old_out = sys.stdin, sys.stdout
    sys.stdin, sys.stdout = monkey_stdin, out
    try:
        rc = engine_cli.main()
    finally:
        sys.stdin, sys.stdout = old_in, old_out
    assert rc == 2
    assert json.loads(out.getvalue())["error"]["code"] == "UNKNOWN_COMMAND"
