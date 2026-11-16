"""Loopback-only publish of the Gotenberg + PlantUML helper containers (NET-03, D6).

`subprocess.run` is replaced by a small fake docker that records every argv, so
no Docker daemon is needed. Run:

    python -m pytest packages/document-converter/engine/tests/test_container_publish.py
"""
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ENGINE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ENGINE_DIR))

from document_converter import pdf_server, plantuml_server  # noqa: E402

SERVERS = {
    "pdf": (pdf_server, pdf_server.PDFServer, pdf_server.PDFServerError, 3000),
    "plantuml": (
        plantuml_server,
        plantuml_server.PlantUMLServer,
        plantuml_server.PlantUMLServerError,
        8080,
    ),
}
NEW_PORT = 45678


def bindings(cport, *host_ips):
    return json.dumps(
        {f"{cport}/tcp": [{"HostIp": ip, "HostPort": "5555"} for ip in host_ips]}
    )


class FakeDocker:
    def __init__(self, name, *, exists=False, running=False, inspect_out="",
                 inspect_rc=0, rm_rc=0, rm_stderr=""):
        self.name = name
        self.exists = exists or running
        self.running = running
        self.inspect_out = inspect_out
        self.inspect_rc = inspect_rc
        self.rm_rc = rm_rc
        self.rm_stderr = rm_stderr
        self.calls = []

    def __call__(self, argv, **kwargs):
        self.calls.append(list(argv))
        out, rc, err = "", 0, ""
        verb = argv[1]
        if verb == "ps":
            listed = (self.exists if "-a" in argv else self.running)
            out = self.name + "\n" if listed else ""
        elif verb == "inspect":
            out, rc = self.inspect_out, self.inspect_rc
        elif verb == "port":
            out = "127.0.0.1:5555\n" if self.running else ""
        elif verb == "rm":
            rc, err = self.rm_rc, self.rm_stderr
            if rc == 0:
                self.exists = self.running = False
        elif verb == "run":
            self.exists = self.running = True
        elif verb == "start":
            self.running = True
        return SimpleNamespace(returncode=rc, stdout=out, stderr=err)

    def verbs(self):
        return [c[1] for c in self.calls]

    def runs(self):
        return [c for c in self.calls if c[1] == "run"]


@pytest.fixture(params=list(SERVERS))
def env(request, monkeypatch):
    module, cls, err, cport = SERVERS[request.param]
    registered = []
    monkeypatch.setattr(module.atexit, "register", lambda fn: registered.append(fn))
    monkeypatch.setattr(module, "get_available_port", lambda: NEW_PORT)
    monkeypatch.setattr(cls, "_wait_for_healthy", lambda self, timeout=None: True)

    def make(**state):
        fake = FakeDocker(cls.CONTAINER_NAME, **state)
        monkeypatch.setattr(module.subprocess, "run", fake)
        return fake

    return SimpleNamespace(module=module, server=cls(), err=err, cport=cport,
                           make=make, registered=registered)


WILDCARD_IPS = ["", "0.0.0.0", "::"]


def assert_recreated(fake, server, cport):
    verbs = fake.verbs()
    assert "start" not in verbs
    assert verbs.index("rm") < verbs.index("run")
    rm = next(c for c in fake.calls if c[1] == "rm")
    assert rm[:3] == ["docker", "rm", "-f"] and rm[3] == server.CONTAINER_NAME
    (run,) = fake.runs()
    assert f"127.0.0.1:{NEW_PORT}:{cport}" in run
    assert server._started_by_us is True


def test_create_publishes_on_loopback(env):
    fake = env.make()
    url = env.server.ensure_running()
    (run,) = fake.runs()
    assert run[run.index("-p") + 1] == f"127.0.0.1:{NEW_PORT}:{env.cport}"
    assert f"{NEW_PORT}:{env.cport}" not in [a for a in run if not a.startswith("127.")]
    assert url == f"http://localhost:{NEW_PORT}"
    assert "inspect" not in fake.verbs()


@pytest.mark.parametrize("running", [True, False])
@pytest.mark.parametrize("ip", WILDCARD_IPS)
def test_wildcard_container_is_recreated(env, caplog, ip, running):
    fake = env.make(running=running, exists=True,
                    inspect_out=bindings(env.cport, ip))
    with caplog.at_level(logging.WARNING):
        url = env.server.ensure_running()
    assert_recreated(fake, env.server, env.cport)
    assert url == f"http://localhost:{NEW_PORT}"
    assert len([r for r in caplog.records if r.levelno == logging.WARNING]) == 1


@pytest.mark.parametrize("ip", ["127.0.0.2", "localhost"])
def test_only_literal_loopback_counts(env, ip):
    fake = env.make(running=True, inspect_out=bindings(env.cport, ip))
    env.server.ensure_running()
    assert_recreated(fake, env.server, env.cport)


def test_mixed_loopback_and_wildcard_is_non_loopback(env):
    fake = env.make(running=True,
                    inspect_out=bindings(env.cport, "127.0.0.1", "0.0.0.0"))
    env.server.ensure_running()
    assert_recreated(fake, env.server, env.cport)


@pytest.mark.parametrize("out", [
    "", "null", "{}", '{"%d/tcp":null}', '{"%d/tcp":[]}',
    '{"%d/tcp":[{"HostPort":"1"}]}', '{"%d/tcp":[{"HostIp":', "not json",
    '{"9999/tcp":[{"HostIp":"127.0.0.1","HostPort":"1"}]}',
])
def test_unparsable_or_absent_bindings_are_non_loopback(env, out):
    fake = env.make(running=True, inspect_out=out.replace("%d", str(env.cport)))
    env.server.ensure_running()
    assert_recreated(fake, env.server, env.cport)


def test_inspect_failure_is_non_loopback(env):
    fake = env.make(running=True, inspect_rc=1,
                    inspect_out=bindings(env.cport, "127.0.0.1"))
    env.server.ensure_running()
    assert_recreated(fake, env.server, env.cport)


def test_inspect_queries_port_bindings(env):
    fake = env.make(running=True, inspect_out=bindings(env.cport, "127.0.0.1"))
    env.server.ensure_running()
    inspect = next(c for c in fake.calls if c[1] == "inspect")
    assert "{{json .HostConfig.PortBindings}}" in inspect
    assert env.server.CONTAINER_NAME in inspect


@pytest.mark.parametrize("ip", ["127.0.0.1", "::1"])
def test_loopback_running_is_reused(env, ip):
    fake = env.make(running=True, inspect_out=bindings(env.cport, ip))
    url = env.server.ensure_running()
    assert url == "http://localhost:5555"
    assert not {"rm", "run", "start"} & set(fake.verbs())


@pytest.mark.parametrize("ip", ["127.0.0.1", "::1"])
def test_loopback_stopped_is_started(env, ip):
    fake = env.make(exists=True, running=False,
                    inspect_out=bindings(env.cport, ip))
    env.server.ensure_running()
    verbs = fake.verbs()
    assert "start" in verbs
    assert not {"rm", "run"} & set(verbs)


def test_stopped_wildcard_never_started_and_inspect_first(env):
    # `docker port` prints nothing for a stopped container.
    fake = env.make(exists=True, running=False,
                    inspect_out=bindings(env.cport, "0.0.0.0"))
    assert env.server.get_container_port() is None
    fake.calls.clear()
    env.server.ensure_running()
    verbs = fake.verbs()
    assert verbs.index("inspect") < verbs.index("rm") < verbs.index("run")
    assert "start" not in verbs
    assert_recreated(fake, env.server, env.cport)


def test_recreate_bookkeeping(env):
    env.make(running=True, inspect_out=bindings(env.cport, "0.0.0.0"))
    url = env.server.ensure_running()
    assert env.server._port == NEW_PORT
    assert url == f"http://localhost:{NEW_PORT}"
    assert len(env.registered) == 1


def test_rm_failure_fails_closed(env):
    fake = env.make(running=False, exists=True, rm_rc=1, rm_stderr="boom",
                    inspect_out=bindings(env.cport, "0.0.0.0"))
    with pytest.raises(env.err):
        env.server.ensure_running()
    assert not {"start", "run"} & set(fake.verbs())


def test_rm_no_such_container_continues_to_create(env):
    fake = env.make(running=True, rm_rc=1,
                    rm_stderr="Error response from daemon: No such container: x",
                    inspect_out=bindings(env.cport, "0.0.0.0"))
    env.server.ensure_running()
    assert len(fake.runs()) == 1
    assert "start" not in fake.verbs()


def test_published_on_loopback_helper(env):
    env.make(running=True, inspect_out=bindings(env.cport, "127.0.0.1", "::1"))
    assert env.server._published_on_loopback() is True


def test_names_and_images_unchanged():
    assert pdf_server.PDFServer.IMAGE_NAME == "gotenberg/gotenberg:8"
    assert pdf_server.PDFServer.CONTAINER_NAME == "docconv-pdf-server"
    assert plantuml_server.PlantUMLServer.IMAGE_NAME == "plantuml/plantuml-server:latest"
    assert plantuml_server.PlantUMLServer.CONTAINER_NAME == "docconv-plantuml-server"
