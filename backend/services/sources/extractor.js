import { readdir, rm, stat } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { AppError } from "../../utils/appError.js";
import { downloadExtractedMedia, extractMediaInfo, ffmpegAvailable, isExtractorConfigured } from "../extractor/ytDlpRunner.js";
import { contentTypeForFormat, findOption, mapRealFormats, sanitizeExtractorTitle } from "../extractor/formatMapper.js";

const EXTRACTOR_HOSTS = new Map([
  ["youtube.com", { id: "youtube", label: "YouTube" }],
  ["youtu.be", { id: "youtube", label: "YouTube" }],
  ["youtube-nocookie.com", { id: "youtube", label: "YouTube" }],
  ["googlevideo.com", { id: "youtube", label: "YouTube" }],
  ["dailymotion.com", { id: "dailymotion", label: "Dailymotion" }],
  ["dai.ly", { id: "dailymotion", label: "Dailymotion" }],
  ["tiktok.com", { id: "tiktok", label: "TikTok" }],
  ["x.com", { id: "x", label: "X" }],
  ["twitter.com", { id: "x", label: "X" }],
  ["instagram.com", { id: "instagram", label: "Instagram" }],
  ["facebook.com", { id: "facebook", label: "Facebook" }],
  ["fb.watch", { id: "facebook", label: "Facebook" }],
  ["pinterest.com", { id: "pinterest", label: "Pinterest" }],
  ["pin.it", { id: "pinterest", label: "Pinterest" }],
  // Reddit and Vimeo are intentionally absent: verified limitations (Reddit IP-blocks
  // datacenter requests, Vimeo requires login) keep them on dedicated unsupported stubs.
]);

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX_ENTRIES = 256;
const analysisCache = new Map();

function matchesHost(hostname) {
  const normalized = hostname.toLowerCase().replace(/\.$/, "");
  return [...EXTRACTOR_HOSTS.keys()].some((host) => normalized === host || normalized.endsWith(`.${host}`));
}

function hostInfo(url) {
  const normalized = url.hostname.toLowerCase().replace(/\.$/, "");
  const entry = [...EXTRACTOR_HOSTS.entries()].find(([host]) => normalized === host || normalized.endsWith(`.${host}`));
  return entry ? { host: entry[0], ...entry[1] } : null;
}

function cacheKey(url) {
  return url.href;
}

function cacheGet(url) {
  const entry = analysisCache.get(cacheKey(url));
  if (!entry) return null;
  if (Date.now() - entry.storedAt > CACHE_TTL_MS) {
    analysisCache.delete(cacheKey(url));
    return null;
  }
  return entry;
}

function cacheSet(url, value) {
  if (analysisCache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = analysisCache.keys().next().value;
    analysisCache.delete(oldestKey);
  }
  analysisCache.set(cacheKey(url), { ...value, storedAt: Date.now() });
}

export function clearExtractorCacheForTests() {
  analysisCache.clear();
}

function requireVideo(info) {
  if (!info || info._type === "playlist" || Array.isArray(info.entries)) {
    throw new AppError(415, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.", {
      source: { detected: true, supported: false, reason: "playlist_unsupported" },
    });
  }
  if (info.live_status === "is_live" || info.is_live === true) {
    throw new AppError(415, "SOURCE_NOT_SUPPORTED", "This source isn't supported yet.", {
      source: { detected: true, supported: false, reason: "live_not_supported" },
    });
  }
  return info;
}

function buildAnalysis(url, info, host) {
  // Platform mode: media URLs come from the platform's own extracted metadata, not
  // from user input, so yt-dlp may orchestrate HLS/DASH segment downloads within
  // the fixed host allowlist. User-supplied direct-media URLs never reach this
  // path and remain strictly single-file through GrabIt's own SSRF-hardened
  // fetcher. Without ffmpeg only single-file audio/video formats are offered.
  const mergeFormat = ffmpegAvailable() ? "mp4" : undefined;
  const { options } = mapRealFormats(info.formats, { mergeFormat, allowSegmented: true });
  const firstOption = options[0];
  const hasVideo = options.some((option) => option.mediaType === "video");
  const sizeBytes = firstOption?.sizeBytes ?? null;
  const thumbnail = typeof info.thumbnail === "string" && /^https:\/\/\S+$/.test(info.thumbnail) && info.thumbnail.length <= 2048
    ? info.thumbnail
    : null;

  const analysis = {
    source: host.label,
    title: sanitizeExtractorTitle(info.title, info.id),
    thumbnail,
    mediaType: hasVideo ? "video" : "audio",
    duration: Number.isFinite(info.duration) && info.duration > 0 ? Math.round(info.duration) : null,
    sizeBytes,
    contentType: contentTypeForFormat(firstOption.format),
    downloadUrl: url.href,
    options,
  };

  cacheSet(url, { analysis, options });
  return analysis;
}

async function analyzeExtractorMedia(url, host) {
  const cached = cacheGet(url);
  if (cached) return cached.analysis;

  const info = await extractMediaInfo(url.href);
  return buildAnalysis(url, requireVideo(info), host);
}

async function downloadExtractorMedia(url, optionId, response) {
  const host = hostInfo(url);
  const cached = cacheGet(url);
  let analysis;
  let options;

  if (cached) {
    ({ analysis, options } = cached);
  } else {
    const info = requireVideo(await extractMediaInfo(url.href));
    analysis = buildAnalysis(url, info, host);
    options = cacheGet(url).options;
  }

  const option = findOption(options, optionId);
  const formatSelector = String(option.selector || "");
  if (!/^[A-Za-z0-9_.+-]{1,100}$/.test(formatSelector)) {
    throw new AppError(502, "EXTRACTION_FAILED", "Media information for this link couldn't be read right now.");
  }

  const temporaryDirectory = await downloadExtractedMedia(url.href, formatSelector);
  try {
    const files = (await readdir(temporaryDirectory)).filter((name) => !name.startsWith("."));
    if (files.length !== 1) {
      throw new AppError(502, "EXTRACTION_FAILED", "The media file couldn't be prepared for download.");
    }
    const temporaryFile = path.join(temporaryDirectory, files[0]);
    const fileInfo = await stat(temporaryFile);
    if (fileInfo.size === 0) {
      throw new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
    }

    const filename = `${analysis.title.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 72) || "media"}.${option.format}`;
    response.status(200);
    response.set({
      // Per-option content type: audio options must not inherit the video type
      // of the recommended option.
      "Content-Type": contentTypeForFormat(option.format),
      "Content-Length": String(fileInfo.size),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });

    const abortController = new AbortController();
    response.once("close", () => abortController.abort());
    await pipeline(createReadStream(temporaryFile), response, { signal: abortController.signal });
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => {});
  }
}

const extractorAdapter = {
  id: "extractor",
  requiresExtractor: true,
  supported: true,
  canHandle: (url) => matchesHost(url.hostname),
  detectId: (url) => hostInfo(url)?.id || "extractor",
  analyze: (url) => analyzeExtractorMedia(url, hostInfo(url)),
  download: (url, optionId, response) => downloadExtractorMedia(url, optionId, response),
};

export function isExtractorBackedSource(url) {
  return matchesHost(url.hostname);
}

export function extractorReady() {
  return isExtractorConfigured();
}

export default extractorAdapter;
