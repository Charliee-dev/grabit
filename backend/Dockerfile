# syntax=docker/dockerfile:1

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV FFPROBE_PATH=/usr/bin/ffprobe

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        curl \
        tini \
    && rm -rf /var/lib/apt/lists/*

ARG YTDLP_VERSION=2026.08.19

RUN curl --fail --show-error --location --retry 5 --retry-delay 2 \
        --connect-timeout 15 --max-time 300 \
        -o /usr/local/bin/yt-dlp \
        "https://github.com/yt-dlp/yt-dlp/releases/download/${YTDLP_VERSION}/yt-dlp_linux" \
    && chmod 0755 /usr/local/bin/yt-dlp \
    && test -s /usr/local/bin/yt-dlp \
    && /usr/local/bin/yt-dlp --version \
    && ffmpeg -version \
    && ffprobe -version

WORKDIR /app

COPY package*.json ./

RUN npm ci --omit=dev \
    && npm cache clean --force

COPY . .

RUN test -x /usr/local/bin/yt-dlp \
    && test -x /usr/bin/ffmpeg \
    && test -x /usr/bin/ffprobe

ENV PORT=10000

ENTRYPOINT ["/usr/bin/tini", "--"]

CMD ["node", "server.js"]
