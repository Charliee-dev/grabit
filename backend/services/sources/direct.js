import { MAX_FILE_SIZE_BYTES, ANALYZE_TIMEOUT_MS } from "../../config.js";
import { AppError } from "../../utils/appError.js";
import { requestPublicUrl } from "../../utils/safeHttpRequest.js";
import { downloadDirectMedia } from "../downloadService.js";

const EXTENSIONS = new Map([
  ["mp4", { format: "mp4", mediaTypes: ["video"] }],
  ["m4v", { format: "mp4", mediaTypes: ["video"] }],
  ["mov", { format: "mov", mediaTypes: ["video"] }],
  ["webm", { format: "webm", mediaTypes: ["video", "audio"] }],
  ["mkv", { format: "mkv", mediaTypes: ["video"] }],
  ["ogv", { format: "ogv", mediaTypes: ["video"] }],
  ["3gp", { format: "3gp", mediaTypes: ["video"] }],
  ["avi", { format: "avi", mediaTypes: ["video"] }],
  ["mp3", { format: "mp3", mediaTypes: ["audio"] }],
  ["m4a", { format: "m4a", mediaTypes: ["audio"] }],
  ["aac", { format: "aac", mediaTypes: ["audio"] }],
  ["ogg", { format: "ogg", mediaTypes: ["audio"] }],
  ["oga", { format: "ogg", mediaTypes: ["audio"] }],
  ["wav", { format: "wav", mediaTypes: ["audio"] }],
  ["flac", { format: "flac", mediaTypes: ["audio"] }],
  ["jpg", { format: "jpg", mediaTypes: ["image"] }],
  ["jpeg", { format: "jpg", mediaTypes: ["image"] }],
  ["png", { format: "png", mediaTypes: ["image"] }],
  ["webp", { format: "webp", mediaTypes: ["image"] }],
  ["gif", { format: "gif", mediaTypes: ["image"] }],
]);

const CONTENT_TYPES = new Map([
  ["video/mp4", { mediaType: "video", format: "mp4" }],
  ["video/quicktime", { mediaType: "video", format: "mov" }],
  ["video/webm", { mediaType: "video", format: "webm" }],
  ["video/x-matroska", { mediaType: "video", format: "mkv" }],
  ["video/ogg", { mediaType: "video", format: "ogv" }],
  ["video/3gpp", { mediaType: "video", format: "3gp" }],
  ["video/x-msvideo", { mediaType: "video", format: "avi" }],
  ["audio/mpeg", { mediaType: "audio", format: "mp3" }],
  ["audio/mp4", { mediaType: "audio", format: "m4a" }],
  ["audio/aac", { mediaType: "audio", format: "aac" }],
  ["audio/ogg", { mediaType: "audio", format: "ogg" }],
  ["audio/wav", { mediaType: "audio", format: "wav" }],
  ["audio/x-wav", { mediaType: "audio", format: "wav" }],
  ["audio/flac", { mediaType: "audio", format: "flac" }],
  ["audio/webm", { mediaType: "audio", format: "webm" }],
  ["image/jpeg", { mediaType: "image", format: "jpg" }],
  ["image/png", { mediaType: "image", format: "png" }],
  ["image/webp", { mediaType: "image", format: "webp" }],
  ["image/gif", { mediaType: "image", format: "gif" }],
]);

function extensionInfo(url) {
  const extension = url.pathname.toLowerCase().match(/\.([a-z0-9]{2,5})$/)?.[1];
  return extension ? EXTENSIONS.get(extension) : undefined;
}

function safeTitle(url) {
  const segment = url.pathname.split("/").filter(Boolean).at(-1) || "Direct media file";
  let decoded = segment;
  try { decoded = decodeURIComponent(segment); } catch { /* Keep the encoded URL name. */ }

  const title = decoded
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return title || "Direct media file";
}

function responseSize(response) {
  const range = response.headers["content-range"];
  const rangeMatch = range?.match(/\/(\d+)$/);
  if (rangeMatch) return Number(rangeMatch[1]);

  const length = response.headers["content-length"];
  return length && /^\d+$/.test(length) ? Number(length) : null;
}

export function validateMediaResponse(response, sourceExtensionInfo) {
  const contentType = String(response.headers["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  const contentInfo = CONTENT_TYPES.get(contentType);

  if (!contentInfo || !sourceExtensionInfo?.mediaTypes.includes(contentInfo.mediaType)) {
    throw new AppError(415, "INVALID_CONTENT_TYPE", "This link doesn't point to a supported media file.");
  }

  const sizeBytes = responseSize(response);
  if (sizeBytes === 0) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
  }
  if (sizeBytes !== null && sizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new AppError(413, "FILE_TOO_LARGE", "This file is too large to download.");
  }

  return { contentType, ...contentInfo, sizeBytes };
}

function checkUpstreamStatus(response) {
  const status = response.statusCode || 0;
  if (status >= 200 && status < 300) return;
  if (status === 401 || status === 403) {
    throw new AppError(403, "PRIVATE_OR_PROTECTED", "This media isn't publicly accessible.");
  }
  if (status === 404 || status === 410) {
    throw new AppError(404, "MEDIA_NOT_FOUND", "We couldn't find accessible media at that link.");
  }
  if (status === 405 || status === 501) {
    throw new AppError(502, "DOWNLOAD_FAILED", "This media server doesn't allow a safe availability check.");
  }
  throw new AppError(502, "DOWNLOAD_FAILED", "The media server couldn't provide this file.");
}

async function analyzeDirectMedia(url) {
  const sourceExtensionInfo = extensionInfo(url);
  let result = await requestPublicUrl(url, { method: "HEAD", timeoutMs: ANALYZE_TIMEOUT_MS });
  let { response } = result;

  if (response.statusCode === 405 || response.statusCode === 501) {
    response.destroy();
    result = await requestPublicUrl(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      timeoutMs: ANALYZE_TIMEOUT_MS,
    });
    response = result.response;
  }

  try {
    checkUpstreamStatus(response);
    const metadata = validateMediaResponse(response, sourceExtensionInfo);
    const title = safeTitle(result.url);
    const option = {
      id: `original-${metadata.format}`,
      label: "Original",
      quality: "Original",
      format: metadata.format,
      recommended: true,
      ...(metadata.sizeBytes === null ? {} : { sizeBytes: metadata.sizeBytes }),
    };

    return {
      source: "Direct media",
      title,
      thumbnail: metadata.mediaType === "image" ? result.url.href : null,
      mediaType: metadata.mediaType,
      duration: null,
      sizeBytes: metadata.sizeBytes,
      contentType: metadata.contentType,
      downloadUrl: result.url.href,
      options: [option],
    };
  } finally {
    response.destroy();
  }
}

const directAdapter = {
  id: "direct",
  supported: true,
  canHandle: (url) => Boolean(extensionInfo(url)),
  analyze: analyzeDirectMedia,
  async download(url, optionId, response) {
    const analysis = await analyzeDirectMedia(url);
    await downloadDirectMedia(analysis, optionId, response);
  },
};

export default directAdapter;
