# GrabIt API

The API supports public, directly accessible media files and platform sources through a
locally executed [yt-dlp](https://github.com/yt-dlp/yt-dlp) binary (Unlicense) using fixed
argument arrays — no shell, no user-controlled flags, no credentials, no cookies.

## Supported Platforms

| Platform | Hosts | Notes |
|---|---|---|
| **YouTube** | youtube.com, youtu.be, googlevideo.com | Full support with ffmpeg merging |
| **Instagram** | instagram.com | Public posts, reels, IGTV |
| **Facebook** | facebook.com, fb.watch | Public videos |
| **Pinterest** | pinterest.com, pin.it | Public pins with media |
| **X (Twitter)** | x.com, twitter.com | Public tweets with media |
| **TikTok** | tiktok.com | Public videos (uses browser impersonation) |
| **Dailymotion** | dailymotion.com, dai.ly | Public videos |
| **Direct Media** | any public URL | MP4, WebM, MKV, MP3, M4A, AAC, OGG, WAV, FLAC, JPG, PNG, WebP, GIF |

**Honestly unsupported:** Reddit (IP-blocks datacenter requests), Vimeo (requires login).

## Setup

```powershell
cd backend
Copy-Item .env.example .env  # only the first time
npm install
npm run dev
```

Use `npm start` for a non-watching local/production process. The API defaults to port `5001`. Keep the frontend on its separate static server (`node frontend-server.js` from the project root).

To enable platform sources, point `YTDLP_PATH` at a yt-dlp binary. With `ffmpeg` (or the optional `ffmpeg-static` npm package) also available, DASH-only sources such as YouTube expose real merged video options; without it, only single-file formats are offered and the API reports honestly.

## Environment

| Variable | Default | Purpose |
|---|---:|---|
| `PORT` | `5001` | HTTP listener port; hosting providers may supply this value. |
| `HOST` | `0.0.0.0` | Listener interface. Use `127.0.0.1` for a local-only binding. |
| `FRONTEND_ORIGINS` | `http://localhost:5500,http://127.0.0.1:5500` | Comma-separated exact browser origins allowed by CORS. |
| `MAX_FILE_SIZE_MB` | `250` | Maximum accepted media size; configuration is capped at 500 MB. |
| `ANALYZE_TIMEOUT_MS` | `12000` | Total time allowed for direct-media analysis. |
| `DOWNLOAD_TIMEOUT_MS` | `30000` | Total time allowed to retrieve a file from its source. |
| `MAX_REDIRECTS` | `4` | Maximum redirects, with public-address validation repeated at each hop. |
| `YTDLP_PATH` | _(empty)_ | Path to a yt-dlp binary. When unset, platform sources report `detected: true, supported: false`. |
| `FFMPEG_PATH` | _(empty)_ | Path to ffmpeg. Falls back to the optional `ffmpeg-static` package. Enables merged video options for DASH-only sources. |
| `EXTRACT_TIMEOUT_MS` | `20000` | Total time allowed for platform metadata extraction. |
| `EXTRACT_DOWNLOAD_TIMEOUT_MS` | `120000` | Total time allowed for platform media retrieval (segments/merges take longer). |
| `MAX_CONCURRENT_EXTRACTIONS` | `2` | Simultaneous yt-dlp child processes (a free-tier RAM guard). |

Copy `.env.example` to `.env` and keep `.env` out of version control. For production, set `FRONTEND_ORIGINS` to the deployed frontend origin and set `HOST`/`PORT` to the hosting provider's requirements.

## API

### `GET /api/health`

Returns a small JSON health response.

### `POST /api/analyze`

Request: `{"url":"https://public.example/video.mp4"}`. A successful response includes the detected source label, URL-derived title, media type, real size when the origin reports one, and the real available options with the best one marked recommended. Unknown sources return `UNSUPPORTED_SOURCE`. Recognized but unavailable platforms return `SOURCE_NOT_SUPPORTED` with `supported: false`.

Platform sources currently enabled: **YouTube**, **Instagram**, **Facebook**, **Pinterest**, **X (Twitter)**, **TikTok**, and **Dailymotion** — all through the same yt-dlp extractor path. Sources detected but honestly unsupported: Reddit (IP-blocked), Vimeo (login-gated).

### `POST /api/download`

Request: `{"url":"https://public.example/video.mp4","optionId":"original-mp4"}`. The API repeats URL/source analysis and validates the option before requesting the media. It checks status, content type, declared and streamed size, and timeout; generates a safe attachment filename; stages data in a unique OS temporary directory; streams the completed file to the response; and removes the temporary directory in `finally` cleanup. Files are not retained as user data.

## Current direct media types

The direct-media adapter accepts matching file extensions and exact supported MIME types for MP4/M4V, MOV, WebM, MKV, OGV, 3GP, AVI, MP3, M4A, AAC, OGG/OGA, WAV, FLAC, JPG/JPEG, PNG, WebP, and GIF. Other file types, generic web pages, mismatched MIME types, non-public resources, and non-standard ports are rejected. Platform sources expose only formats the extractor actually reports: progressive single files, audio-only files, and — when ffmpeg is configured — merged video options built from real streams. The API does not transcode or invent quality levels, titles, thumbnails, or durations.

## Extraction engine security model

- The yt-dlp binary is spawned with a **fixed argument array**; the URL is the only user-influenced value, passed after `--` and never through a shell.
- Child processes run under **hard timeouts**, output-size caps, a **concurrency limit**, and a download **byte ceiling** (`--max-filesize`).
- Extraction writes only into a unique OS temporary directory that is removed in `finally` cleanup; `--no-cache-dir` prevents cache writes.
- Error output is mapped to bounded, safe error codes; stack traces and local paths are never exposed.
- Platform mode allows yt-dlp to orchestrate HLS/DASH segment downloads **only** inside the fixed host allowlist (YouTube, Instagram, Facebook, Pinterest, X, TikTok, Dailymotion); user-supplied direct-media URLs still flow exclusively through GrabIt's own SSRF-hardened fetcher as single files.
- No cookies, credentials, or browser impersonation are ever passed; login-gated content returns `PRIVATE_OR_PROTECTED`.

## Safety and operational limits

- Only HTTP/HTTPS URLs are accepted. URL credentials, local names, private/reserved IPv4 and IPv6 targets, and DNS results containing any non-public address are blocked.
- Each redirect is revalidated and pinned to the validated DNS result to reduce rebinding risk. Redirect count, request size, upstream timeouts, file size, and request rates are bounded.
- Requests use Helmet, exact-origin CORS, a 16 KB JSON limit, and structured errors that do not expose stack traces or local paths.
- Analysis is limited to 30 requests per 15 minutes per client IP; downloads are limited to 8 per 15 minutes. The default rate-limit store is in memory and should be replaced with a shared store before horizontally scaling multiple API instances.
- No platform extraction, authentication, DRM, paywall, private-content, or other access-control bypass is implemented.

## Tests

Run the automated backend suite with `npm test`. The tests cover URL/IP validation, adapter detection, content type and size checks, filename sanitation, timeout behavior, request-body limits, CORS, rate limiting, and structured API errors. Public-source integration checks should also be run against reachable direct media URLs before a release.
