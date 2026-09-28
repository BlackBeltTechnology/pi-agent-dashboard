"""music-analysis deep tier (test-plan E8). Local only: skipped unless the deep venv is active."""
from __future__ import annotations

import importlib.util
import shutil
from pathlib import Path

import pytest

import musiclib as ml
from conftest import read_json, run

DEEP = all(importlib.util.find_spec(m) is not None for m in ("essentia", "beat_this", "demucs"))
pytestmark = pytest.mark.skipif(not DEEP, reason="deep tier (requirements-mir.txt) not installed")


def test_e8_deep_replaces_grid_and_rederives_bars(click124, click124_map, tmp_path):
    audio = tmp_path / click124.name
    shutil.copy(click124, audio)
    mp = tmp_path / click124_map.name
    quick = read_json(click124_map)
    quick["source"] = audio.name
    ml.write_json_atomic(mp, quick)

    r = run("analyze_mir", audio, "--no-tags", "--device", "cpu")
    assert r.returncode == 0, r.stderr
    m = read_json(mp)
    assert m["cut_grid"]["source"] == "beat_this"
    db = m["cut_grid"]["downbeats"]
    beat = 60 / m["tempo"]["bpm"]
    starts = [s["start"] for s in quick["sections"]]
    for s in m["sections"]:
        assert s["start"] in starts  # time-valued fields preserved
        assert abs(db[s["start_bar"] - 1] - s["start"]) <= beat
    assert not Path(m["stems"]["dir"]).is_absolute()
    assert ml.resolve_rel(mp, m["stems"]["dir"]).is_dir()
