"""Dockerfile browser provisioning (change: fix-doc-engine-arm64-chromium).

NOTE: the text guard (E1) pins *wording*, not behaviour (design D5). Behavioural
evidence is the build-time smoke RUN plus manual tasks 6.1-6.4. E2-E5 run the
Dockerfile's browser ``RUN`` body / ``mmdc`` shim under stub binaries on PATH;
no Docker needed. Run:

    python -m pytest packages/document-converter/engine/tests -q
"""
import os
import re
import stat
import subprocess
from pathlib import Path

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent
DOCKERFILE = (ENGINE_DIR / "Dockerfile").read_text(encoding="utf-8")

STUBBED = ["npm", "npx", "apt-get", "ln", "mkdir", "rm"]


def _browser_run_body() -> str:
    """The browser-provisioning RUN, line-continuations joined, `RUN ` stripped."""
    lines = DOCKERFILE.split("\n")
    start = next(i for i, l in enumerate(lines) if l.startswith("RUN set -eu; \\"))
    end = start
    while lines[end].rstrip().endswith("\\"):
        end += 1
    body = " ".join(l.rstrip().rstrip("\\").strip() for l in lines[start : end + 1])
    assert "dpkg --print-architecture" in body
    return body[len("RUN "):]


def _stub_env(tmp_path: Path, dpkg_arch: str):
    bindir = tmp_path / "bin"
    bindir.mkdir()
    log = tmp_path / "calls.log"
    log.write_text("")
    for name in STUBBED:
        p = bindir / name
        p.write_text(f'#!/bin/sh\necho "{name} $*" >> "{log}"\n')
        p.chmod(p.stat().st_mode | stat.S_IXUSR)
    dp = bindir / "dpkg"
    dp.write_text(f'#!/bin/sh\nprintf "%s" "{dpkg_arch}"\n')
    dp.chmod(dp.stat().st_mode | stat.S_IXUSR)
    fd = bindir / "find"
    fd.write_text('#!/bin/sh\necho /opt/dl/x/chrome-headless-shell\n')
    fd.chmod(fd.stat().st_mode | stat.S_IXUSR)
    env = dict(os.environ)
    env["PATH"] = f"{bindir}:{env['PATH']}"
    return env, log


def _run_body(tmp_path, arch, body=None):
    env, log = _stub_env(tmp_path, arch)
    proc = subprocess.run(
        ["sh", "-c", body or _browser_run_body()],
        capture_output=True, text=True, env=env,
    )
    return proc, log.read_text().splitlines()


def test_dockerfile_text_guard():  # E1
    assert not re.search(r"chrome-headless-shell@stable", DOCKERFILE)
    assert 'case "$(dpkg --print-architecture)"' in DOCKERFILE
    for arm in ("amd64)", "arm64)", "*)"):
        assert arm in DOCKERFILE
    arm64_part = DOCKERFILE.split("arm64)", 1)[1].split(";;", 1)[0]
    assert "chromium" in arm64_part
    assert re.search(r"^FROM python:3\.12-slim-\w+", DOCKERFILE, re.MULTILINE)
    assert re.search(r"@mermaid-js/mermaid-cli@\d+\.\d+\.\d+", DOCKERFILE)
    assert "mermaid-cli@stable" not in DOCKERFILE
    # smoke RUN exists after the shim and after COPY . /engine/
    smoke = DOCKERFILE.index("render_diagram")
    assert smoke > DOCKERFILE.index("COPY . /engine/")
    assert smoke > DOCKERFILE.index("/usr/local/bin/mmdc")


@pytest.mark.parametrize("arch", ["ppc64le", "armhf", ""])
def test_unsupported_arch_fails_before_any_install(tmp_path, arch):  # E2
    proc, calls = _run_body(tmp_path, arch)
    assert proc.returncode != 0
    assert f"unsupported build architecture: {arch}" in proc.stderr
    assert calls == []


def test_arch_decision_table(tmp_path):  # E3
    (tmp_path / "a").mkdir()
    proc, calls = _run_body(tmp_path / "a", "amd64")
    assert proc.returncode == 0, proc.stderr
    joined = "\n".join(calls)
    assert re.search(r"npx .*@puppeteer/browsers install chrome-headless-shell@\d+\.\d+\.\d+\.\d+", joined)
    assert "apt-get" not in joined

    (tmp_path / "b").mkdir()
    fake = tmp_path / "chromium"
    fake.write_text("#!/bin/sh\n")
    fake.chmod(0o755)
    body = _browser_run_body().replace("/usr/bin/chromium", str(fake))
    proc, calls = _run_body(tmp_path / "b", "arm64", body)
    assert proc.returncode == 0, proc.stderr
    joined = "\n".join(calls)
    assert "apt-get update" in joined
    assert "apt-get install -y --no-install-recommends chromium" in joined
    assert "mkdir -p /opt/chrome-headless-shell" in joined
    assert f"ln -s {fake} /opt/chrome-headless-shell/chrome-headless-shell" in joined
    assert "browsers install" not in joined


def test_arm64_missing_chromium_fails(tmp_path):  # E4
    body = _browser_run_body().replace("/usr/bin/chromium", str(tmp_path / "absent"))
    proc, calls = _run_body(tmp_path, "arm64", body)
    assert proc.returncode != 0
    assert "chromium not executable" in proc.stderr


def _shim_text() -> str:
    m = re.search(r"printf '(#!/bin/sh[^']*)'", DOCKERFILE)
    assert m, "mmdc shim printf not found"
    return subprocess.run(["printf", m.group(1)], capture_output=True, text=True).stdout


@pytest.mark.parametrize("marker_mode", ["set", "unset", "empty"])
@pytest.mark.parametrize("node_rc", [0, 3])
def test_shim_marker(tmp_path, marker_mode, node_rc):  # E5
    bindir = tmp_path / "bin"
    bindir.mkdir()
    argv_log = tmp_path / "argv.log"
    node = bindir / "node"
    node.write_text(f'#!/bin/sh\necho "$@" > "{argv_log}"\nexit {node_rc}\n')
    node.chmod(0o755)
    shim = tmp_path / "mmdc"
    shim.write_text(_shim_text())
    marker = tmp_path / "marker"
    env = dict(os.environ, PATH=f"{bindir}:{os.environ['PATH']}")
    env.pop("PI_DOC_MMDC_MARKER", None)
    if marker_mode == "set":
        env["PI_DOC_MMDC_MARKER"] = str(marker)
    elif marker_mode == "empty":
        env["PI_DOC_MMDC_MARKER"] = ""
    proc = subprocess.run(["sh", str(shim), "-i", "x.mmd", "-o", "x.png"], env=env, capture_output=True, text=True)
    assert proc.returncode == node_rc
    assert marker.exists() == (marker_mode == "set")
    argv = argv_log.read_text().split()
    assert argv[0].endswith("/cli.js")
    assert argv[1:3] == ["-p", "/opt/puppeteer.json"]
    assert argv[3:] == ["-i", "x.mmd", "-o", "x.png"]
