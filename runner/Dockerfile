# syntax=docker/dockerfile:1.7


ARG NODE_VERSION=24
FROM node:${NODE_VERSION}-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates curl tar gzip \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable

RUN useradd --uid 10001 --create-home --shell /usr/sbin/nologin runner \
 && mkdir /workspace /app \
 && chown runner:runner /workspace

COPY run.mjs /app/run.mjs

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

USER runner
WORKDIR /workspace
CMD ["node", "/app/run.mjs"]
