#!/usr/bin/env bash

set -Eeuo pipefail

echo "========================================"
echo "Installing yt-dlp"
echo "========================================"

YTDLP_DIR="$(pwd)/bin"
YTDLP_PATH="$YTDLP_DIR/yt-dlp_linux"

echo "Working directory: $(pwd)"
echo "Target: $YTDLP_PATH"

mkdir -p "$YTDLP_DIR"

echo "Downloading yt-dlp..."

curl \
  --fail \
  --show-error \
  --location \
  --retry 5 \
  --retry-delay 2 \
  --connect-timeout 15 \
  --max-time 300 \
  --output "$YTDLP_PATH" \
  "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux"

echo "Checking downloaded file..."

if [ ! -f "$YTDLP_PATH" ]; then
    echo "ERROR: yt-dlp file does not exist"
    exit 1
fi

if [ ! -s "$YTDLP_PATH" ]; then
    echo "ERROR: yt-dlp file is empty"
    exit 1
fi

chmod +x "$YTDLP_PATH"

echo "File information:"
ls -lh "$YTDLP_PATH"
file "$YTDLP_PATH"

echo "Testing yt-dlp..."

"$YTDLP_PATH" --version

echo "========================================"
echo "yt-dlp installation successful"
echo "========================================"
