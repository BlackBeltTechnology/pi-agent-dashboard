"""footage-redaction: redact.py (test-plan E31-E34, X7-X10). Stdlib + pytest; ffmpeg only for E34."""
from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / ".pi" / "skills" / "footage-redaction" / "scripts" / "redact.py"
_spec = importlib.util.spec_from_file_location("redact", SCRIPT)
redact = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(redact)

W, H = 1920, 1080
HAS_FFMPEG = shutil.which("ffmpeg") is not None and shutil.which("ffprobe") is not None
NAVY = [0, 0, 128]


def blur_entry(**det) -> dict:
    d = {"x": 1400, "y": 500, "w": 40, "h": 20, "rgb": NAVY, "tol": 40, "min_ratio": 0.5}
    d.update(det)
    return {"x": 100, "y": 300, "w": 400, "h": 200, "pad_s": 0.25, "detect": d}


class FakeRunner:
    """Answers ffprobe with a frame size and the detection pass with synthetic rgb24 frames."""

    def __init__(self, active: set[int] | None = None, encode_rc: int = 0, make_partial: bool = False):
        self.calls: list[list[str]] = []
        self.active = active or set()
        self.encode_rc = encode_rc
        self.make_partial = make_partial

    def __call__(self, argv):
        argv = list(argv)
        self.calls.append(argv)
        if argv[0] == "ffprobe":
            return SimpleNamespace(returncode=0, stdout=json.dumps({"streams": [{"width": W, "height": H}]}).encode(),
                                   stderr=b"")
        if "rawvideo" in argv:
            w, h = (int(v) for v in argv[argv.index("-vf") + 1].split("crop=")[1].split(":")[:2])
            frames = b"".join(bytes(NAVY) * (w * h) if i in self.active else b"\x80" * (3 * w * h) for i in range(24))
            return SimpleNamespace(returncode=0, stdout=frames, stderr=b"")
        if self.make_partial or self.encode_rc == 0:
            Path(argv[-1]).write_bytes(b"an mp4")  # ffmpeg writes <out>.partial
        return SimpleNamespace(returncode=self.encode_rc, stdout=b"", stderr=b"boom")


def _write_spec(tmp_path: Path, spec: dict) -> Path:
    p = tmp_path / "redact.json"
    p.write_text(json.dumps(spec))
    return p


# --------------------------------------------------------------- E31 validation

VALID = {"crop": {"top": 100}, "delogo": [{"x": 1720, "y": 50, "w": 200, "h": 60, "from": 1, "to": 2}],
         "blur_when": [blur_entry()], "trim": {"from": 0, "to": 5}, "speed": 1}


def _with(path: str, value) -> dict:
    spec = copy.deepcopy(VALID)
    node = spec
    keys = path.split(".")
    for k in keys[:-1]:
        node = node[int(k)] if k.isdigit() else node[k]
    node[keys[-1]] = value
    return spec


@pytest.mark.parametrize("path,value", [
    ("blur_when.0.detect.min_ratio", 0.01), ("blur_when.0.detect.min_ratio", 1),
    ("blur_when.0.detect.tol", 0), ("blur_when.0.detect.tol", 255),
    ("delogo.0.x", 1720),  # x + w = 1920
])
def test_e31_valid_boundaries_accepted(path, value):
    redact.validate(_with(path, value), W, H)


@pytest.mark.parametrize("path,value,field", [
    ("blur_when.0.detect.min_ratio", 0, "blur_when[0].detect.min_ratio"),
    ("blur_when.0.detect.min_ratio", 1.5, "blur_when[0].detect.min_ratio"),
    ("blur_when.0.detect.tol", -1, "blur_when[0].detect.tol"),
    ("blur_when.0.detect.tol", 256, "blur_when[0].detect.tol"),
    ("blur_when.0.detect.rgb", [0, 0, 256], "blur_when[0].detect.rgb"),
    ("blur_when.0.detect.rgb", [1.5, 0, 0], "blur_when[0].detect.rgb"),
    ("delogo.0.x", 1721, "delogo[0]"),
    ("delogo.0.to", 1, "delogo[0]"),  # from == to
    ("speed", 0, "speed"),
    ("trim.to", float("nan"), "trim.to"),
    ("crop.top", 1079, "crop"),  # leaves a 1 px frame
])
def test_e31_invalid_values_rejected(path, value, field):
    with pytest.raises(redact.SpecError) as e:
        redact.validate(_with(path, value), W, H)
    assert e.value.field == field


@pytest.mark.parametrize("spec,field", [
    ({"trim": 5}, "trim"), ({"crop": [100]}, "crop"), ({"delogo": {"x": 1}}, "delogo"),
    ({"delogo": [7]}, "delogo[0]"), ({"blur_when": ["x"]}, "blur_when[0]"), ([], "spec"),
])
def test_e31_wrong_container_types_rejected(spec, field):
    with pytest.raises(redact.SpecError) as e:
        redact.validate(spec, W, H)
    assert e.value.field == field


def test_e31_invalid_spec_writes_nothing(tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    out = tmp_path / "out.mp4"
    rc = redact.main([str(src), str(out), "--spec", str(_write_spec(tmp_path, _with("delogo.0.x", 1721)))],
                     runner=FakeRunner())
    assert rc != 0 and not out.exists()


# -------------------------------------------------- E32 coordinate space + order

def test_e32_graph_order_and_shift():
    spec = {"trim": {"from": 10, "to": 20}, "crop": {"top": 100},
            "delogo": [{"x": 10, "y": 50, "w": 100, "h": 40, "from": 10, "to": 20}],
            "blur_when": [blur_entry()], "fps": 30}
    redact.validate(spec, W, H)  # y=50 box is valid against the UNcropped frame
    g = redact.build_graph(spec, [[(12.0, 14.0)]], W, H)
    order = [g.index("trim="), g.index("delogo="), g.index("boxblur"), g.rindex("crop=1920:980"),
             g.index("setpts=PTS/"), g.index("fps=")]
    assert order == sorted(order), g
    assert "between(t,2,4)" in g
    assert "delogo=x=10:y=50" in g  # source-frame coordinates, applied before the crop


# ------------------------------------------------------- E33 window resolution

def test_e33_popup_window():
    samples = [(round(i * 0.25, 2), 1.0 if 2.0 <= i * 0.25 <= 4.0 else 0.0) for i in range(24)]
    wins = redact.resolve_windows(samples, 0.5, 0.25)
    assert len(wins) == 1
    a, b = wins[0]
    assert abs(a - 1.75) <= 0.25 and abs(b - 4.25) <= 0.25


# ------------------------------------------------------------ X7-X10 (injected)

def test_x7_never_active(tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    spec = _write_spec(tmp_path, {"blur_when": [blur_entry()]})
    out = tmp_path / "out.mp4"
    r = FakeRunner()
    assert redact.main([str(src), str(out), "--spec", str(spec), "--strict"], runner=r) != 0
    assert not out.exists()

    r = FakeRunner()
    assert redact.main([str(src), str(out), "--spec", str(spec)], runner=r) == 0
    assert any("-filter_complex" in c for c in r.calls)  # processing continued


def test_x7_messages_name_the_entry(tmp_path, capsys):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    spec = _write_spec(tmp_path, {"blur_when": [blur_entry()]})
    redact.main([str(src), str(tmp_path / "o.mp4"), "--spec", str(spec), "--strict"], runner=FakeRunner())
    assert "blur_when[0]" in capsys.readouterr().err
    redact.main([str(src), str(tmp_path / "o.mp4"), "--spec", str(spec), "--dry-run"], runner=FakeRunner())
    assert "warning: blur_when[0]" in capsys.readouterr().err


def test_x8_ffmpeg_failure_leaves_nothing(tmp_path):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    out = tmp_path / "out.mp4"
    rc = redact.main([str(src), str(out), "--spec", str(_write_spec(tmp_path, {"crop": {"top": 100}}))],
                     runner=FakeRunner(encode_rc=1, make_partial=True))
    assert rc != 0
    assert not out.exists() and not (tmp_path / "out.mp4.partial").exists()


def test_x9_shell_metacharacters_are_literal(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    src = tmp_path / "a;touch PWNED $(id).mp4"
    src.write_bytes(b"x")
    spec = _write_spec(tmp_path, {"blur_when": [blur_entry()]})
    for extra in (["--dry-run"], []):
        r = FakeRunner(active={10})
        assert redact.main([str(src), str(tmp_path / "o.mp4"), "--spec", str(spec), *extra], runner=r) == 0
        for call in r.calls:
            assert isinstance(call, list)
            assert str(src) in call  # one literal argv element
    assert not (tmp_path / "PWNED").exists()
    assert "shell=True" not in SCRIPT.read_text()


def test_x10_dry_run_prints_and_writes_nothing(tmp_path, capsys):
    src = tmp_path / "in.mp4"
    src.write_bytes(b"x")
    out = tmp_path / "out.mp4"
    r = FakeRunner(active=set(range(8, 17)))
    spec = _write_spec(tmp_path, {"crop": {"top": 100}, "blur_when": [blur_entry()]})
    assert redact.main([str(src), str(out), "--spec", str(spec), "--dry-run"], runner=r) == 0
    printed = json.loads(capsys.readouterr().out)
    assert printed["windows"]["blur_when[0]"] and "boxblur" in printed["graph"]
    assert not out.exists()
    assert not any("-filter_complex" in c for c in r.calls)


# ------------------------------------------------------------- E34 real encode

def _gray_frame(path: Path, t: float, w: int, h: int) -> bytes:
    return subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t}", "-i", str(path), "-frames:v", "1",
                           "-f", "rawvideo", "-pix_fmt", "gray", "-"], capture_output=True, check=True).stdout


def _variance(frame: bytes, fw: int, x: int, y: int, w: int, h: int) -> float:
    px = [frame[(y + j) * fw + x + i] for j in range(h) for i in range(0, w, 2)]
    m = sum(px) / len(px)
    return sum((p - m) ** 2 for p in px) / len(px)


@pytest.mark.skipif(not HAS_FFMPEG, reason="ffmpeg/ffprobe not installed")
def test_e34_real_encode_crop_and_timed_blur(tmp_path):
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i",
                    "nullsrc=s=1920x1080:r=10:d=6,format=yuv444p,geq=lum='random(1)*255':cb=128:cr=128,"
                    "drawbox=x=1380:y=480:w=100:h=80:color=0x000080:t=fill:enable='between(t,2,4)'",
                    "-c:v", "libx264", "-preset", "ultrafast", "-qp", "0", "-pix_fmt", "yuv444p", str(src)],
                   check=True)
    spec = _write_spec(tmp_path, {"crop": {"top": 100, "bottom": 80}, "fps": 10, "blur_when": [blur_entry()]})
    out = tmp_path / "out.mp4"
    assert redact.main([str(src), str(out), "--spec", str(spec), "--crf", "18"]) == 0
    probe = json.loads(subprocess.run(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
                                       "stream=width,height", "-of", "json", str(out)],
                                      capture_output=True, check=True).stdout)["streams"][0]
    assert (probe["width"], probe["height"]) == (1920, 900)
    box = (100, 300 - 100, 400, 200)  # target box, shifted by the 100 px top crop
    v_blur = _variance(_gray_frame(out, 3.0, 1920, 900), 1920, *box)
    v_clear = _variance(_gray_frame(out, 1.0, 1920, 900), 1920, *box)
    v_after = _variance(_gray_frame(out, 5.0, 1920, 900), 1920, *box)
    assert v_blur < v_clear / 4 and v_blur < v_after / 4, (v_blur, v_clear, v_after)
