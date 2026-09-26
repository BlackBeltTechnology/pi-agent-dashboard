"""beat-sync-video: pick_hits (test-plan E19-E25)."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

import musiclib as ml
from conftest import SR, load_script, read_json, run, tone, write

BAR = 240 / 124


def _audio(path: Path, dv: list[float], low_amp: dict[int, float], duration: float) -> Path:
    """Hi-hat on every downbeat + a 55 Hz bass tone at ``low_amp[i]`` during video bar i (0-based)."""
    y = np.zeros(int(duration * SR))
    for i, t in enumerate(dv):
        a = int(t * SR)
        seg = tone(8000, 0.03, 0.1, 0.008)
        y[a:a + len(seg)] += seg[: len(y) - a]
        amp = low_amp.get(i, 0.0)
        if amp:
            end = dv[i + 1] if i + 1 < len(dv) else duration
            s = tone(55, end - t, amp)
            y[a:a + len(s)] += s[: len(y) - a]
    return write(path, y * 0.9 / max(1.0, np.abs(y).max()))


def _case(tmp_path: Path, *, dv, low_amp, duration, segments, drops=(), vocals=None, map_db=None) -> Path:
    audio = _audio(tmp_path / "x.wav", dv, low_amp, duration)
    mp = tmp_path / "src_map.json"
    m = {"schema": "music-map/1", "source": "x.wav", "duration": 200.0, "sr": SR,
         "tempo": {"bpm": 124.0, "stable_span": {"start_bar": 1, "end_bar": 2}, "methods": {}},
         "cut_grid": {"source": "librosa", "meter": 4, "downbeats": map_db or [round(k * BAR, 3) for k in range(100)]},
         "beats": [], "key": {"label": "C major", "strength": 0.5},
         "band_level_db_rel": {"sub": 0, "bass": 0, "low_mid": 0, "high_mid": 0, "air": 0},
         "sections": [], "drops": [{"time": t, "bar": 1, "confidence": c} for t, c in drops]}
    if vocals is not None:
        m["stems"] = {"dir": "stems", "energy_share": {}, "bar_rms_db": {"vocals": vocals}}
    mp.write_text(json.dumps(m))
    ep = tmp_path / "x_edit.json"
    ep.write_text(json.dumps({"schema": "music-edit/1", "source": "x.wav", "audio": "x.wav", "map": mp.name,
                              "bpm": 124.0, "meter": 4, "duration": duration, "segments": segments,
                              "joins": [], "downbeats_video": [round(t, 3) for t in dv]}))
    return ep


def _identity(n_bars: int):
    dv = [k * BAR for k in range(n_bars)]
    dur = n_bars * BAR
    return dv, dur, [{"start_bar": 1, "end_bar": n_bars + 1, "music_from": 0.0, "music_to": round(dur, 3),
                      "video_at": 0.0}]


def _hits(ep: Path, *extra) -> tuple[dict, str]:
    r = run("pick_hits", ep, *extra)
    assert r.returncode == 0, r.stderr
    return read_json(ep.with_name("x_hits.json")), r.stderr


def test_e19_source_drop_mapped_and_cut_out_drop_ignored(tmp_path):
    dv = [36.080 + (k - 18) * BAR for k in range(27)]
    dur = dv[-1] + BAR
    segs = [{"start_bar": 1, "end_bar": 20, "music_from": 9.4, "music_to": 45.48, "video_at": 0.0},
            {"start_bar": 20, "end_s": 60.0, "music_from": 45.48, "music_to": 60.0, "video_at": 36.08}]
    ep = _case(tmp_path, dv=dv, low_amp={i: 0.6 for i in range(18, 27)}, duration=dur, segments=segs,
               drops=[(45.480, 0.9), (70.310, 0.9)])
    h, err = _hits(ep)
    big = [x for x in h["hits"] if x["tier"] == "big"]
    assert len(big) == 1 and abs(big[0]["t"] - 36.080) <= 0.02
    assert big[0]["source"] == "structural"
    assert h["schema"] == "music-hits/1" and h["recipe"]["big"]["scale"] == 1.12
    assert ml.resolve_rel(ep.with_name("x_hits.json"), h["edit"]) == ep.resolve()
    # E21: no vocals stem -> structural only, and the skip is reported
    assert all(x["source"] == "structural" for x in h["hits"])
    assert "hook detection skipped" in err


def test_e20_big_hit_threshold(tmp_path):
    dv, dur, segs = _identity(24)
    amp = {4: 0.5, 10: 0.15}
    amp.update({i: 0.9 for i in range(11, 24)})
    ep = _case(tmp_path, dv=dv, low_amp=amp, duration=dur, segments=segs,
               drops=[(round(dv[4], 3), 0.49), (round(dv[10], 3), 0.5)])
    h, _ = _hits(ep)
    def at(t):
        return [x for x in h["hits"] if abs(x["t"] - t) <= 0.01]

    assert [x["tier"] for x in at(dv[10])] == ["big"]  # snapped to the 0.5 drop, not the +1 candidate
    assert [x["tier"] for x in at(dv[4])] == ["mid"]
    assert at(dv[11]) == []


def test_e22_hook_entries(tmp_path):
    dv, dur, segs = _identity(30)
    vocals = [-60.0] * 30
    for start in (5, 13, 22):  # 1-based bars
        for b in range(start, start + 4):
            vocals[b - 1] = -20.0
    ep = _case(tmp_path, dv=dv, low_amp={}, duration=dur, segments=segs, vocals=vocals)
    h, err = _hits(ep)
    hooks = sorted(x["t"] for x in h["hits"] if x["source"] == "hook")
    assert hooks == pytest.approx([dv[4], dv[12], dv[21]], abs=0.002)
    assert "skipped" not in err


def test_e23_every_8_bars_is_broken_up(tmp_path):
    dv, dur, segs = _identity(48)
    ep = _case(tmp_path, dv=dv, low_amp={i: 0.8 for i in (8, 16, 24, 32, 40)}, duration=dur, segments=segs)
    h, _ = _hits(ep)
    ts = [x["t"] for x in h["hits"]]
    assert len(ts) >= 3
    iv = [round((b - a) / BAR) for a, b in zip(ts, ts[1:])]
    modal = max(set(iv), key=iv.count)
    assert iv.count(modal) / len(iv) <= 0.70, iv


def test_e24a_two_hits_not_thinned():
    ph = load_script("pick_hits")
    hits = [{"t": 0.0, "tier": "mid", "source": "structural"}, {"t": 8 * BAR, "tier": "mid", "source": "structural"}]
    assert ph.deregularize(hits, BAR) == hits


def test_e24b_all_manual_regular_grid_terminates(tmp_path):
    dv, dur, segs = _identity(48)
    ep = _case(tmp_path, dv=dv, low_amp={}, duration=dur, segments=segs)
    manual = [{"t": round(dv[8 * k], 3), "tier": "mid", "source": "manual", "why": f"m{k}"} for k in range(6)]
    ep.with_name("x_hits.json").write_text(json.dumps({"schema": "music-hits/1", "edit": "x_edit.json",
                                                      "hits": manual, "recipe": {}}))
    h, _ = _hits(ep)
    assert h["hits"] == manual


def test_e25_manual_hit_preserved_on_rerun(tmp_path):
    dv, dur, segs = _identity(24)
    ep = _case(tmp_path, dv=dv, low_amp={i: 0.8 for i in range(12, 24)}, duration=dur, segments=segs)
    manual = {"t": 5.123, "tier": "big", "source": "manual", "why": "logo reveal", "note": {"by": "editor"}}
    out = ep.with_name("x_hits.json")
    out.write_text(json.dumps({"schema": "music-hits/1", "edit": "x_edit.json", "hits": [manual], "recipe": {}}))
    h, _ = _hits(ep)  # no --out: default path derived from x_edit.json
    kept = [x for x in h["hits"] if x.get("source") == "manual"]
    assert len(kept) == 1 and json.dumps(kept[0]) == json.dumps(manual)
    assert any(x["source"] == "structural" for x in h["hits"])
    assert not list(tmp_path.glob(".x_hits.json.*"))  # atomic write left no temp file
