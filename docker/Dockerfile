# syntax=docker/dockerfile:1
# ---------------------------------------------------------------------------
# pi-dashboard all-in-one image.
#
# Stage `base`  — Debian Bookworm + Node 22 LTS, system tools, code-server, zrok.
# Stage `app`   — non-root `pi` user, global pi agent, built dashboard, cleanup.
#
# Debian (glibc), NOT Alpine (musl): node-pty needs glibc for correct PTY
# behavior. See openspec change docker-packaging, Decision 2.
# ---------------------------------------------------------------------------

# ============================ base stage ===================================
FROM node:22-bookworm-slim AS base

# Pinned tool versions — override at build time with --build-arg.
ARG CODE_SERVER_VERSION=4.96.4
ARG ZROK_VERSION=1.0.6
ARG GH_VERSION=2.62.0
ARG JJ_VERSION=0.24.0

ENV DEBIAN_FRONTEND=noninteractive

# 1.1 System packages. build-essential + python3 needed only for node-pty
# native compile in the app stage; removed there afterwards.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      tmux \
      jq \
      git \
      curl \
      ca-certificates \
      ripgrep \
      fd-find \
      build-essential \
      python3 \
 && rm -rf /var/lib/apt/lists/*

# fd-find ships the binary as `fdfind` on Debian; expose `fd` too.
RUN ln -s "$(command -v fdfind)" /usr/local/bin/fd || true

# 1.2 code-server (pinned). Official installer auto-detects arch.
RUN curl -fsSL https://code-server.dev/install.sh \
      | sh -s -- --version "${CODE_SERVER_VERSION}" \
 && code-server --version

# 1.3 zrok (pinned). Map Debian arch → zrok release arch.
RUN set -eux; \
    deb_arch="$(dpkg --print-architecture)"; \
    case "${deb_arch}" in \
      amd64) zrok_arch="amd64" ;; \
      arm64) zrok_arch="arm64" ;; \
      armhf) zrok_arch="armv7" ;; \
      *) echo "unsupported arch: ${deb_arch}" >&2; exit 1 ;; \
    esac; \
    asset="zrok_${ZROK_VERSION}_linux_${zrok_arch}.tar.gz"; \
    base="https://github.com/openziti/zrok/releases/download/v${ZROK_VERSION}"; \
    curl -fsSL -o "/tmp/${asset}" "${base}/${asset}"; \
    curl -fsSL -o /tmp/zrok-checksums.sha256 "${base}/checksums.sha256.txt"; \
    # Verify the downloaded tarball against the published checksum (fail build on mismatch).
    # Checksum lines prefix the asset with `./`; match either a space or slash before it.
    ( cd /tmp && grep -E "[ /]${asset}\$" zrok-checksums.sha256 | sha256sum -c - ); \
    tar -xzf "/tmp/${asset}" -C /usr/local/bin zrok; \
    rm "/tmp/${asset}" /tmp/zrok-checksums.sha256; \
    zrok version

# 1.3b GitHub CLI (pinned). Spawned/probed by the dashboard git panel.
RUN set -eux; \
    deb_arch="$(dpkg --print-architecture)"; \
    case "${deb_arch}" in \
      amd64) gh_arch="amd64" ;; \
      arm64) gh_arch="arm64" ;; \
      armhf) gh_arch="armv6" ;; \
      *) echo "unsupported arch: ${deb_arch}" >&2; exit 1 ;; \
    esac; \
    asset="gh_${GH_VERSION}_linux_${gh_arch}.tar.gz"; \
    base="https://github.com/cli/cli/releases/download/v${GH_VERSION}"; \
    curl -fsSL -o "/tmp/${asset}" "${base}/${asset}"; \
    curl -fsSL -o /tmp/gh-checksums.txt "${base}/gh_${GH_VERSION}_checksums.txt"; \
    # Verify the tarball against the published checksum (fail build on mismatch).
    ( cd /tmp && grep -E "[ /]${asset}\$" gh-checksums.txt | sha256sum -c - ); \
    rm /tmp/gh-checksums.txt; \
    tar -xzf "/tmp/${asset}" -C /tmp; \
    install -m 0755 "/tmp/gh_${GH_VERSION}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh; \
    rm -rf "/tmp/${asset}" "/tmp/gh_${GH_VERSION}_linux_${gh_arch}"; \
    gh --version

# 1.3c jujutsu (pinned). Spawned/probed by the dashboard jj panel. musl
# static binary runs fine on glibc.
RUN set -eux; \
    deb_arch="$(dpkg --print-architecture)"; \
    case "${deb_arch}" in \
      amd64) jj_arch="x86_64-unknown-linux-musl" ;; \
      arm64) jj_arch="aarch64-unknown-linux-musl" ;; \
      *) echo "unsupported arch: ${deb_arch}" >&2; exit 1 ;; \
    esac; \
    asset="jj-v${JJ_VERSION}-${jj_arch}.tar.gz"; \
    base="https://github.com/jj-vcs/jj/releases/download/v${JJ_VERSION}"; \
    # jj releases publish no checksum manifest (only the tarballs), so unlike
    # zrok/gh there is nothing to verify against; rely on HTTPS + pinned tag.
    curl -fsSL -o "/tmp/${asset}" "${base}/${asset}"; \
    # jj tarball stores the binary as ./jj (not bare jj like zrok).
    tar -xzf "/tmp/${asset}" -C /usr/local/bin ./jj; \
    rm "/tmp/${asset}"; \
    jj --version

# ============================ app stage ====================================
FROM base AS app

# 1.4 Non-root user (UID 1000). node:22 image already ships a `node` user at
# UID 1000; create a dedicated `pi` user instead for clarity.
RUN if getent passwd 1000 >/dev/null; then userdel -r "$(getent passwd 1000 | cut -d: -f1)"; fi \
 && useradd --create-home --uid 1000 --shell /bin/bash pi

# 1.4 Global pi coding agent + openspec (spawned/probed by the dashboard).
# Install must be fatal; the version probes stay non-fatal (grouped so a
# non-zero `--version` can't mask an `npm install -g` failure).
RUN npm install -g @mariozechner/pi-coding-agent openspec \
 && { pi --version || true; } \
 && { openspec --version || true; }

WORKDIR /app

# 1.5 Install deps + build the web client. Copy package manifests first for
# layer caching, then the full source.
COPY package.json package-lock.json ./
# Root tsconfigs that every package extends (../../tsconfig.base.json).
COPY tsconfig.base.json tsconfig.json ./
# Root scripts/ (postinstall: maybe-patch-package + fix-pty-permissions) and
# patches/ (replayed by patch-package during install).
COPY scripts ./scripts
COPY patches ./patches
COPY packages ./packages
# Faux model fixture (provider + scenario catalog). test-entrypoint.sh stages
# these as a global auto-discovered pi extension under PI_E2E_SEED so UI-spawned
# sessions drive a key-free faux model. See change: add-e2e-faux-model-roundtrip.
COPY qa/fixtures ./qa/fixtures
COPY --chmod=0755 docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY docker/scripts ./docker/scripts

RUN npm install \
 && npm run build \
 # Link the root package so `pi-dashboard` is on PATH.
 && npm link \
 # 1.5 Drop build toolchain — not needed at runtime (~200 MB saved).
 && apt-get purge -y --auto-remove build-essential python3 \
 && rm -rf /var/lib/apt/lists/* \
 && chown -R pi:pi /app

USER pi
ENV HOME=/home/pi

# 1.6 Network + storage surface.
EXPOSE 8000 9999
VOLUME ["/home/pi/.pi", "/home/pi/.zrok2"]

# 2.3 Entrypoint seeds auth, starts tmux, execs pi-dashboard.
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
# 1.6 Default command — entrypoint passes these through to pi-dashboard.
CMD ["start"]
