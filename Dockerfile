FROM denoland/deno:debian-2.9.6

USER root
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      bash \
      ca-certificates \
      coreutils \
      curl \
      dbus \
      dbus-x11 \
      gnome-keyring \
      gzip \
      libsecret-tools \
      tar \
      tini \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 agy \
 && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash agy \
 && install -d -m 0700 -o agy -g agy /home/agy/.cache \
 && install -d -m 0700 -o agy -g agy \
      /home/agy/.cache/deno \
      /home/agy/.gemini \
      /home/agy/.local/bin \
      /home/agy/.local/share/keyrings \
      /home/agy/.local/share/agy-secrets \
      /home/agy/.local/state/agy-bridge

USER agy
ENV HOME=/home/agy
ENV DENO_DIR=/home/agy/.cache/deno
ENV PATH=/home/agy/.local/bin:${PATH}

ARG AGY_VERSION=1.2.2
ARG AGY_ARTIFACT_URL=https://storage.googleapis.com/antigravity-public/antigravity-cli/1.2.2-6061403484848128/linux-x64/cli_linux_x64.tar.gz
ARG AGY_ARTIFACT_SHA512=74342cf2a78b344392e573b638a648a6ad1f8e877f494b96e20f9c2b79158d5c423c40b2dcf788703362bb0a9150f09c707fde599d7557ce01c12208802a63cb
RUN set -eux; \
    staging="$(mktemp -d)"; \
    trap 'rm -rf "$staging"' EXIT; \
    curl -fsSL "$AGY_ARTIFACT_URL" -o "$staging/agy.tar.gz"; \
    printf '%s  %s\n' "$AGY_ARTIFACT_SHA512" "$staging/agy.tar.gz" | sha512sum -c -; \
    tar -xzf "$staging/agy.tar.gz" -C "$staging" antigravity; \
    install -m 0755 "$staging/antigravity" /home/agy/.local/bin/agy; \
    /home/agy/.local/bin/agy --version | grep -F "$AGY_VERSION"

WORKDIR /app
COPY --chown=agy:agy . /app
USER root
RUN find /app/docker -type f -name '*.sh' -exec sed -i 's/\r$//' {} + \
 && chmod +x /app/docker/*.sh
USER agy

ENV AGY_BIN=/home/agy/.local/bin/agy
ENV STATE_DIR=/home/agy/.local/state/agy-bridge
ENV KEYRING_PASSWORD_FILE=/home/agy/.local/share/agy-secrets/keyring_password

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash"]
