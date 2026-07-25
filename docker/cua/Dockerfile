FROM node:20-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    clang \
    curl \
    dbus-x11 \
    file \
    git \
    gnome-screenshot \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libgtk-3-dev \
    libwebkit2gtk-4.1-dev \
    mold \
    openbox \
    patchelf \
    pkg-config \
    procps \
    python3 \
    python3-dev \
    python3-tk \
    python3-venv \
    rsync \
    scrot \
    websockify \
    x11-utils \
    x11vnc \
    xauth \
    xdotool \
    xvfb \
    novnc \
  && rm -rf /var/lib/apt/lists/*

RUN useradd --create-home --shell /bin/bash schaltwerk
RUN mkdir -p /workspace/source /home/schaltwerk/app /home/schaltwerk/runtime \
  && chown -R schaltwerk:schaltwerk /workspace /home/schaltwerk
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY desktopctl.sh /usr/local/bin/desktopctl
COPY agent-stub.sh /usr/local/bin/schaltwerk-agent-stub
RUN chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/desktopctl /usr/local/bin/schaltwerk-agent-stub \
  && for agent in amp claude codex copilot droid gemini kilo opencode pi qwen; do \
    ln -s /usr/local/bin/schaltwerk-agent-stub "/usr/local/bin/$agent"; \
  done

USER schaltwerk
WORKDIR /home/schaltwerk

ENV DISPLAY=:99 \
    SCHALTWERK_SOURCE_DIR=/workspace/source \
    SCHALTWERK_APP_DIR=/home/schaltwerk/app \
    SCHALTWERK_RUNTIME_DIR=/home/schaltwerk/runtime \
    SCHALTWERK_COMPUTER_SERVER_PORT=8000 \
    BUN_INSTALL=/home/schaltwerk/.bun \
    PATH=/home/schaltwerk/.venv/bin:/home/schaltwerk/.cargo/bin:/home/schaltwerk/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

RUN curl -fsSL https://sh.rustup.rs | bash -s -- -y --profile minimal --default-toolchain stable
RUN curl -fsSL https://bun.sh/install | bash
RUN python3 -m venv /home/schaltwerk/.venv
RUN /home/schaltwerk/.venv/bin/pip install --no-cache-dir cua-computer-server

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
