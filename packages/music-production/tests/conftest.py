"""Synthetic audio fixtures for the music-production pytest suite (quick tier only).

Every fixture is generated in-test with numpy + soundfile, so the suite needs no
media files and no network. Scripts are exercised through their CLI (subprocess
with ``sys.executable``) and, for pure helpers, imported by path via ``load_script``.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf

PKG = Path(__file__).resolve().parents[1]
SKILLS = PKG / ".pi" / "skills"
SR = 44100
SCRIPTS = {
    "analyze_music": SKILLS / "music-analysis" / "scripts" / "analyze_music.py",
    "analyze_mir": SKILLS / "music-analysis" / "scripts" / "analyze_mir.py",
    "score_joins": SKILLS / "music-edit-to-length" / "scripts" / "score_joins.py",
    "edit_music": SKILLS / "music-edit-to-length" / "scripts" / "edit_music.py",
    "pick_hits": SKILLS / "beat-sync-video" / "scripts" / "pick_hits.py",
}
sys.path.insert(0, str(PKG / "lib"))


def load_script(name: str):
    """Import a skill script as a module (for its pure helpers)."""
    path = SCRIPTS[name]
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))
    spec.loader.exec_module(mod)
    return mod


def run(name: str, *args, cwd=None, env=None) -> subprocess.CompletedProcess:
    return subprocess.run([sys.executable, str(SCRIPTS[name]), *map(str, args)],
                          capture_output=True, text=True, cwd=cwd, env=env, timeout=300)


def read_json(p) -> dict:
    return json.loads(Path(p).read_text())


# ----------------------------------------------------------------- synthesis

def tone(freq: float, dur: float, amp: float = 1.0, decay: float | None = None, phase: float = 0.0) -> np.ndarray:
    t = np.arange(int(dur * SR)) / SR
    y = amp * np.sin(2 * np.pi * freq * t + phase)
    if decay:
        y *= np.exp(-t / decay)
    return y


def mix(*sigs: np.ndarray) -> np.ndarray:
    out = np.zeros(max(len(x) for x in sigs))
    for x in sigs:
        out[: len(x)] += x
    return out


def place(buf: np.ndarray, sig: np.ndarray, at: float) -> None:
    i = int(round(at * SR))
    j = min(len(buf), i + len(sig))
    if i < len(buf):
        buf[i:j] += sig[: j - i]


def click_track(bpm: float, meter: int, seconds: float) -> np.ndarray:
    """Accented downbeat (louder, low thump) + weaker off-beats."""
    y = np.zeros(int(seconds * SR))
    beat = 60.0 / bpm
    n = int(seconds / beat)
    for k in range(n):
        if k % meter == 0:
            place(y, mix(tone(1000, 0.05, 0.9, 0.01), tone(60, 0.12, 0.8, 0.04)), k * beat)
        else:
            place(y, tone(1500, 0.05, 0.35, 0.01), k * beat)
    return y


def highpass_noise(n: int, cutoff: float, rng: np.random.Generator) -> np.ndarray:
    spec = np.fft.rfft(rng.standard_normal(n))
    spec[np.fft.rfftfreq(n, 1 / SR) < cutoff] = 0
    y = np.fft.irfft(spec, n)
    return y / (np.abs(y).max() + 1e-9)


def groove_breakdown_reentry(bpm: float = 124.0) -> tuple[np.ndarray, float]:
    """8 bars kick+bass groove, 4 bars loud high-passed noise breakdown, 8 bars kick+bass re-entry.

    Hi-hat clicks on every beat throughout keep the beat grid alive. Returns (audio, bar seconds).
    """
    rng = np.random.default_rng(1)
    beat = 60.0 / bpm
    bar = 4 * beat
    y = np.zeros(int(20 * bar * SR) + SR)
    for k in range(80):
        t = k * beat
        b = k // 4  # 0-based bar
        place(y, tone(8000, 0.03, 0.15, 0.008), t)
        if b < 8 or b >= 12:
            place(y, mix(tone(55, 0.25, 0.9, 0.08), tone(110, 0.1, 0.3, 0.03)), t)
            if k % 4 == 0:
                place(y, tone(1000, 0.04, 0.3, 0.01), t)
    bass = np.zeros_like(y)
    for b in list(range(0, 8)) + list(range(12, 20)):
        place(bass, tone(41.2, bar, 0.35), b * bar)
    y += bass
    i0, i1 = int(8 * bar * SR), int(12 * bar * SR)
    swell = np.linspace(1.4, 1.9, i1 - i0)
    y[i0:i1] += swell * highpass_noise(i1 - i0, 1500, rng)
    return y / np.abs(y).max() * 0.9, bar


def repeated_block(bpm: float = 124.0) -> tuple[np.ndarray, float]:
    """Block A (4 bars, one chord per bar) twice, then block B (noise texture) for 4 bars."""
    rng = np.random.default_rng(2)
    beat = 60.0 / bpm
    bar = 4 * beat
    chords = [(261.6, 329.6, 392.0), (220.0, 261.6, 329.6), (174.6, 220.0, 261.6), (196.0, 246.9, 293.7)]
    y = np.zeros(int(12 * bar * SR) + SR)
    for b in range(8):
        seg = sum(tone(f, bar, 0.2) for f in chords[b % 4])
        place(y, seg * np.hanning(len(seg)) ** 0.1, b * bar)
    nb = int(4 * bar * SR)
    place(y, 0.4 * highpass_noise(nb, 3000, rng), 8 * bar)
    for k in range(48):
        place(y, tone(60, 0.15, 0.8, 0.05) if k % 4 == 0 else tone(1500, 0.04, 0.3, 0.01), k * beat)
    return y / np.abs(y).max() * 0.9, bar


def write(path: Path, y: np.ndarray) -> Path:
    sf.write(path, y.astype(np.float32), SR, subtype="PCM_16")
    return path


# ------------------------------------------------------------------ fixtures

@pytest.fixture(scope="session")
def fixtures_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("audio")


@pytest.fixture(scope="session")
def click124(fixtures_dir) -> Path:
    return write(fixtures_dir / "click124.wav", click_track(124, 4, 60))


@pytest.fixture(scope="session")
def click120_34(fixtures_dir) -> Path:
    return write(fixtures_dir / "click120_34.wav", click_track(120, 3, 40))


@pytest.fixture(scope="session")
def click_short(fixtures_dir) -> Path:
    return write(fixtures_dir / "click_short.wav", click_track(124, 4, 6))


@pytest.fixture(scope="session")
def groove_track(fixtures_dir) -> Path:
    y, _ = groove_breakdown_reentry()
    return write(fixtures_dir / "groove.wav", y)


@pytest.fixture(scope="session")
def block_track(fixtures_dir) -> Path:
    y, _ = repeated_block()
    return write(fixtures_dir / "block.wav", y)


@pytest.fixture(scope="session")
def silence_tail_track(fixtures_dir) -> Path:
    y = np.concatenate([click_track(124, 4, 20 * 240 / 124), np.zeros(5 * SR)])
    return write(fixtures_dir / "tail.wav", y)


@pytest.fixture(scope="session")
def click124_map(click124) -> Path:
    """The quick map of the 124 BPM click track (analysed once per session)."""
    r = run("analyze_music", click124)
    assert r.returncode == 0, r.stderr
    return click124.with_name("click124_map.json")
