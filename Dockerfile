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
      jq \
      libsecret-tools \
      tini \
 && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 10001 agy \
 && useradd --uid 10001 --gid 10001 --create-home --shell /bin/bash agy \
 && install -d -m 0755 -o agy -g agy /workspace \
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
RUN curl -fsSL https://antigravity.google/cli/install.sh \
  | bash -s -- --dir /home/agy/.local/bin \
 && test -x /home/agy/.local/bin/agy

WORKDIR /app
COPY --chown=agy:agy . /app
USER root
RUN find /app/docker -type f -name '*.sh' -exec sed -i 's/\r$//' {} + \
 && sed -i 's/\r$//' /app/docker/workspace/verified-agy-versions.txt \
 && chmod +x /app/docker/*.sh /app/docker/tests/*.sh 2>/dev/null || true
USER agy

ENV AGY_BIN=/home/agy/.local/bin/agy
ENV STATE_DIR=/home/agy/.local/state/agy-bridge
ENV KEYRING_PASSWORD_FILE=/home/agy/.local/share/agy-secrets/keyring_password

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["bash"]
