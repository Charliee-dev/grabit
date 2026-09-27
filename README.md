# GrabIt

GrabIt is a free, no-account utility for checking and downloading public direct media files. The approved dark interface stays separate from the Node.js API.

Live frontend: <https://charliee-dev.github.io/grabit/>  
API health: <https://grabit-api-yf49.onrender.com/api/health>

## Local development

Use Node.js 20 or later. In one terminal, run the backend:

```powershell
cd backend
Copy-Item .env.example .env  # only the first time
npm install
npm run dev
```

In a second terminal from the project root, serve the static frontend:

```powershell
node frontend-server.js
```

Open <http://127.0.0.1:5500/>. The API listens at <http://127.0.0.1:5001/>. The frontend uses that local API by default and does not show sample analysis results if the API is unavailable.

## What works

- Direct public media file links that use a recognized file extension and matching supported media `Content-Type`.
- Platform videos from **YouTube** and **Dailymotion** (verified), with **TikTok** and **X** enabled through the same extraction engine, using a locally executed [yt-dlp](https://github.com/yt-dlp/yt-dlp) binary (Unlicense) with fixed argument arrays.
- Real quality options only: progressive files, audio-only files, and — when ffmpeg is available — merged video options built from real streams. The best available option is marked **⭐ Recommended**; it is not a paid tier.
- Image preview when the direct image URL is still publicly accessible.
- File size and content type are checked during analysis and checked again during download. Downloaded files are streamed through unique temporary storage and removed after the response finishes or fails.
- Browsers with the File System Access API stream downloads to the chosen file. Other browsers use a Blob download, which can temporarily use browser memory for larger files.

The API does not manufacture resolutions, duration, thumbnails, or file sizes. Detected but honestly unsupported platforms: Instagram, Pinterest, Facebook (login/gallery walls), Vimeo (login-gated client), Reddit (extractor failure). No cookies, credentials, scraping of gated content, DRM, paywall, private-content, or access-control bypass is implemented or accepted.

## Configure a deployed API

## Deployment

The [Render Blueprint](render.yaml) configures the API service and downloads the yt-dlp Linux binary during the build. Set `FRONTEND_ORIGINS` to the exact GitHub Pages origin (for example, `https://your-user.github.io`). Render provides `PORT`; the service binds to `0.0.0.0` and exposes `/api/health` as its health check. The extractor adds RAM and CPU load: the blueprint caps concurrent extractions at 1 for the free tier.

The GitHub Pages workflow publishes only `index.html`, `styles.css`, `app.js`, and the generated `api-config.js`; it does not expose the backend files as site assets. Before the first Pages deployment, set the repository variable `GRABIT_API_BASE_URL` to the deployed API URL ending in `/api`, such as `https://grabit-api.onrender.com/api`. The workflow validates this HTTPS URL and embeds it in the static frontend. Local development keeps using the API default in [api-config.js](api-config.js).

GitHub Pages requires a public repository on GitHub Free. Render's free web services may spin down after inactivity and take about a minute to wake. See [Render's free instance limits](https://render.com/docs/free). Use a paid instance only if you choose to remove those limits.

See [backend/README.md](backend/README.md) for environment variables, API details, security limits, and tests.
