"""Restatement scan (change: fix-doc-engine-arm64-chromium, test-plan #E9).

Every pinned ``pi-doc-engine:X.Y.Z`` must equal ``IMAGE_VERSION``, and the
withdrawn "never hard-fails" / unqualified "falls back to mmdc" wording must be
gone from the package.
"""
import re
from pathlib import Path

PKG = Path(__file__).resolve().parents[2]
ENGINE = PKG / "engine"
VERSION = (ENGINE / "IMAGE_VERSION").read_text().strip()
SELF = Path(__file__).resolve()
TEXT_SUFFIXES = {".md", ".ts", ".py", ".json", ".sh", ".yaml", ".yml", ".txt", ""}


def _files():
    for p in PKG.rglob("*"):
        if not p.is_file() or p == SELF:
            continue
        if {"node_modules", "__pycache__", ".pytest_cache"} & set(p.parts):
            continue
        if p.suffix in TEXT_SUFFIXES:
            yield p


def test_pinned_image_tags_match_image_version():
    bad = []
    for p in _files():
        for m in re.finditer(r"pi-doc-engine:(\d+\.\d+\.\d+)", p.read_text(errors="ignore")):
            if m.group(1) != VERSION:
                bad.append(f"{p.relative_to(PKG)}: {m.group(0)}")
    assert not bad, bad


def test_withdrawn_wording_is_gone():
    bad = []
    for p in _files():
        text = p.read_text(errors="ignore")
        if "never hard-fails" in text:
            bad.append(f"{p.relative_to(PKG)}: never hard-fails")
        for m in re.finditer(r"falls? back to mmdc", text):
            # Every restatement must qualify the fallback with the new failure mode.
            if "MMDC_UNAVAILABLE" not in text[m.start() : m.start() + 250]:
                bad.append(f"{p.relative_to(PKG)}: {m.group(0)}")
    assert not bad, bad
