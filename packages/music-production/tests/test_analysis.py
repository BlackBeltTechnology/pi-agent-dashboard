"""music-analysis quick tier + shared model-fetch guards (test-plan E1-E7, X1-X3)."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path

import numpy as np
import pytest

import musiclib as ml
from conftest import load_script, read_json, run

BAR_124 = 240 / 124  # 1.935 s


def _decimals_ok(x) -> bool:
    if isinstance(x, float):
        return round(x, 3) == x
    if isinstance(x, dict):
        return all(_decimals_ok(v) for v in x.values())
    if isinstance(x, list):
        return all(_decimals_ok(v) for v in x)
    return True


def test_e1_quick_map_fields_and_grid(click124, click124_map):
    m = read_json(click124_map)
    for k in ("schema", "source", "duration", "sr", "tempo", "cut_grid", "beats", "key",
              "band_level_db_rel", "sections", "drops"):
        assert k in m, k
    assert m["schema"] == "music-map/1"
    assert not Path(m["source"]).is_absolute()
    assert ml.resolve_rel(click124_map, m["source"]) == click124.resolve()
    assert m["cut_grid"]["source"] == "librosa" and m["cut_grid"]["meter"] == 4
    assert set(m["band_level_db_rel"]) == {"sub", "bass", "low_mid", "high_mid", "air"}
    assert 123 <= m["tempo"]["bpm"] <= 125
    iv = np.diff(m["cut_grid"]["downbeats"])
    assert np.all(np.abs(iv - BAR_124) <= 0.030), iv
    assert _decimals_ok(m["beats"]) and _decimals_ok(m["cut_grid"]) and _decimals_ok(m["sections"])
    assert (click124.parent / "click124_analysis.png").exists()


def test_e2_out_dir(click124, tmp_path):
    out = tmp_path / "x"
    r = run("analyze_music", click124, "--out-dir", out)
    assert r.returncode == 0, r.stderr
    mp = out / "click124_map.json"
    assert mp.exists() and (out / "click124_analysis.png").exists()
    assert ml.resolve_rel(mp, read_json(mp)["source"]) == click124.resolve()


def test_e3_stable_span_and_methods():
    am = load_script("analyze_music")
    bar = BAR_124
    t, grid = 0.0, []
    for i in range(24):
        grid.append(round(t, 3))
        t += bar * (1.08 if i < 4 else 1.0)  # the first 4 intervals drift 8 %
    tempo = am.grid_tempo(grid, 4, {"x": 124.0 + 2.0})
    assert tempo["stable_span"]["start_bar"] == 5
    a, b = tempo["stable_span"]["start_bar"], tempo["stable_span"]["end_bar"]
    expect = 60 * 4 * (b - a) / (grid[b - 1] - grid[a - 1])
    assert tempo["bpm"] == pytest.approx(expect, abs=0.01)
    assert tempo["methods"]["x"] == 126.0 and abs(tempo["bpm"] - 126.0) > 1


def test_e4_three_four(click120_34):
    r = run("analyze_music", click120_34)
    assert r.returncode == 0, r.stderr
    m = read_json(click120_34.with_name("click120_34_map.json"))
    assert m["cut_grid"]["meter"] == 3
    assert 119 <= m["tempo"]["bpm"] <= 121


def test_e5_bars_are_one_based(click124_map):
    m = read_json(click124_map)
    db = m["cut_grid"]["downbeats"]
    beat = 60 / m["tempo"]["bpm"]
    assert m["sections"][0]["start_bar"] == 1
    for s in m["sections"]:
        assert abs(db[s["start_bar"] - 1] - s["start"]) <= beat


def test_e6_classes_and_drops(groove_track):
    r = run("analyze_music", groove_track)
    assert r.returncode == 0, r.stderr
    m = read_json(groove_track.with_name("groove_map.json"))
    assert m["drops"], "re-entry must be a drop candidate"
    assert m["drops"][0]["bar"] == 13  # 8 groove + 4 breakdown bars, re-entry on bar 13
    for d in m["drops"]:
        if 9 <= d["bar"] <= 12:  # a breakdown bar, if one was a candidate
            assert d["confidence"] < 0.5
    assert all(s["class"] in ml.SECTION_CLASSES for s in m["sections"])
    confs = [d["confidence"] for d in m["drops"]]
    assert confs == sorted(confs, reverse=True)


def test_e7_too_short(click_short):
    r = run("analyze_music", click_short)
    assert r.returncode != 0
    assert "too short or arrhythmic" in r.stderr
    assert not click_short.with_name("click_short_map.json").exists()


def test_x1_missing_dependency(click124, tmp_path):
    shim = tmp_path / "shim" / "librosa"
    shim.mkdir(parents=True)
    (shim / "__init__.py").write_text("raise ImportError('shimmed out')\n")
    env = {**os.environ, "PYTHONPATH": str(shim.parent)}
    r = run("analyze_music", click124, "--out-dir", tmp_path / "o", env=env)
    assert r.returncode == 2
    lines = [ln for ln in r.stderr.splitlines() if ln.strip()]
    assert len(lines) == 1, r.stderr
    assert "librosa" in lines[0] and "requirements-core.txt" in lines[0]


def test_x2_model_mismatch_deleted(tmp_path):
    good = b"real model bytes"
    table = {"m.pb": {"url": "https://example.invalid/m.pb", "sha256": hashlib.sha256(good).hexdigest()}}
    cached = tmp_path / "m.pb"
    cached.write_bytes(b"tampered")
    calls = []
    with pytest.raises(ml.ModelError, match="m.pb"):
        ml.fetch_model("m.pb", table=table, cache=tmp_path, fetcher=lambda url: calls.append(url) or [good])
    assert not cached.exists()
    assert calls == []  # verification of a cached file never touches the network


def test_x3_size_cap(tmp_path):
    table = {"big.pb": {"url": "https://example.invalid/big.pb", "sha256": "0" * 64}}
    cap = ml.MAX_MODEL_BYTES

    def stream(_url):
        yield b"\0" * cap
        yield b"\0"

    with pytest.raises(ml.ModelError, match="cap"):
        ml.fetch_model("big.pb", table=table, cache=tmp_path, fetcher=stream)
    assert list(tmp_path.iterdir()) == []


def test_fetch_model_verifies_download(tmp_path):
    good = b"weights"
    table = {"ok.pb": {"url": "https://example.invalid/ok.pb", "sha256": hashlib.sha256(good).hexdigest()}}
    p = ml.fetch_model("ok.pb", table=table, cache=tmp_path, fetcher=lambda url: [good])
    assert p.read_bytes() == good
