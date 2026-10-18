"""MMDC_UNAVAILABLE classification (change: fix-doc-engine-arm64-chromium, D6).

Manual gate 3.0 (probe argv on both browsers, run on amd64 + arm64 images):
``$PUPPETEER_EXECUTABLE_PATH --headless --no-sandbox --disable-gpu
--disable-dev-shm-usage --dump-dom about:blank`` -> exit 0 and ``<html`` on
stdout; foreign-arch / non-executable binary -> OSError or non-zero exit.
Record results here when run.

Pure monkeypatch; no Docker. Run:

    python -m pytest packages/document-converter/engine/tests -q
"""
import errno
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))

import engine_cli  # noqa: E402

FALLBACK = "/opt/chrome-headless-shell/chrome-headless-shell"
FLAGS = ["--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--dump-dom", "about:blank"]


def _cp(rc=0, out="", err=""):
    return subprocess.CompletedProcess([], rc, out, err)


def _patch_probe_run(monkeypatch, behaviour):
    seen = {}

    def fake(argv, **kw):
        seen["argv"], seen["kw"] = argv, kw
        if isinstance(behaviour, BaseException):
            raise behaviour
        return behaviour

    monkeypatch.setattr(engine_cli.subprocess, "run", fake)
    return seen


@pytest.mark.parametrize(
    "behaviour,expected",
    [
        (_cp(0, "<html><head></head></html>"), True),
        (_cp(0, ""), False),
        (_cp(1, "<html>"), False),
        (FileNotFoundError("x"), False),
        (OSError(errno.ENOEXEC, "Exec format error"), False),
        (subprocess.TimeoutExpired("x", 10), False),
    ],
)
def test_probe_classification(monkeypatch, behaviour, expected):  # E11
    monkeypatch.setenv("PUPPETEER_EXECUTABLE_PATH", "/x/chrome")
    seen = _patch_probe_run(monkeypatch, behaviour)
    assert engine_cli.browser_launch_probe() is expected
    assert seen["argv"] == ["/x/chrome", *FLAGS]
    assert seen["kw"]["timeout"] == 10


@pytest.mark.parametrize("value", [None, ""])
def test_probe_env_fallback(monkeypatch, value):  # E12
    if value is None:
        monkeypatch.delenv("PUPPETEER_EXECUTABLE_PATH", raising=False)
    else:
        monkeypatch.setenv("PUPPETEER_EXECUTABLE_PATH", value)
    seen = _patch_probe_run(monkeypatch, _cp(0, "<html>"))
    assert engine_cli.browser_launch_probe() is True
    assert seen["argv"] == [FALLBACK, *FLAGS]


def test_probe_time_bound(tmp_path, monkeypatch):  # P2
    monkeypatch.setenv("PUPPETEER_EXECUTABLE_PATH", "/x/chrome")
    seen = _patch_probe_run(monkeypatch, subprocess.TimeoutExpired("x", 10))
    t0 = time.monotonic()
    assert engine_cli.browser_launch_probe() is False
    assert time.monotonic() - t0 <= 11
    assert seen["kw"]["timeout"] == 10


# --- _run_dc gating ---------------------------------------------------------


def _patch_dc(monkeypatch, rc, writes_marker, probe_result=True):
    state = {"probes": 0, "env": None, "markers": []}

    def fake_run(cmd, **kw):
        env = kw.get("env") or {}
        state["env"] = env
        marker = env.get("PI_DOC_MMDC_MARKER")
        if marker:
            state["markers"].append(marker)
            if writes_marker:
                Path(marker).write_text("")
        return subprocess.CompletedProcess(cmd, rc, "", "child stderr")

    def fake_probe():
        state["probes"] += 1
        return probe_result

    monkeypatch.setattr(engine_cli.subprocess, "run", fake_run)
    monkeypatch.setattr(engine_cli, "browser_launch_probe", fake_probe)
    return state


def test_run_dc_unclassified_failure(monkeypatch):  # E13a
    st = _patch_dc(monkeypatch, 1, True, False)
    with pytest.raises(engine_cli.EngineError) as ei:
        engine_cli._run_dc(["convert"], classify_mmdc=False)
    assert ei.value.code == "PRODUCE_FAILED"
    assert st["probes"] == 0
    assert "PI_DOC_MMDC_MARKER" not in st["env"]


def test_run_dc_success_no_probe(monkeypatch):  # E13b / P1
    st = _patch_dc(monkeypatch, 0, True)
    engine_cli._run_dc(["convert"], classify_mmdc=True)
    assert st["probes"] == 0
    assert not Path(st["markers"][0]).exists()


def test_run_dc_failure_without_marker_no_probe(monkeypatch):  # E13c
    st = _patch_dc(monkeypatch, 1, False, False)
    with pytest.raises(engine_cli.EngineError) as ei:
        engine_cli._run_dc(["convert"], classify_mmdc=True)
    assert ei.value.code == "PRODUCE_FAILED"
    assert st["probes"] == 0


def test_run_dc_marker_and_probe_fails(monkeypatch):  # E13d
    st = _patch_dc(monkeypatch, 1, True, False)
    with pytest.raises(engine_cli.EngineError) as ei:
        engine_cli._run_dc(["convert"], classify_mmdc=True)
    assert ei.value.code == "MMDC_UNAVAILABLE"
    assert "child stderr" in ei.value.stderr
    assert st["probes"] == 1
    assert not Path(st["markers"][0]).exists()


def test_run_dc_marker_and_probe_passes(monkeypatch):  # E13e
    st = _patch_dc(monkeypatch, 1, True, True)
    with pytest.raises(engine_cli.EngineError) as ei:
        engine_cli._run_dc(["convert"], classify_mmdc=True)
    assert ei.value.code == "PRODUCE_FAILED"
    assert st["probes"] == 1
    assert not Path(st["markers"][0]).exists()


def test_run_dc_distinct_marker_paths(monkeypatch):  # E13f
    st = _patch_dc(monkeypatch, 0, True)
    engine_cli._run_dc(["convert"], classify_mmdc=True)
    engine_cli._run_dc(["convert"], classify_mmdc=True)
    assert len(set(st["markers"])) == 2


def test_caller_routing(tmp_path, monkeypatch):  # E14
    seen = {}

    def spy(args, classify_mmdc=False):
        seen[args[0]] = classify_mmdc
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(engine_cli, "_run_dc", spy)
    md = tmp_path / "a.md"
    md.write_text("x")
    engine_cli.cmd_render_docx({"input": str(md), "output": str(tmp_path / "a.docx")})
    engine_cli.cmd_render_pdf({"input": str(md), "output": str(tmp_path / "a.pdf")})
    engine_cli.cmd_extract_for_edit({"input": str(md), "output": str(tmp_path / "e.md")})
    engine_cli.cmd_merge_back({"original": "o", "edited": "e", "output": str(tmp_path / "m.docx")})
    assert seen["convert"] is True
    assert seen["convert-pdf"] is True
    assert not seen["extract"]
    assert not seen["merge"]


# --- _mmdc classification ---------------------------------------------------


def _patch_mmdc(monkeypatch, rc, writes_png, probe_result):
    state = {"probes": 0}

    def fake_run(cmd, **kw):
        if writes_png:
            Path(cmd[cmd.index("-o") + 1]).write_bytes(b"PNG")
        return subprocess.CompletedProcess(cmd, rc, "", "mmdc stderr")

    def fake_probe():
        state["probes"] += 1
        return probe_result

    monkeypatch.setattr(engine_cli.subprocess, "run", fake_run)
    monkeypatch.setattr(engine_cli, "browser_launch_probe", fake_probe)
    return state


@pytest.mark.parametrize(
    "rc,png,probe,code",
    [
        (1, False, False, "MMDC_UNAVAILABLE"),
        (1, False, True, "MMDC_FAILED"),
        (0, False, True, "MMDC_FAILED"),
    ],
)
def test_mmdc_classification(tmp_path, monkeypatch, rc, png, probe, code):  # E15
    _patch_mmdc(monkeypatch, rc, png, probe)
    with pytest.raises(engine_cli.EngineError) as ei:
        engine_cli._mmdc("graph TD; A-->B", tmp_path / "d.png")
    assert ei.value.code == code


def test_mmdc_success_never_probes(tmp_path, monkeypatch):  # E15d / P1
    st = _patch_mmdc(monkeypatch, 0, True, False)
    engine_cli._mmdc("graph TD; A-->B", tmp_path / "d.png")
    assert st["probes"] == 0


def test_styled_fallback_with_broken_browser(tmp_path, monkeypatch):  # E18
    md = tmp_path / "doc.md"
    md.write_text("```mermaid\ngraph TD; A-->B\n```\n")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    _patch_mmdc(monkeypatch, 1, False, False)
    calls = {"dc": 0}
    monkeypatch.setattr(engine_cli, "_run_dc", lambda *a, **k: calls.__setitem__("dc", calls["dc"] + 1))
    with pytest.raises(engine_cli.EngineError) as ei:
        engine_cli.cmd_render_docx(
            {"input": str(md), "output": str(tmp_path / "o.docx"), "nano_banana": {"enabled": True, "style": "s"}}
        )
    assert ei.value.code == "MMDC_UNAVAILABLE"
    assert calls["dc"] == 0
    assert not (tmp_path / "doc.styled.md").exists()


@pytest.mark.parametrize("which", ["run_dc", "mmdc"])
def test_message_content(tmp_path, monkeypatch, which):  # E20
    monkeypatch.setenv("PUPPETEER_EXECUTABLE_PATH", "/x/chrome")
    monkeypatch.setattr(engine_cli.platform, "machine", lambda: "aarch64")
    if which == "run_dc":
        _patch_dc(monkeypatch, 1, True, False)
        with pytest.raises(engine_cli.EngineError) as ei:
            engine_cli._run_dc(["convert"], classify_mmdc=True)
    else:
        _patch_mmdc(monkeypatch, 1, False, False)
        with pytest.raises(engine_cli.EngineError) as ei:
            engine_cli._mmdc("graph TD; A-->B", tmp_path / "d.png")
    assert ei.value.code == "MMDC_UNAVAILABLE"
    assert "/x/chrome" in ei.value.message
    assert "aarch64" in ei.value.message
