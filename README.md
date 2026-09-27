# GrabIt

GrabIt is a free, no-account utility for checking and downloading public direct media files. The approved dark interface stays separate from the Node.js API.

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
- Original-file analysis and download for supported audio, video, and image content. The highest/only available option is marked **⭐ Recommended**; it is not a paid tier.
- Image preview when the direct image URL is still publicly accessible.
- File size and content type are checked during analysis and checked again during download. Downloaded files are streamed through unique temporary storage and removed after the response finishes or fails.
- Browsers with the File System Access API stream downloads to the chosen file. Other browsers use a Blob download, which can temporarily use browser memory for larger files.

The API does not manufacture resolutions, duration, thumbnails, or file sizes. Direct media only exposes the original file option. Platform pages such as YouTube, Instagram, Pinterest, TikTok, Facebook, and X are recognized by host and explicitly reported as detected but unsupported. No scraping, account access, DRM, paywall, private-content, or access-control bypass is implemented.

## Configure a deployed API

## Deployment

The [Render Blueprint](render.yaml) configures the API service. Create it from the connected GitHub repository and set `FRONTEND_ORIGINS` to the exact GitHub Pages origin (for example, `https://your-user.github.io`). Render provides `PORT`; the service binds to `0.0.0.0` and exposes `/api/health` as its health check.

The GitHub Pages workflow publishes only `index.html`, `styles.css`, `app.js`, and the generated `api-config.js`; it does not expose the backend files as site assets. Before the first Pages deployment, set the repository variable `GRABIT_API_BASE_URL` to the deployed API URL ending in `/api`, such as `https://grabit-api.onrender.com/api`. The workflow validates this HTTPS URL and embeds it in the static frontend. Local development keeps using the API default in [api-config.js](api-config.js).

GitHub Pages requires a public repository on GitHub Free. Render's free web services may spin down after inactivity and take about a minute to wake. See [Render's free instance limits](https://render.com/docs/free). Use a paid instance only if you choose to remove those limits.

See [backend/README.md](backend/README.md) for environment variables, API details, security limits, and tests.
