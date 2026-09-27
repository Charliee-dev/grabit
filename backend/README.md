# GrabIt API

The API supports public, directly accessible media files only. Platform adapters detect YouTube, Instagram, Pinterest, TikTok, Facebook, and X URLs, but those sources remain unsupported until a permitted retrieval method is implemented and tested.

## Setup

```powershell
cd backend
Copy-Item .env.example .env  # only the first time
npm install
npm run dev
```

Use `npm start` for a non-watching local/production process. The API defaults to port `5001`. Keep the frontend on its separate static server (`node frontend-server.js` from the project root).

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

Copy `.env.example` to `.env` and keep `.env` out of version control. For production, set `FRONTEND_ORIGINS` to the deployed frontend origin and set `HOST`/`PORT` to the hosting provider's requirements.

## API

### `GET /api/health`

Returns a small JSON health response.

### `POST /api/analyze`

Request: `{"url":"https://public.example/video.mp4"}`. A successful response includes the detected source label, URL-derived title, media type, real size when the origin reports one, and one `Original` option marked recommended. Unknown sources return `UNSUPPORTED_SOURCE`. Recognized platform pages return `SOURCE_NOT_SUPPORTED` and detection details with `supported: false`.

### `POST /api/download`

Request: `{"url":"https://public.example/video.mp4","optionId":"original-mp4"}`. The API repeats URL/source analysis and validates the option before requesting the media. It checks status, content type, declared and streamed size, and timeout; generates a safe attachment filename; stages data in a unique OS temporary directory; streams the completed file to the response; and removes the temporary directory in `finally` cleanup. Files are not retained as user data.

## Current direct media types

The adapter accepts matching file extensions and exact supported MIME types for MP4/M4V, MOV, WebM, MKV, OGV, 3GP, AVI, MP3, M4A, AAC, OGG/OGA, WAV, FLAC, JPG/JPEG, PNG, WebP, and GIF. Other file types, generic web pages, mismatched MIME types, non-public resources, and non-standard ports are rejected. Original quality is the only option; the API does not transcode media or invent quality levels, titles, thumbnails, or durations.

## Safety and operational limits

- Only HTTP/HTTPS URLs are accepted. URL credentials, local names, private/reserved IPv4 and IPv6 targets, and DNS results containing any non-public address are blocked.
- Each redirect is revalidated and pinned to the validated DNS result to reduce rebinding risk. Redirect count, request size, upstream timeouts, file size, and request rates are bounded.
- Requests use Helmet, exact-origin CORS, a 16 KB JSON limit, and structured errors that do not expose stack traces or local paths.
- Analysis is limited to 30 requests per 15 minutes per client IP; downloads are limited to 8 per 15 minutes. The default rate-limit store is in memory and should be replaced with a shared store before horizontally scaling multiple API instances.
- No platform extraction, authentication, DRM, paywall, private-content, or other access-control bypass is implemented.

## Tests

Run the automated backend suite with `npm test`. The tests cover URL/IP validation, adapter detection, content type and size checks, filename sanitation, timeout behavior, request-body limits, CORS, rate limiting, and structured API errors. Public-source integration checks should also be run against reachable direct media URLs before a release.
