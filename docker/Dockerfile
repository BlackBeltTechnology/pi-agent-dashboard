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
    ( cd /tmp && grep " ${asset}\$" zrok-checksums.sha256 | sha256sum -c - ); \
    tar -xzf "/tmp/${asset}" -C /usr/local/bin zrok; \
    rm "/tmp/${asset}" /tmp/zrok-checksums.sha256; \
    zrok version

# ============================ app stage ====================================
FROM base AS app

# 1.4 Non-root user (UID 1000). node:22 image already ships a `node` user at
# UID 1000; create a dedicated `pi` user instead for clarity.
RUN if getent passwd 1000 >/dev/null; then userdel -r "$(getent passwd 1000 | cut -d: -f1)"; fi \
 && useradd --create-home --uid 1000 --shell /bin/bash pi

# 1.4 Global pi coding agent.
RUN npm install -g @mariozechner/pi-coding-agent \
 && pi --version || true

WORKDIR /app

# 1.5 Install deps + build the web client. Copy package manifests first for
# layer caching, then the full source.
COPY package.json package-lock.json ./
COPY packages ./packages
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
