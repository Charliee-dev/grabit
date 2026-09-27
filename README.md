# GrabIt

A free media downloader for public content. Paste a link from YouTube, Instagram, Facebook, Pinterest, X (Twitter), TikTok, Dailymotion, or any direct media file URL — GrabIt analyzes it and lets you download in the best available quality.

The API supports public, directly accessible media files. Platform sources run through a
locally executed [yt-dlp](https://github.com/yt-dlp/yt-dlp) binary (Unlicense) using fixed
argument arrays — no shell, no user-controlled flags, no credentials, no cookies.

## Supported Platforms

| Platform | What's Supported |
|---|---|
| **YouTube** | Video (up to 4K with ffmpeg), audio (MP3, M4A, Opus) |
| **Instagram** | Posts, Reels, IGTV videos and images |
| **Facebook** | Public videos and video audio |
| **Pinterest** | Public pin videos and images |
| **X (Twitter)** | Public tweet videos and audio |
| **TikTok** | Public videos |
| **Dailymotion** | Public videos |
| **Direct Media** | MP4, WebM, MKV, MOV, MP3, M4A, AAC, OGG, WAV, FLAC, JPG, PNG, WebP, GIF |

## Deployment

### Frontend (GitHub Pages)

The frontend is automatically deployed to GitHub Pages via `.github/workflows/pages.yml`.
The workflow requires the `GRABIT_API_BASE_URL` GitHub repository variable to be set
to the deployed API URL (e.g., `https://grabit-api-yf49.onrender.com/api`).

### Backend (Render)

The backend is auto-deployed to Render via `render.yaml`.

## Environment

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `5001` | HTTP listener port |
| `HOST` | `0.0.0.0` | Listener interface |
| `FRONTEND_ORIGINS` | `http://localhost:5500,http://127.0.0.1:5500` | Comma-separated exact browser origins allowed by CORS |
| `MAX_FILE_SIZE_MB` | `250` | Maximum accepted media size |
| `ANALYZE_TIMEOUT_MS` | `12000` | Total time allowed for direct-media analysis |
| `DOWNLOAD_TIMEOUT_MS` | `30000` | Total time allowed to retrieve a file |
| `MAX_REDIRECTS` | `4` | Maximum redirects, revalidated at each hop |
| `YTDLP_PATH` | _(empty)_ | Path to yt-dlp binary for platform sources |
| `FFMPEG_PATH` | _(empty)_ | Path to ffmpeg, enables merged video options |
| `EXTRACT_TIMEOUT_MS` | `20000` | Extraction metadata timeout |
| `EXTRACT_DOWNLOAD_TIMEOUT_MS` | `120000` | Extraction download timeout |
| `MAX_CONCURRENT_EXTRACTIONS` | `2` | Simultaneous yt-dlp processes |

## Docs

See [backend/README.md](backend/README.md) for full API documentation.
