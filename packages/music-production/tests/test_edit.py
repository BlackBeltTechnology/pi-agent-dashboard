"""music-edit-to-length: join scoring + edit rendering (test-plan E13-E18, X4-X6)."""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

import musiclib as ml
from conftest import SR, load_script, read_json, run, tone, write

BAR_124 = 240 / 124
HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None


def _write_map(path: Path, audio: Path, downbeats, duration: float, sections=None, schema="music-map/1") -> Path:
    m = {"schema": schema, "source": ml.rel_to(path, audio), "duration": round(duration, 3), "sr": SR,
         "tempo": {"bpm": round(240 / (downbeats[1] - downbeats[0]), 2), "stable_span": {"start_bar": 1, "end_bar": len(downbeats)},
                   "methods": {}},
         "cut_grid": {"source": "librosa", "meter": 4, "downbeats": [round(d, 3) for d in downbeats]},
         "beats": [], "key": {"label": "C major", "strength": 0.5},
         "band_level_db_rel": {"sub": 0, "bass": 0, "low_mid": 0, "high_mid": 0, "air": 0},
         "sections": sections or [{"start": 0.0, "end": round(duration, 3), "start_bar": 1,
                                   "end_bar": len(downbeats) + 1, "rms_db": -20, "bass_db": 0, "class": "groove"}],
         "drops": []}
    path.write_text(json.dumps(m))
    return path


@pytest.fixture(scope="module")
def block_map(block_track):
    r = run("analyze_music", block_track)
    assert r.returncode == 0, r.stderr
    return block_track.with_name("block_map.json")


# ------------------------------------------------------------------ scoring

def test_e13_repeated_block_scores_highest(block_map):
    # Loop-back into identical material: end of A2 (bar 8) -> start of A2 (bar 5). Bar 5's
    # run-up (bars 3-4) is identical to the outgoing bars 7-8. (A1 -> A1, bar 4 -> 1, has no
    # run-up to compare against.)
    r = run("score_joins", block_map, "--from-bar", 8, "--to-bar", 5, "--json")
    assert r.returncode == 0, r.stderr
    loop = json.loads(r.stdout)[0]
    # Join into the different-texture block B (run-up bars 9-10 are noise).
    r = run("score_joins", block_map, "--from-bar", 8, "--to-bar", 11, "--json")
    assert r.returncode == 0, r.stderr
    into_b = json.loads(r.stdout)[0]
    assert loop["chroma"] >= 0.98 and loop["timbre"] >= 0.98, loop
    assert loop["score"] > into_b["score"], (loop, into_b)


def test_e14_class_change_decision_table():
    sj = load_script("score_joins")
    base = dict(chroma=0.9, timbre=0.9, jump_db=0.0, section_boundary=True)
    same = sj.composite(**base, from_cls="groove", to_cls="groove")
    assert sj.composite(**base, from_cls="groove", to_cls="breakdown") < same
    assert sj.composite(**base, from_cls="drop", to_cls="build") < same
    assert sj.composite(**base, from_cls="breakdown", to_cls="breakdown") == same

    m = {"sections": [{"start_bar": 1, "end_bar": 5, "class": "groove"},
                      {"start_bar": 5, "end_bar": 9, "class": "breakdown"},
                      {"start_bar": 9, "end_bar": 13, "class": "drop"},
                      {"start_bar": 13, "end_bar": 17, "class": "build"}]}

    class Flat:  # identical similarity inputs for every join
        n = 16

        def window(self, bars):
            return np.ones(12), np.ones(13), -20.0

    rows = {(a, b): sj.score_join(m, Flat(), a, b) for a, b in [(2, 5), (2, 3), (10, 13), (6, 7)]}
    assert rows[(2, 5)]["class_change"] == {"from": "groove", "to": "breakdown"}
    assert rows[(10, 13)]["class_change"] == {"from": "drop", "to": "build"}
    assert rows[(2, 3)]["class_change"] is None and rows[(6, 7)]["class_change"] is None
    assert rows[(2, 5)]["score"] < rows[(2, 3)]["score"]
    assert rows[(10, 13)]["score"] < rows[(2, 3)]["score"]


def test_e15_audio_resolved_via_map_source(block_map, tmp_path):
    r = run("score_joins", block_map, "--from-bar", 2, "--to-bar", 6, "--json", cwd=tmp_path)
    assert r.returncode == 0, r.stderr
    assert json.loads(r.stdout)[0]["to_bar"] == 6


def test_auto_candidates_keep_anchor(block_map):
    target = 8 * BAR_124
    r = run("score_joins", block_map, "--candidates", "auto", "--target-duration", target,
            "--anchor-bar", 9, "--json")
    assert r.returncode == 0, r.stderr
    rows = json.loads(r.stdout)
    assert rows
    for row in rows:
        assert row["from_bar"] >= 9 or row["to_bar"] <= 9
        assert abs(row["duration"] - target) <= BAR_124 / 2 + 0.01


# ------------------------------------------------------------------ editing

def test_e16_output_length_and_grid(click124, click124_map, tmp_path):
    out = tmp_path / "e16"
    r = run("edit_music", click124, out, "1:9", "17:25", "--map", click124_map)
    assert r.returncode == 0, r.stderr
    edit_path = tmp_path / "e16_edit.json"
    e = read_json(edit_path)
    m = read_json(click124_map)
    bar = float(np.median(np.diff(m["cut_grid"]["downbeats"])))
    assert e["schema"] == "music-edit/1"
    assert abs(e["duration"] - 16 * BAR_124) <= 0.040
    assert len(e["downbeats_video"]) == 16 and e["downbeats_video"][0] == 0.0
    assert e["segments"][1]["video_at"] == pytest.approx(8 * bar, abs=0.02)
    for k in ("audio", "source", "map"):
        assert ml.resolve_rel(edit_path, e[k]).is_file(), k
    assert sf.info(str(tmp_path / "e16.wav")).duration == pytest.approx(e["duration"], abs=0.002)


@pytest.mark.parametrize("seg", ["5:5", "9:3", "1:999", "0:4"])
def test_e17_invalid_segment(click124, click124_map, tmp_path, seg):
    r = run("edit_music", click124, tmp_path / "bad", "1:3", seg, "--map", click124_map)
    assert r.returncode != 0
    assert f"'{seg}'" in r.stderr
    assert list(tmp_path.iterdir()) == []


@pytest.mark.parametrize("seg", ["1:END", "1:12.500"])
def test_e17_end_and_seconds_forms(click124, click124_map, tmp_path, seg):
    r = run("edit_music", click124, tmp_path / "ok", seg, "--map", click124_map)
    assert r.returncode == 0, r.stderr
    e = read_json(tmp_path / "ok_edit.json")
    assert "end_s" in e["segments"][0]


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe not installed")
def test_e18_preview(click124, click124_map, tmp_path):
    r = run("edit_music", click124, tmp_path / "pv", "1:5", "9:13", "--map", click124_map, "--preview")
    assert r.returncode == 0, r.stderr
    m4a = tmp_path / "pv.m4a"
    assert m4a.exists()
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_name:format=duration",
                            "-of", "json", str(m4a)], capture_output=True, text=True, check=True)
    info = json.loads(probe.stdout)
    assert info["streams"][0]["codec_name"] == "aac"
    assert abs(float(info["format"]["duration"]) - read_json(tmp_path / "pv_edit.json")["duration"]) <= 0.050


def _sine_source(tmp_path: Path) -> tuple[Path, Path]:
    """Continuous 220.0625 Hz sine, 2 s bars. The phase is 0 deg at the end of bar 1 (t=2 s) and
    90 deg at the start of bar 4 (t=6 s): a butt-join steps from 0 to full amplitude."""
    audio = write(tmp_path / "sine.wav", tone(220.0625, 16.0, 0.8, phase=-np.pi / 4))
    mp = _write_map(tmp_path / "sine_map.json", audio, [2.0 * k for k in range(8)], 16.0)
    return audio, mp


def test_x4_click_check(tmp_path):
    audio, mp = _sine_source(tmp_path)
    r = run("edit_music", audio, tmp_path / "hard", "1:2", "4:6", "--no-xfade")
    assert r.returncode == 0, r.stderr
    assert read_json(tmp_path / "hard_edit.json")["joins"][0]["click_ok"] is False
    r = run("edit_music", audio, tmp_path / "soft", "1:2", "4:6")
    assert r.returncode == 0, r.stderr
    assert read_json(tmp_path / "soft_edit.json")["joins"][0]["click_ok"] is True


def test_x5_trailing_silence(silence_tail_track, tmp_path):
    info = sf.info(str(silence_tail_track))
    mp = _write_map(tmp_path / "tail_map.json", silence_tail_track, [k * BAR_124 for k in range(20)], info.duration)
    r = run("edit_music", silence_tail_track, tmp_path / "t", "1:5", "9:END", "--map", mp)
    assert r.returncode == 0, r.stderr
    y, sr = sf.read(str(tmp_path / "t.wav"), always_2d=True)
    mono = np.abs(y.mean(axis=1))
    last_sound = np.nonzero(mono > 10 ** (-50 / 20))[0][-1] / sr
    assert len(mono) / sr - last_sound <= 0.1
    tail = mono[-int(0.05 * sr):]
    env = [tail[i:i + int(0.01 * sr)].max() for i in range(0, len(tail) - int(0.01 * sr) + 1, int(0.01 * sr))]
    assert all(b <= a + 1e-6 for a, b in zip(env, env[1:])), env


def test_x6_unknown_schema_major(click124, tmp_path):
    info = sf.info(str(click124))
    mp = _write_map(tmp_path / "v2_map.json", click124, [k * BAR_124 for k in range(30)], info.duration,
                    schema="music-map/2")
    r = run("score_joins", mp, "--from-bar", 2, "--to-bar", 5)
    assert r.returncode != 0 and "music-map/2" in r.stderr
    r = run("edit_music", click124, tmp_path / "x", "1:5", "--map", mp)
    assert r.returncode != 0 and "music-map/2" in r.stderr
    edit = {"schema": "music-edit/1", "source": ml.rel_to(tmp_path / "x_edit.json", click124),
            "audio": ml.rel_to(tmp_path / "x_edit.json", click124), "map": "v2_map.json",
            "bpm": 124, "meter": 4, "duration": 10.0,
            "segments": [{"start_bar": 1, "end_bar": 5, "music_from": 0.0, "music_to": 7.742, "video_at": 0.0}],
            "joins": [], "downbeats_video": [0.0, 1.935, 3.871, 5.806]}
    (tmp_path / "x_edit.json").write_text(json.dumps(edit))
    r = run("pick_hits", tmp_path / "x_edit.json")
    assert r.returncode != 0 and "music-map/2" in r.stderr
