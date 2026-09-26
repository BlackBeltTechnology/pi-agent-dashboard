"""Shared helpers for the music-production skills.

Imported by every skill script via
``sys.path.insert(0, str(Path(__file__).resolve().parents[4] / "lib"))``
(scripts -> skill -> skills -> .pi -> package root).

Contents:
  * missing-module hint (exit 2) — ``require``
  * contract load/validate with a schema-major check — ``load_contract``
  * relative-path helpers (paths inside a contract are relative to that file)
  * atomic JSON write (temp + rename) — ``write_json_atomic``
  * 1-based bar <-> time — ``bar_start``, ``time_to_bar``
  * source -> video time through ``music-edit/1`` segments — ``source_to_video``
  * section classes — ``classify_sections``
  * argv-only ffmpeg runner (injectable) — ``run_ffmpeg``
  * sha256-pinned, size-capped model fetch — ``MODEL_TABLE``, ``fetch_model``

Only the standard library and numpy are imported at module level (librosa is
passed in by callers), so the helpers load in either venv (core or deep tier).
"""
from __future__ import annotations

import hashlib
import importlib
import json
import math
import os
import subprocess
import sys
import tempfile
import urllib.request

try:
    import numpy as _np
except ImportError:  # scripts call require('numpy') and print the install hint
    _np = None
from pathlib import Path
from typing import Callable, Iterable, NoReturn, Sequence

SCHEMA_MAJOR = 1
SECTION_CLASSES = ("intro", "groove", "breakdown", "build", "drop", "outro")
LOW_BAND = (30.0, 150.0)  # Hz — kick + bass fundamentals; the "drop" band


class ContractError(ValueError):
    """A contract file is missing, malformed, or has an unsupported schema."""


def die(msg: str, code: int = 1) -> NoReturn:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


# --------------------------------------------------------------------------- deps

def require(module: str, reqfile: str = "requirements-core.txt"):
    """Import ``module`` or exit 2 with a one-line hint naming the requirements file.

    Scripts never install packages; the user builds the venv (see SKILL.md step 0).
    """
    try:
        return importlib.import_module(module)
    except ImportError:
        top = module.split(".")[0]
        die(f"missing Python module '{top}': install {reqfile} into the venv "
            f"(uv pip install -r <music-production>/{reqfile})", 2)


# ---------------------------------------------------------------------- contracts

def load_contract(path: str | os.PathLike, name: str) -> dict:
    """Load a ``<name>/<major>`` JSON contract; reject an unknown major version."""
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ContractError(f"{p}: file not found") from None
    except json.JSONDecodeError as e:
        raise ContractError(f"{p}: invalid JSON ({e})") from None
    schema = data.get("schema") if isinstance(data, dict) else None
    if not isinstance(schema, str) or "/" not in schema:
        raise ContractError(f"{p}: missing 'schema' (expected '{name}/{SCHEMA_MAJOR}')")
    got_name, _, major = schema.partition("/")
    if got_name != name:
        raise ContractError(f"{p}: schema '{schema}' is not a {name} file")
    if major.split(".")[0] != str(SCHEMA_MAJOR):
        raise ContractError(f"{p}: unsupported schema '{schema}' (this tool reads {name}/{SCHEMA_MAJOR})")
    return data


def load_contract_or_die(path, name: str) -> dict:
    try:
        return load_contract(path, name)
    except ContractError as e:
        die(str(e))


def resolve_rel(contract_file: str | os.PathLike, rel: str) -> Path:
    """Resolve a path stored inside a contract (relative to the contract's directory)."""
    r = Path(rel)
    return r if r.is_absolute() else (Path(contract_file).resolve().parent / r).resolve()


def rel_to(contract_file: str | os.PathLike, target: str | os.PathLike) -> str:
    """Express ``target`` relative to the directory that will hold ``contract_file``."""
    base = Path(contract_file).resolve().parent
    return Path(os.path.relpath(Path(target).resolve(), base)).as_posix()


def write_json_atomic(path: str | os.PathLike, obj) -> None:
    """Write JSON to a temp file in the same directory, then rename over ``path``."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=f".{p.name}.", suffix=".tmp", dir=p.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, indent=1)
            fh.write("\n")
        os.replace(tmp, p)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


def r3(x: float) -> float:
    """Seconds rounded to 3 decimals (the contract precision)."""
    return round(float(x), 3)


# ------------------------------------------------------------------ bars and time

def bar_start(downbeats: Sequence[float], bar: int) -> float:
    """Start time of 1-based ``bar``: ``downbeats[bar-1]``."""
    if bar < 1 or bar > len(downbeats):
        raise IndexError(f"bar {bar} outside the grid (1..{len(downbeats)})")
    return float(downbeats[bar - 1])


def time_to_bar(downbeats: Sequence[float], t: float) -> int:
    """1-based bar whose downbeat is nearest to ``t``."""
    best = min(range(len(downbeats)), key=lambda i: abs(downbeats[i] - t))
    return best + 1


def bar_containing(downbeats: Sequence[float], t: float) -> int:
    """1-based bar whose span [downbeat, next downbeat) contains ``t`` (clamped)."""
    n = 0
    for i, d in enumerate(downbeats):
        if d <= t + 1e-6:
            n = i + 1
    return max(1, n)


def source_to_video(segments: Sequence[dict], s: float) -> float | None:
    """Map source time ``s`` through ``music-edit/1`` segments; None when cut out."""
    for seg in segments:
        a, b = float(seg["music_from"]), float(seg["music_to"])
        if a - 1e-3 <= s < b - 1e-3:
            return float(seg["video_at"]) + (s - a)
    return None


# ------------------------------------------------------------- per-bar levels

HOP = 512
N_FFT = 4096
# Power of a full-scale sine peak in a Hann-windowed STFT bin: (N_FFT/4)^2 -> dB.
FULL_SCALE_DB = 20 * math.log10(N_FFT / 4)
LOW_FLOOR_DB = FULL_SCALE_DB - 60.0  # the 30-150 Hz band below -60 dBFS counts as silent


def bar_spans(downbeats, duration: float) -> list[tuple[float, float]]:
    """[start, end) per bar; the last bar lasts one median bar, clipped to ``duration``."""
    db = [float(x) for x in downbeats]
    med = float(_np.median(_np.diff(db))) if len(db) > 1 else duration
    ends = db[1:] + [min(duration, db[-1] + med)]
    return list(zip(db, ends))


def bar_levels(librosa, y, sr, S, freqs, downbeats, dur):
    """Per-bar RMS dB, 30-150 Hz dB and a chroma+MFCC texture vector (bars x 25 -> 25 x bars).

    Only frames whose analysis window lies fully inside the bar are used, so a
    kick on the next downbeat never leaks into the previous bar. The low band is
    floored at -60 dBFS so numerical noise in a bass-less passage never reads as a jump.
    """
    low_pow = S[(freqs >= LOW_BAND[0]) & (freqs < LOW_BAND[1])].sum(axis=0)
    frame_t = librosa.frames_to_time(_np.arange(S.shape[1]), sr=sr, hop_length=HOP)
    rms = librosa.feature.rms(y=y, frame_length=2048, hop_length=HOP)[0]
    rms_t = librosa.frames_to_time(_np.arange(len(rms)), sr=sr, hop_length=HOP)
    chroma = librosa.feature.chroma_stft(S=S, sr=sr, n_fft=N_FFT, hop_length=HOP)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, hop_length=HOP, n_mfcc=14)[1:]
    guard = N_FFT / 2 / sr
    bar_rms, bar_low, feats = [], [], []
    for a, b in bar_spans(downbeats, dur):
        m = (rms_t >= a + 1024 / sr) & (rms_t < b - 1024 / sr)
        f = (frame_t >= a + guard) & (frame_t < b - guard)
        bar_rms.append(10 * _np.log10(_np.mean(rms[m] ** 2) + 1e-10) if m.any() else -100.0)
        bar_low.append(max(LOW_FLOOR_DB, 10 * _np.log10(_np.mean(low_pow[f]) + 1e-10)) if f.any() else LOW_FLOOR_DB)
        feats.append(_np.concatenate([chroma[:, f].mean(axis=1) if f.any() else _np.zeros(12),
                                     mfcc[:, f[:mfcc.shape[1]]].mean(axis=1) / 100.0 if f.any() else _np.zeros(13)]))
    return _np.array(bar_rms), _np.array(bar_low), _np.array(feats).T


# ---------------------------------------------------------------------- sections

def classify_sections(sections: list[dict], drops: list[dict],
                      stems_bar_db: dict | None = None, active_db: float = -40.0) -> None:
    """Assign ``class`` in place (advisory; confirm by ear).

    With stems (per-bar RMS dB, 1-based bar index = list index + 1): drums/bass
    active -> groove (or drop when the section starts on a drop >= 0.5); neither
    active -> breakdown, or build when the level rises across the section.
    Without stems the same rule runs on the section ``bass_db`` (30-150 Hz) level.
    First/last quiet sections become intro/outro.
    """
    if not sections:
        return
    drop_bars = {d["bar"] for d in drops if d.get("confidence", 0) >= 0.5}
    max_rms = max(s["rms_db"] for s in sections)
    max_low = max(s["bass_db"] for s in sections)

    def low_active(s: dict) -> bool:
        if stems_bar_db:
            vals = []
            for stem in ("drums", "bass"):
                arr = stems_bar_db.get(stem) or []
                vals += [v for v in arr[s["start_bar"] - 1:s["end_bar"] - 1] if v is not None]
            return bool(vals) and max(vals) > active_db
        return s["bass_db"] > max_low - 12.0

    for i, s in enumerate(sections):
        quiet = s["rms_db"] < max_rms - 9.0
        if low_active(s):
            cls = "drop" if s["start_bar"] in drop_bars else "groove"
        else:
            cls = "build" if s.get("rise_db", 0.0) > 3.0 else "breakdown"
        if quiet and i == 0:
            cls = "intro"
        elif quiet and i == len(sections) - 1 and len(sections) > 1:
            cls = "outro"
        s["class"] = cls


# ------------------------------------------------------------------------ ffmpeg

Runner = Callable[[Sequence[str]], "subprocess.CompletedProcess"]


FFMPEG_TIMEOUT_S = 600


def default_runner(argv: Sequence[str]):
    try:
        return subprocess.run(list(argv), capture_output=True, timeout=FFMPEG_TIMEOUT_S)  # argv list, never a shell
    except subprocess.TimeoutExpired as e:
        raise RuntimeError(f"{argv[0]} timed out after {e.timeout:g}s") from e


def run_ffmpeg(args: Sequence[str], runner: Runner | None = None, exe: str = "ffmpeg"):
    """Run ffmpeg with an argument vector. Raises RuntimeError on non-zero exit."""
    argv = [exe, *[str(a) for a in args]]
    r = (runner or default_runner)(argv)
    if r.returncode != 0:
        err = r.stderr.decode(errors="replace") if isinstance(r.stderr, bytes) else (r.stderr or "")
        raise RuntimeError(f"{exe} failed ({r.returncode}): {err.strip()[-400:]}")
    return r


# ------------------------------------------------------------------ model weights

MAX_MODEL_BYTES = 200 * 1024 * 1024
_ESS = "https://essentia.upf.edu/models"
# Discogs-EffNet embedding + tag heads (MTG, CC BY-NC-SA 4.0 — fetched, never redistributed).
MODEL_TABLE: dict[str, dict[str, str]] = {
    "discogs-effnet-bs64-1.pb": {
        "url": f"{_ESS}/music-style-classification/discogs-effnet/discogs-effnet-bs64-1.pb",
        "sha256": "3ed9af50d5367c0b9c795b294b00e7599e4943244f4cbd376869f3bfc87721b1"},
    "discogs-effnet-bs64-1.json": {
        "url": f"{_ESS}/music-style-classification/discogs-effnet/discogs-effnet-bs64-1.json",
        "sha256": "395479c8d0e23c1185bf903079c38b9c536014787db6e1184abd68463c92b2da"},
    "genre_discogs400-discogs-effnet-1.pb": {
        "url": f"{_ESS}/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.pb",
        "sha256": "3885ba078a35249af94b8e5e4247689afac40deca4401a4bc888daf5a579c01c"},
    "genre_discogs400-discogs-effnet-1.json": {
        "url": f"{_ESS}/classification-heads/genre_discogs400/genre_discogs400-discogs-effnet-1.json",
        "sha256": "2d367319d9b782ffa10f69abf0e805b3ac4e10899025e5bdbaceda3919b243e0"},
    "mtg_jamendo_instrument-discogs-effnet-1.pb": {
        "url": f"{_ESS}/classification-heads/mtg_jamendo_instrument/mtg_jamendo_instrument-discogs-effnet-1.pb",
        "sha256": "2e8c3003c722e098da371b6a1f7ad0ce62fac0dcfc09c7c7997d430941196c2a"},
    "mtg_jamendo_instrument-discogs-effnet-1.json": {
        "url": f"{_ESS}/classification-heads/mtg_jamendo_instrument/mtg_jamendo_instrument-discogs-effnet-1.json",
        "sha256": "7d02204c6451b5615e2968ec6364bbae3b915c886e608f05f00d3a38dc5177c4"},
    "mtg_jamendo_moodtheme-discogs-effnet-1.pb": {
        "url": f"{_ESS}/classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.pb",
        "sha256": "03f2b047020aee4ab39f8880da7bdae2a36d06a1508d656c6d424ad4d6de07a9"},
    "mtg_jamendo_moodtheme-discogs-effnet-1.json": {
        "url": f"{_ESS}/classification-heads/mtg_jamendo_moodtheme/mtg_jamendo_moodtheme-discogs-effnet-1.json",
        "sha256": "d62cd90263e4d613fa7fcce7a831e339450394794af63685f96e065c1a896ab0"},
}


class ModelError(RuntimeError):
    """A model file failed verification or download."""


def model_cache_dir() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "pi-music-production" / "models"


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def verify_model(path: Path, name: str, table: dict | None = None) -> Path:
    """Check ``path`` against the pinned digest; delete it and raise on mismatch."""
    entry = (table or MODEL_TABLE)[name]
    if path.stat().st_size > MAX_MODEL_BYTES or _sha256(path) != entry["sha256"]:
        path.unlink(missing_ok=True)
        raise ModelError(f"model '{name}' failed sha256/size verification; deleted {path}")
    return path


def urllib_fetcher(url: str) -> Iterable[bytes]:
    with urllib.request.urlopen(url, timeout=60) as resp:  # noqa: S310 — fixed https table
        for chunk in iter(lambda: resp.read(1 << 20), b""):
            yield chunk


def fetch_model(name: str, table: dict | None = None, fetcher: Callable[[str], Iterable[bytes]] | None = None,
                cache: Path | None = None, max_bytes: int = MAX_MODEL_BYTES) -> Path:
    """Return a verified cached model file, downloading it once from the fixed table."""
    tbl = table or MODEL_TABLE
    if name not in tbl:
        raise ModelError(f"model '{name}' is not in the built-in table")
    cdir = cache or model_cache_dir()
    cdir.mkdir(parents=True, exist_ok=True)
    dst = cdir / name
    if dst.exists():
        return verify_model(dst, name, tbl)
    part = dst.with_name(dst.name + ".partial")
    size = 0
    try:
        with open(part, "wb") as fh:
            for chunk in (fetcher or urllib_fetcher)(tbl[name]["url"]):
                size += len(chunk)
                if size > max_bytes:
                    raise ModelError(f"model '{name}' exceeds the {max_bytes} byte cap; aborted")
                fh.write(chunk)
        os.replace(part, dst)
    except OSError as e:  # includes urllib.error.URLError / timeouts
        part.unlink(missing_ok=True)
        raise ModelError(f"model '{name}' download failed ({e}); re-run to retry") from e
    except BaseException:
        part.unlink(missing_ok=True)
        raise
    return verify_model(dst, name, tbl)


def db(x: float, floor: float = -120.0) -> float:
    """Amplitude -> dB with a floor (no -inf in contracts)."""
    return max(floor, 20.0 * math.log10(x)) if x > 0 else floor
